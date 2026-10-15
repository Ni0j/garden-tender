import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { openDatabase, bindTestingDatabase } from "../src/db";
import { validateEnvironment } from "../src/config";
import { createBillingProvider } from "../src/stripe";
import { apiHandler } from "../src/http";
import { Maintenance } from "../src/maintenance";
import type { BillingService } from "../src/billing";
import type { DeletionService } from "../src/deletion";
import type { BackupStore } from "../src/backups";

const environment = { NODE_ENV: "production", APP_MODE: "testing", SUPABASE_URL: "https://test-project.supabase.co", TESTING_SUPABASE_PROJECT_REF: "test-project", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture", SUPABASE_SECRET_KEY: "sb_secret_fixture", PUBLIC_APP_URL: "https://garden-testing.example.com", DATABASE_PATH: "/var/data/testing/garden.db", BACKUP_S3_BUCKET: "private-testing", BACKUP_S3_REGION: "us-east-1", BACKUP_S3_ACCESS_KEY_ID: "fixture", BACKUP_S3_SECRET_ACCESS_KEY: "fixture", BACKUP_S3_PREFIX: "garden-testing" };

test("testing production needs auth, isolated storage and backups, but no Stripe", () => {
  expect(() => validateEnvironment(environment)).not.toThrow();
  expect(() => validateEnvironment({ ...environment, DATABASE_PATH: "/var/data/garden.db" })).toThrow("isolated");
  expect(() => validateEnvironment({ ...environment, SUPABASE_URL: "https://personal.supabase.co" })).toThrow("separate testing project");
  expect(() => validateEnvironment({ ...environment, BACKUP_S3_PREFIX: "garden" })).toThrow("garden-testing");
  expect(() => validateEnvironment({ ...environment, SUPABASE_SECRET_KEY: "" })).toThrow("Missing production");
});

test("testing database rejects existing personal data and cannot change auth projects", () => {
  const personal = new Database(":memory:");
  const testing = new Database(":memory:");
  try {
    personal.exec("CREATE TABLE projects (name TEXT); INSERT INTO projects VALUES ('Private garden')");
    expect(() => bindTestingDatabase(personal, environment.SUPABASE_URL)).toThrow("populated");
    expect(personal.query("SELECT name FROM projects").get()).toEqual({ name: "Private garden" });
    bindTestingDatabase(testing, environment.SUPABASE_URL);
    expect(() => bindTestingDatabase(testing, environment.SUPABASE_URL)).not.toThrow();
    expect(() => bindTestingDatabase(testing, "https://other.supabase.co")).toThrow("another authentication project");
  } finally { personal.close(); testing.close(); }
});

test("testing maintenance leaves configured backups manual while SaaS remains automatic", async () => {
  const oldMode = process.env.APP_MODE;
  process.env.APP_MODE = "testing";
  const { db, sqlite } = openDatabase(":memory:");
  let backupCalls = 0;
  const billing = { reconcile: async () => undefined } as unknown as BillingService;
  const deletion = { resumePending: async () => undefined } as unknown as DeletionService;
  const backup = { backup: async () => { backupCalls++; return "unexpected"; } } as unknown as BackupStore;
  try {
    const maintenance = new Maintenance(db, sqlite, billing, deletion, backup);
    await maintenance.tick();
    expect(backupCalls).toBe(0);
    expect(maintenance.health().backup).toBe("manual");
    process.env.APP_MODE = "saas";
    const saasMaintenance = new Maintenance(db, sqlite, billing, deletion, backup);
    await saasMaintenance.tick();
    expect(backupCalls).toBe(1);
    expect(saasMaintenance.health().backup).toBe("ok");
  } finally {
    sqlite.close();
    if (oldMode === undefined) delete process.env.APP_MODE; else process.env.APP_MODE = oldMode;
  }
});

test("MVP has no payment cap; TODO removal, archive and export remain isolated", async () => {
  const oldMode = process.env.APP_MODE;
  process.env.APP_MODE = "testing";
  const { db, sqlite } = openDatabase(":memory:");
  const alice = crypto.randomUUID(), bob = crypto.randomUUID();
  const handle = apiHandler(db, async req => { const id = req.headers.get("Authorization")?.slice(7); return id === alice || id === bob ? { id, email: `${id}@example.com` } : null; }, { configured: true, delete: async () => true });
  const call = (name: string, user: string = alice, body = {}) => handle(new Request(`http://local/api/${name}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${user}` }, body: JSON.stringify(body) }));
  try {
    expect(createBillingProvider()).toBeNull();
    for (let n = 0; n < 5; n++) expect((await call("createProject", alice, { name: `Plant ${n}`, description: "Synthetic", deadline: null, nextStep: "Read" })).status).toBe(200);
    const garden = (await (await call("listProjects")).json()).projects;
    expect(garden.filter((p: {status:string}) => p.status === "active")).toHaveLength(5);
    expect((await (await call("account")).json()).activeLimit).toBeNull();
    for (const route of ["billing/checkout", "billing/portal", "billing/refresh", "billing/webhook"]) expect((await call(route)).status).toBe(404);
    const projectId = garden[0].id;
    const change = { kind: "removeTodo", id: "legacy-next-step" };
    expect((await call("updateProject", bob, { projectId, change })).status).toBe(404);
    expect((await call("updateProject", alice, { projectId, change: { kind: "toggleTodo", id: "legacy-next-step", done: true } })).status).toBe(200);
    expect((await call("updateProject", alice, { projectId, change })).status).toBe(200);
    expect((await call("archiveProject", alice, { projectId })).status).toBe(200);
    expect((await call("updateProject", alice, { projectId, change: { kind: "addTodo", text: "Blocked" } })).status).toBe(409);
    expect((await call("restoreProject", bob, { projectId })).status).toBe(404);
    expect((await call("restoreProject", alice, { projectId })).status).toBe(200);
    const restored = (await (await call("listProjects")).json()).projects.find((p: {id:number}) => p.id === projectId);
    expect(restored.details.todos).toHaveLength(0);
    expect(restored.efforts).toHaveLength(1);
    expect((await (await call("exportGarden", bob)).json()).projects).toEqual([]);
    expect((await call("listProjects", "forged")).status).toBe(401);
  } finally { sqlite.close(); if (oldMode === undefined) delete process.env.APP_MODE; else process.env.APP_MODE = oldMode; }
});
