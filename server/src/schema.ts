import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  userId: text("user_id").notNull(),
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description").notNull(),
  nextStep: text("next_step"),
  archiveReason: text("archive_reason"),
  details: text("details", { mode: "json" }).$type<import("../../shared/project").Details>(),
  deadline: text("deadline"),
  status: text("status", { enum: ["active", "completed", "archived"] })
    .notNull()
    .default("active"),
  plantVariant: integer("plant_variant").notNull().default(0),
  demoKey: text("demo_key").unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
});

export const efforts = sqliteTable("efforts", {
  userId: text("user_id").notNull(),
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const outcomes = sqliteTable("outcomes", {
  userId: text("user_id").notNull(),
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  value: text("value").notNull(),
  note: text("note"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const anonymousClaims = sqliteTable("anonymous_claims", {
  anonymousUserId: text("anonymous_user_id").primaryKey(),
  accountUserId: text("account_user_id"),
  claimedAt: integer("claimed_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const accounts = sqliteTable("accounts", {
  userId: text("user_id").primaryKey(),
  provider: text("provider"),
  customerId: text("customer_id").unique(),
  deletionState: text("deletion_state").notNull().default("none"),
  deletionUpdatedAt: integer("deletion_updated_at"),
  lastSignInDay: text("last_sign_in_day"),
  createdAt: integer("created_at").notNull(),
});
export const subscriptions = sqliteTable("subscriptions", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(),
  provider: text("provider").notNull(), status: text("status").notNull(),
  priceId: text("price_id").notNull(), paidThrough: integer("paid_through").notNull(),
  cancelAtPeriodEnd: integer("cancel_at_period_end", { mode: "boolean" }).notNull().default(false),
  updatedAt: integer("updated_at").notNull(),
});
export const billingEvents = sqliteTable("billing_events", {
  id: text("id").primaryKey(), processedAt: integer("processed_at").notNull(),
});
export const analyticsDaily = sqliteTable("analytics_daily", {
  day: text("day").notNull(), event: text("event").notNull(), count: integer("count").notNull().default(0),
});
