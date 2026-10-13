import { useEffect, useRef, useState } from "react";
import { Plant, type Project } from "./Plant";
import type { Details } from "../../shared/project";

const quadrants: { id: Details["quadrant"]; title: string; hint: string }[] = [
  { id: "do", title: "Important + Urgent", hint: "Do next" },
  { id: "plan", title: "Important + Not Urgent", hint: "Make time" },
  { id: "delegate", title: "Not Important + Urgent", hint: "Delegate or simplify" },
  { id: "later", title: "Not Important + Not Urgent", hint: "Leave for later" },
];
type Props = { projects: Project[]; onOpen: (id: number) => void; onSave: (id: number, settings: Partial<Details>) => void };
const clamp = (value: number) => Math.max(0, Math.min(1, value));
type Drag = { id: number; startX: number; startY: number; left: number; top: number; width: number; height: number; moved: boolean };

export function Matrix({ projects, onOpen, onSave }: Props) {
  const board = useRef<HTMLDivElement>(null);
  const keyboardFocus = useRef<number | null>(null);
  useEffect(() => {
    if (keyboardFocus.current !== null) {
      board.current?.querySelector<HTMLButtonElement>(`[data-project-id="${keyboardFocus.current}"]`)?.focus({ preventScroll: true });
      keyboardFocus.current = null;
    }
  }, [projects]);
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const [preview, setPreview] = useState<{ id: number; x: number; y: number } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const largest = Math.max(1, ...quadrants.map(q => projects.filter(p => p.details.quadrant === q.id).length));
  const spaceHeight = Math.max(260, largest * 190);
  return <section aria-label="Plant priority matrix">
    <p className="view-hint">Drag a plant to arrange it or change its priority. Select to tend it. Arrow keys move a focused plant.</p>
    <p role="status" className="sr-only">{announcement}</p>
    <div className="plant-matrix" ref={board}>
      {quadrants.map((quadrant, quadrantIndex) => {
        const plants = projects.filter(project => project.details.quadrant === quadrant.id);
        return <section key={quadrant.id} className="matrix-quadrant" aria-label={quadrant.title}>
          <header><h2>{quadrant.title}</h2><p>{quadrant.hint}</p></header>
          <div className="quadrant-space" data-quadrant={quadrant.id} style={{ height: spaceHeight }}>
            {plants.length === 0 && <p className="matrix-empty">Room to grow</p>}
            {plants.map((project, index) => {
              const position = project.details.matrixPosition ?? { x: plants.length === 1 ? .5 : index % 2 ? .65 : .35, y: plants.length === 1 ? .35 : index / (plants.length - 1) };
              const moving = preview?.id === project.id;
              return <button key={project.id} data-project-id={project.id} className={`matrix-plant ${moving ? "is-dragging" : ""}`}
                style={{ left: `calc(${position.x * 100}% - var(--matrix-plant-width) * ${position.x})`, top: `calc(${position.y * 100}% - var(--matrix-plant-height) * ${position.y})`, transform: moving ? `translate(${preview.x}px, ${preview.y}px)` : undefined }}
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
                    const space = board.current.querySelector<HTMLElement>(`[data-quadrant="${target.id}"]`)!.getBoundingClientRect();
                    const matrixPosition = { x: clamp((current.left + e.clientX - current.startX - space.left) / Math.max(1, space.width - current.width)), y: clamp((current.top + e.clientY - current.startY - space.top) / Math.max(1, space.height - current.height)) };
                    onSave(project.id, { quadrant: target.id, matrixPosition });
                    setAnnouncement(`${project.name} moved to ${target.title}.`);
                  }
                  drag.current = null; setPreview(null);
                }}
                onPointerCancel={() => { drag.current = null; setPreview(null); }}
                onKeyDown={e => {
                  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
                  e.preventDefault(); suppressClick.current = false; keyboardFocus.current = project.id;
                  let x = position.x + (e.key === "ArrowRight" ? .15 : e.key === "ArrowLeft" ? -.15 : 0);
                  let y = position.y + (e.key === "ArrowDown" ? .15 : e.key === "ArrowUp" ? -.15 : 0);
                  let column = quadrantIndex % 2, row = Math.floor(quadrantIndex / 2);
                  if (x > 1 && column === 0) { column = 1; x = 0; }
                  else if (x < 0 && column === 1) { column = 0; x = 1; }
                  if (y > 1 && row === 0) { row = 1; y = 0; }
                  else if (y < 0 && row === 1) { row = 0; y = 1; }
                  const target = quadrants[row * 2 + column]!;
                  onSave(project.id, { quadrant: target.id, matrixPosition: { x: clamp(x), y: clamp(y) } });
                  setAnnouncement(`${project.name}: ${target.title}.`);
                }}>
                <Plant project={project} /><span>{project.name}</span>
              </button>;
            })}
          </div>
        </section>;
      })}
    </div>
  </section>;
}
