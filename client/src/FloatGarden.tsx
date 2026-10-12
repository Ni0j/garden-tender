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

export function FloatGarden({ projects, onOpen, onChange }: { projects: Project[]; onOpen: (id: number) => void; onChange: (id: number, selected: boolean) => void }) {
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
      if (mounted.current) setError("The floating window could not open. Try Float again, or keep tending your garden here.");
    } finally {
      opening.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const content = <section className="floating-garden" aria-label="Active companions">
    {companions.length === 0 && <p>Choose a companion from your garden to keep it beside your work.</p>}
    {companions.map(project => <figure className="floating-plant" key={project.id}>
      <button className="plant-button" onClick={() => { onOpen(project.id); window.focus(); }} aria-label={`Return to ${project.name}`}><Plant project={project} /></button>
      <figcaption><button className="text-button" onClick={() => { onOpen(project.id); window.focus(); }}>{project.name} ↗</button></figcaption>
      <p>{project.details.context || "Add a reminder of where you left off."}</p>
      <small>Next: {project.details.todos.find(todo => !todo.done)?.text || "Choose your next step"}</small>
      <button className="text-button" onClick={() => onChange(project.id, false)}>Remove companion</button>
    </figure>)}
  </section>;
  return <div className="float-control">
    <button className="float-button" onClick={() => setChoosing(!choosing)}>Choose companions ({companions.length})</button>
    <button className="float-button" onClick={() => void open()} disabled={busy || companions.length === 0}>
      {busy ? "Opening…" : pip ? "Show Float ↗" : "Float ↗"}
    </button>
    <p>Keep selected projects beside your work.</p>
    {choosing && <div className="companion-picker">
      {available.length === 0 && <p>Plant a project to choose a companion.</p>}
      {available.map(project => <label key={project.id}><input type="checkbox" checked={project.details.inFloat} onChange={e => onChange(project.id, e.target.checked)} />{project.name}</label>)}
    </div>}
    {error && <p className="float-error" role="status">{error}</p>}
    {pip && createPortal(content, pip.document.body)}
    {inline && <aside className="inline-float"><button className="text-button" onClick={() => setInline(false)}>Close Float</button>{content}</aside>}
  </div>;
}
