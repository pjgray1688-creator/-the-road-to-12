import type { Metadata } from "next";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOperationalContext } from "@/lib/club-server-context";
import { clubTitle } from "@/lib/club-metadata";

export async function generateMetadata(): Promise<Metadata> {
  try {
    const supabase = await serverSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    const context = user ? await resolveClubOperationalContext(supabase, user.id) : undefined;
    return { title: clubTitle(undefined, context?.organisation.name), description: "Operational tools for R12 clubs.", manifest: "/club/manifest.webmanifest" };
  } catch {
    return { title: "R12 Club", description: "Operational tools for R12 clubs.", manifest: "/club/manifest.webmanifest" };
  }
}

export default function ClubLayout({ children }: Readonly<{ children: React.ReactNode }>) { return children; }
