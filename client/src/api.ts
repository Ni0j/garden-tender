import type { z } from "zod";
import type { contracts } from "../../server/src/actions";

type Contracts = typeof contracts;
type ActionName = keyof Contracts;
type RequestArgs<K extends ActionName> = z.infer<Contracts[K]["request"]>;
type ResponseBody<K extends ActionName> = z.infer<Contracts[K]["response"]>;
export type ApiResponse<T, K extends keyof T> = T[K] extends (...args: never[]) => infer R ? Awaited<R> : never;

const storageKey = "project-garden.user-id";
function userId(): string {
  const existing = localStorage.getItem(storageKey);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(storageKey, id);
  return id;
}

async function post<K extends ActionName>(name: K, args: RequestArgs<K>): Promise<ResponseBody<K>> {
  const response = await fetch(`/api/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-User-Id": userId() },
    body: JSON.stringify(args),
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `Garden request failed (${response.status}).`);
  }
  return response.json() as Promise<ResponseBody<K>>;
}

export const api = {
  listProjects: (args: RequestArgs<"listProjects">) => post("listProjects", args),
  createProject: (args: RequestArgs<"createProject">) => post("createProject", args),
  addEffort: (args: RequestArgs<"addEffort">) => post("addEffort", args),
  addOutcome: (args: RequestArgs<"addOutcome">) => post("addOutcome", args),
  completeProject: (args: RequestArgs<"completeProject">) => post("completeProject", args),
  archiveProject: (args: RequestArgs<"archiveProject">) => post("archiveProject", args),
  seedSampleGarden: (args: RequestArgs<"seedSampleGarden">) => post("seedSampleGarden", args),
};
