import { notificationConfig, type NotificationSender } from "./notification-provider";

export type NotificationTemplateKey =
  | "staff_invitation"
  | "member_activation"
  | "coach_relationship_invite"
  | "join_incomplete"
  | "monthly_payment_failed"
  | "yearly_renewal_1_month"
  | "yearly_renewal_1_week"
  | "yearly_renewal_final_days"
  | "induction_reminder"
  | "order_ready_for_collection"
  | "maintenance_escalation";

export type NotificationTemplateInput = { templateKey: NotificationTemplateKey; payload: Record<string, unknown> };

const text = (value: unknown, fallback = "") => typeof value === "string" ? value : fallback;
const html = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
const link = (path: string) => `${notificationConfig().appBaseUrl}${path.startsWith("/") ? path : `/${path}`}`;

export function renderNotification(input: NotificationTemplateInput) {
  const p = input.payload;
  const name = text(p.name, "there");
  const organisation = text(p.organisationName, "R12");
  let sender: NotificationSender = "members";
  let subject = "A message from R12";
  let body = "Please sign in to R12 to continue.";
  let path = "/account";

  switch (input.templateKey) {
    case "staff_invitation":
      sender = "staff"; subject = `Your ${organisation} staff access is ready`; body = `${organisation} has prepared personal ${text(p.role, "staff")} access for you. Use your own R12 account with ${text(p.email)} to accept it.`; path = `/club/staff/claim?grant=${encodeURIComponent(text(p.grantId))}`; break;
    case "member_activation":
      subject = "Activate your R12 account"; body = "Your R12 account can now be linked to your existing membership. Sign in with your verified email to continue."; path = "/member-hub/link"; break;
    case "coach_relationship_invite":
      {
        const coachName = text(p.coachName, "Your Coach");
        const expiry = text(p.expiresAt);
        subject = `${coachName} has invited you to train with them on R12`;
        body = `${coachName} has invited you to connect with them on R12.\n\nR12 keeps your programme, coached sessions and progress together in one place.${p.organisationName ? `\n\nThis connection is through ${text(p.organisationName)}.` : ""}\n\nAccept the invitation to connect your account with ${coachName}.${expiry ? `\n\nThis invitation expires on ${expiry}.` : ""}`;
        path = text(p.invitePath, text(p.claimPath, "/coach/claim"));
      }
      break;
    case "join_incomplete":
      subject = "Continue joining Madhouse"; body = "You have a saved Madhouse joining application. Sign in to R12 to continue where you left off."; path = "/join/madhouse"; break;
    case "monthly_payment_failed":
      sender = "billing"; subject = "Action needed for your Madhouse membership payment"; body = "A recurring monthly payment needs your attention. Your current membership/access state is unchanged by this message; sign in to review the payment action."; path = "/member-hub"; break;
    case "yearly_renewal_1_month":
      sender = "billing"; subject = "Your Madhouse membership renewal is coming up"; body = "Your one-off annual membership is approaching its paid-through date. Sign in to review renewal options."; path = "/member-hub"; break;
    case "yearly_renewal_1_week":
      sender = "billing"; subject = "One week until your Madhouse membership renewal date"; body = "Your annual membership is due to expire soon. Sign in to review renewal options."; path = "/member-hub"; break;
    case "yearly_renewal_final_days":
      sender = "billing"; subject = "Your Madhouse membership expires soon"; body = "Your annual membership is in its final renewal window. Sign in to renew if you want uninterrupted access."; path = "/member-hub"; break;
    case "induction_reminder":
      subject = "Reminder: your Madhouse induction"; body = "You have an upcoming induction booking. Sign in to review the time and venue."; path = "/member-hub"; break;
    case "order_ready_for_collection":
      subject = "Your Madhouse order is ready for collection"; body = `Your order is ready to collect${p.collectionCode ? ` using collection code ${text(p.collectionCode)}` : ""}.`; path = "/member-hub"; break;
    case "maintenance_escalation":
      sender = "staff"; subject = `${organisation} maintenance issue needs review`; body = `A ${text(p.priority, "reported")} issue${p.assetName ? ` with ${text(p.assetName)}` : ""} has been reported at ${text(p.locationName, "a venue")}.`; path = `/club/checks?org=${encodeURIComponent(text(p.organisationId))}`; break;
  }

  const greeting = `Hi ${name},`;
  const url = link(path);
  return { sender, subject, text: `${greeting}\n\n${body}\n\nContinue securely: ${url}\n\nR12`, html: `<main style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#17131f;padding:24px"><p>${html(greeting)}</p><p style="white-space:pre-line;line-height:1.6">${html(body)}</p><p><a href="${html(url)}" style="display:inline-block;padding:12px 18px;background:#7c3aed;color:white;border-radius:8px;text-decoration:none">Accept invitation</a></p><p>R12</p></main>` };
}
