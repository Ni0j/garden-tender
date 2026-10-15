import { ApiError } from "./errors";
import { z } from "zod";

export type AuthenticatedUser = { id: string; email: string };
export type Authenticator = (request: Request) => Promise<AuthenticatedUser | null>;
export type AccountDeletion = { configured: boolean; delete: (userId: string) => Promise<boolean> };

const supabaseUser = z.object({ id: z.uuid(), email: z.email() });

export function authConfiguration() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "") ?? "";
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
  if (publishableKey.startsWith("sb_secret_")) throw new ApiError(503, "The public authentication key is misconfigured.");
  if (publishableKey.startsWith("eyJ")) {
    try { if (JSON.parse(Buffer.from(publishableKey.split(".")[1] ?? "", "base64url").toString()).role !== "anon") throw new Error("not public"); }
    catch { throw new ApiError(503, "The public authentication key is misconfigured."); }
  }
  return { url, publishableKey, configured: Boolean(url && publishableKey) };
}

export function createSupabaseAuthenticator(): Authenticator {
  const config = authConfiguration();
  return async (request) => {
    const authorization = request.headers.get("Authorization");
    if (!config.configured) throw new ApiError(503, "Authentication is not configured.");
    if (!authorization?.startsWith("Bearer ")) return null;
    const token = authorization.slice("Bearer ".length).trim();
    if (!token) return null;
    try {
      const response = await fetch(`${config.url}/auth/v1/user`, {
        headers: { apikey: config.publishableKey, Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5_000),
      });
      if (response.status === 401 || response.status === 403) return null;
      if (!response.ok) throw new ApiError(503, "Sign-in verification is temporarily unavailable. Please retry.");
      const user = supabaseUser.safeParse(await response.json());
      return user.success ? { id: user.data.id.toLowerCase(), email: user.data.email } : null;
    } catch {
      throw new ApiError(503, "Sign-in verification is temporarily unavailable. Please retry.");
    }
  };
}

export function createSupabaseAccountDeletion(): AccountDeletion {
  const { url } = authConfiguration();
  const secretKey = process.env.SUPABASE_SECRET_KEY ?? "";
  return {
    configured: Boolean(url && secretKey),
    async delete(userId) {
      if (!url || !secretKey) return false;
      try {
        const response = await fetch(`${url}/auth/v1/admin/users/${userId}`, {
          method: "DELETE",
          headers: { apikey: secretKey, Authorization: `Bearer ${secretKey}` },
          signal: AbortSignal.timeout(5_000),
        });
        return response.ok || response.status === 404;
      } catch {
        return false;
      }
    },
  };
}
