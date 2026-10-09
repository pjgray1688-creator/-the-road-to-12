import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { TutorialExperience } from "@/components/tutorial-experience";
import { authenticatedServerClient } from "@/lib/require-user";
import { SchedulingUserGuide } from "@/components/scheduling-user-guide";

export default async function MemberTutorialPage() { const { user } = await authenticatedServerClient(); if (!user) redirect("/account?mode=signIn&next=%2Ftutorial%2Fmember"); return <><main className="shell"><p className="muted">The Member tutorial opens here. You can skip it or return to Account.</p><SchedulingUserGuide audience="member"/></main><TutorialExperience area="member" replayKey="member_core" /><AppNav /></>; }
