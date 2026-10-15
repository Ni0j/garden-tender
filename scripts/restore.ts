import { createBackupStore } from "../server/src/backups";
const [key, destination] = process.argv.slice(2);
if (!key || !destination || destination === process.env.DATABASE_PATH) throw new Error("Usage: bun scripts/restore.ts <snapshot-key> <NEW-isolated-destination.db>");
const store = createBackupStore();
if (!store) throw new Error("Configure BACKUP_S3_* first.");
await store.downloadRestore(key, destination);
console.log("Isolated restore passed integrity checks. Deletion intents were reapplied and stale entitlements cleared. Reconcile billing and pending deletions before switching the production database, with explicit approval.");
