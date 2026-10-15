import { z } from "zod";

export const todoShape = z.object({ id: z.string(), text: z.string().trim().min(1).max(240), done: z.boolean(), credited: z.boolean() });
export const detailsShape = z.object({
  todos: z.array(todoShape),
  projectType: z.enum(["ongoing", "recurring"]),
  inFloat: z.boolean(),
  context: z.string().max(500),
  position: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).nullable(),
  matrixPosition: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).nullable(),
  quadrant: z.enum(["do", "plan", "delegate", "later"]),
});
export type Details = z.infer<typeof detailsShape>;
export function initialDetails(nextStep?: string | null): Details {
  return { todos: nextStep ? [{ id: "legacy-next-step", text: nextStep, done: false, credited: false }] : [], projectType: "ongoing", inFloat: false, context: "", position: null, matrixPosition: null, quadrant: "plan" };
}
// Normalize older saved gardens without discarding their steps, notes, or layouts.
export function normalizeDetails(details: (Partial<Omit<Details, "projectType">> & { projectType?: string }) | null | undefined, nextStep?: string | null): Details {
  return { ...initialDetails(nextStep), ...details, projectType: details?.projectType === "recurring" ? "recurring" : "ongoing", matrixPosition: details?.matrixPosition ?? null };
}
export const changeShape = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("addTodo"), text: z.string().trim().min(1).max(240) }),
  z.object({ kind: z.literal("editTodo"), id: z.string(), text: z.string().trim().min(1).max(240) }),
  z.object({ kind: z.literal("removeTodo"), id: z.string() }),
  z.object({ kind: z.literal("toggleTodo"), id: z.string(), done: z.boolean() }),
  z.object({ kind: z.literal("moveTodo"), id: z.string(), direction: z.enum(["up", "down"]) }),
  z.object({ kind: z.literal("settings"), projectType: detailsShape.shape.projectType.optional(), inFloat: z.boolean().optional(), context: z.string().max(500).optional(), position: detailsShape.shape.position.optional(), matrixPosition: detailsShape.shape.matrixPosition.optional(), quadrant: detailsShape.shape.quadrant.optional() }),
]);
export function changeDetails(details: Details, change: z.infer<typeof changeShape>): string | null {
  if (change.kind === "settings") { const { kind, ...settings } = change; Object.assign(details, settings); return null; }
  if (change.kind === "addTodo") { details.todos.push({ id: crypto.randomUUID(), text: change.text, done: false, credited: false }); return null; }
  const index = details.todos.findIndex(todo => todo.id === change.id);
  const todo = details.todos[index];
  if (!todo) throw new Error("TODO not found.");
  if (change.kind === "removeTodo") { details.todos.splice(index, 1); return null; }
  if (change.kind === "editTodo") todo.text = change.text;
  if (change.kind === "moveTodo") {
    const direction = change.direction === "up" ? -1 : 1;
    let target = index + direction;
    while (target >= 0 && target < details.todos.length && details.todos[target]?.done !== todo.done) target += direction;
    if (target >= 0 && target < details.todos.length) { details.todos.splice(index, 1); details.todos.splice(target, 0, todo); }
  }
  if (change.kind === "toggleTodo") {
    todo.done = change.done;
    if (change.done && !todo.credited) { todo.credited = true; return todo.text; }
  }
  return null;
}
