import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerUser } from "./supabase-server";

export async function authenticatedServerClient() {
  const { client, user, error } = await getServerUser();
  return { client: client as SupabaseClient, user: user ?? null, error };
}
