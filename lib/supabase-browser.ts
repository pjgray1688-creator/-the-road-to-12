import { createBrowserClient } from "@supabase/ssr";
export function browserSupabase() { return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!); }

/** Auth return pages explicitly exchange their one-time code; auto-detection would consume it first. */
export function authRedirectSupabase() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    isSingleton: false,
    auth: { detectSessionInUrl: false },
  });
}
