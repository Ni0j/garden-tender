import { eq } from "drizzle-orm";
import type { GardenDatabase } from "./db";
import type { AccountDeletion } from "./auth";
import { BillingService } from "./billing";
import { ensureAccount } from "./entitlements";
import { accounts, projects, efforts, outcomes, anonymousClaims, subscriptions } from "./schema";
import { ApiError } from "./errors";

export class DeletionService {
  constructor(private db: GardenDatabase, private billing: BillingService, private auth: AccountDeletion, private recordIntent: (userId: string) => Promise<void> = async () => {}) {}
  async run(userId: string) {
    return this.billing.withAccount(userId, async () => {
      let account = ensureAccount(this.db, userId);
      if (account.deletionState === "complete") return;
      if (!this.auth.configured) throw new ApiError(503, "Account deletion is not configured. Your data has not been removed.");
      if (account.customerId && !this.billing.provider) throw new ApiError(503, "Billing must be available before account deletion can proceed.");
      // Durable intent is saved before any external deletion; write protection
      // remains even when an external operation fails or the process restarts.
      if (account.deletionState === "none") {
        this.advance(userId, "billing");
        account = ensureAccount(this.db, userId);
      }
      await this.recordIntent(userId);
      if (account.deletionState === "billing") {
        if (account.customerId) await this.billing.provider!.closeAccount(account.customerId);
        this.advance(userId, "auth");
        account = ensureAccount(this.db, userId);
      }
      if (account.deletionState === "auth") {
        if (!(await this.auth.delete(userId))) throw new ApiError(503, "Deletion is pending. Future billing has stopped, but sign-in removal is still retrying. Your garden is locked until deletion finishes.");
        this.advance(userId, "purge");
      }
      this.db.transaction(tx => {
        tx.delete(efforts).where(eq(efforts.userId, userId)).run();
        tx.delete(outcomes).where(eq(outcomes.userId, userId)).run();
        tx.delete(projects).where(eq(projects.userId, userId)).run();
        tx.delete(subscriptions).where(eq(subscriptions.userId, userId)).run();
        tx.update(anonymousClaims).set({ accountUserId: null }).where(eq(anonymousClaims.accountUserId, userId)).run();
        // Minimal tombstone suppresses late events and prevents restored/deleted
        // accounts from writing. No email or garden content is retained.
        tx.update(accounts).set({ deletionState: "complete", deletionUpdatedAt: Date.now(), lastSignInDay: null }).where(eq(accounts.userId, userId)).run();
      }, { behavior: "immediate" });
    });
  }
  private advance(userId: string, state: string) {
    this.db.update(accounts).set({ deletionState: state, deletionUpdatedAt: Date.now() }).where(eq(accounts.userId, userId)).run();
  }
  async resumePending() {
    for (const account of this.db.select().from(accounts).all()) {
      if (["none", "complete"].includes(account.deletionState)) continue;
      try { await this.run(account.userId); }
      catch { console.error("Account deletion remains pending; retry scheduled."); }
    }
  }
}
