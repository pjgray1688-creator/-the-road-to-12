import { AppShell, EmptyState, PageHeader, Surface } from "@/components/ui";
import { MemberActivationClaim } from "@/components/member-activation-claim";
import { getServerUser } from "@/lib/supabase-server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function MemberActivationPage({ searchParams }: { searchParams?: Promise<{ invitation?: string }> }) {
  const params = await searchParams;
  const invitationId = params?.invitation ?? "";
  const { user } = await getServerUser();
  return <AppShell className="module-page member-area-page">
    <PageHeader eyebrow="R12 × MADHOUSE" title="Activate your membership" description="Connect your existing Madhouse membership to your verified R12 account." />
    <Surface>
      {!UUID.test(invitationId) ? <EmptyState title="Invitation link unavailable">Open the secure link from your Madhouse invitation email or contact the gym for help.</EmptyState>
        : <MemberActivationClaim invitationId={invitationId} signedIn={Boolean(user)} emailVerified={Boolean(user?.email_confirmed_at)} />}
      <p className="muted">This process only links your existing gym membership. It does not create another membership, request payment or enable physical door access. Glow Zone verification is separate.</p>
    </Surface>
  </AppShell>;
}
