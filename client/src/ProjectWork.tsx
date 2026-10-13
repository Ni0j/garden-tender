import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "./api";
import type { Project } from "./Plant";

export function ProjectWork({ project, onChanged }: { project: Project; onChanged: () => void }) {
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const update = useMutation({ mutationFn: api.updateProject, onSuccess: onChanged });
  const change = (value: Parameters<typeof api.updateProject>[0]["change"]) => update.mutate({ projectId: project.id, change: value });
  const readOnly = project.status === "archived";
  const pending = project.details.todos.filter(todo => !todo.done);
  const completed = project.details.todos.filter(todo => todo.done);
  const previous = project.efforts.at(-1);
  function step(todo: Project["details"]["todos"][number], index: number, done: boolean) {
    return <li key={todo.id}>
      <input aria-label={`${done ? "Reopen" : "Complete"} ${todo.text}`} type="checkbox" checked={todo.done} disabled={readOnly || update.isPending} onChange={e => change({ kind: "toggleTodo", id: todo.id, done: e.target.checked })} />
      <span className={done ? "todo-done" : ""}>{todo.text}</span>
      {!readOnly && <div className="todo-actions">
        <button aria-label={`Edit ${todo.text}`} onClick={() => { setEditing(todo.id); setText(todo.text); }}>Edit</button>
        {!done && <>
          <button aria-label={`Move ${todo.text} up`} disabled={index === 0 || update.isPending} onClick={() => change({ kind: "moveTodo", id: todo.id, direction: "up" })}>↑</button>
          <button aria-label={`Move ${todo.text} down`} disabled={index === pending.length - 1 || update.isPending} onClick={() => change({ kind: "moveTodo", id: todo.id, direction: "down" })}>↓</button>
        </>}
      </div>}
    </li>;
  }
  return <section className="project-work" aria-label="Project steps">
    <div className="previous-step"><h3>Previous step</h3><p>{previous?.text || "Your first effort will appear here."}</p></div>
    <div className="next-steps">
      <h3>Next step{pending.length > 1 ? "s" : ""}</h3>
      {pending.length === 0 && <p className="empty-line">What would you like to do next?</p>}
      <ul className="todo-list">{pending.map((todo, index) => step(todo, index, false))}</ul>
      {!readOnly && <form className="inline-entry" onSubmit={e => { e.preventDefault(); update.mutate({ projectId: project.id, change: editing ? { kind: "editTodo", id: editing, text } : { kind: "addTodo", text } }, { onSuccess: () => { setText(""); setEditing(null); } }); }}>
        <input aria-label={editing ? "Edit step" : "New next step"} placeholder="A small step to take next" value={text} onChange={e => setText(e.target.value)} required maxLength={240} />
        <button disabled={update.isPending || !text.trim()}>{editing ? "Save step" : "Add step"}</button>
        {editing && <button type="button" onClick={() => { setEditing(null); setText(""); }}>Cancel</button>}
      </form>}
      {completed.length > 0 && <details className="completed-steps"><summary>Completed steps ({completed.length})</summary><ul className="todo-list">{completed.map((todo, index) => step(todo, index, true))}</ul></details>}
    </div>
    {update.error && <p role="alert" className="form-error">Could not save this change. Please try again.</p>}
    {update.isSuccess && <p role="status" className="save-status">Saved.</p>}
    <label className="recurring-choice"><input type="checkbox" checked={project.details.projectType === "recurring"} disabled={readOnly || update.isPending} onChange={e => change({ kind: "settings", projectType: e.target.checked ? "recurring" : "ongoing" })} />This is a recurring activity</label>
  </section>;
}
