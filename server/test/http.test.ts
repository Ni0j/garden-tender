import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { openDatabase } from "../src/db";
import { apiHandler } from "../src/http";
import type { Authenticator } from "../src/auth";
import * as schema from "../src/schema";

let directory: string;
let database: ReturnType<typeof openDatabase>;
let handle: ReturnType<typeof apiHandler>;
let alice: string;
let bob: string;
const testAuthenticator: Authenticator = async (request) => {
  const token = request.headers.get("Authorization")?.replace(/^Bearer /, "");
  if (token === alice) return { id: alice, email: "alice@example.com" };
  if (token === bob) return { id: bob, email: "bob@example.com" };
  return null;
};
const testAccountDeletion = { configured: true, delete: async () => true };

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "garden-test-"));
  database = openDatabase(join(directory, "garden.db"));
  alice = crypto.randomUUID();
  bob = crypto.randomUUID();
  handle = apiHandler(database.db, testAuthenticator, testAccountDeletion);
});
afterEach(() => {
  database.sqlite.close();
  rmSync(directory, { recursive: true, force: true });
});
async function request(action: string, userId: string, args: unknown = {}) {
  return handle(new Request(`http://localhost/api/${action}`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${userId}` },
    body: JSON.stringify(args),
  }));
}
async function create(userId: string) {
  const response = await request("createProject", userId, { name: "Test garden", description: "Keep growing", deadline: null });
  expect(response.status).toBe(200);
  return (await response.json()).id as number;
}
async function list(userId: string) {
  const response = await request("listProjects", userId);
  expect(response.status).toBe(200);
  return (await response.json()).projects;
}

describe("authenticated HTTP isolation", () => {
  test("fresh identities are empty; projects, efforts and outcomes stay private", async () => {
    expect(await list(alice)).toEqual([]);
    expect(await list(bob)).toEqual([]);
    const id = await create(alice);
    await request("addEffort", alice, { projectId: id, text: "First effort" });
    await request("addOutcome", alice, { projectId: id, type: "Knowledge", value: "Learned", note: null });
    expect(await list(bob)).toEqual([]);
    const spoofed = await handle(new Request("http://localhost/api/listProjects", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${bob}`, "X-User-Id": alice },
      body: "{}",
    }));
    expect((await spoofed.json()).projects).toEqual([]);
    const [project] = await list(alice);
    expect(project.efforts).toHaveLength(1);
    expect(project.outcomes).toHaveLength(1);
    expect(project.growthStage).toBe("Sprout");
    expect(JSON.stringify(project)).not.toContain(alice);
    expect((await request("listProjects", alice)).headers.get("cache-control")).toBe("no-store");
    const bobId = await create(bob);
    expect((await list(alice)).map((p: { id: number }) => p.id)).toEqual([id]);
    expect((await list(bob)).map((p: { id: number }) => p.id)).toEqual([bobId]);
  });

  test("all project mutations deny guessed foreign IDs without changing either garden", async () => {
    const id = await create(alice);
    for (const [action, args] of [
      ["addEffort", { projectId: id, text: "Intruder" }],
      ["addOutcome", { projectId: id, type: "Other", value: "Intruder", note: null }],
      ["completeProject", { projectId: id }],
      ["archiveProject", { projectId: id }],
    ] as const) {
      const foreign = await request(action, bob, args);
      const absent = await request(action, bob, { ...args, projectId: 99999 });
      expect(foreign.status).toBe(404);
      expect(await foreign.json()).toEqual(await absent.json());
    }
    const [project] = await list(alice);
    expect(project.status).toBe("active");
    expect(project.efforts).toEqual([]);
    expect(project.outcomes).toEqual([]);
    expect(await list(bob)).toEqual([]);
  });

  test("sessions, method, JSON, schemas and route names are validated", async () => {
    for (const token of ["", "not-a-token", "legacy-unassigned"]) {
      expect((await request("listProjects", token)).status).toBe(401);
    }
    const forged = await handle(new Request("http://localhost/api/listProjects", {
      method: "POST", headers: { "Content-Type": "application/json", "X-User-Id": alice }, body: "{}",
    }));
    expect(forged.status).toBe(401);
    expect((await request("createProject", alice, { name: " ", description: "", deadline: "bad" })).status).toBe(400);
    expect((await request("addEffort", alice, { projectId: -1, text: " " })).status).toBe(400);
    expect((await request("constructor", alice)).status).toBe(404);
    expect((await handle(new Request("http://localhost/api/listProjects"))).status).toBe(405);
    expect((await handle(new Request("http://localhost/api/listProjects", {
      method: "POST", headers: { Authorization: `Bearer ${alice}`, "Content-Type": "application/json" }, body: "{",
    }))).status).toBe(400);
    expect((await handle(new Request("http://localhost/api/listProjects", {
      method: "POST", headers: { Authorization: `Bearer ${alice}` }, body: "{}",
    }))).status).toBe(415);
    expect(await list(alice)).toEqual([]);
  });

  test("sample gardens are opt-in, atomic and idempotent for each visitor", async () => {
    const replies = await Promise.all([request("seedSampleGarden", alice), request("seedSampleGarden", alice), request("seedSampleGarden", bob)]);
    expect(await Promise.all(replies.map((r) => r.json()))).toEqual([{ added: 3 }, { added: 0 }, { added: 3 }]);
    const a = await list(alice), b = await list(bob);
    expect(a).toHaveLength(3);
    expect(b).toHaveLength(3);
    expect(a.every((p: { id: number }) => b.every((q: { id: number }) => q.id !== p.id))).toBe(true);
    expect(a.reduce((n: number, p: { efforts: unknown[] }) => n + p.efforts.length, 0)).toBe(9);
    expect(b.reduce((n: number, p: { outcomes: unknown[] }) => n + p.outcomes.length, 0)).toBe(3);
  });
});

test("legacy claiming is disabled; owner exports and deletes their own data", async () => {
  const anonymousId = crypto.randomUUID();
  const project = database.db.insert(schema.projects).values({
    userId: alice,
    name: "Existing garden",
    description: "From this browser",
    plantVariant: 2,
  }).returning({ id: schema.projects.id }).get();
  database.db.insert(schema.efforts).values({ userId: alice, projectId: project.id, text: "Old effort" }).run();
  database.db.insert(schema.outcomes).values({ userId: alice, projectId: project.id, type: "Knowledge", value: "Saved", note: null }).run();

  for (const id of [alice, alice.toUpperCase(), anonymousId]) {
    expect((await request("claimAnonymousGarden", bob, { anonymousUserId: id })).status).toBe(410);
  }
  expect(await list(bob)).toEqual([]);
  expect((await list(alice))[0].efforts[0].text).toBe("Old effort");

  const exported = await (await request("exportGarden", alice)).json();
  expect(exported.email).toBe("alice@example.com");
  expect(exported.version).toBe(1);
  expect(exported.projects).toHaveLength(1);

  expect((await request("deletePersonalData", alice, { confirmation: "wrong" })).status).toBe(400);
  const withoutAdminKey = apiHandler(database.db, testAuthenticator, { configured: false, delete: async () => false });
  const unavailable = await withoutAdminKey(new Request("http://localhost/api/deletePersonalData", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${alice}` },
    body: JSON.stringify({ confirmation: "DELETE" }),
  }));
  expect(unavailable.status).toBe(503);
  expect(await list(alice)).toHaveLength(1);
  expect((await request("deletePersonalData", alice, { confirmation: "DELETE" })).status).toBe(200);
  expect(await list(alice)).toEqual([]);
  expect((await request("claimAnonymousGarden", bob, { anonymousUserId: anonymousId })).status).toBe(410);
});

test("all growth thresholds, completion and dormancy retain their original behavior", async () => {
  const id = await create(alice);
  for (let count = 0; count <= 16; count++) {
    const expected = count >= 15 ? "Bloom" : count >= 10 ? "Mature plant" : count >= 6 ? "Growing plant" : count >= 3 ? "Young plant" : count >= 1 ? "Sprout" : "Seed";
    expect((await list(alice))[0].growthStage).toBe(expected);
    if (count < 16) expect((await request("addEffort", alice, { projectId: id, text: `Effort ${count + 1}` })).status).toBe(200);
  }
  const seed = await create(bob);
  await request("completeProject", bob, { projectId: seed });
  expect((await list(bob))[0].growthStage).toBe("Bloom");
  expect((await list(bob))[0].completedAt).not.toBeNull();
  await request("archiveProject", alice, { projectId: id });
  expect((await request("addEffort", alice, { projectId: id, text: "Dormant" })).status).toBe(409);
  expect((await request("addOutcome", alice, { projectId: id, type: "Other", value: "Dormant", note: null })).status).toBe(409);
});

test("data and identities survive reopening the database and rerunning migrations", async () => {
  const id = await create(alice);
  await request("addEffort", alice, { projectId: id, text: "Persistent" });
  await request("addOutcome", alice, { projectId: id, type: "Other", value: "Saved", note: "Note" });
  const before = await list(alice);
  database.sqlite.close();
  database = openDatabase(join(directory, "garden.db"));
  handle = apiHandler(database.db, testAuthenticator, testAccountDeletion);
  expect(await list(alice)).toEqual(before);
  expect(await list(bob)).toEqual([]);
});

test("migration preserves legacy rows without exposing them to new visitors", async () => {
  const path = join(directory, "legacy.db");
  const old = new Database(path);
  old.exec(readFileSync(new URL("../../drizzle/0002_project_garden_tables.sql", import.meta.url), "utf8"));
  old.exec("INSERT INTO projects (name, description, created_at) VALUES ('Private', 'Legacy', 1); INSERT INTO efforts (project_id, text, created_at) VALUES (1, 'Private effort', 1); INSERT INTO outcomes (project_id, type, value, created_at) VALUES (1, 'Other', 'Private outcome', 1);");
  // Model a database whose original migrations have already run.
  old.exec("CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC); INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('legacy', 1790654550354);");
  old.close();
  const migrated = openDatabase(path);
  try {
    const response = await apiHandler(migrated.db, testAuthenticator, testAccountDeletion)(new Request("http://localhost/api/listProjects", { method: "POST", headers: { Authorization: `Bearer ${alice}`, "Content-Type": "application/json" }, body: "{}" }));
    expect(await response.json()).toEqual({ projects: [] });
    for (const table of ["projects", "efforts", "outcomes"]) {
      expect(migrated.sqlite.query(`SELECT user_id FROM ${table}`).get()).toEqual({ user_id: "legacy-unassigned" });
    }
  } finally { migrated.sqlite.close(); }
});

test("TODOs credit once, reorder and persist alongside independent project settings", async () => {
  const id = await create(alice);
  const update = (change: unknown, user = alice) => request("updateProject", user, { projectId: id, change });
  expect((await update({ kind: "addTodo", text: "First" }, bob)).status).toBe(404);
  await update({ kind: "addTodo", text: "First" });
  await update({ kind: "addTodo", text: "Second" });
  const todos = (await list(alice))[0].details.todos;
  await update({ kind: "editTodo", id: todos[1].id, text: "Edited" });
  await update({ kind: "moveTodo", id: todos[1].id, direction: "up" });
  await update({ kind: "toggleTodo", id: todos[0].id, done: true });
  await update({ kind: "toggleTodo", id: todos[0].id, done: false });
  await update({ kind: "toggleTodo", id: todos[0].id, done: true });
  await update({ kind: "settings", projectType: "recurring", position: { x: .2, y: .6 }, quadrant: "do", inFloat: true, context: "Tests running in Codex" });
  database.sqlite.close();
  database = openDatabase(join(directory, "garden.db"));
  handle = apiHandler(database.db, testAuthenticator, testAccountDeletion);
  const [project] = await list(alice);
  expect(project.efforts).toHaveLength(1);
  expect(project.growthStage).toBe("Sprout");
  expect(project.details.todos.map((todo: {text:string}) => todo.text)).toEqual(["Edited", "First"]);
  expect(project.details.position).toEqual({ x: .2, y: .6 });
  expect(project.details.quadrant).toBe("do");
  expect(project.details.projectType).toBe("recurring");
  expect(project.status).toBe("active");
  await update({ kind: "settings", inFloat: false });
  expect((await list(alice))[0].details.todos).toHaveLength(2);
  expect((await update({ kind: "settings", position: { x: 2, y: 0 } })).status).toBe(400);
});

test("existing project details migrate without losing deadlines, notes, steps or garden positions", async () => {
  const id = await create(alice);
  const legacy = { todos: [{ id: "a", text: "Read a chapter", done: false, credited: false }], projectType: "one-time", inFloat: true, context: "An older saved note", position: { x: .3, y: .7 }, quadrant: "plan" };
  database.sqlite.query("UPDATE projects SET details = ?, deadline = ? WHERE id = ?").run(JSON.stringify(legacy), "2027-04-01", id);
  const [migrated] = await list(alice);
  expect(migrated.details.projectType).toBe("ongoing");
  expect(migrated.details.context).toBe(legacy.context);
  expect(migrated.details.matrixPosition).toBeNull();
  await request("updateProject", alice, { projectId: id, change: { kind: "settings", projectType: "recurring", quadrant: "do", matrixPosition: { x: .8, y: .2 } } });
  await request("updateProject", alice, { projectId: id, change: { kind: "toggleTodo", id: "a", done: true } });
  const [project] = await list(alice);
  expect(project.deadline).toBe("2027-04-01");
  expect(project.details.position).toEqual(legacy.position);
  expect(project.details.matrixPosition).toEqual({ x: .8, y: .2 });
  expect(project.efforts.at(-1).text).toBe("Read a chapter");
  expect(project.details.todos.filter((todo: {done: boolean}) => !todo.done)).toHaveLength(0);
  expect(project.details.context).toBe(legacy.context);
});

test("only canonical TODO completion credits effort; removed aliases cannot double credit", async () => {
  const response = await request("createProject", alice, { name: "Steps", description: "Canonical", deadline: null, nextStep: "Do once" });
  const id = (await response.json()).id;
  for (const action of ["setNextStep", "completeNextStep"]) expect((await request(action, alice, { projectId: id, text: "Do once" })).status).toBe(404);
  for (const done of [true, true, false, true]) await request("updateProject", alice, { projectId: id, change: { kind: "toggleTodo", id: "legacy-next-step", done } });
  expect((await list(alice))[0].efforts).toHaveLength(1);
});

test("completion is idempotent; archive preserves growth and rejects mutations", async () => {
  const id = await create(alice);
  await request("completeProject", alice, { projectId: id });
  const before = (await list(alice))[0];
  await request("completeProject", alice, { projectId: id });
  expect((await list(alice))[0].completedAt).toBe(before.completedAt);
  await request("archiveProject", alice, { projectId: id });
  expect((await list(alice))[0].growthStage).toBe("Bloom");
  expect((await request("completeProject", alice, { projectId: id })).status).toBe(409);
  expect((await request("updateProject", alice, { projectId: id, change: { kind: "settings", context: "No" } })).status).toBe(409);
});

test("calendar date validation rejects impossible dates and historical rendering is safe", async () => {
  const { displayDate } = await import("../../shared/dates");
  for (const deadline of ["2026-99-99", "2026-02-29", "2026-04-31"]) {
    expect((await request("createProject", alice, { name: "Date", description: "Check", deadline })).status).toBe(400);
    expect(displayDate(deadline)).toBe("Unknown date");
  }
  expect((await request("createProject", alice, { name: "Date", description: "Check", deadline: "2028-02-29" })).status).toBe(200);
});

test("initial-only migration preserves entry data and repairs duplicate migration timestamps", () => {
  const path = join(directory, "initial.db");
  const old = new Database(path);
  old.exec(readFileSync(new URL("../../drizzle/0001_initial.sql", import.meta.url), "utf8"));
  old.exec("INSERT INTO entries(text, created_at) VALUES ('Retain me', 1); CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC); INSERT INTO __drizzle_migrations(hash,created_at) VALUES ('initial',1790654550354)");
  old.close();
  const repaired = openDatabase(path);
  expect(repaired.sqlite.query("SELECT text FROM legacy_entries_before_projects").get()).toEqual({ text: "Retain me" });
  expect(repaired.sqlite.query("SELECT COUNT(*) AS n FROM projects").get()).toEqual({ n: 0 });
  repaired.sqlite.close();
  const reopened = openDatabase(path); reopened.sqlite.close();
});

test("Free capacity is enforced atomically on create, samples and restoration", async () => {
  const ids = await Promise.all(Array.from({ length: 5 }, () => request("createProject", alice, { name: "Limit", description: "Check", deadline: null })));
  expect(ids.filter(r => r.status === 200)).toHaveLength(3);
  expect(ids.filter(r => r.status === 409)).toHaveLength(2);
  expect((await request("seedSampleGarden", alice)).status).toBe(409);
  expect(await list(alice)).toHaveLength(3);
  const id = (await list(alice))[0].id;
  await request("archiveProject", alice, { projectId: id });
  await create(alice);
  expect((await request("restoreProject", alice, { projectId: id })).status).toBe(409);
  expect((await request("restoreProject", bob, { projectId: id })).status).toBe(404);
});

test("verified Plus allows unlimited plants; expiry preserves history and keeps oldest three active", async () => {
  database.db.insert(schema.subscriptions).values({ id: "sub_test", userId: alice, provider: "test", status: "active", priceId: "test", paidThrough: Date.now() + 60_000, updatedAt: Date.now() }).run();
  for (let i = 0; i < 6; i++) { const id = await create(alice); await request("addEffort", alice, { projectId: id, text: "Preserved" }); }
  expect((await list(alice)).filter((p: {status:string}) => p.status === "active")).toHaveLength(6);
  database.sqlite.query("UPDATE subscriptions SET paid_through = 1").run();
  const after = await list(alice);
  expect(after).toHaveLength(6);
  expect(after.filter((p: {status:string}) => p.status === "active")).toHaveLength(3);
  expect(after.filter((p: {archiveReason:string}) => p.archiveReason === "plan-limit")).toHaveLength(3);
  expect(after.every((p: {efforts:unknown[]}) => p.efforts.length === 1)).toBe(true);
  const active = after.find((p: {status:string}) => p.status === "active");
  const paused = after.find((p: {archiveReason:string}) => p.archiveReason === "plan-limit");
  await request("archiveProject", alice, { projectId: active.id });
  expect((await request("restoreProject", alice, { projectId: paused.id })).status).toBe(200);
});
