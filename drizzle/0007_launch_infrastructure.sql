ALTER TABLE projects ADD COLUMN archive_reason TEXT;
--> statement-breakpoint
CREATE INDEX projects_user_status_idx ON projects(user_id, status);
--> statement-breakpoint
CREATE TABLE accounts (
  user_id TEXT PRIMARY KEY NOT NULL,
  provider TEXT,
  customer_id TEXT UNIQUE,
  deletion_state TEXT NOT NULL DEFAULT 'none',
  deletion_updated_at INTEGER,
  last_sign_in_day TEXT,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  price_id TEXT NOT NULL,
  paid_through INTEGER NOT NULL,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX subscriptions_user_idx ON subscriptions(user_id);
--> statement-breakpoint
CREATE TABLE billing_events (
  id TEXT PRIMARY KEY NOT NULL,
  processed_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE analytics_daily (
  day TEXT NOT NULL,
  event TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(day, event)
);
