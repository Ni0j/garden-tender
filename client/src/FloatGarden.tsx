import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation } from "@tanstack/react-query";
import { api } from "./api";
import { Plant, type Project } from "./Plant";

export type ViewMode = "plant" | "minimal";
type PictureInPicture = { requestWindow: (options: { width: number; height: number }) => Promise<Window> };

export function ViewChoice({ view, onChange }: { view: ViewMode; onChange: (view: ViewMode) => void }) {
  return <div className="view-choice" role="group" aria-label="Garden view">
    <button aria-pressed={view === "plant"} onClick={() => onChange("plant")}>Plant</button>
    <button aria-pressed={view === "minimal"} onClick={() => onChange("minimal")}>Minimal</button>
  </div>;
}

function FloatingProject({ project, view, onChanged }: { project: Project; view: ViewMode; onChanged: () => void }) {
  const [text, setText] = useState("");
  const effort = useMutation({
    mutationFn: () => api.addEffort({ projectId: project.id, text }),
    onSuccess: () => { setText(""); onChanged(); },
  });
  return <>
    {view === "plant" && <Plant project={project} animate={effort.isSuccess} />}
    <h1>{project.name}</h1>
    <p className="float-stage">{project.growthStage} · {project.efforts.length} effort{project.efforts.length === 1 ? "" : "s"}</p>
    {view === "minimal" && <dl className="float-stats"><div><dt>Efforts</dt><dd>{project.efforts.length}</dd></div><div><dt>Outcomes</dt><dd>{project.outcomes.length}</dd></div></dl>}
    <form className="float-effort" onSubmit={(event) => { event.preventDefault(); effort.mutate(); }}>
      <label htmlFor="float-effort">What moved this project forward?</label>
      <input id="float-effort" value={text} onChange={(event) => { setText(event.target.value); if (!effort.isPending) effort.reset(); }} maxLength={240} required placeholder="A little effort counts" />
      <button className="primary-button" disabled={effort.isPending || !text.trim()}>{effort.isPending ? "Adding…" : "Add effort"}</button>
      {effort.isError && <p className="form-error" role="alert">Could not add this effort. Your note is kept—try again.</p>}
      {effort.isSuccess && <p className="float-feedback" role="status">Effort added. Your garden is up to date.</p>}
    </form>
  </>;
}

export function FloatGarden({ projects, view, onViewChange, onChanged }: {
  projects: Project[]; view: ViewMode; onViewChange: (view: ViewMode) => void; onChanged: () => void;
}) {
  const [pip, setPip] = useState<Window | null>(null);
  const currentWindow = useRef<Window | null>(null);
  const opening = useRef(false);
  const mounted = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<number | null>(null);
  const available = projects.filter((project) => project.status !== "archived");
  const project = available.find((item) => item.id === projectId) ?? available[0];
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
      child = await apiPip.requestWindow({ width: 340, height: view === "plant" ? 550 : 380 });
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
      <section className={`floating-garden view-${view}`} aria-label="Floating garden">
        <header><span className="overline">Tended by effort</span><button className="text-button" onClick={() => pip.close()}>Close float</button></header>
        <ViewChoice view={view} onChange={onViewChange} />
        {project ? <>
          <label className="float-project-label" htmlFor="float-project">Project</label>
          <select id="float-project" value={project.id} onChange={(event) => setProjectId(Number(event.target.value))}>
            {available.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <FloatingProject key={project.id} project={project} view={view} onChanged={onChanged} />
        </> : <p className="empty-line">No growing or bloomed projects. Plant one in your garden to continue.</p>}
        <p className="float-footnote">Lives with your garden tab. No installation needed.</p>
      </section>, pip.document.body,
    )}
  </div>;
}
