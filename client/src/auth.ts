import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let clientPromise: Promise<SupabaseClient> | null = null;

export function getAuthClient(): Promise<SupabaseClient> {
  if (!__SUPABASE_URL__ || !__SUPABASE_PUBLISHABLE_KEY__) return Promise.reject(new Error("Authentication has not been configured for this deployment."));
  clientPromise ??= Promise.resolve(createClient(__SUPABASE_URL__, __SUPABASE_PUBLISHABLE_KEY__, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  }));
  return clientPromise;
}

export async function getAccessToken(): Promise<string> {
  const client = await getAuthClient();
  const { data, error } = await client.auth.getSession();
  if (error || !data.session?.access_token) throw new Error("Your session has expired. Sign in again.");
  return data.session.access_token;
}
