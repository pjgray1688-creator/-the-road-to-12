import { serverSupabase } from "@/lib/supabase-server";

type LocationEligibility = { locationName: string; eligible: boolean };

export async function MemberAccessVenueEligibility({ organisationId }: { organisationId: string }) {
  const supabase = await serverSupabase();
  const { data, error } = await supabase.rpc("club_get_my_access_eligibility", { p_organisation_id: organisationId });
  if (error || !Array.isArray(data)) return <p role="status" className="muted">Venue eligibility could not be refreshed. Entry is always checked live at the venue.</p>;
  const locations = data as LocationEligibility[];
  if (!locations.length) return <p className="muted">No door-controlled venues are currently available for this membership.</p>;
  return <>{locations.map((location) => <div className="club-detail-row" key={location.locationName}><span>{location.locationName}</span><strong>{location.eligible ? "Eligible" : "Not eligible"}</strong></div>)}</>;
}
