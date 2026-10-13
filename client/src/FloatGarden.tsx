import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plant, type Project } from "./Plant";

export type ViewMode = "plant" | "minimal" | "matrix";
type PictureInPicture = { requestWindow: (options: { width: number; height: number }) => Promise<Window> };

export function ViewChoice({ view, onChange }: { view: ViewMode; onChange: (view: ViewMode) => void }) {
  return <div className="view-choice" role="group" aria-label="Garden view">
    <button aria-pressed={view === "plant"} onClick={() => onChange("plant")}>Garden</button>
    <button aria-pressed={view === "matrix"} onClick={() => onChange("matrix")}>Matrix</button>
    <button aria-pressed={view === "minimal"} onClick={() => onChange("minimal")}>Minimal</button>
  </div>;
}

export function FloatGarden({ projects, onOpen, onChange, busy: saving }: { projects: Project[]; onOpen: (id: number) => void; onChange: (id: number, selected: boolean) => void; busy: boolean }) {
  const [choosing, setChoosing] = useState(false);
  const [inline, setInline] = useState(false);
  const [pip, setPip] = useState<Window | null>(null);
  const currentWindow = useRef<Window | null>(null);
  const opening = useRef(false);
  const mounted = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const available = projects.filter((project) => project.status !== "archived");
  const companions = available.filter(project => project.details.inFloat);
  const apiPip = (window as Window & { documentPictureInPicture?: PictureInPicture }).documentPictureInPicture;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; currentWindow.current?.close(); };
  }, []);

  async function open() {
    if (!apiPip) {
      setInline(true);
      setError("Companions are shown here. For an always-on-top window, use desktop Chrome or Edge.");
      return;
    }
    if (currentWindow.current && !currentWindow.current.closed) { currentWindow.current.focus(); return; }
    if (opening.current) return;
    opening.current = true;
    setBusy(true);
    setError(null);
    let child: Window | undefined;
    try {
      child = await apiPip.requestWindow({ width: 420, height: 420 });
      if (!mounted.current) { child.close(); return; }
      child.document.title = "Your floating garden";
      child.document.documentElement.lang = "en";
      document.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
        const copy = node.cloneNode(true) as HTMLElement;
        if (node instanceof HTMLLinkElement) (copy as HTMLLinkElement).href = node.href;
        child!.document.head.append(copy);
      });
      child.document.body.className = "float-body";
      const opened = child;
      opened.addEventListener("pagehide", () => {
        if (currentWindow.current === opened) {
          currentWindow.current = null;
          if (mounted.current) setPip(null);
        }
      }, { once: true });
      currentWindow.current = opened;
      setPip(opened);
    } catch {
      child?.close();
      if (mounted.current) { setInline(true); setError("This browser could not open a floating window. Your companions are shown here instead."); }
    } finally {
      opening.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const returnTo = (id: number) => { setInline(false); onOpen(id); window.focus(); };
  const content = <section className="floating-garden" aria-label="Active companions">
    {companions.length === 0 && <p>Choose an existing project to keep it beside your work.</p>}
    {companions.map(project => <figure className="floating-plant" key={project.id}>
      <figcaption><button onClick={() => returnTo(project.id)}>{project.name}</button></figcaption>
      <button className="plant-button" onClick={() => returnTo(project.id)} aria-label={`Return to ${project.name}`}><Plant project={project} /></button>
      <dl className="float-steps"><div><dt>Previous</dt><dd>{project.efforts.at(-1)?.text || "No steps completed yet"}</dd></div><div><dt>Next</dt><dd>{project.details.todos.find(todo => !todo.done)?.text || "Choose a next step"}</dd></div></dl>
      <button className="text-button remove-companion" disabled={saving} onClick={() => onChange(project.id, false)}>Remove from Float</button>
    </figure>)}
  </section>;
  return <section className="float-control" aria-labelledby="float-title">
    <div className="float-heading"><div><h2 id="float-title">Float · current companions</h2><p>Bring existing projects beside your work. Your garden stays as it is.</p></div>
      <div className="float-actions">
        <button className="float-button" aria-expanded={choosing} onClick={() => setChoosing(!choosing)}>{choosing ? "Done choosing" : "Choose plants"}{companions.length > 0 ? ` (${companions.length})` : ""}</button>
        <button className="text-button" onClick={() => void open()} disabled={busy || companions.length === 0}>{busy ? "Opening…" : pip ? "Show Float ↗" : "Open Float ↗"}</button>
      </div>
    </div>
    {companions.length > 0 && <button className="text-button inline-float-toggle" onClick={() => setInline(!inline)}>{inline ? "Hide preview" : "Preview companions here"}</button>}
    {choosing && <div className="companion-picker">
      {available.length === 0 && <p>Your projects will appear here after you add a plant to the garden.</p>}
      {available.map(project => <label key={project.id}><input type="checkbox" checked={project.details.inFloat} disabled={saving} onChange={e => onChange(project.id, e.target.checked)} />{project.name}</label>)}
    </div>}
    {error && <p className="float-error" role="status">{error}</p>}
    {pip && createPortal(content, pip.document.body)}
    {inline && <aside className="inline-float" aria-label="Float preview"><button className="text-button" onClick={() => setInline(false)}>Close preview</button>{content}</aside>}
  </section>;
}
