import { Actions, contracts, type Context } from "./actions";
import { authConfiguration, createSupabaseAccountDeletion, createSupabaseAuthenticator, type AccountDeletion, type Authenticator } from "./auth";
import type { GardenDatabase } from "./db";

function responseHeaders(request: Request) {
  const headers = new Headers({ "Cache-Control": "no-store", Vary: "Authorization, Origin" });
  const origin = request.headers.get("Origin");
  const allowed = (process.env.APP_ORIGIN ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (origin && allowed.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }
  return headers;
}

const json = (request: Request, body: unknown, status = 200) => Response.json(body, { status, headers: responseHeaders(request) });

export function apiHandler(db: GardenDatabase, authenticate: Authenticator = createSupabaseAuthenticator(), accountDeletion: AccountDeletion = createSupabaseAccountDeletion()) {
  return async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname;
    if (request.method === "OPTIONS" && path.startsWith("/api/")) {
      return new Response(null, { status: 204, headers: responseHeaders(request) });
    }
    if (path === "/api/auth/config") {
      if (request.method !== "GET") return json(request, { error: "Use GET." }, 405);
      const { url, publishableKey, configured } = authConfiguration();
      return json(request, { url, publishableKey, configured });
    }
    const name = path.slice("/api/".length);
    if (!path.startsWith("/api/") || !Object.hasOwn(contracts, name)) {
      return json(request, { error: "Endpoint not found." }, 404);
    }
    if (request.method !== "POST") return json(request, { error: "Use POST." }, 405);
    const user = await authenticate(request);
    if (!user) return json(request, { error: "A valid authenticated session is required." }, 401);
    if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
      return json(request, { error: "Expected application/json." }, 415);
    }
    let body: unknown;
    try { body = await request.json(); }
    catch { return json(request, { error: "Invalid JSON." }, 400); }
    const actionName = name as keyof typeof contracts;
    const contract = contracts[actionName];
    const args = contract.request.safeParse(body);
    if (!args.success) return json(request, { error: "Invalid request.", issues: args.error.issues }, 400);
    if (actionName === "deletePersonalData" && !accountDeletion.configured) {
      return json(request, { error: "Account deletion is not configured." }, 503);
    }
    try {
      // The route's schema validates the argument before this heterogeneous dispatch.
      const handler = Actions[actionName] as (ctx: Context, args: unknown) => unknown;
      const result = db.transaction((tx) => contract.response.parse(
        handler({ db: tx, userId: user.id, email: user.email }, args.data),
      ));
      if (actionName === "deletePersonalData" && !(await accountDeletion.delete(user.id))) {
        return json(request, { error: "Garden data was deleted, but the sign-in account could not be removed. Try again." }, 502);
      }
      return json(request, result);
    } catch (error) {
      if (error instanceof Error && error.message === "Project not found.") {
        return json(request, { error: error.message }, 404);
      }
      if (error instanceof Error && error.message === "Archived projects are dormant.") {
        return json(request, { error: error.message }, 409);
      }
      if (error instanceof Error && ["Anonymous garden has already been claimed.", "Anonymous garden cannot match the account."].includes(error.message)) {
        return json(request, { error: error.message }, 409);
      }
      console.error("Garden request failed", error);
      return json(request, { error: "The garden could not be updated. Try again." }, 500);
    }
  };
}
