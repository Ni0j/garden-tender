import { resolve, sep } from "node:path";
import { openDatabase } from "./db";
import { apiHandler } from "./http";
import { authConfiguration, createSupabaseAccountDeletion } from "./auth";
import { isTestingMvp, validateEnvironment } from "./config";
import { BillingService } from "./billing";
import { createBillingProvider } from "./stripe";
import { DeletionService } from "./deletion";
import { createBackupStore } from "./backups";
import { Maintenance } from "./maintenance";
import { ensureAccount } from "./entitlements";
import { RateLimiter } from "./rate-limit";

validateEnvironment();
const { db, sqlite } = openDatabase();
const billing = new BillingService(db, createBillingProvider());
if (billing.provider) await billing.provider.validate();
const backup = createBackupStore();
const authDeletion = createSupabaseAccountDeletion();
const deletion = new DeletionService(db, billing, authDeletion, async userId => {
  if (backup) { const account = ensureAccount(db, userId); await backup.recordDeletion({ userId, customerId: account.customerId, provider: account.provider }); }
});
const maintenance = new Maintenance(db, sqlite, billing, deletion, backup);
await maintenance.tick();
const interval = setInterval(() => { void maintenance.tick().catch(() => console.error("Maintenance failed; retry scheduled.")); }, 60_000);
const handleApi = apiHandler(db, undefined, authDeletion, billing, deletion);
const publicDirectory = resolve(import.meta.dir, "../../client/dist");
const ingress = new RateLimiter(300);
const webhookIngress = new RateLimiter(600);
const server = Bun.serve({
  hostname: "0.0.0.0", port: Number(process.env.PORT ?? 3000), maxRequestBodySize: 1024 * 1024,
  async fetch(request, server) {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") {
      try {
        sqlite.query("SELECT 1").get();
        const services = maintenance.health();
        const backupHealthy = services.backup === "ok" || (isTestingMvp() && services.backup === "manual");
        const ok = authConfiguration().configured && (process.env.NODE_ENV !== "production" || backupHealthy);
        return Response.json({ ok, services }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
      } catch { return Response.json({ ok: false }, { status: 503 }); }
    }
    if (url.pathname.startsWith("/api/")) {
      // Never trust an arbitrary X-Forwarded-For header as an abuse identity.
      const ip = server.requestIP(request)?.address ?? "unknown";
      const webhook = url.pathname === "/api/billing/webhook";
      if (!(webhook ? webhookIngress : ingress).allow(ip)) return Response.json({ error: "Too many requests. Please retry shortly." }, { status: 429, headers: { "Retry-After": "60" } });
      if (!webhook && Number(request.headers.get("Content-Length") ?? 0) > 64 * 1024) return new Response("Request too large", { status: 413 });
      return handleApi(request);
    }
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
    let path: string;
    try { path = decodeURIComponent(url.pathname); } catch { return new Response("Bad path", { status: 400 }); }
    const filename = resolve(publicDirectory, `.${path === "/" ? "/index.html" : path}`);
    if (!filename.startsWith(publicDirectory + sep)) return new Response("Not found", { status: 404 });
    const file = Bun.file(filename);
    if (!(await file.exists())) return new Response("Not found", { status: 404 });
    const supabaseOrigin = authConfiguration().url || "https://*.supabase.co";
    return new Response(request.method === "HEAD" ? null : file, {
      headers: { "Content-Type": file.type, "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Content-Security-Policy": `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ${supabaseOrigin}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`, "Permissions-Policy": "camera=(), microphone=(), geolocation=()" },
    });
  },
});
console.log(`Project Garden listening on ${server.url}`);
async function shutdown() {
  clearInterval(interval);
  await server.stop(false);
  await maintenance.tick();
  sqlite.close(); process.exit(0);
}
process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
