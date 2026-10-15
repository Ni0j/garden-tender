import { and, asc, eq } from "drizzle-orm";
import type { GardenDatabase } from "./db";
import { accounts, projects, subscriptions } from "./schema";
import { ApiError } from "./errors";
import { isTestingMvp } from "./config";
export type Store = Pick<GardenDatabase, "select" | "insert" | "update" | "delete">;
export const FREE_LIMIT = 3;

export function ensureAccount(db: Store, userId: string) {
  db.insert(accounts).values({ userId, createdAt: Date.now() }).onConflictDoNothing().run();
  return db.select().from(accounts).where(eq(accounts.userId, userId)).get()!;
}
export function entitlement(db: Store, userId: string, now = Date.now()) {
  const rows = db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).all();
  const paid = rows.filter(s => ["active", "past_due"].includes(s.status) && s.paidThrough > now);
  const current = paid.sort((a, b) => b.paidThrough - a.paidThrough)[0];
  const activeCount = db.select({ id: projects.id }).from(projects).where(and(eq(projects.userId, userId), eq(projects.status, "active"))).all().length;
  const pausedCount = db.select({ id: projects.id }).from(projects).where(and(eq(projects.userId, userId), eq(projects.archiveReason, "plan-limit"), eq(projects.status, "archived"))).all().length;
  return { testing: isTestingMvp(), plan: current ? "plus" as const : "free" as const, activeLimit: isTestingMvp() || current ? null : FREE_LIMIT, activeCount, pausedCount, paidThrough: current?.paidThrough ?? null, cancelAtPeriodEnd: current?.cancelAtPeriodEnd ?? false, paymentPastDue: rows.some(s => s.status === "past_due"), canCreate: isTestingMvp() || Boolean(current) || activeCount < FREE_LIMIT };
}
export function requireCapacity(db: Store, userId: string) {
  if (!entitlement(db, userId).canCreate) throw new ApiError(409, "Free includes 3 active plants. Archive a growing plant to make room, or choose Garden Plus.");
}
// Run inside the same transaction as the caller. Never delete history on downgrade.
export function reconcilePlantLimit(db: Store, userId: string, now = Date.now()) {
  if (isTestingMvp()) return;
  if (entitlement(db, userId, now).plan === "plus") return;
  const active = db.select({ id: projects.id }).from(projects).where(and(eq(projects.userId, userId), eq(projects.status, "active"))).orderBy(asc(projects.createdAt), asc(projects.id)).all();
  for (const plant of active.slice(FREE_LIMIT)) db.update(projects).set({ status: "archived", archiveReason: "plan-limit" }).where(and(eq(projects.userId, userId), eq(projects.id, plant.id))).run();
}
