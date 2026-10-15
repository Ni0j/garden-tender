import Stripe from "stripe";
import { isTestingMvp } from "./config";
import { ApiError } from "./errors";
import type { BillingProvider, BillingInterval, SubscriptionSnapshot } from "./billing-provider";

export type StripeConfiguration = { secretKey: string; webhookSecret: string; monthPrice: string; yearPrice: string; origin: string; portalConfiguration: string; allowLive: boolean };
export function stripeConfiguration(): StripeConfiguration | null {
  const secretKey = process.env.STRIPE_SECRET_KEY ?? "";
  if (!secretKey) return null;
  return { secretKey, webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "", monthPrice: process.env.STRIPE_PRICE_MONTHLY ?? "", yearPrice: process.env.STRIPE_PRICE_YEARLY ?? "", origin: process.env.PUBLIC_APP_URL ?? "", portalConfiguration: process.env.STRIPE_PORTAL_CONFIGURATION_ID ?? "", allowLive: process.env.NODE_ENV === "production" && process.env.ALLOW_LIVE_BILLING === "true" };
}
export class StripeProvider implements BillingProvider {
  readonly name = "stripe";
  readonly mode: "test" | "live";
  readonly sdk: Stripe;
  constructor(private config: StripeConfiguration, sdk?: Stripe) {
    this.mode = config.secretKey.startsWith("sk_live_") ? "live" : "test";
    if (!/^sk_(test|live)_/.test(config.secretKey) || (this.mode === "live" && !config.allowLive)) throw new Error("Stripe live billing is disabled. Use a test secret key during development.");
    if (!config.webhookSecret || !config.monthPrice || !config.yearPrice || !config.portalConfiguration || config.monthPrice === config.yearPrice) throw new Error("Complete Stripe webhook, price and portal configuration is required.");
    const origin = new URL(config.origin);
    if (origin.protocol !== "https:" && !(this.mode === "test" && ["localhost", "127.0.0.1"].includes(origin.hostname))) throw new Error("PUBLIC_APP_URL must use HTTPS.");
    this.sdk = sdk ?? new Stripe(config.secretKey, { maxNetworkRetries: 2, timeout: 10_000 });
  }
  async validate() {
    for (const [id, amount, interval] of [[this.config.monthPrice, 149, "month"], [this.config.yearPrice, 1499, "year"]] as const) {
      const price = await this.sdk.prices.retrieve(id);
      if (!price.active || price.livemode !== (this.mode === "live") || price.currency !== "usd" || price.unit_amount !== amount || price.type !== "recurring" || price.recurring?.interval !== interval || price.recurring.interval_count !== 1 || price.recurring.usage_type !== "licensed") throw new Error(`Stripe ${interval} price must be active, USD ${amount / 100}, recurring every one ${interval}, in ${this.mode} mode.`);
    }
    const portal = await this.sdk.billingPortal.configurations.retrieve(this.config.portalConfiguration);
    if (!portal.active || !portal.features.subscription_cancel.enabled || portal.features.subscription_cancel.mode !== "at_period_end" || !portal.features.payment_method_update.enabled || portal.features.subscription_update.enabled) throw new Error("Stripe Portal must allow end-of-period cancellation and payment updates, with plan switching disabled.");
  }
  async createCustomer(userId: string, email: string) {
    const customer = await this.sdk.customers.create({ email, metadata: { garden_user_id: userId } }, { idempotencyKey: `garden-customer-${userId}` });
    return customer.id;
  }
  async subscriptions(customerId: string): Promise<SubscriptionSnapshot[]> {
    const result: SubscriptionSnapshot[] = [];
    for await (const sub of this.sdk.subscriptions.list({ customer: customerId, status: "all", limit: 100, expand: ["data.latest_invoice"] })) {
      const item = sub.items.data[0];
      if (!item || sub.items.data.length !== 1 || item.quantity !== 1 || ![this.config.monthPrice, this.config.yearPrice].includes(item.price.id)) continue;
      const invoice = typeof sub.latest_invoice === "object" ? sub.latest_invoice : null;
      const paidThrough = invoice?.status === "paid" ? item.current_period_end * 1000 : 0;
      result.push({ id: sub.id, status: sub.status, priceId: item.price.id, paidThrough, cancelAtPeriodEnd: sub.cancel_at_period_end });
    }
    return result;
  }
  async checkout(customerId: string, interval: BillingInterval, userId: string) {
    const price = interval === "month" ? this.config.monthPrice : this.config.yearPrice;
    // Reuse an outstanding session and expire the other interval's session.
    for await (const session of this.sdk.checkout.sessions.list({ customer: customerId, status: "open", limit: 100 })) {
      if (session.metadata?.garden_price_id === price && session.url) return session.url;
      await this.sdk.checkout.sessions.expire(session.id);
    }
    const session = await this.sdk.checkout.sessions.create({
      customer: customerId, mode: "subscription", client_reference_id: userId,
      line_items: [{ price, quantity: 1 }], allowed_payment_method_types: ["card"],
      success_url: `${this.config.origin}/?billing=returned`, cancel_url: `${this.config.origin}/?billing=canceled`,
      metadata: { garden_price_id: price }, subscription_data: { metadata: { garden_user_id: userId } },
    }, { idempotencyKey: crypto.randomUUID() });
    if (!session.url) throw new ApiError(502, "Checkout is unavailable. Please try again.");
    return session.url;
  }
  async portal(customerId: string) {
    return (await this.sdk.billingPortal.sessions.create({ customer: customerId, configuration: this.config.portalConfiguration, return_url: `${this.config.origin}/` })).url;
  }
  async verifyEvent(rawBody: string, signature: string) {
    let event: Stripe.Event;
    try { event = await this.sdk.webhooks.constructEventAsync(rawBody, signature, this.config.webhookSecret); }
    catch { throw new ApiError(400, "Invalid webhook signature."); }
    if (event.livemode !== (this.mode === "live")) throw new ApiError(400, "Webhook mode does not match this deployment.");
    const accepted = ["checkout.session.completed", "checkout.session.async_payment_succeeded", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted", "invoice.paid", "invoice.payment_failed", "invoice.payment_action_required", "invoice.finalization_failed"];
    const object = event.data.object as { customer?: string | { id: string } | null };
    const customerId = accepted.includes(event.type) ? (typeof object.customer === "string" ? object.customer : object.customer?.id ?? null) : null;
    return { id: event.id, customerId };
  }
  async closeAccount(customerId: string) {
    const missing = (error: unknown) => error instanceof Stripe.errors.StripeInvalidRequestError && error.code === "resource_missing";
    let customer: Stripe.Customer | Stripe.DeletedCustomer;
    try { customer = await this.sdk.customers.retrieve(customerId); }
    catch (error) { if (missing(error)) return; throw error; }
    if (customer.deleted) return;
    for await (const session of this.sdk.checkout.sessions.list({ customer: customerId, status: "open", limit: 100 })) {
      try { await this.sdk.checkout.sessions.expire(session.id); }
      catch (error) { if (!missing(error)) throw error; }
    }
    // Do not mistake a missing/expired Checkout session for a deleted customer.
    try { await this.sdk.customers.del(customerId); }
    catch (error) { if (!missing(error)) throw error; }
  }

}
export function createBillingProvider(): BillingProvider | null {
  if (isTestingMvp()) return null;
  const config = stripeConfiguration();
  return config ? new StripeProvider(config) : null;
}
