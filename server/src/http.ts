import { z } from "zod";
import { Actions, contracts, type Context } from "./actions";
import type { GardenDatabase } from "./db";

const identity = z.uuid();
const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: { "Cache-Control": "no-store", "Vary": "X-User-Id" },
});

export function apiHandler(db: GardenDatabase) {
  return async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname;
    const name = path.slice("/api/".length);
    if (!path.startsWith("/api/") || !Object.hasOwn(contracts, name)) {
      return json({ error: "Endpoint not found." }, 404);
    }
    if (request.method !== "POST") return json({ error: "Use POST." }, 405);
    const user = identity.safeParse(request.headers.get("X-User-Id"));
    if (!user.success) return json({ error: "A valid X-User-Id is required." }, 401);
    if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
      return json({ error: "Expected application/json." }, 415);
    }
    let body: unknown;
    try { body = await request.json(); }
    catch { return json({ error: "Invalid JSON." }, 400); }
    const actionName = name as keyof typeof contracts;
    const contract = contracts[actionName];
    const args = contract.request.safeParse(body);
    if (!args.success) return json({ error: "Invalid request.", issues: args.error.issues }, 400);
    try {
      // The route's schema validates the argument before this heterogeneous dispatch.
      const handler = Actions[actionName] as (ctx: Context, args: unknown) => unknown;
      const result = db.transaction((tx) => contract.response.parse(
        handler({ db: tx, userId: user.data.toLowerCase() }, args.data),
      ));
      return json(result);
    } catch (error) {
      if (error instanceof Error && error.message === "Project not found.") {
        return json({ error: error.message }, 404);
      }
      if (error instanceof Error && error.message === "Archived projects are dormant.") {
        return json({ error: error.message }, 409);
      }
      console.error("Garden request failed", error);
      return json({ error: "The garden could not be updated. Try again." }, 500);
    }
  };
}
