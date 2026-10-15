import { recordEvent } from "./analytics";
import { eq } from "drizzle-orm";
import type { GardenDatabase } from "./db";
import { accounts, subscriptions, billingEvents } from "./schema";
import { ensureAccount, entitlement, reconcilePlantLimit } from "./entitlements";
import { ApiError } from "./errors";
import type { BillingInterval, BillingProvider } from "./billing-provider";

export class BillingService {
  private locks = new Map<string, Promise<unknown>>();
  constructor(readonly db: GardenDatabase, readonly provider: BillingProvider | null) {}
  // The Render deployment is deliberately single-instance. Serialize provider
  // reads + writes per account so delayed webhook delivery cannot roll state back.
  async withAccount<T>(userId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(userId) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    this.locks.set(userId, current);
    try { return await current; }
    finally { if (this.locks.get(userId) === current) this.locks.delete(userId); }
  }
  private required() {
    if (!this.provider) throw new ApiError(503, "Billing is not configured yet. Your Free garden remains available.");
    return this.provider;
  }
  async syncUnlocked(userId: string) {
    const account = ensureAccount(this.db, userId);
    if (!account.customerId || account.deletionState !== "none") return;
    const provider = this.required();
    const snapshots = await provider.subscriptions(account.customerId);
    this.db.transaction(tx => {
      const wasPlus = entitlement(tx, userId).plan === "plus";
      const old = tx.select().from(subscriptions).where(eq(subscriptions.userId, userId)).all();
      for (const row of old) if (!snapshots.some(s => s.id === row.id)) tx.update(subscriptions).set({ status: "canceled", updatedAt: Date.now() }).where(eq(subscriptions.id, row.id)).run();
      for (const snapshot of snapshots) {
        const previous = old.find(s => s.id === snapshot.id);
        const values = { ...snapshot, paidThrough: Math.max(snapshot.paidThrough, previous?.paidThrough ?? 0), userId, provider: provider.name, updatedAt: Date.now() };
        const collision = tx.select().from(subscriptions).where(eq(subscriptions.id, snapshot.id)).get();
        if (collision && collision.userId !== userId) throw new Error("Billing ownership mismatch");
        tx.insert(subscriptions).values(values).onConflictDoUpdate({ target: subscriptions.id, set: values }).run();
      }
      if (!wasPlus && entitlement(tx, userId).plan === "plus") recordEvent(tx, "subscription_activated");
      reconcilePlantLimit(tx, userId);
    }, { behavior: "immediate" });
  }
  async reconcile(userId: string) { return this.withAccount(userId, () => this.syncUnlocked(userId)); }
  async checkout(userId: string, email: string, interval: BillingInterval) {
    return this.withAccount(userId, async () => {
      const provider = this.required();
      await provider.validate();
      let account = ensureAccount(this.db, userId);
      if (account.deletionState !== "none") throw new ApiError(409, "Account deletion is pending.");
      if (!account.customerId) {
        const customerId = await provider.createCustomer(userId, email);
        this.db.update(accounts).set({ customerId, provider: provider.name }).where(eq(accounts.userId, userId)).run();
        account = ensureAccount(this.db, userId);
      }
      await this.syncUnlocked(userId);
      const existing = this.db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).all();
      if (existing.some(s => !["canceled", "incomplete_expired"].includes(s.status))) throw new ApiError(409, "You already have a subscription. Use Manage billing to avoid duplicate charges.");
      const url = await provider.checkout(account.customerId!, interval, userId);
      recordEvent(this.db, "upgrade_initiated");
      return url;
    });
  }
  async portal(userId: string) {
    return this.withAccount(userId, async () => {
      const account = ensureAccount(this.db, userId);
      if (account.deletionState !== "none") throw new ApiError(409, "Account deletion is pending.");
      if (!account.customerId) throw new ApiError(409, "There is no billing account to manage yet.");
      return this.required().portal(account.customerId);
    });
  }
  async webhook(body: string, signature: string) {
    const provider = this.required();
    const event = await provider.verifyEvent(body, signature);
    if (this.db.select().from(billingEvents).where(eq(billingEvents.id, event.id)).get()) return;
    if (!event.customerId) return;
    const account = this.db.select().from(accounts).where(eq(accounts.customerId, event.customerId)).get();
    // Never trust user IDs from webhook metadata as an ownership assignment.
    if (!account) throw new ApiError(503, "Billing customer mapping is not available; retry delivery.");
    await this.withAccount(account.userId, async () => {
      if (this.db.select().from(billingEvents).where(eq(billingEvents.id, event.id)).get()) return;
      await this.syncUnlocked(account.userId);
      this.db.insert(billingEvents).values({ id: event.id, processedAt: Date.now() }).onConflictDoNothing().run();
    });
  }
  account(userId: string) {
    const account = ensureAccount(this.db, userId);
    return { ...entitlement(this.db, userId), billingAvailable: Boolean(this.provider), billingMode: this.provider?.mode ?? null, hasCustomer: Boolean(account.customerId), deletionState: account.deletionState };
  }
}
