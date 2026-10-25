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
const accounts = new Map<string, { id: string; passwordHash: string }>();
const billing = new BillingService(db, null);
const handler = apiHandler(db, async request => sessions.get(request.headers.get("Authorization")?.replace("Bearer ", "") ?? "") ?? null, { configured: true, delete: async userId => { for (const [token, user] of sessions) if (user.id === userId) sessions.delete(token); return true; } }, billing);
const directory = resolve("client/dist");
function userJson(user: { id: string; email: string }) { return { ...user, aud: "authenticated", role: "authenticated", created_at: new Date().toISOString(), app_metadata: {}, user_metadata: {} }; }
function createSession(user: { id: string; email: string }) {
  const payload = Buffer.from(JSON.stringify({ sub: user.id, aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000), session_id: crypto.randomUUID() })).toString("base64url");
  const token = `eyJhbGciOiJIUzI1NiJ9.${payload}.synthetic`;
  sessions.set(token, user);
  return { access_token: token, refresh_token: token, expires_in: 3600, token_type: "bearer", user: userJson(user) };
}
const server = Bun.serve({ hostname: "127.0.0.1", port: Number(process.env.PORT ?? 4197), async fetch(request) {
  const path = new URL(request.url).pathname;
  if (path === "/api/auth/config") return Response.json({ configured: true, url: new URL(request.url).origin, publishableKey: "sb_publishable_synthetic" });
  if (path === "/auth/v1/signup") {
    const args = await request.json() as { email: string; password: string };
    if (accounts.has(args.email)) return Response.json({ message: "An account with this email already exists." }, { status: 422 });
    const account = { id: crypto.randomUUID(), passwordHash: await Bun.password.hash(args.password) };
    accounts.set(args.email, account);
    return Response.json(createSession({ id: account.id, email: args.email }));
  }
  if (path === "/auth/v1/token" && new URL(request.url).searchParams.get("grant_type") === "password") {
    const args = await request.json() as { email: string; password: string };
    const account = accounts.get(args.email);
    if (!account || !await Bun.password.verify(args.password, account.passwordHash)) return Response.json({ message: "Invalid email or password." }, { status: 400 });
    return Response.json(createSession({ id: account.id, email: args.email }));
  }
  if (path === "/auth/v1/token" && new URL(request.url).searchParams.get("grant_type") === "refresh_token") {
    const args = await request.json() as { refresh_token: string };
    const user = sessions.get(args.refresh_token);
    return user ? Response.json(createSession(user)) : Response.json({ message: "Session expired." }, { status: 401 });
  }
  if (path === "/auth/v1/recover") return Response.json({});
  if (path === "/auth/v1/user") {
    const token = request.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
    const user = sessions.get(token);
    if (!user) return Response.json({ message: "Invalid session." }, { status: 401 });
    if (request.method === "PUT") {
      const args = await request.json() as { password?: string };
      const account = accounts.get(user.email);
      if (account && args.password) account.passwordHash = await Bun.password.hash(args.password);
    }
    return Response.json(userJson(user));
  }
  if (path === "/auth/v1/logout") { sessions.delete(request.headers.get("Authorization")?.replace("Bearer ", "") ?? ""); return Response.json({}); }
  if (path.startsWith("/api/")) return handler(request);
  const filename = resolve(directory, `.${path === "/" ? "/index.html" : path}`);
  if (!filename.startsWith(directory + sep)) return new Response("Not found", { status: 404 });
  const file = Bun.file(filename);
  return await file.exists() ? new Response(file) : new Response("Not found", { status: 404 });
} });
console.log(`Synthetic acceptance garden: ${server.url} — create an email/password account; data is in memory.`);
process.on("SIGINT", () => { server.stop(true); sqlite.close(); process.exit(0); });
