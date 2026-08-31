import type { SupabaseClient } from "@supabase/supabase-js";
import { serverSupabase } from "./supabase-server";

export async function authenticatedServerClient() {
  const client = await serverSupabase();
  const { data: { user }, error } = await client.auth.getUser();
  return { client: client as SupabaseClient, user: user ?? null, error };
}
