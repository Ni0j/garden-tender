// Synthetic browser acceptance harness. Never imported by the production entry.
// No real credentials, email, payment, or persistent user data are used.
import { resolve, sep } from "node:path";
import { openDatabase } from "../server/src/db";
import { apiHandler } from "../server/src/http";
import { BillingService } from "../server/src/billing";
if (process.env.NODE_ENV !== "test") throw new Error("Acceptance harness requires NODE_ENV=test.");
process.env.APP_MODE = "testing";
const { db, sqlite } = openDatabase(":memory:");
const sessions = new Map<string, { id: string; email: string }>();
const identities = new Map<string, string>();
const billing = new BillingService(db, null);
const handler = apiHandler(db, async request => sessions.get(request.headers.get("Authorization")?.replace("Bearer ", "") ?? "") ?? null, { configured: true, delete: async userId => { for (const [token, user] of sessions) if (user.id === userId) sessions.delete(token); return true; } }, billing);
const directory = resolve("client/dist");
const server = Bun.serve({ hostname: "127.0.0.1", port: Number(process.env.PORT ?? 4197), async fetch(request) {
  const path = new URL(request.url).pathname;
  if (path === "/api/auth/config") return Response.json({ configured: true, url: new URL(request.url).origin, publishableKey: "sb_publishable_synthetic" });
  if (path === "/auth/v1/otp") return Response.json({});
  if (path === "/auth/v1/verify") {
    const args = await request.json() as { email: string; token: string };
    if (args.token !== "123456") return Response.json({ msg: "Invalid test code. Use 123456.", error_code: "otp_expired" }, { status: 403 });
    const id = identities.get(args.email) ?? crypto.randomUUID(); identities.set(args.email, id);
    const payload = Buffer.from(JSON.stringify({ sub: id, aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000), session_id: crypto.randomUUID() })).toString("base64url");
    const token = `eyJhbGciOiJIUzI1NiJ9.${payload}.synthetic`;
    sessions.set(token, { id, email: args.email });
    return Response.json({ access_token: token, refresh_token: token, expires_in: 3600, token_type: "bearer", user: { id, email: args.email, aud: "authenticated", role: "authenticated", created_at: new Date().toISOString(), app_metadata: {}, user_metadata: {} } });
  }
  if (path === "/auth/v1/logout") { sessions.delete(request.headers.get("Authorization")?.replace("Bearer ", "") ?? ""); return Response.json({}); }
  if (path.startsWith("/api/")) return handler(request);
  const filename = resolve(directory, `.${path === "/" ? "/index.html" : path}`);
  if (!filename.startsWith(directory + sep)) return new Response("Not found", { status: 404 });
  const file = Bun.file(filename);
  return await file.exists() ? new Response(file) : new Response("Not found", { status: 404 });
} });
console.log(`Synthetic acceptance garden: ${server.url} — email code 123456; data is in memory.`);
process.on("SIGINT", () => { server.stop(true); sqlite.close(); process.exit(0); });
