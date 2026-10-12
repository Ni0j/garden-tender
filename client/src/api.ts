import { initialDetails, changeDetails, changeShape } from "../../shared/project";
import type { z } from "zod";
import type { contracts } from "../../server/src/actions";

type Contracts = typeof contracts;
type ActionName = keyof Contracts;
type RequestArgs<K extends ActionName> = z.infer<Contracts[K]["request"]>;
type ResponseBody<K extends ActionName> = z.infer<Contracts[K]["response"]>;
export type ApiResponse<T, K extends keyof T> = T[K] extends (...args: never[]) => infer R ? Awaited<R> : never;

type Project = ResponseBody<"listProjects">["projects"][number];
type StoredGarden = { projects: Project[]; nextId: number };
const gardenStorageKey = "project-garden.github-pages-data";

const storageKey = "project-garden.user-id";
function userId(): string {
  const existing = localStorage.getItem(storageKey);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(storageKey, id);
  return id;
}

async function post<K extends ActionName>(name: K, args: RequestArgs<K>): Promise<ResponseBody<K>> {
  if (__GITHUB_PAGES__) return localPost(name, args);
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

function readGarden(): StoredGarden {
  try {
    const saved = localStorage.getItem(gardenStorageKey);
    if (saved) {
      const garden = JSON.parse(saved) as StoredGarden;
      garden.projects.forEach((project) => { project.nextStep ??= null; project.details ??= initialDetails(project.nextStep); });
      return garden;
    }
  } catch { /* Start with an empty garden if local storage is unavailable or damaged. */ }
  return { projects: [], nextId: 1 };
}

function growthStage(effortCount: number, completed: boolean): Project["growthStage"] {
  if (completed || effortCount >= 15) return "Bloom";
  if (effortCount >= 10) return "Mature plant";
  if (effortCount >= 6) return "Growing plant";
  if (effortCount >= 3) return "Young plant";
  if (effortCount >= 1) return "Sprout";
  return "Seed";
}

function saveGarden(garden: StoredGarden): void {
  localStorage.setItem(gardenStorageKey, JSON.stringify(garden));
}

async function localPost<K extends ActionName>(name: K, args: RequestArgs<K>): Promise<ResponseBody<K>> {
  const garden = readGarden();
  if (name === "listProjects") return { projects: garden.projects } as ResponseBody<K>;
  if (name === "createProject") {
    const input = args as RequestArgs<"createProject">;
    const id = garden.nextId++;
    garden.projects.unshift({
      id, name: input.name.trim(), description: input.description.trim(), nextStep: input.nextStep?.trim() || null, deadline: input.projectType === "recurring" ? null : input.deadline,
      status: "active", plantVariant: id % 6, createdAt: new Date().toISOString(), completedAt: null,
      growthStage: "Seed", efforts: [], outcomes: [], details: { ...initialDetails(input.nextStep), projectType: input.projectType ?? "one-time" },
    });
    saveGarden(garden);
    return { id } as ResponseBody<K>;
  }
  if (name === "seedSampleGarden") return { added: 0 } as ResponseBody<K>;

  const input = args as { projectId: number };
  const project = garden.projects.find((item) => item.id === input.projectId);
  if (!project) throw new Error("Project not found.");
  if (project.status === "archived" && (name === "addEffort" || name === "addOutcome" || name === "setNextStep" || name === "completeNextStep" || (name === "updateProject" && (args as RequestArgs<"updateProject">).change.kind !== "settings"))) {
    throw new Error("Archived projects are dormant.");
  }
  if (name === "updateProject") {
    const change = changeShape.parse((args as RequestArgs<"updateProject">).change);
    const effort = changeDetails(project.details, change);
    if (effort) project.efforts.push({ id: garden.nextId++, text: effort, createdAt: new Date().toISOString() });
    project.nextStep = null;
    if (project.details.projectType === "recurring") project.deadline = null;
    project.growthStage = growthStage(project.efforts.length, project.status === "completed");
  } else if (name === "addEffort") {
    const effort = args as RequestArgs<"addEffort">;
    project.efforts.push({ id: garden.nextId++, text: effort.text.trim(), createdAt: new Date().toISOString() });
    project.growthStage = growthStage(project.efforts.length, project.status === "completed");
  } else if (name === "setNextStep") {
    project.nextStep = (args as RequestArgs<"setNextStep">).text.trim();
  } else if (name === "completeNextStep") {
    if (!project.nextStep) throw new Error("No next step to complete.");
    project.efforts.push({ id: garden.nextId++, text: project.nextStep, createdAt: new Date().toISOString() });
    project.nextStep = null;
    project.growthStage = growthStage(project.efforts.length, project.status === "completed");
  } else if (name === "addOutcome") {
    const outcome = args as RequestArgs<"addOutcome">;
    project.outcomes.push({ id: garden.nextId++, type: outcome.type.trim(), value: outcome.value.trim(), note: outcome.note, createdAt: new Date().toISOString() });
  } else if (name === "completeProject") {
    project.status = "completed";
    project.completedAt = new Date().toISOString();
    project.growthStage = "Bloom";
  } else if (name === "archiveProject") {
    project.status = "archived";
  }
  saveGarden(garden);
  return { ok: true } as ResponseBody<K>;
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
};
