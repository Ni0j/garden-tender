import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "./schema";
import { isTestingMvp } from "./config";

export function openDatabase(filename = process.env.DATABASE_PATH ?? "./data/garden.db") {
  if (filename !== ":memory:") mkdirSync(dirname(resolve(filename)), { recursive: true });
  const sqlite = new Database(filename, { create: true });
  try { if (isTestingMvp() && filename !== ":memory:") bindTestingDatabase(sqlite, process.env.SUPABASE_URL ?? ""); }
  catch (error) { sqlite.close(); throw error; }
  sqlite.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  repairInitialOnlyDatabase(sqlite);
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return { db, sqlite };
}
export type GardenDatabase = ReturnType<typeof openDatabase>["db"];

// A testing service must never silently adopt a personal database or another
// Supabase project's identities. The binding travels with database backups.
export function bindTestingDatabase(sqlite: Database, supabaseUrl: string) {
  const origin = new URL(supabaseUrl).origin;
  sqlite.transaction(() => {
    const bound = sqlite.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='testing_environment'").get();
    if (bound) {
      const binding = sqlite.query<{ auth_origin: string }, []>("SELECT auth_origin FROM testing_environment WHERE id=1").get();
      if (binding?.auth_origin !== origin) throw new Error("Testing database belongs to another authentication project. Use a new empty testing database.");
      return;
    }
    const tables = sqlite.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations'").all();
    for (const { name } of tables) {
      if (sqlite.query(`SELECT 1 FROM "${name.replaceAll('"', '""')}" LIMIT 1`).get()) throw new Error("Refusing to use an existing populated database for user testing. Use a new empty testing database.");
    }
    sqlite.exec("CREATE TABLE testing_environment (id INTEGER PRIMARY KEY CHECK(id=1), auth_origin TEXT NOT NULL)");
    sqlite.query("INSERT INTO testing_environment VALUES (1, ?)").run(origin);
  })();
}

// 0001 and 0002 historically shared a timestamp. Repair only the identifiable
// initial-only schema, preserving entries and every applied migration record.
function repairInitialOnlyDatabase(sqlite: Database) {
  const exists = (name: string) => Boolean(sqlite.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
  if (!exists("__drizzle_migrations") || exists("projects")) return;
  const last = sqlite.query<{ created_at: number }, []>("SELECT MAX(created_at) AS created_at FROM __drizzle_migrations").get();
  if (last?.created_at !== 1790654550354 || !exists("entries")) throw new Error("Unrecognized legacy schema; restore or reconcile migration history before startup.");
  const sql = readFileSync(resolve(process.cwd(), "drizzle/0002_project_garden_tables.sql"), "utf8");
  sqlite.transaction(() => {
    sqlite.exec("ALTER TABLE entries RENAME TO legacy_entries_before_projects");
    sqlite.exec(sql);
    sqlite.query("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)").run(createHash("sha256").update(sql).digest("hex"), 1790654550354);
  })();
}
