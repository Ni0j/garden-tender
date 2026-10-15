import type { z } from "zod";
import type { contracts } from "../../server/src/actions";
import type { Account } from "../../shared/account";
import { changeDetails, initialDetails, normalizeDetails } from "../../shared/project";
import { getAuthClient } from "./auth";

type Contracts = typeof contracts;
type ActionName = keyof Contracts;
type RequestArgs<K extends ActionName> = z.infer<Contracts[K]["request"]>;
type ResponseBody<K extends ActionName> = z.infer<Contracts[K]["response"]>;
export type ApiResponse<T, K extends keyof T> = T[K] extends (...args: never[]) => infer R ? Awaited<R> : never;

export const anonymousStorageKey = "project-garden.user-id";
export function existingAnonymousId(): string | null {
  try {
    const value = localStorage.getItem(anonymousStorageKey)?.toLowerCase() ?? null;
    return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value) ? value : null;
  } catch { return null; }
}
export function clearAnonymousId(): void { try { localStorage.removeItem(anonymousStorageKey); } catch { /* Ignore unavailable browser storage. */ } }

function fail(error: { message: string } | null, fallback = "Garden request failed.") { if (error) throw new Error(error.message || fallback); }
async function authenticated() {
  const client = await getAuthClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) { await client.auth.signOut({ scope: "local" }); throw new Error("Your session has expired. Sign in again."); }
  return { client, user: data.user };
}
function growthStage(count: number, completed: boolean) {
  if (completed || count >= 15) return "Bloom" as const;
  if (count >= 10) return "Mature plant" as const;
  if (count >= 6) return "Growing plant" as const;
  if (count >= 3) return "Young plant" as const;
  if (count >= 1) return "Sprout" as const;
  return "Seed" as const;
}
async function listProjects(): Promise<ResponseBody<"listProjects">> {
  const { client } = await authenticated();
  const { data, error } = await client.from("projects").select("*, efforts(*), outcomes(*)").order("created_at", { ascending: false });
  fail(error);
  return { projects: (data ?? []).map((row: any) => {
    const efforts = (row.efforts ?? []).sort((a: any, b: any) => a.created_at.localeCompare(b.created_at)).map((item: any) => ({ id: Number(item.id), text: item.text, createdAt: item.created_at }));
    const outcomes = (row.outcomes ?? []).sort((a: any, b: any) => a.created_at.localeCompare(b.created_at)).map((item: any) => ({ id: Number(item.id), type: item.type, value: item.value, note: item.note, createdAt: item.created_at }));
    return { id: Number(row.id), name: row.name, description: row.description, nextStep: row.next_step, archiveReason: row.archive_reason, details: normalizeDetails(row.details, row.next_step), deadline: row.deadline, status: row.status, plantVariant: row.plant_variant, createdAt: row.created_at, completedAt: row.completed_at, growthStage: growthStage(efforts.length, row.status === "completed" || row.completed_at !== null), efforts, outcomes };
  }) };
}
async function createProject(args: RequestArgs<"createProject">): Promise<ResponseBody<"createProject">> {
  const { client, user } = await authenticated();
  const { data: latest } = await client.from("projects").select("id").order("id", { ascending: false }).limit(1).maybeSingle();
  const details = { ...initialDetails(args.nextStep), projectType: args.projectType === "recurring" ? "recurring" as const : "ongoing" as const };
  const { data, error } = await client.from("projects").insert({ user_id: user.id, name: args.name.trim(), description: args.description.trim(), details, deadline: args.deadline ?? null, plant_variant: ((Number(latest?.id) || 0) + 1) % 6 }).select("id").single();
  fail(error, "The seed could not be planted."); return { id: Number(data!.id) };
}
async function projectRow(projectId: number) {
  const { client } = await authenticated();
  const { data, error } = await client.from("projects").select("id,status,completed_at,details,next_step").eq("id", projectId).maybeSingle();
  fail(error); if (!data) throw new Error("Project not found."); return { client, data };
}
const samples = [
  { key: "sample-restaurant-website", name: "Restaurant website", description: "A compact launch for a neighborhood restaurant, from research through a responsive build.", status: "completed", variant: 1, efforts: ["Researched restaurant websites", "Built the homepage", "Sent the proposal", "Revised the mobile layout"], outcomes: [{ type: "Payment", value: "$500", note: "Final project payment" }, { type: "New client", value: "1 client", note: "First direct client" }] },
  { key: "sample-publication", name: "Publication prototype", description: "Shape the first issue around a single visual question and test the physical format.", status: "active", variant: 4, efforts: ["Defined the issue theme", "Built a rough page sequence", "Printed a folded paper test"], outcomes: [{ type: "Knowledge", value: "Format test", note: "The smaller trim size reads better" }] },
  { key: "sample-archive", name: "Community poster series", description: "An early poster direction kept for its studies even though the series paused.", status: "archived", variant: 3, efforts: ["Collected references", "Made two composition studies"], outcomes: [] },
] as const;

export const api = {
  listProjects: (_args: RequestArgs<"listProjects">) => listProjects(),
  createProject,
  async updateProject(args: RequestArgs<"updateProject">) {
    const { client, data } = await projectRow(args.projectId);
    if (data.status === "archived") throw new Error("Archived projects are dormant.");
    const details = normalizeDetails(structuredClone(data.details), data.next_step);
    const effort = changeDetails(details, args.change);
    const { error } = await client.rpc("garden_update_project", { p_project_id: args.projectId, p_details: details, p_effort: effort });
    fail(error); return { ok: true as const };
  },
  async addEffort(args: RequestArgs<"addEffort">) {
    const { client, user } = await authenticated(); const row = await projectRow(args.projectId);
    if (row.data.status === "archived") throw new Error("Archived projects are dormant.");
    fail((await client.from("efforts").insert({ user_id: user.id, project_id: args.projectId, text: args.text.trim() })).error); return { ok: true as const };
  },
  async addOutcome(args: RequestArgs<"addOutcome">) {
    const { client, user } = await authenticated(); const row = await projectRow(args.projectId);
    if (row.data.status === "archived") throw new Error("Archived projects are dormant.");
    fail((await client.from("outcomes").insert({ user_id: user.id, project_id: args.projectId, type: args.type.trim(), value: args.value.trim(), note: args.note?.trim() || null })).error); return { ok: true as const };
  },
  async completeProject(args: RequestArgs<"completeProject">) {
    const { client } = await projectRow(args.projectId);
    fail((await client.from("projects").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", args.projectId).neq("status", "archived")).error); return { ok: true as const };
  },
  async archiveProject(args: RequestArgs<"archiveProject">) {
    const { client } = await projectRow(args.projectId);
    fail((await client.from("projects").update({ status: "archived", archive_reason: null }).eq("id", args.projectId)).error); return { ok: true as const };
  },
  async restoreProject(args: RequestArgs<"restoreProject">) {
    const { client, data } = await projectRow(args.projectId);
    fail((await client.from("projects").update({ status: data.completed_at ? "completed" : "active", archive_reason: null }).eq("id", args.projectId).eq("status", "archived")).error); return { ok: true as const };
  },
  async seedSampleGarden(_args: RequestArgs<"seedSampleGarden">) {
    const { client, user } = await authenticated(); let added = 0;
    for (const sample of samples) {
      const demoKey = `${user.id}:${sample.key}`;
      if ((await client.from("projects").select("id").eq("demo_key", demoKey).maybeSingle()).data) continue;
      const { data: project, error } = await client.from("projects").insert({ user_id: user.id, name: sample.name, description: sample.description, status: sample.status, plant_variant: sample.variant, demo_key: demoKey, completed_at: sample.status === "completed" ? new Date().toISOString() : null, details: initialDetails() }).select("id").single();
      fail(error); if (!project) continue;
      if (sample.efforts.length) fail((await client.from("efforts").insert(sample.efforts.map(text => ({ user_id: user.id, project_id: project.id, text })))).error);
      if (sample.outcomes.length) fail((await client.from("outcomes").insert(sample.outcomes.map(item => ({ user_id: user.id, project_id: project.id, ...item })))).error);
      added++;
    }
    return { added };
  },
  async claimAnonymousGarden(_args: RequestArgs<"claimAnonymousGarden">): Promise<ResponseBody<"claimAnonymousGarden">> { throw new Error("Legacy garden import requires verified support assistance."); },
  async exportGarden(_args: RequestArgs<"exportGarden">): Promise<ResponseBody<"exportGarden">> { const { user } = await authenticated(); return { version: 1, exportedAt: new Date().toISOString(), email: user.email ?? "", ...(await listProjects()) }; },
  async deletePersonalData(args: RequestArgs<"deletePersonalData">) { const { client } = await authenticated(); fail((await client.rpc("delete_garden_account", { p_confirmation: args.confirmation })).error); return { ok: true as const }; },
};

export async function accountRequest<T>(name: string, _args: unknown = {}): Promise<T> {
  if (name === "analytics/sign-in") return { ok: true } as T;
  if (name.startsWith("billing/") && name !== "billing/refresh") throw new Error("Upgrades are not available during user testing.");
  const projects = (await listProjects()).projects;
  const account: Account = { testing: true, plan: "free", activeLimit: null, activeCount: projects.filter(project => project.status === "active").length, pausedCount: 0, paidThrough: null, cancelAtPeriodEnd: false, paymentPastDue: false, canCreate: true, billingAvailable: false, billingMode: null, hasCustomer: false, deletionState: "none" };
  return account as T;
}
