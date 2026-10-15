import { notificationConfig, senderAddress, type NotificationSender } from "./notification-provider";

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
  | "maintenance_escalation"
  | "schedule_update";

export type NotificationTemplateInput = { templateKey: NotificationTemplateKey; payload: Record<string, unknown> };

const text = (value: unknown, fallback = "") => typeof value === "string" ? value : fallback;
const html = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
const link = (path: string) => `${notificationConfig().appBaseUrl}${path.startsWith("/") ? path : `/${path}`}`;

export function renderNotification(input: NotificationTemplateInput) {
  const p = input.payload;
  const name = text(p.name, "there");
  const organisation = text(p.organisationName, "R12");
  const testMode = p.testMode === true;
  let sender: NotificationSender = "members";
  let subject = "A message from R12";
  let body = "Please sign in to R12 to continue.";
  let path = "/account";
  let cta = "Continue to R12";

  switch (input.templateKey) {
    case "staff_invitation":
      {
        const role = text(p.role);
        const roleLabel = role === "gym_admin" ? "Manager" : role === "trainer" ? "PT / Coach" : role === "gym_staff" ? "Operational Staff" : role || "staff";
        const venues = Array.isArray(p.venueNames) ? p.venueNames.filter((value): value is string => typeof value === "string" && value.length > 0) : [];
        const expiry = text(p.expiresAt);
        const expiryLabel = expiry ? new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "Europe/London" }).format(new Date(expiry)) : "30 days from issue";
        sender = "staff";
        subject = "Your R12 staff access is ready";
        body = `${text(p.inviterName, "The Madhouse team")} has prepared personal ${roleLabel} access for ${organisation}.${venues.length ? ` Your authorised venues are ${venues.join(" and ")}.` : " Your access follows the organisation’s venue permissions."} Use the same email address (${text(p.email)}) to sign in to your existing R12 account or create your own account. After signing in, review and accept the staff access request. This invitation is valid until ${expiryLabel}.`;
        path = `/club/staff/claim?grant=${encodeURIComponent(text(p.grantId))}`;
        cta = "Activate staff access";
      }
      break;
    case "member_activation":
      subject = "Activate your R12 membership account";
      body = `Your existing ${organisation} gym membership is already recorded on R12. You are not buying or joining again. Use the same email address as your membership: sign in if you already have an R12 account, or create your own account if you are new. Once authenticated, you can confirm and link your existing membership.`;
      path = "/member-hub/link";
      cta = "Activate my R12 account";
      break;
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
    case "schedule_update":
      {
        const action = text(p.eventType, "updated");
        const verb = action === "cancelled" ? "cancelled" : action === "booked" ? "booked" : "updated";
        subject = `Your ${text(p.kind, "schedule item")} has been ${verb}`;
        body = `${text(p.title, "Your appointment")} · ${text(p.startsAt)}${p.location ? ` · ${text(p.location)}` : ""}. View your schedule in R12.`;
      }
      path = "/member-hub/schedule"; break;
  }

  const greeting = `Hi ${name},`;
  const url = link(path);
  const testPrefix = testMode ? "[TEST] " : "";
  const textContent = `${testMode ? "[TEST MESSAGE — no access or membership is created by this email.]\n\n" : ""}${greeting}\n\n${body}\n\n${cta}: ${url}\n\nR12 · MADHOUSE\nYour club, your progress.`;
  const htmlContent = `<div style="margin:0;background:#f4f1f8;padding:20px 12px;font-family:Arial,Helvetica,sans-serif;color:#211a2b"><main style="box-sizing:border-box;max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden"><header style="padding:22px 24px;background:#17131f;color:#fff;border-bottom:4px solid #8b5cf6"><div style="font-size:26px;font-weight:900;letter-spacing:.06em">R12</div><div style="margin-top:3px;color:#d6c5ff;font-size:11px;font-weight:700;letter-spacing:.18em">MADHOUSE · ROTHERHAM · CARLTON</div></header>${testMode ? `<div style="padding:12px 24px;background:#fff4cf;color:#614400;font-size:13px;font-weight:700">TEST EMAIL — this message does not create or change access.</div>` : ""}<section style="padding:26px 24px 18px"><p style="margin:0 0 16px">${html(greeting)}</p><p style="margin:0;line-height:1.65;white-space:pre-line">${html(body)}</p><p style="margin:24px 0 8px"><a href="${html(url)}" style="display:inline-block;box-sizing:border-box;min-height:48px;padding:15px 20px;background:#6d28d9;color:#fff;border-radius:10px;text-decoration:none;font-weight:700">${html(cta)}</a></p><p style="margin:12px 0 0;color:#625a6c;font-size:12px;line-height:1.5">If the button does not work, copy this address into your browser:<br><a style="color:#6d28d9;overflow-wrap:anywhere" href="${html(url)}">${html(url)}</a></p></section><footer style="padding:18px 24px;background:#f8f6fb;border-top:1px solid #eee8f5;color:#625a6c;font-size:12px;line-height:1.5"><strong style="color:#211a2b">R12 · MADHOUSE</strong><br>Your club, your progress.<br>Rotherham · Carlton</footer></main></div>`;
  return { sender, senderName: notificationConfig().fromNames[sender], senderAddress: senderAddress(sender), subject: `${testPrefix}${subject}`, cta, destination: url, text: textContent, html: htmlContent };
}
