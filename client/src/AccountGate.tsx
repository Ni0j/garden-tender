import { PrivacyNotice } from "./PrivacyNotice";
import { useEffect, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { App } from "./App";
import { accountRequest } from "./api";
import { getAuthClient } from "./auth";

function SignIn({ client }: { client: SupabaseClient }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function sendCode(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const { error } = await client.auth.signInWithOtp({
        email: email.trim(),
        options: {
          shouldCreateUser: true,
          emailRedirectTo: window.location.href.split(/[?#]/, 1)[0],
        },
      });
      if (error) setMessage(error.message); else setSent(true);
    } catch { setMessage("Could not send a code. Check your connection and try again."); }
    finally { setBusy(false); }
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    const token = code.replace(/\D/g, "");
    if (token.length !== 8) {
      setMessage("Enter the 8-digit code from your email.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const { error } = await client.auth.verifyOtp({ email: email.trim(), token, type: "email" });
      if (error) setMessage(error.message);
    } catch { setMessage("Could not verify the code. Check your connection and try again."); }
    finally { setBusy(false); }
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="auth-title">
        <p className="overline">Tended by effort</p>
        <h1 id="auth-title">Return to your garden.</h1>
        <p>Your projects stay private and travel with your account.</p>
        {!sent ? (
          <form className="stack-form" onSubmit={sendCode}>
            <label>Email address<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoFocus /></label>
            <button className="primary-button" type="submit" disabled={busy}>{busy ? "Sending…" : "Email me a sign-in code"}</button>
          </form>
        ) : (
          <form className="stack-form" onSubmit={verifyCode}>
            <label>8-digit email code<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{8}" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 8))} minLength={8} maxLength={8} required autoFocus /></label>
            <button className="primary-button" type="submit" disabled={busy}>{busy ? "Checking…" : "Enter the garden"}</button>
            <button className="text-button" type="button" onClick={() => { setSent(false); setCode(""); setMessage(null); }}>Resend code / use a different email</button>
          </form>
        )}
        {message && <p className="form-error" role="alert">{message}</p>}
        <PrivacyNotice />
      </section>
    </main>
  );
}

export function AccountGate() {
  const queryClient = useQueryClient();
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
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
  return <App key={session.user.id} accountEmail={session.user.email} onSignOut={async (localOnly = false) => { const { error } = await client.auth.signOut(localOnly ? { scope: "local" } : undefined); if (error) throw error; }} />;
}
