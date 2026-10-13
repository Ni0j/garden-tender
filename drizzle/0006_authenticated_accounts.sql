-- Anonymous browser IDs remain only as one-time migration capabilities.
CREATE TABLE anonymous_claims (
  anonymous_user_id TEXT PRIMARY KEY,
  account_user_id TEXT,
  claimed_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX anonymous_claims_account_user_id_idx ON anonymous_claims(account_user_id);
