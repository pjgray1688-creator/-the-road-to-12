// Local UI fixture only. The runner replaces server actions with throwing sentinels;
// it never authenticates, calls a provider or exposes this fixture as an app route.
import { createRoot } from "react-dom/client";
import { ClubSectionNav } from "../../components/club-shell";
import { ClubMenuLinks } from "../../components/club-menu-links";
import { ClubShop } from "../../components/club-shop";
import { ClubMembersDirectory } from "../../components/club-members-directory";
import { ClubReviewerMember } from "../../components/club-reviewer-member";
import { BackButton } from "../../components/ui";
import { reviewerClubOrganisation as organisation, reviewerClubLocations as locations, reviewerClubProducts as products, reviewerClubStockBalances as stockBalances, reviewerClubMembers as members, reviewerClubCustomers as customers } from "../../lib/play-reviewer-club-data";
import type { ClubRole } from "../../lib/club";
const params = new URLSearchParams(location.search);
const role: ClubRole = params.get("role") === "owner" ? "owner" : "gym_staff";
const path = location.pathname;
createRoot(document.getElementById("root")!).render(<main className="app-shell module-page club-page">
  <ClubSectionNav organisation={organisation} role={role} locations={locations} locationId={locations[1].id}/>
  {path.startsWith("/club/shop") ? <ClubShop organisationId={organisation.id} userId="synthetic-club-reviewer" products={products} locations={locations} orders={[]} declarations={[]} staff canReconcile={false} accent="#a855f7" currentLocationId={locations[1].id} stockBalances={stockBalances} demoMode/>
  : path.startsWith("/club/members/") ? <><ClubReviewerMember memberId={path.split("/").at(-1)}/><BackButton href="/club/members">Back to members</BackButton></>
  : path.startsWith("/club/members") ? <ClubMembersDirectory members={members} customers={customers} organisationId={organisation.id}/>
  : <ClubMenuLinks role={role} organisationId={organisation.id} locationId={locations[1].id}/>}
</main>);
