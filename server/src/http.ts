import { RateLimiter } from "./rate-limit";
import { isTestingMvp } from "./config";
import { DeletionService } from "./deletion";
import { recordSignIn } from "./analytics";
import { BillingService } from "./billing";
import { createBillingProvider } from "./stripe";
import { z } from "zod";
import { ApiError } from "./errors";
import { ensureAccount, reconcilePlantLimit } from "./entitlements";
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

export function apiHandler(db: GardenDatabase, authenticate: Authenticator = createSupabaseAuthenticator(), accountDeletion: AccountDeletion = createSupabaseAccountDeletion(), billing = new BillingService(db, createBillingProvider()), deletion = new DeletionService(db, billing, accountDeletion)) {
  const userLimits = new RateLimiter(120);
  const billingLimits = new RateLimiter(10);
  return async (request: Request): Promise<Response> => {
    try {
    const path = new URL(request.url).pathname;
    if (isTestingMvp() && path.startsWith("/api/billing/")) return json(request, { error: "Billing is disabled for user testing." }, 404);
    if (path === "/api/billing/webhook") {
      if (request.method !== "POST") return json(request, { error: "Use POST." }, 405);
      await billing.webhook(await request.text(), request.headers.get("Stripe-Signature") ?? "");
      return json(request, { ok: true });
    }
    if (request.method === "OPTIONS" && path.startsWith("/api/")) {
      return new Response(null, { status: 204, headers: responseHeaders(request) });
    }
    if (path === "/api/auth/config") {
      if (request.method !== "GET") return json(request, { error: "Use GET." }, 405);
      const { url, publishableKey, configured } = authConfiguration();
      return json(request, { url, publishableKey, configured });
    }
    const name = path.slice("/api/".length);
    if (!path.startsWith("/api/") || (!Object.hasOwn(contracts, name) && !["account", "billing/checkout", "billing/portal", "billing/refresh", "analytics/sign-in"].includes(name))) {
      return json(request, { error: "Endpoint not found." }, 404);
    }
    if (request.method !== "POST") return json(request, { error: "Use POST." }, 405);
    const user = await authenticate(request);
    if (!user) return json(request, { error: "A valid authenticated session is required." }, 401);
    if (!userLimits.allow(user.id) || (name.startsWith("billing/") && !billingLimits.allow(user.id))) {
      const response = json(request, { error: "Too many requests. Please wait a minute and retry." }, 429);
      response.headers.set("Retry-After", "60"); return response;
    }
    const account = ensureAccount(db, user.id);
    if (account.deletionState !== "none" && !["account", "listProjects", "exportGarden", "deletePersonalData"].includes(name)) throw new ApiError(409, "Account deletion is pending. Changes are locked; retry deletion in Account.");
    if (account.deletionState === "none") db.transaction(tx => reconcilePlantLimit(tx, user.id), { behavior: "immediate" });
    if (name === "account") return json(request, billing.account(user.id));
    if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
      return json(request, { error: "Expected application/json." }, 415);
    }
    let body: unknown;
    try { const raw = await request.text(); if (new TextEncoder().encode(raw).byteLength > 64 * 1024) return json(request, { error: "Request too large." }, 413); body = JSON.parse(raw); }
    catch { return json(request, { error: "Invalid JSON." }, 400); }
    if (name === "analytics/sign-in") { db.transaction(tx => recordSignIn(tx, user.id)); return json(request, { ok: true }); }
    if (name.startsWith("billing/")) {
      if (name === "billing/checkout") {
        const parsed = z.object({ interval: z.enum(["month", "year"]) }).strict().safeParse(body);
        if (!parsed.success) return json(request, { error: "Choose monthly or yearly billing." }, 400);
        return json(request, { url: await billing.checkout(user.id, user.email, parsed.data.interval) });
      }
      if (name === "billing/portal") return json(request, { url: await billing.portal(user.id) });
      await billing.reconcile(user.id);
      return json(request, billing.account(user.id));
    }
    const actionName = name as keyof typeof contracts;
    const contract = contracts[actionName];
    const args = contract.request.safeParse(body);
    if (!args.success) return json(request, { error: "Invalid request.", issues: args.error.issues }, 400);
    if (actionName === "deletePersonalData") {
      await deletion.run(user.id);
      return json(request, { ok: true });
    }
    try {
      // The route's schema validates the argument before this heterogeneous dispatch.
      const handler = Actions[actionName] as (ctx: Context, args: unknown) => unknown;
      const result = db.transaction((tx) => contract.response.parse(
        handler({ db: tx, userId: user.id, email: user.email }, args.data),
      ), { behavior: "immediate" });
      return json(request, result);
    } catch (error) {
      if (error instanceof ApiError) return json(request, { error: error.message }, error.status);
      if (error instanceof Error && error.message === "Legacy garden import requires verified support assistance.") return json(request, { error: error.message }, 410);
      if (error instanceof Error && error.message === "TODO not found.") return json(request, { error: error.message }, 404);
      if (error instanceof Error && error.message === "Project not found.") {
        return json(request, { error: error.message }, 404);
      }
      if (error instanceof Error && error.message === "Archived projects are dormant.") {
        return json(request, { error: error.message }, 409);
      }
      if (error instanceof Error && ["Anonymous garden has already been claimed.", "Anonymous garden cannot match the account."].includes(error.message)) {
        return json(request, { error: error.message }, 409);
      }
      console.error("Garden request failed", error instanceof Error ? error.name : "unknown");
      return json(request, { error: "The garden could not be updated. Try again." }, 500);
    }
    } catch (error) {
      if (error instanceof ApiError) return json(request, { error: error.message }, error.status);
      console.error("External service request failed", error instanceof Error ? error.name : "unknown");
      return json(request, { error: "The service is temporarily unavailable. Please try again." }, 503);
    }
  };
}
