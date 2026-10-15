import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/db";
import { consistentBackup, restoreIsolated, digestFile } from "../src/backups";
import { accounts, projects, efforts, outcomes, subscriptions } from "../src/schema";
import { validateEnvironment } from "../src/config";
import { RateLimiter } from "../src/rate-limit";
import { createSupabaseAuthenticator, authConfiguration } from "../src/auth";

test("backup CLI read-only connection includes committed WAL data", async () => {
  const directory = await mkdtemp(join(tmpdir(), "garden-readonly-backup-"));
  const source = join(directory, "source.db");
  const live = openDatabase(source);
  let reader: Database | undefined;
  try {
    live.db.insert(projects).values({ userId: crypto.randomUUID(), name: "Committed before backup", description: "Synthetic backup fixture" }).run();
    reader = new Database(source, { readonly: true });
    const snapshot = join(directory, "snapshot.db");
    await consistentBackup(reader, snapshot);
    const restored = new Database(snapshot, { readonly: true });
    try {
      expect(restored.query("SELECT name FROM projects").all()).toEqual([{ name: "Committed before backup" }]);
      expect(() => reader!.query("DELETE FROM projects").run()).toThrow();
      expect(live.db.select().from(projects).all()).toHaveLength(1);
    } finally { restored.close(); }
  } finally { reader?.close(); live.sqlite.close(); await rm(directory, { recursive: true, force: true }); }
});

test("WAL backup restores independently with deletion intents and invalidated billing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "garden-recovery-test-"));
  const live = openDatabase(join(directory, "source.db"));
  const user = crypto.randomUUID();
  try {
    live.db.insert(accounts).values({ userId: user, customerId: "cus_restore", createdAt: Date.now() }).run();
    const p = live.db.insert(projects).values({ userId: user, name: "Keep", description: "Committed in WAL" }).returning().get();
    live.db.insert(efforts).values({ userId: user, projectId: p.id, text: "Effort" }).run();
    live.db.insert(outcomes).values({ userId: user, projectId: p.id, type: "Other", value: "Outcome" }).run();
    live.db.insert(subscriptions).values({ id: "sub_restore", userId: user, provider: "stripe", status: "active", priceId: "price_month", paidThrough: Date.now() + 60_000, updatedAt: Date.now() }).run();
    const backup = join(directory, "backup.db"), destination = join(directory, "restored.db");
    const manifest = await consistentBackup(live.sqlite, backup);
    expect(await digestFile(backup)).toBe(manifest.sha256);
    await restoreIsolated(backup, destination, manifest.sha256, [{ userId: user, customerId: "cus_restore", provider: "stripe" }]);
    const restored = openDatabase(destination);
    try {
      expect(restored.db.select().from(projects).all()).toEqual(live.db.select().from(projects).all());
      expect(restored.db.select().from(efforts).all()).toEqual(live.db.select().from(efforts).all());
      expect(restored.db.select().from(outcomes).all()).toEqual(live.db.select().from(outcomes).all());
      expect(restored.db.select().from(accounts).get()!.deletionState).toBe("billing");
      expect(restored.db.select().from(subscriptions).get()!.paidThrough).toBe(0);
    } finally { restored.sqlite.close(); }
    await expect(restoreIsolated(backup, destination, manifest.sha256, [])).rejects.toThrow("exists");
    await expect(restoreIsolated(backup, join(directory, "bad.db"), "invalid", [])).rejects.toThrow("checksum");
    expect(live.db.select().from(accounts).get()!.deletionState).toBe("none");
  } finally { live.sqlite.close(); await rm(directory, { recursive: true, force: true }); }
});

test("production configuration fails closed and bounded rate limits recover", () => {
  expect(() => validateEnvironment({ NODE_ENV: "production" })).toThrow("Missing production");
  expect(() => validateEnvironment({ NODE_ENV: "test" })).not.toThrow();
  const limit = new RateLimiter(2, 1000, 2);
  expect(limit.allow("a", 0)).toBe(true); expect(limit.allow("a", 1)).toBe(true); expect(limit.allow("a", 2)).toBe(false);
  expect(limit.allow("a", 1001)).toBe(true);
  expect(limit.allow("b", 1001)).toBe(true); expect(limit.allow("c", 1002)).toBe(false);
  expect(limit.allow("c", 3000)).toBe(true);
});

test("auth provider outages are retryable rather than invalid-session responses; secrets stay private", async () => {
  const oldURL = process.env.SUPABASE_URL, oldKey = process.env.SUPABASE_PUBLISHABLE_KEY, oldFetch = globalThis.fetch;
  try {
    process.env.SUPABASE_URL = "https://synthetic.supabase.co";
    process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_synthetic";
    globalThis.fetch = (async () => new Response("unavailable", { status: 503 })) as unknown as typeof fetch;
    await expect(createSupabaseAuthenticator()(new Request("http://local", { headers: { Authorization: "Bearer synthetic" } }))).rejects.toMatchObject({ status: 503 });
    globalThis.fetch = (async () => new Response("invalid", { status: 401 })) as unknown as typeof fetch;
    expect(await createSupabaseAuthenticator()(new Request("http://local", { headers: { Authorization: "Bearer synthetic" } }))).toBeNull();
    process.env.SUPABASE_PUBLISHABLE_KEY = "sb_secret_never_expose";
    expect(() => authConfiguration()).toThrow("misconfigured");
  } finally {
    globalThis.fetch = oldFetch;
    if (oldURL === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldURL;
    if (oldKey === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY; else process.env.SUPABASE_PUBLISHABLE_KEY = oldKey;
  }
});
