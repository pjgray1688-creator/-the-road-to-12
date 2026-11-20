import Link from "next/link";
import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { ClubMemberActivationInvitations } from "@/components/club-member-activation-invitations";
import { AppShell, EmptyState, PageHeader, Surface } from "@/components/ui";
import { resolveClubOperationalContext } from "@/lib/club-server-context";
import { validInvitationSecret } from "@/lib/madhouse-member-invitation-token";
import { notificationTransportAvailable } from "@/lib/notification-provider";
import { serverSupabase } from "@/lib/supabase-server";

const MADHOUSE_ORGANISATION_ID = "fa44592a-1593-4ad3-a621-63a4a4bcbceb";

export default async function MadhouseMemberActivationPage({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const params = await searchParams;
  const organisationId = params?.org ?? MADHOUSE_ORGANISATION_ID;
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/account?app=club&mode=signIn&next=${encodeURIComponent(`/club/members/activation?org=${MADHOUSE_ORGANISATION_ID}`)}`);
  const context = await resolveClubOperationalContext(supabase, user.id, organisationId);
  if (!context || context.organisation.id !== MADHOUSE_ORGANISATION_ID || !["owner", "gym_admin"].includes(context.role)
    || !(await context.repository.hasCapability(context.organisation.id, user.id, "members.link_account"))) {
    return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · MEMBERS" title="Member activation" /><Surface><EmptyState title="Management access required">Only authorised Madhouse management can preview or send existing-member activation invitations.</EmptyState></Surface><AppNav /></AppShell>;
  }
  const { data: previewData, error: previewError } = await supabase.rpc("club_preview_madhouse_member_activation_invitations", { p_organisation_id: context.organisation.id });
  const preview = !previewError && previewData && typeof previewData === "object"
    ? previewData as { members?: Array<{ id: string; customer_id: string; display_name: string; masked_email: string; eligibility: string; state: string; sendable: boolean; invite_id?: string | null; invite_expires_at?: string | null }>; eligible_count?: number; counts?: Record<string, number> }
    : undefined;
  const deliveryReady = process.env.R12_MADHOUSE_MEMBER_INVITATIONS_ENABLED === "true"
    && validInvitationSecret(process.env.R12_MADHOUSE_MEMBER_INVITATION_TOKEN_SECRET)
    && Boolean(process.env.R12_NOTIFICATION_WORKER_SECRET?.trim() || process.env.CRON_SECRET?.trim())
    && notificationTransportAvailable();
  return <AppShell className="module-page club-page">
    <PageHeader eyebrow="R12 CLUB · MEMBERS" title="Invite existing members to R12" description="Help current Madhouse members connect their existing membership to one verified R12 account." />
    <Surface>
      <p>Invitations are tied to one existing Madhouse customer and expire after seven days. Members must verify the exact invited email. Shared emails and identity conflicts require staff review.</p>
      {preview ? <ClubMemberActivationInvitations organisationId={context.organisation.id} preview={preview} deliveryReady={deliveryReady} /> : <EmptyState title="Preview unavailable">The invitation preview could not be loaded. No email has been sent.</EmptyState>}
      <p><Link className="secondary" href={`/club/members?org=${encodeURIComponent(context.organisation.id)}`}>Back to Members</Link></p>
    </Surface>
    <AppNav />
  </AppShell>;
}
