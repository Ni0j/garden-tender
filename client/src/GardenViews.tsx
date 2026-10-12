import { useRef, useState } from "react";
import { Plant, type Project } from "./Plant";
import type { Details } from "../../shared/project";

export const quadrants: { id: Details["quadrant"]; title: string; hint: string }[] = [
  { id: "do", title: "Important + Urgent", hint: "Do next" },
  { id: "plan", title: "Important + Not Urgent", hint: "Make time" },
  { id: "delegate", title: "Not Important + Urgent", hint: "Delegate or simplify" },
  { id: "later", title: "Not Important + Not Urgent", hint: "Leave for later" },
];
type Props = { projects: Project[]; onOpen: (id: number) => void; onSave: (id: number, settings: Partial<Details>) => void };

export function FreeGarden({ projects, onOpen, onSave }: Props) {
  const bed = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; startX: number; startY: number; x: number; y: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [preview, setPreview] = useState<{ id: number; x: number; y: number } | null>(null);
  return <><p className="empty-line">Drag a plant to arrange your garden. Select it to tend it. Arrow keys move a focused plant.</p>
    <div className="free-garden" ref={bed} style={{ height: Math.max(540, Math.ceil(projects.length / 2) * 220) }}>
      {projects.map((project, index) => {
        const position = preview?.id === project.id ? preview : project.details.position ?? { x: (index % 2), y: Math.floor(index / 2) / Math.max(2, Math.ceil(projects.length / 2)) };
        return <button key={project.id} className="free-plant" style={{ left: `calc(${position.x * 100}% - ${position.x * 130}px)`, top: `calc(${position.y * 100}% - ${position.y * 200}px)` }} aria-label={`Open ${project.name}`} onClick={() => { if (!suppressClick.current) onOpen(project.id); suppressClick.current = false; }}
          onPointerDown={e => { if (e.button !== 0) return; suppressClick.current = false; drag.current = { id: project.id, startX: e.clientX, startY: e.clientY, x: position.x, y: position.y, moved: false }; e.currentTarget.setPointerCapture(e.pointerId); }}
          onPointerMove={e => {
            const current = drag.current; const bounds = bed.current?.getBoundingClientRect();
            if (!current || current.id !== project.id || !bounds) return;
            const dx = e.clientX - current.startX, dy = e.clientY - current.startY;
            if (Math.hypot(dx, dy) < 6 && !current.moved) return;
            current.moved = true; suppressClick.current = true;
            setPreview({ id: project.id, x: Math.max(0, Math.min(1, current.x + dx / Math.max(1, bounds.width - 130))), y: Math.max(0, Math.min(1, current.y + dy / Math.max(1, bounds.height - 200))) });
          }}
          onPointerUp={() => { if (drag.current?.moved && preview) onSave(project.id, { position: { x: preview.x, y: preview.y } }); drag.current = null; setPreview(null); }}
          onPointerCancel={() => { drag.current = null; setPreview(null); }}
          onKeyDown={e => { if (!e.key.startsWith("Arrow")) return; e.preventDefault(); onSave(project.id, { position: { x: Math.max(0, Math.min(1, position.x + (e.key === "ArrowRight" ? .04 : e.key === "ArrowLeft" ? -.04 : 0))), y: Math.max(0, Math.min(1, position.y + (e.key === "ArrowDown" ? .04 : e.key === "ArrowUp" ? -.04 : 0))) } }); }}>
          <Plant project={project} /><strong>{project.name}</strong><small>{project.details.projectType === "recurring" ? "Recurring" : "One-time"} · {project.efforts.length} efforts</small>
        </button>;
      })}
    </div></>;
}

export function Matrix({ projects, onOpen, onSave }: Props) {
  const [dragging, setDragging] = useState<number | null>(null);
  return <><p className="empty-line">Drag projects between quadrants, or use each project's Move to menu.</p><div className="matrix">
    {quadrants.map(quadrant => <section key={quadrant.id} className="quadrant" data-quadrant={quadrant.id} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (dragging !== null) onSave(dragging, { quadrant: quadrant.id }); setDragging(null); }}>
      <h2>{quadrant.title}</h2><p>{quadrant.hint}</p>
      {projects.filter(project => project.details.quadrant === quadrant.id).map(project => <article key={project.id} className={`matrix-project ${dragging === project.id ? "is-dragging" : ""}`}>
        <button className="matrix-drag" aria-label={`Drag ${project.name}`} onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); setDragging(project.id); }} onPointerUp={e => { const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-quadrant]")?.dataset.quadrant; if (target) onSave(project.id, { quadrant: target as Details["quadrant"] }); setDragging(null); }} onPointerCancel={() => setDragging(null)}>⠿</button>
        <button className="text-button" onClick={() => onOpen(project.id)}>{project.name} ↗</button><small>{project.details.projectType} · {project.details.todos.filter(todo => !todo.done).length} TODOs</small>
        <select aria-label={`Move ${project.name} to`} value={quadrant.id} onChange={e => onSave(project.id, { quadrant: e.target.value as Details["quadrant"] })}>{quadrants.map(q => <option key={q.id} value={q.id}>{q.title}</option>)}</select>
      </article>)}
      {!projects.some(project => project.details.quadrant === quadrant.id) && <p className="empty-line">Drop a project here.</p>}
    </section>)}
  </div></>;
}
