import { PrivacyNotice } from "./PrivacyNotice";
import { useEffect, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { App } from "./App";
import { accountRequest } from "./api";
import { getAuthClient } from "./auth";

function SignIn({ client }: { client: SupabaseClient }) {
  const [mode, setMode] = useState<"sign-in" | "sign-up" | "forgot">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      if (mode === "forgot") {
        const { error } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.href.split(/[?#]/, 1)[0] });
        setMessage(error?.message ?? "Check your email for a password reset link.");
      } else if (mode === "sign-up") {
        const { data, error } = await client.auth.signUp({ email: email.trim(), password });
        setMessage(error?.message ?? (data.session ? null : "Check your email to confirm your account, then sign in."));
      } else {
        const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
        if (error) setMessage(error.message);
      }
    } catch { setMessage("Authentication failed. Check your connection and try again."); }
    finally { setBusy(false); }
  }

  function changeMode(nextMode: typeof mode) {
    setMode(nextMode);
    setPassword("");
    setMessage(null);
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="auth-title">
        <p className="overline">Tended by effort</p>
        <h1 id="auth-title">{mode === "sign-up" ? "Create your garden." : mode === "forgot" ? "Reset your password." : "Return to your garden."}</h1>
        <p>Your projects stay private and travel with your account.</p>
        <form className="stack-form" onSubmit={submit}>
          <label>Email address<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoFocus /></label>
          {mode !== "forgot" && <label>Password<input type="password" autoComplete={mode === "sign-up" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required /></label>}
          <button className="primary-button" type="submit" disabled={busy}>{busy ? "Working…" : mode === "sign-up" ? "Create account" : mode === "forgot" ? "Send reset link" : "Sign in"}</button>
          {mode === "sign-in" ? <>
            <button className="text-button" type="button" onClick={() => changeMode("forgot")}>Forgot password?</button>
            <button className="text-button" type="button" onClick={() => changeMode("sign-up")}>Create an account</button>
          </> : <button className="text-button" type="button" onClick={() => changeMode("sign-in")}>Back to sign in</button>}
        </form>
        {message && <p className="form-error" role="alert">{message}</p>}
        <PrivacyNotice />
      </section>
    </main>
  );
}

function ResetPassword({ client, onDone }: { client: SupabaseClient; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setMessage(null);
    try {
      const { error } = await client.auth.updateUser({ password });
      if (error) setMessage(error.message); else onDone();
    } catch { setMessage("Could not update your password. Try again."); }
    finally { setBusy(false); }
  }
  return <main className="auth-page"><section className="auth-card" aria-labelledby="reset-title">
    <p className="overline">Tended by effort</p>
    <h1 id="reset-title">Choose a new password.</h1>
    <form className="stack-form" onSubmit={submit}>
      <label>New password<input type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} minLength={8} required autoFocus /></label>
      <button className="primary-button" type="submit" disabled={busy}>{busy ? "Saving…" : "Save new password"}</button>
    </form>
    {message && <p className="form-error" role="alert">{message}</p>}
  </section></main>;
}

export function AccountGate() {
  const queryClient = useQueryClient();
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [recovering, setRecovering] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true); setError(null);
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void getAuthClient().then((authClient) => {
      if (!active) return;
      setClient(authClient);
      const listener = authClient.auth.onAuthStateChange((_event, nextSession) => {
        if (!active) return;
        if (_event === "SIGNED_OUT" || _event === "SIGNED_IN") queryClient.clear();
        if (_event === "PASSWORD_RECOVERY") setRecovering(true);
        if (_event === "SIGNED_OUT") setRecovering(false);
        setSession(nextSession);
        setLoading(false);
        if (_event === "SIGNED_IN") window.setTimeout(() => { void accountRequest("analytics/sign-in").catch(() => {}); }, 0);
      });
      unsubscribe = () => listener.data.subscription.unsubscribe();
    }).catch((reason: unknown) => {
      if (!active) return;
      setError(reason instanceof Error ? reason.message : "Authentication could not start.");
      setLoading(false);
    });
    return () => { active = false; unsubscribe?.(); };
  }, [queryClient, attempt]);

  if (loading) return <div className="loading-garden auth-loading"><span /><span /><span /><p>Opening the gate…</p></div>;
  if (error || !client) return <main className="auth-page"><section className="auth-card"><h1>The garden gate is unavailable.</h1><p className="form-error" role="alert">{error}</p><button className="primary-button" onClick={() => setAttempt(value => value + 1)}>Try again</button></section></main>;
  if (!session?.user.email) return <SignIn client={client} />;
  if (recovering) return <ResetPassword client={client} onDone={() => setRecovering(false)} />;
  return <App key={session.user.id} accountEmail={session.user.email} onChangePassword={async password => { const { error } = await client.auth.updateUser({ password }); if (error) throw error; }} onSignOut={async (localOnly = false) => { const { error } = await client.auth.signOut(localOnly ? { scope: "local" } : undefined); if (error) throw error; }} />;
}
