import { useModalFocus } from "./useModalFocus";
import { PrivacyNotice } from "./PrivacyNotice";
import { BillingPanel } from "./BillingPanel";
import type { Account } from "../../shared/account";
import { displayDate } from "../../shared/dates";
import { Matrix } from "./GardenViews";
import { ProjectList } from "./ProjectList";
import { ProjectWork } from "./ProjectWork";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, accountRequest, existingAnonymousId } from "./api";
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
  return displayDate(value);
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
  useModalFocus(onClose);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [nextStep, setNextStep] = useState("");
  const [deadline, setDeadline] = useState("");
  const [projectType, setProjectType] = useState<"ongoing" | "recurring">("ongoing");
  const create = useMutation({
    mutationFn: () => api.createProject({ name, description, projectType, nextStep: nextStep.trim() || null, deadline: deadline || null }),
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
            <h2 id="plant-seed-title">Grow a new project</h2>
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
          <label className="recurring-choice"><input type="checkbox" checked={projectType === "recurring"} onChange={e => setProjectType(e.target.checked ? "recurring" : "ongoing")} />This is a recurring activity</label>
          <label>
            Deadline <span>optional — grow at your own pace</span>
            <input type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} />
          </label>
          {create.error && <p className="form-error">{create.error.message}</p>}
          <button className="primary-button" type="submit" disabled={create.isPending}>{create.isPending ? "Planting…" : "Create project"}</button>
        </form>
      </div>
    </div>
  );
}

function ProjectDetail({ project, onClose, onChanged, setAnimating }: { project: Project; onClose: () => void; onChanged: () => void; setAnimating: (value: boolean) => void }) {
  useModalFocus(onClose);
  const [effortText, setEffortText] = useState("");
  const [outcomeType, setOutcomeType] = useState(OUTCOME_TYPES[0] ?? "Other");
  const [outcomeValue, setOutcomeValue] = useState("");
  const [outcomeNote, setOutcomeNote] = useState("");
  const [showOutcome, setShowOutcome] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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
      setMessage("Project archived. Steps and history are kept; restore it whenever you are ready.");
      onChanged();
    },
  });
  const restore = useMutation({ mutationFn: () => api.restoreProject({ projectId: project.id }), onSuccess: () => { setMessage("Plant restored."); onChanged(); }, onError: (error) => setMessage(error.message) });
  const readOnly = project.status === "archived";

  return (
    <div className="modal-layer detail-layer" role="dialog" aria-modal="true" aria-labelledby="project-title">
      <div className="detail-sheet">
        <button className="close-button detail-close" onClick={onClose} aria-label="Close project details">×</button>
        <section className="detail-botanical">
          <Plant project={project} large />
          <div className="stage-stamp">
            <span>{project.growthStage}</span>
            <small>{readOnly ? "Dormant" : project.completedAt ? "Completed" : nextMilestone(project.efforts.length)}</small>
          </div>
        </section>
        <section className="detail-content">
          <header>
            <p className="overline">{project.status === "active" ? "Growing" : project.status === "completed" ? "Bloomed" : "Archived"}</p>
            <h2 id="project-title">{project.name}</h2>
            <p className="description">{project.description}</p>
            <div className="date-row">
              <span>Planted {formatDate(project.createdAt)}</span>
              {project.deadline && <span>Due {displayDate(project.deadline)}</span>}
            </div>
          </header>

          {message && <p className="notice" role="status">{message}</p>}

          <ProjectWork key={project.id} project={project} onChanged={onChanged} />

          {!readOnly && (
            <details className="other-effort"><summary>Log other work</summary>
            <form className="effort-form" onSubmit={(event) => { event.preventDefault(); effort.mutate(); }}>
              <label htmlFor="effort-entry">What moved this project forward?</label>
              <div className="inline-entry">
                <input id="effort-entry" value={effortText} onChange={(event) => setEffortText(event.target.value)} placeholder="Describe the work you actually did" maxLength={240} required />
                <button type="submit" disabled={effort.isPending}>{effort.isPending ? "Adding…" : "Add effort"}</button>
              </div>
            </form>
            </details>
          )}

          <details className="history-section"><summary>Effort history ({project.efforts.length})</summary>
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
          </details>

          <details className="outcome-section"><summary>Outcomes ({project.outcomes.length})</summary>
            <div className="section-heading">
              <h3>Outcomes</h3>
              {!readOnly && <button className="text-button" onClick={() => setShowOutcome((value) => !value)}>{showOutcome ? "Cancel" : "+ Add outcome"}</button>}
            </div>
            {showOutcome && !readOnly && (
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
          </details>

          {readOnly && <div className="project-actions"><button className="secondary-button" disabled={restore.isPending} onClick={() => restore.mutate()}>Restore project</button></div>}
          {!readOnly && (
            <div className="project-actions">
              {project.status === "active" && project.details.projectType === "ongoing" && <button className="complete-button" onClick={() => complete.mutate()} disabled={complete.isPending}>Mark complete</button>}
              <button className="archive-button" onClick={() => archive.mutate()} disabled={archive.isPending}>Archive project</button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export function App({ accountEmail, onChangePassword, onSignOut }: { accountEmail: string; onChangePassword: (password: string) => Promise<unknown>; onSignOut: (localOnly?: boolean) => Promise<unknown> }) {
  const queryClient = useQueryClient();
  const [anonymousId] = useState(existingAnonymousId);
  const [migrationDismissed, setMigrationDismissed] = useState(false);
  const [view, setView] = useState<ViewMode>(() => {
    try { const saved = localStorage.getItem("project-garden.view"); return saved === "minimal" || saved === "matrix" ? saved : "plant"; }
    catch { return "plant"; }
  });
  const changeView = (next: ViewMode) => {
    setView(next);
    try { localStorage.setItem("project-garden.view", next); } catch { /* Keep the current session usable. */ }
  };
  const [gardenMessage, setGardenMessage] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmedPassword, setConfirmedPassword] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [filter, setFilter] = useState<Filter>("active");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showBilling, setShowBilling] = useState(() => new URLSearchParams(window.location.search).has("billing"));
  const [billingMessage, setBillingMessage] = useState<string | null>(null);
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("billing");
    if (!result) return;
    const url = new URL(window.location.href); url.searchParams.delete("billing"); window.history.replaceState(null, "", url);
    if (result === "canceled") { setBillingMessage("Checkout canceled. Your current plan is unchanged."); return; }
    setBillingMessage("Checking your payment with the billing service…");
    void accountRequest<Account>("billing/refresh").then(account => {
      setBillingMessage(account.plan === "plus" ? "Garden Plus is active. Thank you." : "Your payment has not been confirmed yet. Check payment status in billing shortly.");
      void queryClient.invalidateQueries();
    }).catch(() => setBillingMessage("Payment verification is temporarily unavailable. Use Check payment status in billing to retry."));
  }, [queryClient]);
  const accountQuery = useQuery({ queryKey: ["account"], queryFn: () => accountRequest<Account>("account"), refetchInterval: 60_000 });
  const account = accountQuery.data;
  const [creating, setCreating] = useState(false);
  const [animatingId, setAnimatingId] = useState<number | null>(null);
  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: () => api.listProjects({}) });
  const projects = projectsQuery.data?.projects ?? [];
  const selected = projects.find((project) => project.id === selectedId) ?? null;
  const visibleProjects = useMemo(() => projects.filter((project) => project.status === filter && (typeFilter === "all" || project.details.projectType === typeFilter)), [projects, filter, typeFilter]);
  const counts = useMemo(() => ({
    active: projects.filter((project) => project.status === "active").length,
    completed: projects.filter((project) => project.status === "completed").length,
    archived: projects.filter((project) => project.status === "archived").length,
  }), [projects]);
  const refresh = () => { void queryClient.invalidateQueries(); };

  const update = useMutation({ mutationFn: api.updateProject, onSuccess: refresh });
  const exportData = useMutation({
    mutationFn: () => api.exportGarden({}),
    onSuccess: (data) => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `gardener-export-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    },
  });
  const signOut = useMutation({ mutationFn: () => onSignOut() });
  const changePassword = useMutation({
    mutationFn: async () => {
      if (newPassword !== confirmedPassword) throw new Error("Passwords do not match.");
      await onChangePassword(newPassword);
    },
    onSuccess: () => {
      setNewPassword(""); setConfirmedPassword(""); setChangingPassword(false);
      setGardenMessage("Password updated.");
    },
  });
  const deleteData = useMutation({
    mutationFn: () => api.deletePersonalData({ confirmation: "DELETE" }),
    onSettled: refresh,
    onSuccess: async () => {
      queryClient.clear();
      await onSignOut(true);
    },
  });

  function permanentlyDeleteData() {
    if (window.confirm("Permanently delete this account and every project, effort, and outcome? This cannot be undone.")) deleteData.mutate();
  }

  return (
    <div className="app-shell">
      <main inert={creating || Boolean(selected) || (showBilling && Boolean(account) && !account?.testing)}>
        <header className="garden-intro">
          <div>
            <p className="overline">Tended by effort</p>
            <h1>Your garden</h1>
            <p className="intro-copy">Keep your place. Tend your projects, one small effort at a time.</p>
          </div>
          <div className="header-actions">
            <details className="account-menu">
              <summary aria-label="Account menu">Account</summary>
              <div>
                <p>{accountEmail}</p>
                {account && !account.testing && <button onClick={() => setShowBilling(true)}>{account.plan === "plus" ? "Garden Plus · Manage billing" : "Garden Free · Explore Plus"}</button>}
                {anonymousId && <button onClick={() => { setMigrationDismissed(false); }}>About this browser’s old garden</button>}
                <button onClick={() => exportData.mutate()} disabled={exportData.isPending}>{exportData.isPending ? "Preparing export…" : "Export garden data"}</button>
                <button onClick={() => setChangingPassword(value => !value)}>Change password</button>
                {changingPassword && <form className="stack-form" onSubmit={event => { event.preventDefault(); changePassword.mutate(); }}>
                  <label>New password<input type="password" autoComplete="new-password" value={newPassword} onChange={event => setNewPassword(event.target.value)} minLength={8} required /></label>
                  <label>Confirm new password<input type="password" autoComplete="new-password" value={confirmedPassword} onChange={event => setConfirmedPassword(event.target.value)} minLength={8} required /></label>
                  <button type="submit" disabled={changePassword.isPending}>{changePassword.isPending ? "Saving…" : "Save password"}</button>
                  {changePassword.error && <p className="form-error" role="alert">{changePassword.error.message}</p>}
                </form>}
                <button disabled={signOut.isPending} onClick={() => signOut.mutate()}>Sign out</button>
                <button className="danger-action" onClick={permanentlyDeleteData} disabled={deleteData.isPending}>{deleteData.isPending ? "Deleting…" : "Delete account and garden data"}</button>
                {(exportData.error || deleteData.error || signOut.error) && <p className="form-error">{(exportData.error || deleteData.error || signOut.error)?.message}</p>}
              </div>
            </details>
            <button className="add-project" onClick={() => account && !account.canCreate ? setShowBilling(true) : setCreating(true)}><span>＋</span> Add a plant</button>
          </div>
        </header>

        {anonymousId && !migrationDismissed && (
          <section className="migration-notice" aria-labelledby="migration-title">
            <div><h2 id="migration-title">Your older garden is preserved</h2><p>This browser has an older garden. For your privacy, importing it now requires verified support assistance. Its data has not been deleted.</p></div>
            <div className="migration-actions"><button className="text-button" onClick={() => setMigrationDismissed(true)}>Dismiss</button></div>
          </section>
        )}

        {gardenMessage && <p className="notice" role="status">{gardenMessage}</p>}
        {billingMessage && <p className="notice" role="status">{billingMessage}</p>}
        {account && !account.testing && <p className="notice">{account.plan === "plus" ? "Garden Plus · Unlimited active plants" : `Garden Free · ${account.activeCount} of 3 active plants`} · <button className="text-button" onClick={() => setShowBilling(true)}>{account.plan === "plus" ? "Manage billing" : "Explore Plus"}</button></p>}
        {account && !account.testing && account.pausedCount > 0 && <p className="notice" role="status">{account.pausedCount} extra plant{account.pausedCount === 1 ? " is" : "s are"} safely archived after returning to Free. All history is preserved. Archive a growing plant to make room, then restore one from Archived. <button className="text-button" onClick={() => setFilter("archived")}>View Archived</button></p>}
        {account && !["none", "complete"].includes(account.deletionState) && <p className="form-error" role="alert">Account deletion is pending. Changes are locked. Use Account → Delete account to retry; the server also retries automatically.</p>}
        {!account?.testing && account?.paymentPastDue && <p className="form-error" role="alert">Your subscription payment needs attention. <button className="text-button" onClick={() => setShowBilling(true)}>Manage billing</button></p>}
        {accountQuery.error && <p className="form-error" role="alert">Account status could not be loaded. <button className="text-button" onClick={() => void accountQuery.refetch()}>Retry</button></p>}
        <div className="garden-tools">
          {filter !== "archived" && <ViewChoice view={view} onChange={changeView} />}
          <label className="type-filter">Show <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}><option value="all">All projects</option><option value="recurring">Recurring activities</option><option value="ongoing">Other projects</option></select></label>
        </div>

        {update.error && <p role="alert" className="form-error">Could not save this change. Please try again.</p>}

        <nav className="filter-row" aria-label="Project status filters">
          {FILTERS.map((item) => (
            <button key={item.value} aria-pressed={filter === item.value} className={filter === item.value ? "active" : ""} onClick={() => setFilter(item.value)}>
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
            <h2>{typeFilter !== "all" ? "No projects match this view." : filter === "active" ? (projects.length ? "Nothing growing right now." : "Plant the first seed.") : filter === "completed" ? "No projects have bloomed yet." : "No plants are dormant."}</h2>
            <p>{filter === "active" ? "Give something you care about a place to grow." : filter === "archived" ? "Archive a project to pause it without losing its steps or history. Restore it whenever you are ready." : "Completed projects will appear here."}</p>
            {typeFilter !== "all" && <button onClick={() => setTypeFilter("all")}>Show all projects</button>}
            {filter === "active" && typeFilter === "all" && <button onClick={() => account && !account.canCreate ? setShowBilling(true) : setCreating(true)}>Plant a project</button>}
          </div>
        ) : view === "minimal" || filter === "archived" ? (
          <ProjectList key={filter} projects={visibleProjects} archived={filter === "archived"} onOpen={setSelectedId} onRestored={project => { setGardenMessage(`${project.name} restored. Its steps and history are ready.`); setFilter(project.completedAt ? "completed" : "active"); refresh(); }} />
        ) : view === "matrix" ? (
          <Matrix projects={visibleProjects} onOpen={setSelectedId} onSave={(id, settings) => update.mutate({ projectId: id, change: { kind: "settings", ...settings } })} />
        ) : (
          <section className="garden-bed" aria-label="Garden projects">
            <div className="garden-rule" />
            <div className="plant-grid">{visibleProjects.map(project => <GardenCard key={project.id} project={project} onOpen={() => setSelectedId(project.id)} animate={animatingId === project.id} />)}</div>
          </section>
        )}
        <PrivacyNotice />
        <FloatGarden projects={projects} onOpen={setSelectedId} onChange={(id, inFloat) => update.mutate({ projectId: id, change: { kind: "settings", inFloat } })} busy={update.isPending} />
      </main>

      {showBilling && account && !account.testing && <BillingPanel account={account} onClose={() => setShowBilling(false)} />}
      {creating && <CreateProjectPanel onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setSelectedId(id); refresh(); }} />}
      {selected && <ProjectDetail project={selected} onClose={() => setSelectedId(null)} onChanged={refresh} setAnimating={(value) => setAnimatingId(value ? selected.id : null)} />}
    </div>
  );
}
