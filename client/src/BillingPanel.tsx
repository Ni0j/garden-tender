import { useModalFocus } from "./useModalFocus";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { accountRequest } from "./api";
import { displayDate } from "../../shared/dates";
import type { Account } from "../../shared/account";

export function BillingPanel({ account, onClose }: { account: Account; onClose: () => void }) {
  useModalFocus(onClose);
  const cache = useQueryClient();
  const checkout = useMutation({ mutationFn: (interval: "month" | "year") => accountRequest<{url:string}>("billing/checkout", { interval }), onSuccess: ({ url }) => { window.location.assign(url); } });
  const portal = useMutation({ mutationFn: () => accountRequest<{url:string}>("billing/portal"), onSuccess: ({ url }) => { window.location.assign(url); } });
  const refresh = useMutation({ mutationFn: () => accountRequest<Account>("billing/refresh"), onSuccess: () => { void cache.invalidateQueries(); } });
  const busy = checkout.isPending || portal.isPending || refresh.isPending;
  return <div className="modal-layer" role="dialog" aria-modal="true" aria-labelledby="billing-title"><section className="form-sheet compact-sheet">
    <div className="sheet-heading"><div><p className="overline">Room to grow</p><h2 id="billing-title">Garden {account.plan === "plus" ? "Plus" : "Free"}</h2></div><button className="close-button" aria-label="Close billing" onClick={onClose}>×</button></div>
    <p>Free includes 3 active plants. Garden Plus includes unlimited active plants. Both include unlimited efforts and outcomes, full growth, history, and every core feature.</p>
    {!account.canCreate && account.plan === "free" && <p className="notice">Your 3 active spots are full. Archive a growing plant to make room, or choose Plus.</p>}
    {account.billingMode === "test" && <p className="notice">Test payments only. Do not enter a real card.</p>}
    {account.plan === "plus" ? <p>{account.cancelAtPeriodEnd ? "Plus ends" : "Paid through"} {account.paidThrough ? displayDate(new Date(account.paidThrough).toISOString()) : "the current billing period"}.</p> : <div className="stack-form">
      <button className="primary-button" disabled={busy || !account.billingAvailable} onClick={() => checkout.mutate("month")}>Plus · $1.49 / month</button>
      <button className="secondary-button" disabled={busy || !account.billingAvailable} onClick={() => checkout.mutate("year")}>Plus · $14.99 / year</button>
      <p>USD. Renews automatically until canceled. Cancel in Manage billing; Plus continues through the paid period.</p>
    </div>}
    {!account.billingAvailable && <p>Upgrades are not available on this deployment yet. Your Free garden remains available.</p>}
    {account.hasCustomer && <button className="secondary-button" disabled={busy} onClick={() => portal.mutate()}>Manage billing / cancel subscription</button>}
    {account.plan === "free" && <button className="text-button" onClick={onClose}>Keep Free — return to garden</button>}
    <p>When Plus ends, the three oldest active plants keep growing. Extra plants are safely archived with their full history. Archive a growing plant to make room, then restore one from Archived.</p>
    <button className="text-button" disabled={busy || !account.billingAvailable} onClick={() => refresh.mutate()}>{refresh.isPending ? "Checking…" : "Check payment status"}</button>
    {refresh.isSuccess && <p role="status">Payment status checked.</p>}
    {(checkout.error || portal.error || refresh.error) && <p role="alert" className="form-error">{(checkout.error || portal.error || refresh.error)?.message}</p>}
  </section></div>;
}
