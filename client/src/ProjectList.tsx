import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "./api";
import { displayDate } from "../../shared/dates";
import type { Project } from "./Plant";

export function ProjectList({ projects, archived, onOpen, onRestored }: { projects: Project[]; archived: boolean; onOpen: (id: number) => void; onRestored: (project: Project) => void }) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("newest");
  const restore = useMutation({ mutationFn: api.restoreProject, onSuccess: (_result, args) => { const project = projects.find(p => p.id === args.projectId); if (project) onRestored(project); } });
  const visible = useMemo(() => projects.filter(p => `${p.name} ${p.description} ${p.details.todos.map(t => t.text).join(" ")}`.toLowerCase().includes(search.trim().toLowerCase())).sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : sort === "deadline" ? (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999") : b.createdAt.localeCompare(a.createdAt)), [projects, search, sort]);
  return <section className="minimal-garden" aria-label={archived ? "Archived projects" : "Project list"}>
    <p className="view-hint">{archived ? "Archived projects are paused. Their steps, effort and outcomes stay here until you restore them." : "Your next steps at a glance. Open a project to continue."}</p>
    <div className="list-tools">
      <label>Find a project<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search projects and steps" /></label>
      <label>Sort<select value={sort} onChange={e => setSort(e.target.value)}><option value="newest">Newest first</option><option value="name">Name</option><option value="deadline">Deadline</option></select></label>
    </div>
    {restore.error && <p className="form-error" role="alert">{restore.error.message}</p>}
    {visible.length === 0 && <p className="empty-line">No matching projects. <button className="text-button" onClick={() => setSearch("")}>Clear search</button></p>}
    {visible.map(project => {
      const pending = project.details.todos.filter(todo => !todo.done);
      return <article className="list-project" key={project.id}>
        <button className="project-row" onClick={() => onOpen(project.id)} aria-label={`Open ${project.name}`}>
          <span><strong>{project.name}</strong><small>{pending[0] ? `Next: ${pending[0].text}` : "No unfinished steps"}</small>{project.deadline && <small>Due {displayDate(project.deadline)}</small>}</span>
          <span>{pending.length} to do<small>{project.efforts.length} efforts</small></span>
          <span aria-hidden="true">↗</span>
        </button>
        {archived && <button className="text-button list-restore" disabled={restore.isPending} onClick={() => restore.mutate({ projectId: project.id })}>Restore {project.name}</button>}
      </article>;
    })}
  </section>;
}
