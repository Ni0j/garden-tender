import { useEffect, useRef, useState } from "react";
import { matrixLayout, snapSlot } from "./matrix-layout";
import { Plant, type Project } from "./Plant";
import type { Details } from "../../shared/project";

const quadrants: { id: Details["quadrant"]; title: string; hint: string }[] = [
  { id: "do", title: "Important + Urgent", hint: "Do next" },
  { id: "plan", title: "Important + Not Urgent", hint: "Make time" },
  { id: "delegate", title: "Not Important + Urgent", hint: "Delegate or simplify" },
  { id: "later", title: "Not Important + Not Urgent", hint: "Leave for later" },
];
type Props = { projects: Project[]; onOpen: (id: number) => void; onSave: (id: number, settings: Partial<Details>) => void };
type Drag = { id: number; startX: number; startY: number; left: number; top: number; width: number; height: number; moved: boolean };

export function Matrix({ projects, onOpen, onSave }: Props) {
  const board = useRef<HTMLDivElement>(null);
  const [widths, setWidths] = useState<Record<string, { width: number; height: number }>>({});
  const keyboardFocus = useRef<number | null>(null);
  useEffect(() => {
    if (keyboardFocus.current !== null) {
      board.current?.querySelector<HTMLButtonElement>(`[data-project-id="${keyboardFocus.current}"]`)?.focus();
      keyboardFocus.current = null;
    }
  }, [projects]);
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const [preview, setPreview] = useState<{ id: number; x: number; y: number } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    const element = board.current;
    if (!element) return;
    const spaces = new ResizeObserver(entries => {
      setWidths(previous => {
        const next = { ...previous };
        for (const entry of entries) next[(entry.target as HTMLElement).dataset.quadrant!] = { width: entry.contentRect.width, height: entry.contentRect.height };
        return next;
      });
    });
    element.querySelectorAll(".quadrant-space").forEach(space => spaces.observe(space));
    return () => {
      spaces.disconnect();
    };
  }, []);
  return <section className="matrix-view" aria-label="Plant priority matrix">
    <p className="sr-only">Drag to snap into a free space. Select to tend.</p>
    <p className="sr-only">Arrow keys move a focused plant one grid space.</p>
    <p role="status" className="sr-only">{announcement}</p>
    <div className="plant-matrix" ref={board}>
      {quadrants.map((quadrant, quadrantIndex) => {
        const plants = projects.filter(project => project.details.quadrant === quadrant.id);
        const layout = matrixLayout(plants, widths[quadrant.id]?.width ?? 104, widths[quadrant.id]?.height ?? 300);
        return <section key={quadrant.id} className="matrix-quadrant" aria-label={quadrant.title}>
          <header><h2>{quadrant.title}</h2><p>{quadrant.hint}{plants.length > 0 && <span className="quadrant-count"> · {plants.length}</span>}</p></header>
          <div className="quadrant-space" data-quadrant={quadrant.id} tabIndex={0} aria-label={`${quadrant.title} projects`}>
            {plants.length === 0 && <p className="matrix-empty">Room to grow</p>}
            <div className="quadrant-grid" style={{ height: "100%" }}>
            {plants.map(project => {
              const slot = layout.slots.get(project.id)!;
              const column = slot % layout.columns, row = Math.floor(slot / layout.columns);
              const moving = preview?.id === project.id;
              return <button key={project.id} data-project-id={project.id} className={`matrix-plant ${moving ? "is-dragging" : ""}`}
                style={moving ? { position: "fixed", left: drag.current!.left + preview.x, top: drag.current!.top + preview.y, width: drag.current!.width, height: drag.current!.height } : { left: `${column * 100 / layout.columns}%`, top: `${row * 100 / layout.rows}%`, width: `${100 / layout.columns}%`, height: `${100 / layout.rows}%` }}
                title={project.name}
                aria-label={`Open ${project.name}; ${quadrant.title}`}
                onClick={() => { if (!suppressClick.current) onOpen(project.id); suppressClick.current = false; }}
                onPointerDown={e => {
                  if (e.button !== 0) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  suppressClick.current = false;
                  drag.current = { id: project.id, startX: e.clientX, startY: e.clientY, left: rect.left, top: rect.top, width: rect.width, height: rect.height, moved: false };
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={e => {
                  const current = drag.current;
                  if (!current || current.id !== project.id) return;
                  const x = e.clientX - current.startX, y = e.clientY - current.startY;
                  if (Math.hypot(x, y) < 6 && !current.moved) return;
                  current.moved = true; suppressClick.current = true;
                  setPreview({ id: project.id, x, y });
                }}
                onPointerUp={e => {
                  const current = drag.current;
                  if (current?.moved && board.current) {
                    const bounds = board.current.getBoundingClientRect();
                    const column = e.clientX < bounds.left + bounds.width / 2 ? 0 : 1;
                    const row = e.clientY < bounds.top + bounds.height / 2 ? 0 : 1;
                    const target = quadrants[row * 2 + column]!;
                    const spaceElement = board.current.querySelector<HTMLElement>(`[data-quadrant="${target.id}"]`)!;
                    const space = spaceElement.getBoundingClientRect();
                    const targetLayout = matrixLayout([...projects.filter(p => p.details.quadrant === target.id && p.id !== project.id), { ...project, details: { ...project.details, matrixPosition: null } }], space.width, space.height);
                    const matrixPosition = snapSlot(targetLayout, project.id, (e.clientX - space.left) / (space.width / targetLayout.columns) - .5, (e.clientY - space.top + spaceElement.scrollTop) / targetLayout.cellHeight - .5);
                    onSave(project.id, { quadrant: target.id, matrixPosition });
                    setAnnouncement(`${project.name} moved to ${target.title}.`);
                  }
                  drag.current = null; setPreview(null);
                }}
                onPointerCancel={() => { drag.current = null; setPreview(null); }}
                onKeyDown={e => {
                  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
                  e.preventDefault(); suppressClick.current = false; keyboardFocus.current = project.id;
                  let x = column + (e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0);
                  let y = row + (e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0);
                  let quadrantColumn = quadrantIndex % 2, quadrantRow = Math.floor(quadrantIndex / 2);
                  if (x >= layout.columns && quadrantColumn === 0) { quadrantColumn = 1; x = 0; }
                  else if (x < 0 && quadrantColumn === 1) { quadrantColumn = 0; x = Infinity; }
                  if (y >= layout.rows && quadrantRow === 0) { quadrantRow = 1; y = 0; }
                  else if (y < 0 && quadrantRow === 1) { quadrantRow = 0; y = Infinity; }
                  const target = quadrants[quadrantRow * 2 + quadrantColumn]!;
                  const targetLayout = matrixLayout([...projects.filter(p => p.details.quadrant === target.id && p.id !== project.id), { ...project, details: { ...project.details, matrixPosition: null } }], widths[target.id]?.width ?? 104, widths[target.id]?.height ?? 300);
                  x = Math.max(0, Math.min(targetLayout.columns - 1, x));
                  y = Math.max(0, Math.min(targetLayout.rows - 1, y));
                  onSave(project.id, { quadrant: target.id, matrixPosition: snapSlot(targetLayout, project.id, x, y) });
                  setAnnouncement(`${project.name}: ${target.title}.`);
                }}>
                <Plant project={project} /><span>{project.name}</span>
              </button>;
            })}
            </div>
          </div>
        </section>;
      })}
    </div>
  </section>;
}
