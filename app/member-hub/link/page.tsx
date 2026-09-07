import Link from "next/link";
import { AppShell, EmptyState, PageHeader, Surface } from "@/components/ui";

export default function LinkMembershipPage() { return <AppShell className="module-page"><PageHeader eyebrow="MEMBER HUB" title="Link an existing membership" description="Connect the gym membership held in your name." /><Surface><EmptyState title="Email verification is not configured yet">R12 will verify the email held by your gym before linking a membership. Ask the gym team to help if that email is no longer accessible.</EmptyState><Link className="secondary" href="/member-hub">Back to My Gym</Link></Surface></AppShell>; }
