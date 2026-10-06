import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { TutorialExperience } from "@/components/tutorial-experience";
import { authenticatedServerClient } from "@/lib/require-user";

export default async function CoachTutorialPage() { const { client, user } = await authenticatedServerClient(); if (!user) redirect("/account?mode=signIn&next=%2Ftutorial%2Fcoach"); const { data } = await client.rpc("coach_has_access", { p_client_user_id: null }); if (!data) redirect("/coach"); return <><main className="shell"><p className="muted">The Coach tutorial opens here. It does not change your Coach permission or client assignments.</p></main><TutorialExperience area="coach" replayKey="coach_core" /><AppNav /></>; }
