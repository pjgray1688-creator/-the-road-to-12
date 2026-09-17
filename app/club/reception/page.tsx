import { redirect } from "next/navigation";

export default async function ClubReceptionPage({ searchParams }: { searchParams?: Promise<{ org?: string; location?: string }> }) {
  const params = await searchParams;
  const query = new URLSearchParams();
  if (params?.org) query.set("org", params.org);
  if (params?.location) query.set("location", params.location);
  redirect(`/club${query.toString() ? `?${query.toString()}` : ""}`);
}
