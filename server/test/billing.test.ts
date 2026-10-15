import { test, expect } from "bun:test";
import Stripe from "stripe";
import { openDatabase } from "../src/db";
import { BillingService } from "../src/billing";
import { StripeProvider, type StripeConfiguration } from "../src/stripe";
import type { BillingProvider, SubscriptionSnapshot } from "../src/billing-provider";
import { entitlement } from "../src/entitlements";
import { apiHandler } from "../src/http";
import { accounts, billingEvents } from "../src/schema";
import { eq } from "drizzle-orm";

export class FakeBilling implements BillingProvider {
  name = "test"; mode = "test" as const; snapshots: SubscriptionSnapshot[] = [];
  customers = 0; closed = false; failClose = false; requests: string[] = [];
  async validate() {}
  async createCustomer() { this.customers++; return "cus_synthetic"; }
  async subscriptions() { return this.snapshots; }
  async checkout(_customer: string, interval: string) { this.requests.push(interval); return "https://checkout.stripe.com/synthetic"; }
  async portal() { return "https://billing.stripe.com/synthetic"; }
  verifyEvent(body: string, signature: string) { if (signature !== "test") throw new Error("bad signature"); return JSON.parse(body); }
  async closeAccount() { if (this.failClose) throw new Error("provider unavailable"); this.closed = true; }
}
const config: StripeConfiguration = { secretKey: "sk_test_synthetic", webhookSecret: "whsec_synthetic", monthPrice: "price_month", yearPrice: "price_year", origin: "http://localhost:3000", portalConfiguration: "bpc_synthetic", allowLive: false };

test("official Stripe verification rejects forged, changed, expired and wrong-mode events", async () => {
  const provider = new StripeProvider(config);
  const body = JSON.stringify({ id: "evt_test", object: "event", type: "invoice.paid", livemode: false, data: { object: { customer: "cus_synthetic" } } });
  const sign = (payload: string, timestamp?: number) => Stripe.webhooks.generateTestHeaderStringAsync({ payload, secret: config.webhookSecret, timestamp });
  expect(await provider.verifyEvent(body, await sign(body))).toEqual({ id: "evt_test", customerId: "cus_synthetic" });
  await expect(provider.verifyEvent(body, "forged")).rejects.toThrow();
  await expect(provider.verifyEvent(body + " ", await sign(body))).rejects.toThrow();
  await expect(provider.verifyEvent(body, await sign(body, 1))).rejects.toThrow();
  const live = body.replace('"livemode":false', '"livemode":true');
  await expect(provider.verifyEvent(live, await sign(live))).rejects.toThrow();
  expect(() => new StripeProvider({ ...config, secretKey: "sk_live_forbidden" })).toThrow();
  const { db, sqlite } = openDatabase(":memory:");
  const handler = apiHandler(db, async () => null, { configured: false, delete: async () => false }, new BillingService(db, provider));
  expect((await handler(new Request("http://local/api/billing/webhook", { method: "POST", body, headers: { "Stripe-Signature": "forged" } }))).status).toBe(400);
  sqlite.close();
});

test("checkout never grants Plus; current provider truth wins over duplicate and out-of-order events", async () => {
  const { db, sqlite } = openDatabase(":memory:");
  try {
    const provider = new FakeBilling(), billing = new BillingService(db, provider), user = crypto.randomUUID();
    await billing.checkout(user, "test@example.com", "month");
    expect(entitlement(db, user).plan).toBe("free");
    expect(provider.requests).toEqual(["month"]);
    expect(provider.customers).toBe(1);
    provider.snapshots = [{ id: "sub_test", status: "active", priceId: "price_month", paidThrough: Date.now() + 60_000, cancelAtPeriodEnd: false }];
    const event = (id: string) => JSON.stringify({ id, customerId: "cus_synthetic" });
    await billing.webhook(event("evt_paid"), "test");
    await billing.webhook(event("evt_paid"), "test");
    expect(db.select().from(billingEvents).all()).toHaveLength(1);
    expect(entitlement(db, user).plan).toBe("plus");
    await expect(billing.checkout(user, "test@example.com", "year")).rejects.toThrow("already have a subscription");
    provider.snapshots[0]!.cancelAtPeriodEnd = true;
    await billing.webhook(event("evt_cancel_requested"), "test");
    expect(entitlement(db, user).plan).toBe("plus");
    expect(entitlement(db, user).cancelAtPeriodEnd).toBe(true);
    provider.snapshots[0]!.status = "canceled";
    await billing.webhook(event("evt_canceled"), "test");
    await billing.webhook(event("evt_old_paid_delivered_late"), "test");
    expect(entitlement(db, user).plan).toBe("free");
    expect(entitlement(db, crypto.randomUUID()).plan).toBe("free");
    await expect(billing.webhook(JSON.stringify({ id: "evt_unknown", customerId: "cus_unknown" }), "test")).rejects.toThrow("mapping");
  } finally { sqlite.close(); }
});

test("renewals, failed payments and paid-through expiration are provider-independent", async () => {
  const { db, sqlite } = openDatabase(":memory:");
  try {
    const provider = new FakeBilling(), billing = new BillingService(db, provider), user = crypto.randomUUID();
    await billing.checkout(user, "test@example.com", "year");
    const end = Date.now() + 120_000;
    provider.snapshots = [{ id: "sub_year", status: "active", priceId: "price_year", paidThrough: end, cancelAtPeriodEnd: false }];
    await billing.reconcile(user);
    expect(entitlement(db, user).paidThrough).toBe(end);
    provider.snapshots[0]!.paidThrough = end + 120_000;
    await billing.reconcile(user);
    expect(entitlement(db, user).paidThrough).toBe(end + 120_000);
    provider.snapshots[0]!.status = "past_due"; provider.snapshots[0]!.paidThrough = 0;
    await billing.reconcile(user);
    expect(entitlement(db, user, end + 130_000).plan).toBe("free");
    expect(entitlement(db, user).paymentPastDue).toBe(true);
    db.update(accounts).set({ deletionState: "billing" }).where(eq(accounts.userId, user)).run();
    await expect(billing.checkout(user, "test@example.com", "month")).rejects.toThrow("deletion");
  } finally { sqlite.close(); }
});

test("Stripe adapter rejects wrong prices and constructs only configured recurring Checkout", async () => {
  const calls: unknown[] = [];
  const sdk = {
    prices: { retrieve: async (id: string) => ({ active: true, livemode: false, currency: "usd", unit_amount: id === "price_month" ? 149 : 1499, type: "recurring", recurring: { interval: id === "price_month" ? "month" : "year", interval_count: 1, usage_type: "licensed" } }) },
    billingPortal: { configurations: { retrieve: async () => ({ active: true, features: { subscription_cancel: { enabled: true, mode: "at_period_end" }, payment_method_update: { enabled: true }, subscription_update: { enabled: false } } }) } },
    checkout: { sessions: { list: async function* () {}, create: async (args: unknown) => { calls.push(args); return { url: "https://checkout.stripe.com/test" }; } } },
  } as unknown as Stripe;
  const provider = new StripeProvider(config, sdk);
  await provider.validate();
  await provider.checkout("cus_owner", "month", "owner");
  await provider.checkout("cus_owner", "year", "owner");
  expect(calls).toMatchObject([{ customer: "cus_owner", mode: "subscription", line_items: [{ price: "price_month", quantity: 1 }] }, { line_items: [{ price: "price_year", quantity: 1 }] }]);
  sdk.prices.retrieve = (async () => ({ active: true, unit_amount: 199 })) as unknown as typeof sdk.prices.retrieve;
  await expect(provider.validate()).rejects.toThrow("USD");
});

test("deletion still deletes the customer when an open Checkout session disappears", async () => {
  let deleted = false;
  const sdk = {
    customers: { retrieve: async () => ({ id: "cus_test" }), del: async () => { deleted = true; return { deleted: true }; } },
    checkout: { sessions: { list: async function* () { yield { id: "cs_missing" }; }, expire: async () => { throw new Stripe.errors.StripeInvalidRequestError({ message: "Missing session", code: "resource_missing" }); } } },
  } as unknown as Stripe;
  await new StripeProvider(config, sdk).closeAccount("cus_test");
  expect(deleted).toBe(true);
});
