-- Existing private data has no browser owner. Never assign it to a visitor.
ALTER TABLE projects ADD COLUMN user_id TEXT NOT NULL DEFAULT 'legacy-unassigned';
--> statement-breakpoint
ALTER TABLE efforts ADD COLUMN user_id TEXT NOT NULL DEFAULT 'legacy-unassigned';
--> statement-breakpoint
ALTER TABLE outcomes ADD COLUMN user_id TEXT NOT NULL DEFAULT 'legacy-unassigned';
--> statement-breakpoint
CREATE INDEX projects_user_id_idx ON projects(user_id);
--> statement-breakpoint
CREATE INDEX efforts_user_project_idx ON efforts(user_id, project_id);
--> statement-breakpoint
CREATE INDEX outcomes_user_project_idx ON outcomes(user_id, project_id);
