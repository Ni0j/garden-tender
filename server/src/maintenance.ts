import { accounts } from "./schema";
import type { GardenDatabase } from "./db";
import type { Database } from "bun:sqlite";
import type { BillingService } from "./billing";
import type { DeletionService } from "./deletion";
import type { BackupStore } from "./backups";
import { pruneTelemetry } from "./analytics";
import { reconcilePlantLimit } from "./entitlements";
import { isTestingMvp } from "./config";

export class Maintenance {
  private running: Promise<void> | null = null;
  private lastReconcile = 0;
  private lastBackupAttempt = 0;
  lastBackupSuccess = 0;
  reconciliationHealthy = true;
  deletionHealthy = true;
  constructor(private db: GardenDatabase, private sqlite: Database, private billing: BillingService, private deletion: DeletionService, private backup: BackupStore | null) {}
  tick() {
    if (this.running) return this.running;
    this.running = this.work().finally(() => { this.running = null; });
    return this.running;
  }
  private async work() {
    await this.deletion.resumePending();
    this.deletionHealthy = !this.db.select().from(accounts).all().some(a => !["none", "complete"].includes(a.deletionState));
    if (Date.now() - this.lastReconcile >= 5 * 60_000) {
      this.reconciliationHealthy = true;
      for (const account of this.db.select().from(accounts).all()) {
        if (account.deletionState !== "none") continue;
        if (account.customerId) {
          try { await this.billing.reconcile(account.userId); }
          catch { this.reconciliationHealthy = false; console.error("Billing reconciliation failed; retry scheduled."); }
        }
        this.db.transaction(tx => reconcilePlantLimit(tx, account.userId), { behavior: "immediate" });
      }
      this.lastReconcile = Date.now();
      pruneTelemetry(this.db);
    }
    if (!isTestingMvp() && this.backup && Date.now() - this.lastBackupSuccess >= 6 * 60 * 60_000 && Date.now() - this.lastBackupAttempt >= 60_000) {
      this.lastBackupAttempt = Date.now();
      try { await this.backup.backup(this.sqlite); this.lastBackupSuccess = Date.now(); }
      catch { console.error("Database backup failed; retry scheduled. Check backup credentials, storage and service health."); }
    }
  }
  health() { return { backup: !this.backup ? "unconfigured" : isTestingMvp() ? "manual" : Date.now() - this.lastBackupSuccess < 8 * 60 * 60_000 ? "ok" : "overdue", billing: this.reconciliationHealthy ? "ok" : "retrying", deletion: this.deletionHealthy ? "ok" : "retrying" }; }
}
