import { Database } from "bun:sqlite";
const db = new Database(process.env.DATABASE_PATH ?? "./data/garden.db", { readonly: true });
try { console.table(db.query("SELECT day, event, count FROM analytics_daily ORDER BY day DESC, event").all()); } finally { db.close(); }
