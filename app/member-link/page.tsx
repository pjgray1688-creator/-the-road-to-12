import { redirect } from "next/navigation";

/** Backwards-compatible destination for existing Madhouse website links. */
export default function LegacyMemberLinkPage() {
  redirect("/member-hub/link");
}
