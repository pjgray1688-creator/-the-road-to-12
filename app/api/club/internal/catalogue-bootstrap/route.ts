import { NextResponse } from "next/server";
import { serverSupabase } from "@/lib/supabase-server";
import { SupabaseClubRepository } from "@/lib/supabase-club-repository";
import { catalogueBootstrapEnabled, MADHOUSE_CATALOGUE_BOOTSTRAP_CONFIRMATION, MADHOUSE_PRODUCTION_ORGANISATION_ID, reconcileMadhouseCatalogue } from "@/lib/madhouse-catalogue";

export async function POST(request: Request) {
  if (!catalogueBootstrapEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  if (body?.confirmation !== MADHOUSE_CATALOGUE_BOOTSTRAP_CONFIRMATION || body?.mode !== "create_missing") return NextResponse.json({ error: "Explicit catalogue confirmation required" }, { status: 400 });
  const supabase = await serverSupabase(); const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const repository = new SupabaseClubRepository(supabase); const members = await repository.listMembers(MADHOUSE_PRODUCTION_ORGANISATION_ID);
  if (!members.some(member => member.userId === user.id && member.active && member.role === "owner")) return NextResponse.json({ error: "Owner authorisation required" }, { status: 403 });
  try { return NextResponse.json({ organisationId: MADHOUSE_PRODUCTION_ORGANISATION_ID, results: await reconcileMadhouseCatalogue(repository) }); }
  catch (error) { console.error("[club-bootstrap] catalogue reconciliation failed", error); return NextResponse.json({ error: "Catalogue bootstrap failed safely" }, { status: 500 }); }
}
