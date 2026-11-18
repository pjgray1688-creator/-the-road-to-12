import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";

export const serverSupabase = cache(async function serverSupabaseForRequest() {
  const cookieStore = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll(values) {
        try { values.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); }
        catch { /* Server components cannot persist refreshed cookies; proxy.ts owns that boundary. */ }
      },
    },
  });
});

export const getServerUser = cache(async function getServerUserForRequest() {
  const client = await serverSupabase();
  const result = await client.auth.getUser();
  return { client, ...result.data, error: result.error };
});
