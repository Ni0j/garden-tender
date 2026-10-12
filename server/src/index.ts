import { resolve, sep } from "node:path";
import { openDatabase } from "./db";
import { apiHandler } from "./http";

const { db, sqlite } = openDatabase();
const handleApi = apiHandler(db);
const publicDirectory = resolve(import.meta.dir, "../../client/dist");
const server = Bun.serve({
  hostname: "0.0.0.0",
  port: Number(process.env.PORT ?? 3000),
  maxRequestBodySize: 64 * 1024,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleApi(request);
    if (url.pathname === "/healthz") return Response.json({ ok: true });
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
    let path: string;
    try { path = decodeURIComponent(url.pathname); }
    catch { return new Response("Bad path", { status: 400 }); }
    const filename = resolve(publicDirectory, `.${path === "/" ? "/index.html" : path}`);
    if (!filename.startsWith(publicDirectory + sep)) return new Response("Not found", { status: 404 });
    const file = Bun.file(filename);
    if (!(await file.exists())) return new Response("Not found", { status: 404 });
    return new Response(request.method === "HEAD" ? null : file, {
      headers: { "Content-Type": file.type, "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" },
    });
  },
});
console.log(`Project Garden listening on ${server.url}`);
async function shutdown() {
  await server.stop();
  sqlite.close();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
