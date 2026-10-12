import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plant, type Project } from "./Plant";

export type ViewMode = "plant" | "minimal";
type PictureInPicture = { requestWindow: (options: { width: number; height: number }) => Promise<Window> };

export function ViewChoice({ view, onChange }: { view: ViewMode; onChange: (view: ViewMode) => void }) {
  return <div className="view-choice" role="group" aria-label="Garden view">
    <button aria-pressed={view === "plant"} onClick={() => onChange("plant")}>Plant</button>
    <button aria-pressed={view === "minimal"} onClick={() => onChange("minimal")}>Minimal</button>
  </div>;
}

export function FloatGarden({ projects }: { projects: Project[] }) {
  const [pip, setPip] = useState<Window | null>(null);
  const currentWindow = useRef<Window | null>(null);
  const opening = useRef(false);
  const mounted = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const available = projects.filter((project) => project.status !== "archived");
  const apiPip = (window as Window & { documentPictureInPicture?: PictureInPicture }).documentPictureInPicture;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; currentWindow.current?.close(); };
  }, []);

  async function open() {
    if (!apiPip) {
      setError("Float is not available in this browser. Try desktop Chrome or Edge; your garden works here as usual.");
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

  return <div className="float-control">
    <button className="float-button" onClick={() => void open()} disabled={busy || available.length === 0} aria-describedby="float-hint">
      {busy ? "Opening…" : pip ? "Show floating garden ↗" : "Float garden ↗"}
    </button>
    <p id="float-hint">{available.length === 0 ? "Plant a project to float it." : pip ? "Keep this tab open while your garden floats." : "Keep a plant beside your work."}</p>
    {error && <p className="float-error" role="alert">{error}</p>}
    {pip && createPortal(
      <section className="floating-garden" aria-label="Floating garden">
        {available.map((project) => (
          <figure className="floating-plant" key={project.id} tabIndex={0} aria-label={`${project.name}: ${project.growthStage}`}>
            <Plant project={project} />
            <figcaption>{project.name}</figcaption>
          </figure>
        ))}
      </section>, pip.document.body,
    )}
  </div>;
}
