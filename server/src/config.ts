export const isTestingMvp = () => process.env.APP_MODE === "testing";

export function validateEnvironment(env: NodeJS.ProcessEnv = process.env) {
  if (env.APP_MODE && !["testing", "saas"].includes(env.APP_MODE)) throw new Error("APP_MODE must be testing or saas.");
  if (env.NODE_ENV !== "production") return;
  const testing = env.APP_MODE === "testing";
  const required = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "PUBLIC_APP_URL", "DATABASE_PATH", "BACKUP_S3_BUCKET", "BACKUP_S3_REGION", "BACKUP_S3_ACCESS_KEY_ID", "BACKUP_S3_SECRET_ACCESS_KEY", ...(testing ? ["TESTING_SUPABASE_PROJECT_REF"] : ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_MONTHLY", "STRIPE_PRICE_YEARLY", "STRIPE_PORTAL_CONFIGURATION_ID"])];
  const missing = required.filter(name => !env[name] || /replace_me|your-project/.test(env[name]!));
  if (missing.length) throw new Error(`Missing production configuration: ${missing.join(", ")}`);
  for (const name of ["PUBLIC_APP_URL", "SUPABASE_URL"]) if (new URL(env[name]!).protocol !== "https:") throw new Error(`${name} must use HTTPS.`);
  if (!env.DATABASE_PATH!.startsWith("/var/data/")) throw new Error("Production DATABASE_PATH must be on the Render disk under /var/data/.");
  if (env.SUPABASE_PUBLISHABLE_KEY!.startsWith("sb_secret_") || env.SUPABASE_PUBLISHABLE_KEY === env.SUPABASE_SECRET_KEY) throw new Error("The public Supabase key must not be a secret key.");
  if (testing) {
    if (env.DATABASE_PATH !== "/var/data/testing/garden.db") throw new Error("Testing requires the isolated /var/data/testing/garden.db database.");
    if (new URL(env.SUPABASE_URL!).hostname !== `${env.TESTING_SUPABASE_PROJECT_REF}.supabase.co`) throw new Error("Supabase URL must match TESTING_SUPABASE_PROJECT_REF from the separate testing project.");
    if (env.BACKUP_S3_PREFIX !== "garden-testing") throw new Error("Testing backups require BACKUP_S3_PREFIX=garden-testing.");
  } else if (!env.STRIPE_SECRET_KEY!.startsWith("sk_test_") && !(env.STRIPE_SECRET_KEY!.startsWith("sk_live_") && env.ALLOW_LIVE_BILLING === "true")) throw new Error("Use Stripe test mode until live billing is explicitly enabled.");
  if (env.BACKUP_S3_ENDPOINT && new URL(env.BACKUP_S3_ENDPOINT).protocol !== "https:") throw new Error("Backup endpoint must use HTTPS.");
}
