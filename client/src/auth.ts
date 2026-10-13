import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type PublicAuthConfiguration = { url: string; publishableKey: string; configured: boolean };

const baseUrl = __API_BASE_URL__.replace(/\/$/, "");
let clientPromise: Promise<SupabaseClient> | null = null;

export function apiUrl(path: string): string {
  return `${baseUrl}${path}`;
}

export function getAuthClient(): Promise<SupabaseClient> {
  clientPromise ??= fetch(apiUrl("/api/auth/config"), { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) throw new Error("Authentication configuration could not be loaded.");
      return response.json() as Promise<PublicAuthConfiguration>;
    })
    .then((config) => {
      if (!config.configured) throw new Error("Authentication has not been configured for this deployment.");
      return createClient(config.url, config.publishableKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
    });
  return clientPromise;
}

export async function getAccessToken(): Promise<string> {
  const client = await getAuthClient();
  const { data, error } = await client.auth.getSession();
  if (error || !data.session?.access_token) throw new Error("Your session has expired. Sign in again.");
  return data.session.access_token;
}
