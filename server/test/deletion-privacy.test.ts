import { test, expect } from "bun:test";
import { openDatabase } from "../src/db";
import { BillingService } from "../src/billing";
import { DeletionService } from "../src/deletion";
import { FakeBilling } from "./billing.test";
import { accounts, analyticsDaily, projects, anonymousClaims } from "../src/schema";
import { apiHandler } from "../src/http";
import { recordEvent, recordSignIn, pruneTelemetry } from "../src/analytics";
import { ensureAccount } from "../src/entitlements";
import { eq } from "drizzle-orm";

test("deletion survives billing and auth failures, blocks writes, and resumes without a login", async () => {
  const { db, sqlite } = openDatabase(":memory:");
  const user = crypto.randomUUID(), provider = new FakeBilling(), billing = new BillingService(db, provider);
  let authFails = true;
  const auth = { configured: true, delete: async () => !authFails };
  const intents: string[] = [];
  const deletion = new DeletionService(db, billing, auth, async id => { intents.push(id); });
  const handle = apiHandler(db, async () => ({ id: user, email: "private@example.com" }), auth, billing, deletion);
  const req = (name: string, body: unknown = {}) => handle(new Request(`http://local/api/${name}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  try {
    await billing.checkout(user, "private@example.com", "month");
    await req("createProject", { name: "Private name", description: "Private description", deadline: null });
    provider.failClose = true;
    expect((await req("deletePersonalData", { confirmation: "DELETE" })).status).toBe(503);
    expect(db.select().from(projects).all()).toHaveLength(1);
    expect(ensureAccount(db, user).deletionState).toBe("billing");
    expect((await req("createProject", { name: "blocked", description: "blocked", deadline: null })).status).toBe(409);
    expect((await req("billing/checkout", { interval: "month" })).status).toBe(409);
    provider.failClose = false;
    expect((await req("deletePersonalData", { confirmation: "DELETE" })).status).toBe(503);
    expect(provider.closed).toBe(true);
    expect(ensureAccount(db, user).deletionState).toBe("auth");
    expect(db.select().from(projects).all()).toHaveLength(1);
    authFails = false;
    const restarted = new DeletionService(db, new BillingService(db, provider), auth, async id => { intents.push(id); });
    await restarted.resumePending();
    expect(ensureAccount(db, user).deletionState).toBe("complete");
    expect(db.select().from(projects).all()).toHaveLength(0);
    await restarted.run(user);
    expect((await req("createProject", { name: "blocked", description: "blocked", deadline: null })).status).toBe(409);
    expect(intents.length).toBeGreaterThan(0);
  } finally { sqlite.close(); }
});

test("first-party analytics store only daily allowlisted aggregate counts and expire after 90 days", () => {
  const { db, sqlite } = openDatabase(":memory:");
  try {
    const user = crypto.randomUUID(); ensureAccount(db, user);
    recordSignIn(db, user); recordSignIn(db, user);
    recordEvent(db, "effort_created"); recordEvent(db, "effort_created");
    recordEvent(db, "outcome_created", Date.now() - 100 * 86_400_000);
    pruneTelemetry(db);
    const rows = db.select().from(analyticsDaily).all();
    expect(rows).toHaveLength(2);
    expect(rows.find(r => r.event === "sign_in")?.count).toBe(1);
    expect(rows.find(r => r.event === "effort_created")?.count).toBe(2);
    expect(Object.keys(rows[0]!).sort()).toEqual(["count", "day", "event"]);
    expect(JSON.stringify(rows)).not.toContain(user);
    db.update(accounts).set({ deletionState: "billing" }).where(eq(accounts.userId, user)).run();
    recordSignIn(db, user);
    expect(db.select().from(analyticsDaily).all()).toEqual(rows);
  } finally { sqlite.close(); }
});

test("disabled migration preserves actual anonymous rows and claim tombstones", async () => {
  const { db, sqlite } = openDatabase(":memory:");
  try {
    const anonymous = crypto.randomUUID(), attacker = crypto.randomUUID();
    db.insert(projects).values({ userId: anonymous, name: "Retained", description: "Legacy" }).run();
    db.insert(anonymousClaims).values({ anonymousUserId: anonymous, accountUserId: null }).run();
    const before = JSON.stringify([db.select().from(projects).all(), db.select().from(anonymousClaims).all()]);
    const handle = apiHandler(db, async () => ({ id: attacker, email: "test@example.com" }), { configured: true, delete: async () => true }, new BillingService(db, null));
    for (const id of [anonymous, anonymous.toUpperCase(), attacker]) {
      const r = await handle(new Request("http://local/api/claimAnonymousGarden", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ anonymousUserId: id }) }));
      expect(r.status).toBe(410);
    }
    expect(JSON.stringify([db.select().from(projects).all(), db.select().from(anonymousClaims).all()])).toBe(before);
  } finally { sqlite.close(); }
});
