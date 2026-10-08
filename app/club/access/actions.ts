"use server";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";

async function authorised(organisationId: string) {
  const client = await serverSupabase(); const { data: { user } } = await client.auth.getUser();
  if (!user) return;
  const club = await resolveClubOrganisationContext(client, user.id, organisationId);
  if (!club || !(await club.repository.hasCapability(organisationId, user.id, "members.view"))) return;
  return client;
}
export async function decideScannedAccessAction(input: { organisationId: string; locationId: string; credential: string; credentialType: "legacy_member_reference" | "barcode" | "qr" }) {
  try { const client = await authorised(input.organisationId); if (!client || !input.locationId || !input.credential.trim()) return { ok: false, error: "Reception access is required." }; const { data, error } = await client.rpc("club_reception_access_decision", { p_organisation_id: input.organisationId, p_location_id: input.locationId, p_credential: input.credential, p_credential_type: input.credentialType }); if (error) return { ok: false, error: "The access decision could not be completed." }; return { ok: true, decision: data as Record<string, unknown> }; } catch { return { ok: false, error: "The access decision could not be completed." }; }
}
export async function decideCustomerAccessAction(input: { organisationId: string; locationId: string; customerId: string }) {
  try { const client = await authorised(input.organisationId); if (!client || !input.locationId || !input.customerId) return { ok: false, error: "Reception access is required." }; const { data, error } = await client.rpc("club_reception_customer_access_decision", { p_organisation_id: input.organisationId, p_location_id: input.locationId, p_customer_id: input.customerId }); if (error) return { ok: false, error: "The access decision could not be completed." }; return { ok: true, decision: data as Record<string, unknown> }; } catch { return { ok: false, error: "The access decision could not be completed." }; }
}
