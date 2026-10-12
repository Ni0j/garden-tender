import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { openDatabase } from "../src/db";
import { apiHandler } from "../src/http";

let directory: string;
let database: ReturnType<typeof openDatabase>;
let handle: ReturnType<typeof apiHandler>;
let alice: string;
let bob: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "garden-test-"));
  database = openDatabase(join(directory, "garden.db"));
  handle = apiHandler(database.db);
  alice = crypto.randomUUID();
  bob = crypto.randomUUID();
});
afterEach(() => {
  database.sqlite.close();
  rmSync(directory, { recursive: true, force: true });
});
async function request(action: string, userId: string, args: unknown = {}) {
  return handle(new Request(`http://localhost/api/${action}`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-User-Id": userId },
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

describe("anonymous HTTP isolation", () => {
  test("fresh identities are empty; projects, efforts and outcomes stay private", async () => {
    expect(await list(alice)).toEqual([]);
    expect(await list(bob)).toEqual([]);
    const id = await create(alice);
    await request("addEffort", alice, { projectId: id, text: "First effort" });
    await request("addOutcome", alice, { projectId: id, type: "Knowledge", value: "Learned", note: null });
    expect(await list(bob)).toEqual([]);
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

  test("completing a next step records effort and advances growth", async () => {
    const id = await create(alice);
    expect((await request("setNextStep", alice, { projectId: id, text: "Draft the first page" })).status).toBe(200);
    expect((await list(alice))[0].nextStep).toBe("Draft the first page");
    expect((await request("completeNextStep", alice, { projectId: id })).status).toBe(200);
    const [project] = await list(alice);
    expect(project.nextStep).toBeNull();
    expect(project.efforts[0].text).toBe("Draft the first page");
    expect(project.growthStage).toBe("Sprout");
  });

  test("all project mutations deny guessed foreign IDs without changing either garden", async () => {
    const id = await create(alice);
    for (const [action, args] of [
      ["addEffort", { projectId: id, text: "Intruder" }],
      ["addOutcome", { projectId: id, type: "Other", value: "Intruder", note: null }],
      ["setNextStep", { projectId: id, text: "Intruder" }],
      ["completeNextStep", { projectId: id }],
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

  test("identity, method, JSON, schemas and route names are validated", async () => {
    for (const identity of ["", "not-a-uuid", "legacy-unassigned"]) {
      expect((await request("listProjects", identity)).status).toBe(401);
    }
    expect((await request("createProject", alice, { name: " ", description: "", deadline: "bad" })).status).toBe(400);
    expect((await request("addEffort", alice, { projectId: -1, text: " " })).status).toBe(400);
    expect((await request("constructor", alice)).status).toBe(404);
    expect((await handle(new Request("http://localhost/api/listProjects"))).status).toBe(405);
    expect((await handle(new Request("http://localhost/api/listProjects", {
      method: "POST", headers: { "X-User-Id": alice, "Content-Type": "application/json" }, body: "{",
    }))).status).toBe(400);
    expect((await handle(new Request("http://localhost/api/listProjects", {
      method: "POST", headers: { "X-User-Id": alice }, body: "{}",
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
  handle = apiHandler(database.db);
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
    const response = await apiHandler(migrated.db)(new Request("http://localhost/api/listProjects", { method: "POST", headers: { "X-User-Id": alice, "Content-Type": "application/json" }, body: "{}" }));
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
  handle = apiHandler(database.db);
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
