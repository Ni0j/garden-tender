import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { Plant, type Project } from "./Plant";
import { FloatGarden, ViewChoice, type ViewMode } from "./FloatGarden";

type Filter = "active" | "completed" | "archived";

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "active", label: "Growing" },
  { value: "completed", label: "Bloomed" },
  { value: "archived", label: "Archived" },
];

const OUTCOME_TYPES = ["Payment", "New client", "Job offer", "Portfolio piece", "New connection", "Knowledge", "Other"];

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function nextMilestone(count: number): string {
  if (count < 1) return "First shoot after the next effort";
  if (count < 3) return `${3 - count} effort${3 - count === 1 ? "" : "s"} to young plant`;
  if (count < 6) return `${6 - count} efforts to growing plant`;
  if (count < 10) return `${10 - count} efforts to mature plant`;
  if (count < 15) return `${15 - count} efforts to bloom`;
  return "In bloom";
}


function GardenCard({ project, onOpen, animate }: { project: Project; onOpen: () => void; animate: boolean }) {
  const [fruitLabel, setFruitLabel] = useState<string | null>(null);
  return (
    <article className={`garden-card status-${project.status}`}>
      <button className="plant-button" onClick={onOpen} aria-label={`Open ${project.name}`}>
        <Plant project={project} animate={animate} />
      </button>
      <div className="project-caption">
        <div>
          <h2>{project.name}</h2>
          <p>{project.growthStage} · {project.efforts.length} effort{project.efforts.length === 1 ? "" : "s"}</p>
        </div>
        {project.outcomes.length > 0 && (
          <button
            className="fruit-count"
            onClick={() => {
              const outcome = project.outcomes[0];
              setFruitLabel(outcome ? `${outcome.type}: ${outcome.value}${project.outcomes.length > 1 ? ` +${project.outcomes.length - 1}` : ""}` : null);
            }}
            aria-label={`Show outcomes for ${project.name}`}
          >
            <span className="fruit-dot" /> {project.outcomes.length}
          </button>
        )}
      </div>
      {fruitLabel && (
        <button className="fruit-note" onClick={() => setFruitLabel(null)} aria-label="Hide outcome">
          {fruitLabel}
        </button>
      )}
    </article>
  );
}

function CreateProjectPanel({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [nextStep, setNextStep] = useState("");
  const [deadline, setDeadline] = useState("");
  const create = useMutation({
    mutationFn: () => api.createProject({ name, description, nextStep: nextStep.trim() || null, deadline: deadline || null }),
    onSuccess: (result) => onCreated(result.id),
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }
  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-labelledby="plant-seed-title">
      <div className="form-sheet compact-sheet">
        <div className="sheet-heading">
          <div>
            <p className="overline">New ground</p>
            <h2 id="plant-seed-title">Plant a project</h2>
          </div>
          <button className="close-button" onClick={onClose} aria-label="Close new project form">×</button>
        </div>
        <form onSubmit={submit} className="stack-form">
          <label>
            Project name
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required autoFocus />
          </label>
          <label>
            Short description
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={300} rows={3} required />
          </label>
          <label>
            Next step <span>optional</span>
            <input value={nextStep} onChange={(event) => setNextStep(event.target.value)} maxLength={240} placeholder="The next concrete thing to do" />
          </label>
          <label>
            Deadline <span>optional</span>
            <input type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} />
          </label>
          {create.error && <p className="form-error">Could not plant this seed. Try again.</p>}
          <button className="primary-button" type="submit" disabled={create.isPending}>{create.isPending ? "Planting…" : "Plant seed"}</button>
        </form>
      </div>
    </div>
  );
}

function ProjectDetail({ project, onClose, onChanged, setAnimating }: { project: Project; onClose: () => void; onChanged: () => void; setAnimating: (value: boolean) => void }) {
  const [effortText, setEffortText] = useState("");
  const [outcomeType, setOutcomeType] = useState(OUTCOME_TYPES[0] ?? "Other");
  const [outcomeValue, setOutcomeValue] = useState("");
  const [outcomeNote, setOutcomeNote] = useState("");
  const [showOutcome, setShowOutcome] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [nextStepText, setNextStepText] = useState("");

  const effort = useMutation({
    mutationFn: () => api.addEffort({ projectId: project.id, text: effortText }),
    onMutate: () => setMessage(null),
    onError: () => setMessage("Could not add this effort. Try again."),
    onSuccess: () => {
      const milestone = [1, 3, 6, 10, 15].includes(project.efforts.length + 1);
      setEffortText("");
      setMessage(milestone ? "A new growth stage." : "Effort added. The plant grew.");
      setAnimating(true);
      window.setTimeout(() => setAnimating(false), 900);
      onChanged();
    },
  });
  const outcome = useMutation({
    mutationFn: () => api.addOutcome({ projectId: project.id, type: outcomeType, value: outcomeValue, note: outcomeNote.trim() || null }),
    onMutate: () => setMessage(null),
    onError: () => setMessage("Could not add this outcome. Try again."),
    onSuccess: () => {
      setOutcomeValue("");
      setOutcomeNote("");
      setShowOutcome(false);
      setMessage("Outcome added. The plant is bearing fruit.");
      onChanged();
    },
  });
  const setNextStep = useMutation({
    mutationFn: () => api.setNextStep({ projectId: project.id, text: nextStepText }),
    onMutate: () => setMessage(null),
    onError: () => setMessage("Could not save the next step. Try again."),
    onSuccess: () => { setNextStepText(""); setMessage("Next step saved."); onChanged(); },
  });
  const completeNextStep = useMutation({
    mutationFn: () => api.completeNextStep({ projectId: project.id }),
    onMutate: () => setMessage(null),
    onError: () => setMessage("Could not complete the next step. Try again."),
    onSuccess: () => {
      setMessage("Next step completed. The plant grew.");
      setAnimating(true);
      window.setTimeout(() => setAnimating(false), 900);
      onChanged();
    },
  });
  const complete = useMutation({
    mutationFn: () => api.completeProject({ projectId: project.id }),
    onMutate: () => setMessage(null),
    onError: () => setMessage("Could not complete this project. Try again."),
    onSuccess: () => {
      setMessage("Project completed.");
      setAnimating(true);
      window.setTimeout(() => setAnimating(false), 1100);
      onChanged();
    },
  });
  const archive = useMutation({
    mutationFn: () => api.archiveProject({ projectId: project.id }),
    onMutate: () => setMessage(null),
    onError: () => setMessage("Could not archive this project. Try again."),
    onSuccess: () => {
      setMessage("Project moved into dormancy.");
      onChanged();
    },
  });
  const readOnly = project.status === "archived";

  return (
    <div className="modal-layer detail-layer" role="dialog" aria-modal="true" aria-labelledby="project-title">
      <div className="detail-sheet">
        <button className="close-button detail-close" onClick={onClose} aria-label="Close project details">×</button>
        <section className="detail-botanical">
          <Plant project={project} large />
          <div className="stage-stamp">
            <span>{project.growthStage}</span>
            <small>{readOnly ? "Dormant" : nextMilestone(project.efforts.length)}</small>
          </div>
        </section>
        <section className="detail-content">
          <header>
            <p className="overline">{project.status === "active" ? "Growing" : project.status === "completed" ? "Bloomed" : "Archived"}</p>
            <h2 id="project-title">{project.name}</h2>
            <p className="description">{project.description}</p>
            <div className="date-row">
              <span>Planted {formatDate(project.createdAt)}</span>
              {project.deadline && <span>Due {new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(`${project.deadline}T00:00:00`))}</span>}
            </div>
          </header>

          {message && <p className="notice" role="status">{message}</p>}

          {!readOnly && project.status === "active" && (
            <section className="next-step" aria-labelledby="next-step-title">
              <h3 id="next-step-title">Next step</h3>
              {project.nextStep ? (
                <label className="next-step-check">
                  <input type="checkbox" checked={false} onChange={() => completeNextStep.mutate()} disabled={completeNextStep.isPending} />
                  <span>{project.nextStep}</span>
                </label>
              ) : (
                <form className="inline-entry" onSubmit={(event) => { event.preventDefault(); setNextStep.mutate(); }}>
                  <input value={nextStepText} onChange={(event) => setNextStepText(event.target.value)} placeholder="Add the next concrete step" maxLength={240} required />
                  <button type="submit" disabled={setNextStep.isPending}>{setNextStep.isPending ? "Saving…" : "Set next step"}</button>
                </form>
              )}
            </section>
          )}

          {!readOnly && (
            <form className="effort-form" onSubmit={(event) => { event.preventDefault(); effort.mutate(); }}>
              <label htmlFor="effort-entry">What moved this project forward?</label>
              <div className="inline-entry">
                <input id="effort-entry" value={effortText} onChange={(event) => setEffortText(event.target.value)} placeholder="Describe the work you actually did" maxLength={240} required />
                <button type="submit" disabled={effort.isPending}>{effort.isPending ? "Adding…" : "Add effort"}</button>
              </div>
            </form>
          )}

          <div className="history-section">
            <div className="section-heading">
              <h3>Effort history</h3>
              <span>{project.efforts.length}</span>
            </div>
            {project.efforts.length === 0 ? (
              <p className="empty-line">No effort logged yet. The seed is waiting.</p>
            ) : (
              <ol className="history-list">
                {[...project.efforts].reverse().map((entry) => (
                  <li key={entry.id}>
                    <span className="history-mark" />
                    <div><p>{entry.text}</p><time>{formatDate(entry.createdAt)}</time></div>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="outcome-section">
            <div className="section-heading">
              <h3>Outcomes</h3>
              {!readOnly && <button className="text-button" onClick={() => setShowOutcome((value) => !value)}>{showOutcome ? "Cancel" : "+ Add outcome"}</button>}
            </div>
            {showOutcome && (
              <form className="outcome-form" onSubmit={(event) => { event.preventDefault(); outcome.mutate(); }}>
                <label>Type<select value={outcomeType} onChange={(event) => setOutcomeType(event.target.value)}>{OUTCOME_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label>
                <label>Value<input value={outcomeValue} onChange={(event) => setOutcomeValue(event.target.value)} placeholder="$320, one client, a new skill…" maxLength={80} required /></label>
                <label className="wide-field">Note <span>optional</span><input value={outcomeNote} onChange={(event) => setOutcomeNote(event.target.value)} maxLength={200} /></label>
                <button className="secondary-button wide-field" type="submit" disabled={outcome.isPending}>{outcome.isPending ? "Adding…" : "Grow fruit"}</button>
              </form>
            )}
            {project.outcomes.length === 0 ? <p className="empty-line">No outcomes yet. Completion and outcomes are separate.</p> : (
              <ul className="outcome-list">
                {project.outcomes.map((item) => <li key={item.id}><span className="large-fruit" /><div><strong>{item.value}</strong><p>{item.type}{item.note ? ` · ${item.note}` : ""}</p></div></li>)}
              </ul>
            )}
          </div>

          {!readOnly && (
            <div className="project-actions">
              {project.status === "active" && <button className="complete-button" onClick={() => complete.mutate()} disabled={complete.isPending}>Mark complete</button>}
              <button className="archive-button" onClick={() => archive.mutate()} disabled={archive.isPending}>Archive project</button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export function App() {
  const queryClient = useQueryClient();
  const [view, setView] = useState<ViewMode>(() => {
    try { return localStorage.getItem("project-garden.view") === "minimal" ? "minimal" : "plant"; }
    catch { return "plant"; }
  });
  const changeView = (next: ViewMode) => {
    setView(next);
    try { localStorage.setItem("project-garden.view", next); } catch { /* Keep the current session usable. */ }
  };
  const [filter, setFilter] = useState<Filter>("active");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [animatingId, setAnimatingId] = useState<number | null>(null);
  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: () => api.listProjects({}) });
  const projects = projectsQuery.data?.projects ?? [];
  const selected = projects.find((project) => project.id === selectedId) ?? null;
  const visibleProjects = useMemo(() => projects.filter((project) => project.status === filter), [projects, filter]);
  const counts = useMemo(() => ({
    active: projects.filter((project) => project.status === "active").length,
    completed: projects.filter((project) => project.status === "completed").length,
    archived: projects.filter((project) => project.status === "archived").length,
  }), [projects]);
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ["projects"] }); };

  return (
    <div className="app-shell">
      <main>
        <header className="garden-intro">
          <div>
            <p className="overline">Tended by effort</p>
            <h1>Your garden</h1>
            <p className="intro-copy">Nothing grows on its own. Log the work that moved a project forward.</p>
          </div>
          <button className="add-project" onClick={() => setCreating(true)}><span>＋</span> Plant project</button>
        </header>

        <div className="garden-tools">
          <ViewChoice view={view} onChange={changeView} />
          <FloatGarden projects={projects} />
        </div>

        <nav className="filter-row" aria-label="Project status filters">
          {FILTERS.map((item) => (
            <button key={item.value} className={filter === item.value ? "active" : ""} onClick={() => setFilter(item.value)}>
              {item.label}<span>{counts[item.value]}</span>
            </button>
          ))}
        </nav>

        {projectsQuery.isPending ? (
          <div className="loading-garden"><span /><span /><span /><p>Waking the garden…</p></div>
        ) : projectsQuery.error ? (
          <div className="empty-garden"><h2>The garden could not be reached.</h2><button onClick={refresh}>Try again</button></div>
        ) : visibleProjects.length === 0 ? (
          <div className="empty-garden">
            <div className="empty-seed" />
            <h2>{filter === "active" ? "Plant the first seed." : filter === "completed" ? "No projects have bloomed yet." : "No plants are dormant."}</h2>
            <p>{filter === "active" ? "A project begins here, then grows only when you record real effort." : "This bed will hold the projects that reach this season."}</p>
            {filter === "active" && <button onClick={() => setCreating(true)}>Plant a project</button>}
          </div>
        ) : view === "minimal" ? (
          <section className="minimal-garden" aria-label="Project dashboard">
            {visibleProjects.map((project) => (
              <button className="project-row" key={project.id} onClick={() => setSelectedId(project.id)}>
                <span><strong>{project.name}</strong><small>{project.growthStage}</small></span>
                <span>{project.efforts.length} effort{project.efforts.length === 1 ? "" : "s"}<small>{project.outcomes.length} outcomes</small></span>
                <span aria-hidden="true">↗</span>
              </button>
            ))}
          </section>
        ) : (
          <section className="garden-bed" aria-label={`${FILTERS.find((item) => item.value === filter)?.label ?? "Project"} projects`}>
            <div className="garden-rule" />
            <div className="plant-grid">
              {visibleProjects.map((project) => (
                <GardenCard key={project.id} project={project} onOpen={() => setSelectedId(project.id)} animate={animatingId === project.id} />
              ))}
            </div>
          </section>
        )}
      </main>

      {creating && <CreateProjectPanel onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setSelectedId(id); refresh(); }} />}
      {selected && <ProjectDetail project={selected} onClose={() => setSelectedId(null)} onChanged={refresh} setAnimating={(value) => setAnimatingId(value ? selected.id : null)} />}
    </div>
  );
}
