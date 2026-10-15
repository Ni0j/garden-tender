import { Database } from "bun:sqlite";
import { createBackupStore } from "../server/src/backups";
const store = createBackupStore();
if (!store) throw new Error("Configure BACKUP_S3_* before running a remote backup.");
const sqlite = new Database(process.env.DATABASE_PATH ?? "./data/garden.db", { readonly: true });
try { console.log(await store.backup(sqlite)); } finally { sqlite.close(); }
