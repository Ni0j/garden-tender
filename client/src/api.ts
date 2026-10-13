import type { z } from "zod";
import type { contracts } from "../../server/src/actions";
import { apiUrl, getAccessToken } from "./auth";

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
  } catch {
    return null;
  }
}

export function clearAnonymousId(): void {
  try { localStorage.removeItem(anonymousStorageKey); } catch { /* The claim is still secured on the server. */ }
}

async function post<K extends ActionName>(name: K, args: RequestArgs<K>): Promise<ResponseBody<K>> {
  const token = await getAccessToken();
  const response = await fetch(apiUrl(`/api/${name}`), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
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
  updateProject: (args: RequestArgs<"updateProject">) => post("updateProject", args),
  listProjects: (args: RequestArgs<"listProjects">) => post("listProjects", args),
  createProject: (args: RequestArgs<"createProject">) => post("createProject", args),
  addEffort: (args: RequestArgs<"addEffort">) => post("addEffort", args),
  setNextStep: (args: RequestArgs<"setNextStep">) => post("setNextStep", args),
  completeNextStep: (args: RequestArgs<"completeNextStep">) => post("completeNextStep", args),
  addOutcome: (args: RequestArgs<"addOutcome">) => post("addOutcome", args),
  completeProject: (args: RequestArgs<"completeProject">) => post("completeProject", args),
  archiveProject: (args: RequestArgs<"archiveProject">) => post("archiveProject", args),
  seedSampleGarden: (args: RequestArgs<"seedSampleGarden">) => post("seedSampleGarden", args),
  claimAnonymousGarden: (args: RequestArgs<"claimAnonymousGarden">) => post("claimAnonymousGarden", args),
  exportGarden: (args: RequestArgs<"exportGarden">) => post("exportGarden", args),
  deletePersonalData: (args: RequestArgs<"deletePersonalData">) => post("deletePersonalData", args),
};
