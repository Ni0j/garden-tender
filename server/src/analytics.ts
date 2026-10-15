import { and, eq, lt, sql } from "drizzle-orm";
import type { Store } from "./entitlements";
import { accounts, analyticsDaily, billingEvents } from "./schema";
export const ANALYTICS_EVENTS = ["sign_in", "plant_created", "effort_created", "outcome_created", "upgrade_initiated", "subscription_activated"] as const;
export type AnalyticsEvent = typeof ANALYTICS_EVENTS[number];
export function recordEvent(db: Store, event: AnalyticsEvent, now = Date.now()) {
  if (!ANALYTICS_EVENTS.includes(event)) throw new Error("Unapproved analytics event");
  const day = new Date(now).toISOString().slice(0, 10);
  db.insert(analyticsDaily).values({ day, event, count: 1 }).onConflictDoUpdate({ target: [analyticsDaily.day, analyticsDaily.event], set: { count: sql`${analyticsDaily.count} + 1` } }).run();
}
// One successful sign-in per account per UTC day; no session IDs or tokens stored.
export function recordSignIn(db: Store, userId: string) {
  const day = new Date().toISOString().slice(0, 10);
  const row = db.select().from(accounts).where(eq(accounts.userId, userId)).get();
  if (!row || row.deletionState !== "none" || row.lastSignInDay === day) return;
  db.update(accounts).set({ lastSignInDay: day }).where(and(eq(accounts.userId, userId), eq(accounts.deletionState, "none"))).run();
  recordEvent(db, "sign_in");
}
export function pruneTelemetry(db: Store, now = Date.now()) {
  const cutoff = now - 90 * 86_400_000;
  db.delete(analyticsDaily).where(lt(analyticsDaily.day, new Date(cutoff).toISOString().slice(0, 10))).run();
  db.delete(accounts).where(and(eq(accounts.deletionState, "complete"), lt(accounts.deletionUpdatedAt, cutoff))).run();
  db.delete(billingEvents).where(lt(billingEvents.processedAt, cutoff)).run();
}
