import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "./api";
import type { Project } from "./Plant";

export function ProjectWork({ project, onChanged }: { project: Project; onChanged: () => void }) {
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [context, setContext] = useState(project.details.context);
  const update = useMutation({ mutationFn: api.updateProject, onSuccess: onChanged });
  const change = (value: Parameters<typeof api.updateProject>[0]["change"]) => update.mutate({ projectId: project.id, change: value });
  const readOnly = project.status === "archived";
  return <section className="project-work">
    <div className="work-settings">
      <label>Project type <select aria-label="Project type" value={project.details.projectType} disabled={readOnly || update.isPending} onChange={e => change({ kind: "settings", projectType: e.target.value as "recurring" | "one-time" })}><option value="one-time">One-time</option><option value="recurring">Recurring</option></select></label>
      {!readOnly && <button className="secondary-button" disabled={update.isPending} onClick={() => change({ kind: "settings", inFloat: !project.details.inFloat })}>{project.details.inFloat ? "Remove from Float" : "Bring into Float"}</button>}
    </div>
    {project.details.projectType === "recurring" && <p className="empty-line">A continuing practice. Grow through repeated efforts, with no finish date.</p>}
    <h3>TODOs</h3>
    {project.details.todos.length === 0 && <p className="empty-line">Add a small step to pick up next.</p>}
    <ul className="todo-list">
      {project.details.todos.map((todo, index) => <li key={todo.id}>
        <input aria-label={`Complete ${todo.text}`} type="checkbox" checked={todo.done} disabled={readOnly || update.isPending} onChange={e => change({ kind: "toggleTodo", id: todo.id, done: e.target.checked })} />
        <span className={todo.done ? "todo-done" : ""}>{todo.text}</span>
        {!readOnly && <div className="todo-actions">
          <button aria-label={`Edit ${todo.text}`} onClick={() => { setEditing(todo.id); setText(todo.text); }}>Edit</button>
          <button aria-label={`Move ${todo.text} up`} disabled={index === 0 || update.isPending} onClick={() => change({ kind: "moveTodo", id: todo.id, direction: "up" })}>↑</button>
          <button aria-label={`Move ${todo.text} down`} disabled={index === project.details.todos.length - 1 || update.isPending} onClick={() => change({ kind: "moveTodo", id: todo.id, direction: "down" })}>↓</button>
        </div>}
      </li>)}
    </ul>
    {!readOnly && <>
      <form className="inline-entry" onSubmit={e => { e.preventDefault(); update.mutate({ projectId: project.id, change: editing ? { kind: "editTodo", id: editing, text } : { kind: "addTodo", text } }, { onSuccess: () => { setText(""); setEditing(null); } }); }}>
        <input aria-label={editing ? "Edit TODO" : "New TODO"} placeholder="Add a concrete next step" value={text} onChange={e => setText(e.target.value)} required maxLength={240} />
        <button disabled={update.isPending || !text.trim()}>{editing ? "Save TODO" : "Add TODO"}</button>
        {editing && <button type="button" onClick={() => { setEditing(null); setText(""); }}>Cancel</button>}
      </form>
      <form className="context-form" onSubmit={e => { e.preventDefault(); change({ kind: "settings", context }); }}>
        <label>Where I left off<textarea aria-label="Where I left off" value={context} onChange={e => setContext(e.target.value)} maxLength={500} placeholder="Tool, current work, and what to return to…" rows={2} /></label>
        <button className="text-button" disabled={update.isPending}>Save reminder</button>
      </form>
    </>}
    {update.error && <p role="alert" className="form-error">Could not save. Your changes are still here; try again.</p>}
    {update.isSuccess && <p role="status" className="empty-line">Saved.</p>}
  </section>;
}
