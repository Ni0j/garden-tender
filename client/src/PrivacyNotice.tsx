export function PrivacyNotice() {
  return <details className="history-section"><summary>Privacy and your data</summary><p>Your garden content is stored privately for your account. Supabase handles email sign-in and database storage. User testing does not require payment.</p><p>Account isolation is enforced by database row-level security. The browser receives only rows belonging to the signed-in account.</p><p>Export or permanently delete your account and garden data from Account.</p></details>;
}
