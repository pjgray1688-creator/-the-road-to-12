"use server";
import { serverSupabase } from "@/lib/supabase-server";
import { revalidatePath } from "next/cache";
import { isClubStaffRole, resolveClubOperationalContext, resolveClubOrganisationContext } from "@/lib/club-server-context";
import { cookies } from "next/headers";
import { CLUB_STATION_COOKIE, CLUB_STATION_USER_COOKIE, stationCookieValue, verifyClubStationSession } from "@/lib/club-station";
import { MADHOUSE_PRODUCTION_ORGANISATION_ID } from "@/lib/madhouse-catalogue";

async function ownMadhouseStaff(organisationId: string) {
  if (organisationId !== MADHOUSE_PRODUCTION_ORGANISATION_ID) return undefined;
  const client = await serverSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return undefined;
  const context = await resolveClubOperationalContext(client, user.id, organisationId);
  if (!context || context.organisation.id !== MADHOUSE_PRODUCTION_ORGANISATION_ID) return undefined;
  return { client, context, user };
}

async function ownAccessPass(organisationId: string) {
  const actor = await ownMadhouseStaff(organisationId);
  if (!actor) return undefined;
  const { data, error } = await actor.client.rpc("club_get_my_access_pass", { p_organisation_id: actor.context.organisation.id });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) return undefined;
  return { ...actor, pass: data as Record<string, unknown> };
}

async function authorised(organisationId: string) {
  const client = await serverSupabase(); const { data: { user } } = await client.auth.getUser();
  if (!user) return;
  const club = await resolveClubOrganisationContext(client, user.id, organisationId);
  if (!club || !isClubStaffRole(club.role) || !(await club.repository.hasCapability(organisationId, user.id, "members.view"))) return;
  return client;
}
export async function decideScannedAccessAction(input: { organisationId: string; locationId: string; credential: string; credentialType: "pin" | "qr" | "legacy_member_reference" | "barcode" }) {
  try { const client = await authorised(input.organisationId); if (!client || !input.locationId || !input.credential.trim()) return { ok: false, error: "Reception access is required." }; const { data, error } = await client.rpc("club_reception_access_decision", { p_organisation_id: input.organisationId, p_location_id: input.locationId, p_credential: input.credential, p_credential_type: input.credentialType }); if (error) return { ok: false, error: "The access decision could not be completed." }; return { ok: true, decision: data as Record<string, unknown> }; } catch { return { ok: false, error: "The access decision could not be completed." }; }
}
export async function checkInStationScanAction(input: { credential: string }) {
  try {
    const client=await serverSupabase(); const {data:{user}}=await client.auth.getUser();
    const jar=await cookies(); const station=stationCookieValue(jar.get(CLUB_STATION_COOKIE)?.value);
    if(!user||!station||!verifyClubStationSession(jar.get(CLUB_STATION_USER_COOKIE)?.value,user.id,station.id)) return {ok:false,error:"Unlock this registered station before scanning."};
    if(!/^R12-[A-F0-9]{32}$/i.test(input.credential.trim())) return {ok:false,error:"Scan a valid R12 member QR code."};
    const {data,error}=await client.rpc("club_checkin_station_scan",{p_station_id:station.id,p_station_token:station.token,p_credential:input.credential.trim()});
    if(error)return {ok:false,error:"The check-in could not be completed. Please ask reception for help."};
    return {ok:true,decision:data as Record<string,unknown>};
  } catch { return {ok:false,error:"The check-in could not be completed. Please ask reception for help."}; }
}
export async function decideCustomerAccessAction(input: { organisationId: string; locationId: string; customerId: string }) {
  try { const client = await authorised(input.organisationId); if (!client || !input.locationId || !input.customerId) return { ok: false, error: "Reception access is required." }; const { data, error } = await client.rpc("club_reception_customer_access_decision", { p_organisation_id: input.organisationId, p_location_id: input.locationId, p_customer_id: input.customerId }); if (error) return { ok: false, error: "The access decision could not be completed." }; return { ok: true, decision: data as Record<string, unknown> }; } catch { return { ok: false, error: "The access decision could not be completed." }; }
}

/** Returns the current user's own PIN only after an explicit reveal action. */
export async function revealMyClubAccessPin(organisationId: string) {
  try {
    const result = await ownAccessPass(organisationId);
    if (!result || result.pass.accessAllowed !== true || typeof result.pass.pin !== "string") {
      return { ok: false as const, error: "Your staff access PIN is unavailable. Ask a Madhouse manager to check your staff access." };
    }
    return { ok: true as const, pin: result.pass.pin };
  } catch {
    return { ok: false as const, error: "Your access PIN could not be retrieved. Try again or contact a manager." };
  }
}

/** The existing audited RPC changes only this signed-in staff member's own PIN. */
export async function resetMyClubAccessPin(organisationId: string) {
  try {
    const result = await ownAccessPass(organisationId);
    if (!result || result.pass.accessAllowed !== true || typeof result.pass.customerId !== "string") {
      return { ok: false as const, error: "Your staff access could not be verified. Ask a Madhouse manager for help." };
    }
    if (!(await result.context.repository.hasCapability(result.context.organisation.id, result.user.id, "members.link_account"))) {
      return { ok: false as const, error: "Your role does not allow PIN reset. Ask a Madhouse manager for help." };
    }
    const { error } = await result.client.rpc("club_reissue_person_access_credential", {
      p_organisation_id: result.context.organisation.id,
      p_customer_id: result.pass.customerId,
      p_type: "pin",
      p_reason: "Staff member requested their own access PIN reset in Club",
    });
    if (error) return { ok: false as const, error: "Your PIN could not be reset. Try again or contact a manager." };
    revalidatePath("/club/my-access");
    return { ok: true as const };
  } catch {
    return { ok: false as const, error: "Your PIN could not be reset. Try again or contact a manager." };
  }
}
