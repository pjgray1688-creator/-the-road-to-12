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
  let personalityLine = "";
  let heading = "";
  let accessSummary: Array<[string, string]> = [];
  let footerPersonality = "";

  switch (input.templateKey) {
    case "staff_invitation":
      {
        const role = text(p.role);
        const roleLabel = role === "owner" ? "Owner" : role === "gym_admin" ? "Manager" : role === "trainer" ? "PT / Coach" : role === "gym_staff" ? "Operational Staff" : "Staff";
        const venues = Array.isArray(p.venueNames) ? p.venueNames.filter((value): value is string => typeof value === "string" && value.length > 0) : [];
        const expiry = text(p.expiresAt);
        const expiryLabel = expiry ? new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "Europe/London" }).format(new Date(expiry)) : "30 days from issue";
        sender = "staff";
        subject = "Your R12 staff access is ready";
        personalityLine = `Welcome aboard, ${name}.`;
        heading = "Your staff access is ready.";
        const rows: Array<[string, string]> = [["Role", roleLabel]];
        if (venues.length) rows.push(["Venues", venues.join(" + ")]);
        if (p.coachEnabled === true || p.coachRequested === true || role === "trainer") rows.push(["Coach/PT", "Enabled"]);
        accessSummary = rows;
        body = `We’ve set you up on R12 for Madhouse Gym.\n\nUse ${text(p.email)} to sign in or create your R12 account, then activate your staff access.\n\nYour invite is valid until ${expiryLabel}.`;
        footerPersonality = "Everything’s ready when you are.";
        path = `/club/staff/claim?grant=${encodeURIComponent(text(p.grantId))}`;
        cta = "ACTIVATE STAFF ACCESS";
      }
      break;
    case "member_activation":
      subject = "Activate your R12 membership account";
      personalityLine = "Your gym just got an upgrade.";
      heading = "Your Madhouse membership is now on R12.";
      body = "You’re already a member — you’re not joining or paying again.\n\nActivate your R12 account to access your membership, training, progress, shop and everything else we’re rolling out.\n\nAlready use R12? Sign in. New to R12? Create an account with the same email address linked to your membership. Once you’re signed in, link your existing Madhouse membership.";
      footerPersonality = "Same gym. Much smarter.";
      path = "/member-hub/link";
      cta = "ACTIVATE MY R12 ACCOUNT";
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
  const textContent = `${testMode ? "TEST EMAIL — nothing will be changed.\n\n" : ""}${heading ? `${personalityLine}\n\n${heading}\n\n` : `${greeting}\n\n`}${accessSummary.length ? `YOUR ACCESS\n${accessSummary.map(([label, value]) => `${label}: ${value}`).join("\n")}\n\n` : ""}${body}\n\n${cta}: ${url}\n\n${footerPersonality ? `${footerPersonality}\n\n` : ""}R12 × MADHOUSE\nYour club. Your progress.`;
  const logoUrl = link("/club-branding/madhouse-club-wide.png");
  const contentHtml = heading
    ? `<p style="margin:0 0 14px;color:#6d28d9;font-size:15px;font-style:italic">${html(personalityLine)}</p><h1 style="margin:0 0 18px;color:#211a2b;font-size:25px;line-height:1.2">${html(heading)}</h1>${accessSummary.length ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 20px;border:1px solid #e9e2f1;border-radius:12px;background:#faf9fc"><tr><td colspan="2" style="padding:14px 16px 8px;color:#6d28d9;font-size:11px;font-weight:bold;letter-spacing:1.5px">YOUR ACCESS</td></tr>${accessSummary.map(([label, value]) => `<tr><td style="padding:7px 16px;color:#675e70;font-size:13px">${html(label)}</td><td align="right" style="padding:7px 16px;color:#211a2b;font-size:14px;font-weight:bold">${html(value)}</td></tr>`).join("")}<tr><td colspan="2" style="height:8px"></td></tr></table>` : ""}<p style="margin:0;color:#403849;font-size:15px;line-height:1.65;white-space:pre-line">${html(body)}</p>`
    : `<p style="margin:0 0 16px">${html(greeting)}</p><p style="margin:0;color:#403849;font-size:15px;line-height:1.65;white-space:pre-line">${html(body)}</p>`;
  const htmlContent = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0;background:#f2eff6;font-family:Arial,Helvetica,sans-serif;color:#211a2b"><tr><td align="center" style="padding:18px 10px"><table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e9e3ef;border-radius:14px;overflow:hidden"><tr><td align="center" style="padding:18px 22px 16px;background:#17131f;border-bottom:3px solid #8052d8"><img src="${html(logoUrl)}" width="220" alt="R12 × Madhouse Gym" style="display:block;width:220px;max-width:100%;height:auto;border:0"><div style="margin-top:10px;color:#ffffff;font-size:15px;font-weight:bold;letter-spacing:1px">R12 × MADHOUSE</div><div style="margin-top:4px;color:#d8c9f3;font-size:10px;font-weight:bold;letter-spacing:1.5px">MADHOUSE · ROTHERHAM · CARLTON</div></td></tr>${testMode ? `<tr><td style="padding:8px 22px;background:#f3effa;color:#5b4778;font-size:11px;font-weight:bold;letter-spacing:.3px">TEST EMAIL — nothing will be changed</td></tr>` : ""}<tr><td style="padding:24px 22px 10px">${contentHtml}<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:22px 0 0"><tr><td align="center" bgcolor="#6d28d9" style="border-radius:9px"><a href="${html(url)}" style="display:inline-block;min-height:48px;padding:15px 20px;box-sizing:border-box;color:#ffffff;font-size:13px;font-weight:bold;letter-spacing:.5px;text-decoration:none">${html(cta)}</a></td></tr></table><p style="margin:13px 0 0;color:#665d6e;font-size:12px;line-height:1.5">Button not opening? Copy this link into your browser:<br><a href="${html(url)}" style="color:#5c2bbd;word-break:break-all">${html(url)}</a></p></td></tr><tr><td style="padding:16px 22px;background:#f8f6fb;border-top:1px solid #eee9f3;color:#625a6c;font-size:12px;line-height:1.6"><div style="margin-bottom:7px;color:#6d28d9;font-style:italic">${html(footerPersonality || "")}</div><strong style="color:#211a2b">R12 × MADHOUSE</strong><br>Your club. Your progress.</td></tr></table></td></tr></table>`;
  const destinationType = input.templateKey === "staff_invitation" ? "Staff access activation page" : input.templateKey === "member_activation" ? "R12 membership account link page" : "R12 account page";
  return { sender, senderName: notificationConfig().fromNames[sender], senderAddress: senderAddress(sender), subject: `${testPrefix}${subject}`, cta, destination: url, destinationType, text: textContent, html: htmlContent };
}
