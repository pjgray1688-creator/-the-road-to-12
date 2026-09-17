import { redirect } from "next/navigation";

export default async function ClubMembersPage({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const params = await searchParams;
  redirect(`/club${params?.org ? `?org=${encodeURIComponent(params.org)}` : ""}`);
}
