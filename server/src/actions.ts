import { detailsShape, initialDetails, normalizeDetails, changeShape, changeDetails } from "../../shared/project";
import { z } from "zod";
import type { GardenDatabase } from "./db";

import { and, asc, desc, eq } from "drizzle-orm";
import * as schema from "./schema";

export type Context = { db: Pick<GardenDatabase, "select" | "insert" | "update" | "delete">; userId: string; email: string };

const projectStatus = z.enum(["active", "completed", "archived"]);
const effortShape = z.object({
  id: z.number(),
  text: z.string(),
  createdAt: z.string(),
});
const outcomeShape = z.object({
  id: z.number(),
  type: z.string(),
  value: z.string(),
  note: z.string().nullable(),
  createdAt: z.string(),
});
const projectShape = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string(),
  nextStep: z.string().nullable(),
  details: detailsShape,
  deadline: z.string().nullable(),
  status: projectStatus,
  plantVariant: z.number(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
  growthStage: z.enum(["Seed", "Sprout", "Young plant", "Growing plant", "Mature plant", "Bloom"]),
  efforts: z.array(effortShape),
  outcomes: z.array(outcomeShape),
});
const okResponse = z.object({ ok: z.literal(true) });

function growthStage(effortCount: number, completed: boolean): "Seed" | "Sprout" | "Young plant" | "Growing plant" | "Mature plant" | "Bloom" {
  if (completed || effortCount >= 15) return "Bloom";
  if (effortCount >= 10) return "Mature plant";
  if (effortCount >= 6) return "Growing plant";
  if (effortCount >= 3) return "Young plant";
  if (effortCount >= 1) return "Sprout";
  return "Seed";
}

export const contracts = {
  updateProject: { request: z.object({ projectId: z.number().int().positive(), change: changeShape }), response: okResponse },
  listProjects: { request: z.object({}), response: z.object({ projects: z.array(projectShape) }) },
  createProject: { request: z.object({
      name: z.string().trim().min(1).max(80),
      description: z.string().trim().min(1).max(300),
      nextStep: z.string().trim().max(240).nullable().optional(),
      projectType: z.enum(["ongoing", "one-time", "recurring"]).optional(),
      deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    }), response: z.object({ id: z.number() }) },
  setNextStep: { request: z.object({ projectId: z.number().int().positive(), text: z.string().trim().min(1).max(240) }), response: okResponse },
  completeNextStep: { request: z.object({ projectId: z.number().int().positive() }), response: okResponse },
  addEffort: { request: z.object({ projectId: z.number().int().positive(), text: z.string().trim().min(1).max(240) }), response: okResponse },
  addOutcome: { request: z.object({
      projectId: z.number().int().positive(),
      type: z.string().trim().min(1).max(40),
      value: z.string().trim().min(1).max(80),
      note: z.string().trim().max(200).nullable(),
    }), response: okResponse },
  completeProject: { request: z.object({ projectId: z.number().int().positive() }), response: okResponse },
  archiveProject: { request: z.object({ projectId: z.number().int().positive() }), response: okResponse },
  seedSampleGarden: { request: z.object({}), response: z.object({ added: z.number() }) },
  claimAnonymousGarden: {
    request: z.object({ anonymousUserId: z.uuid() }),
    response: z.object({ status: z.enum(["claimed", "already-claimed"]), migratedProjects: z.number().int().nonnegative() }),
  },
  exportGarden: {
    request: z.object({}),
    response: z.object({ version: z.literal(1), exportedAt: z.string(), email: z.email(), projects: z.array(projectShape) }),
  },
  deletePersonalData: { request: z.object({ confirmation: z.literal("DELETE") }), response: okResponse },
};

function listProjects(ctx: Context) {
  const { db, userId } = ctx;
  const [projectRows, effortRows, outcomeRows] = [
    db.select().from(schema.projects).where(eq(schema.projects.userId, userId)).orderBy(desc(schema.projects.createdAt)).all(),
    db.select().from(schema.efforts).where(eq(schema.efforts.userId, userId)).orderBy(asc(schema.efforts.createdAt)).all(),
    db.select().from(schema.outcomes).where(eq(schema.outcomes.userId, userId)).orderBy(asc(schema.outcomes.createdAt)).all(),
  ] as const;
  return {
    projects: projectRows.map((project) => {
      const projectEfforts = effortRows
        .filter((effort) => effort.projectId === project.id)
        .map((effort) => ({ id: effort.id, text: effort.text, createdAt: effort.createdAt.toISOString() }));
      const projectOutcomes = outcomeRows
        .filter((outcome) => outcome.projectId === project.id)
        .map((outcome) => ({
          id: outcome.id,
          type: outcome.type,
          value: outcome.value,
          note: outcome.note,
          createdAt: outcome.createdAt.toISOString(),
        }));
      return {
        id: project.id,
        name: project.name,
        description: project.description,
        nextStep: project.nextStep,
        details: normalizeDetails(project.details, project.nextStep),
        deadline: project.deadline,
        status: project.status,
        plantVariant: project.plantVariant,
        createdAt: project.createdAt.toISOString(),
        completedAt: project.completedAt?.toISOString() ?? null,
        growthStage: growthStage(projectEfforts.length, project.status === "completed"),
        efforts: projectEfforts,
        outcomes: projectOutcomes,
      };
    }),
  };
}

export const Actions = {
  updateProject(ctx: Context, args: z.infer<typeof contracts.updateProject.request>) {
    const { db, userId } = ctx;
    const where = and(eq(schema.projects.userId, userId), eq(schema.projects.id, args.projectId));
    const project = db.select().from(schema.projects).where(where).get();
    if (!project) throw new Error("Project not found.");
    if (project.status === "archived" && args.change.kind !== "settings") throw new Error("Archived projects are dormant.");
    const details = normalizeDetails(project.details, project.nextStep);
    const effort = changeDetails(details, args.change);
    if (effort) db.insert(schema.efforts).values({ userId, projectId: project.id, text: effort }).run();
    db.update(schema.projects).set({ details, nextStep: null }).where(where).run();
    return { ok: true as const };
  },
  listProjects(ctx: Context) {
      return listProjects(ctx);
  },

  createProject(ctx: Context, args: z.infer<typeof contracts.createProject.request>) {
      const { db, userId } = ctx;
      const latest = db.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.userId, userId)).orderBy(desc(schema.projects.id)).limit(1).all();
      const nextVariant = ((latest[0]?.id ?? 0) + 1) % 6;
      const rows = db.insert(schema.projects).values({ userId,
        name: args.name,
        description: args.description,
        nextStep: args.nextStep ?? null,
        deadline: args.deadline,
        details: { ...initialDetails(args.nextStep), projectType: args.projectType === "recurring" ? "recurring" : "ongoing" },
        plantVariant: nextVariant,
      }).returning({ id: schema.projects.id }).all();
      const inserted = rows[0];
      if (!inserted) throw new Error("The seed could not be planted.");
      return { id: inserted.id };
  },

  addEffort(ctx: Context, args: z.infer<typeof contracts.addEffort.request>) {
      const { db, userId } = ctx;
      const project = db.select({ id: schema.projects.id, status: schema.projects.status }).from(schema.projects).where(and(eq(schema.projects.userId, userId), eq(schema.projects.id, args.projectId))).limit(1).all();
      if (!project[0]) throw new Error("Project not found.");
      if (project[0].status === "archived") throw new Error("Archived projects are dormant.");
      db.insert(schema.efforts).values({ userId, projectId: args.projectId, text: args.text }).run();
      return { ok: true as const };
  },

  setNextStep(ctx: Context, args: z.infer<typeof contracts.setNextStep.request>) {
      const { db, userId } = ctx;
      const changed = db.update(schema.projects).set({ nextStep: args.text }).where(and(eq(schema.projects.userId, userId), eq(schema.projects.id, args.projectId), eq(schema.projects.status, "active"))).returning({ id: schema.projects.id }).all();
      if (!changed[0]) throw new Error("Project not found.");
      return { ok: true as const };
  },

  completeNextStep(ctx: Context, args: z.infer<typeof contracts.completeNextStep.request>) {
      const { db, userId } = ctx;
      const rows = db.select({ id: schema.projects.id, nextStep: schema.projects.nextStep }).from(schema.projects).where(and(eq(schema.projects.userId, userId), eq(schema.projects.id, args.projectId), eq(schema.projects.status, "active"))).limit(1).all();
      const project = rows[0];
      if (!project?.nextStep) throw new Error("Project not found.");
      db.insert(schema.efforts).values({ userId, projectId: project.id, text: project.nextStep }).run();
      db.update(schema.projects).set({ nextStep: null }).where(and(eq(schema.projects.userId, userId), eq(schema.projects.id, project.id))).run();
      return { ok: true as const };
  },

  addOutcome(ctx: Context, args: z.infer<typeof contracts.addOutcome.request>) {
      const { db, userId } = ctx;
      const project = db.select({ id: schema.projects.id, status: schema.projects.status }).from(schema.projects).where(and(eq(schema.projects.userId, userId), eq(schema.projects.id, args.projectId))).limit(1).all();
      if (!project[0]) throw new Error("Project not found.");
      if (project[0].status === "archived") throw new Error("Archived projects are dormant.");
      db.insert(schema.outcomes).values({ userId, projectId: args.projectId, type: args.type, value: args.value, note: args.note }).run();
      return { ok: true as const };
  },

  completeProject(ctx: Context, args: z.infer<typeof contracts.completeProject.request>) {
      const { db, userId } = ctx;
      const changed = db.update(schema.projects).set({ status: "completed", completedAt: new Date() }).where(and(eq(schema.projects.userId, userId), eq(schema.projects.id, args.projectId))).returning({ id: schema.projects.id }).all();
      if (!changed[0]) throw new Error("Project not found.");
      return { ok: true as const };
  },

  archiveProject(ctx: Context, args: z.infer<typeof contracts.archiveProject.request>) {
      const { db, userId } = ctx;
      const changed = db.update(schema.projects).set({ status: "archived" }).where(and(eq(schema.projects.userId, userId), eq(schema.projects.id, args.projectId))).returning({ id: schema.projects.id }).all();
      if (!changed[0]) throw new Error("Project not found.");
      return { ok: true as const };
  },

  seedSampleGarden(ctx: Context) {
      const { db, userId } = ctx;
      const now = Date.now();
      const day = 86_400_000;
      const samples = [
        {
          key: "sample-restaurant-website",
          name: "Restaurant website",
          description: "A compact launch for a neighborhood restaurant, from research through a responsive build.",
          status: "completed" as const,
          variant: 1,
          daysAgo: 18,
          efforts: ["Researched restaurant websites", "Built the homepage", "Sent the proposal", "Revised the mobile layout"],
          outcomes: [
            { type: "Payment", value: "$500", note: "Final project payment" },
            { type: "New client", value: "1 client", note: "First direct client" },
          ],
        },
        {
          key: "sample-publication",
          name: "Publication prototype",
          description: "Shape the first issue around a single visual question and test the physical format.",
          status: "active" as const,
          variant: 4,
          daysAgo: 8,
          efforts: ["Defined the issue theme", "Built a rough page sequence", "Printed a folded paper test"],
          outcomes: [{ type: "Knowledge", value: "Format test", note: "The smaller trim size reads better" }],
        },
        {
          key: "sample-archive",
          name: "Community poster series",
          description: "An early poster direction kept for its studies even though the series paused.",
          status: "archived" as const,
          variant: 3,
          daysAgo: 31,
          efforts: ["Collected references", "Made two composition studies"],
          outcomes: [],
        },
      ];
      let added = 0;
      for (const sample of samples) {
        const existing = db.select({ id: schema.projects.id }).from(schema.projects).where(and(eq(schema.projects.userId, userId), eq(schema.projects.demoKey, `${userId}:${sample.key}`))).limit(1).all();
        if (existing[0]) continue;
        const insertedRows = db.insert(schema.projects).values({ userId,
          name: sample.name,
          description: sample.description,
          status: sample.status,
          plantVariant: sample.variant,
          demoKey: `${userId}:${sample.key}`,
          createdAt: new Date(now - sample.daysAgo * day),
          completedAt: sample.status === "completed" ? new Date(now - 2 * day) : null,
        }).returning({ id: schema.projects.id }).all();
        const inserted = insertedRows[0];
        if (!inserted) continue;
        for (let index = 0; index < sample.efforts.length; index += 1) {
          const effortText = sample.efforts[index];
          if (!effortText) continue;
          db.insert(schema.efforts).values({ userId,
            projectId: inserted.id,
            text: effortText,
            createdAt: new Date(now - (sample.daysAgo - index * 2) * day),
          }).run();
        }
        for (let index = 0; index < sample.outcomes.length; index += 1) {
          const outcome = sample.outcomes[index];
          if (!outcome) continue;
          db.insert(schema.outcomes).values({ userId,
            projectId: inserted.id,
            type: outcome.type,
            value: outcome.value,
            note: outcome.note,
            createdAt: new Date(now - (3 - index) * day),
          }).run();
        }
        added += 1;
      }
      return { added };
  },

  claimAnonymousGarden(ctx: Context, args: z.infer<typeof contracts.claimAnonymousGarden.request>) {
      const { db, userId } = ctx;
      const anonymousUserId = args.anonymousUserId.toLowerCase();
      if (anonymousUserId === userId) throw new Error("Anonymous garden cannot match the account.");
      const existing = db.select().from(schema.anonymousClaims).where(eq(schema.anonymousClaims.anonymousUserId, anonymousUserId)).get();
      if (existing) {
        if (existing.accountUserId === userId) return { status: "already-claimed" as const, migratedProjects: 0 };
        throw new Error("Anonymous garden has already been claimed.");
      }
      const migratedProjects = db.update(schema.projects).set({ userId }).where(eq(schema.projects.userId, anonymousUserId)).returning({ id: schema.projects.id }).all().length;
      db.update(schema.efforts).set({ userId }).where(eq(schema.efforts.userId, anonymousUserId)).run();
      db.update(schema.outcomes).set({ userId }).where(eq(schema.outcomes.userId, anonymousUserId)).run();
      db.insert(schema.anonymousClaims).values({ anonymousUserId, accountUserId: userId }).run();
      return { status: "claimed" as const, migratedProjects };
  },

  exportGarden(ctx: Context) {
      return { version: 1 as const, exportedAt: new Date().toISOString(), email: ctx.email, ...listProjects(ctx) };
  },

  deletePersonalData(ctx: Context) {
      const { db, userId } = ctx;
      db.delete(schema.efforts).where(eq(schema.efforts.userId, userId)).run();
      db.delete(schema.outcomes).where(eq(schema.outcomes.userId, userId)).run();
      db.delete(schema.projects).where(eq(schema.projects.userId, userId)).run();
      db.update(schema.anonymousClaims).set({ accountUserId: null }).where(eq(schema.anonymousClaims.accountUserId, userId)).run();
      return { ok: true as const };
  },
};
