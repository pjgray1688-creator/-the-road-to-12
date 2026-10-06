export const MEMBER_TUTORIAL_VERSION = 1;
export const MADHOUSE_TUTORIAL_VERSION = 1;
export const COACH_TUTORIAL_VERSION = 1;

export type TutorialKey = "member_core" | "madhouse_connected" | "coach_core";
export type TutorialStep = { eyebrow: string; title: string; body: string };

export const memberTutorialSteps: TutorialStep[] = [
  { eyebrow: "WELCOME", title: "Welcome to R12", body: "R12 keeps today’s training, recovery and progress together. You can skip this tour and replay it from Account at any time." },
  { eyebrow: "TODAY", title: "Start with Today", body: "Today shows the session that belongs on this date, anything already in progress, and the clearest next action." },
  { eyebrow: "TRAINING", title: "Open and start a workout", body: "Training holds your programme. Open today’s session, review the plan, then start each exercise when you are ready." },
  { eyebrow: "LOGGING", title: "Log what you actually do", body: "Enter the load and reps after each set. R12 saves preparation and working sets separately so your history stays meaningful." },
  { eyebrow: "PREPARATION", title: "Warm-up, ramp, then work", body: "Warm-up and ramp sets prepare you and help find today’s load. Working sets are the prescribed sets that count toward programme progress." },
  { eyebrow: "EFFORT", title: "RIR means reps in reserve", body: "RIR 3 = about 3 clean reps left. RIR 2 = about 2 left. RIR 1 = about 1 left. RIR 0 = no clean reps left." },
  { eyebrow: "SESSION TOOLS", title: "Rest, adapt and finish", body: "Use the rest timer, choose a suitable substitution when equipment or pain gets in the way, and finish the session so it reaches your history." },
  { eyebrow: "PROGRESS", title: "Review progress and history", body: "Progress shows logged measurements and trends. History keeps completed sessions and the work you recorded." },
  { eyebrow: "RECOVERY", title: "Recovery stays honest", body: "When recovery data is available, R12 uses it to guide demand. Missing wearable data is shown as missing rather than guessed." },
];

export const madhouseTutorialSteps: TutorialStep[] = [
  { eyebrow: "MADHOUSE CONNECTED", title: "Your gym is now in R12", body: "Open My Gym to see your Madhouse membership, induction and access status without changing your training account." },
  { eyebrow: "AT THE GYM", title: "Shop, classes and membership", body: "Your available Madhouse shop, classes, orders and balance live in My Gym. Staff and Coach access remain separate." },
  { eyebrow: "ACCESS", title: "Membership rules still apply", body: "R12 shows access eligibility, but induction, paid-through dates and Madhouse access policy remain authoritative." },
];

export const coachTutorialSteps: TutorialStep[] = [
  { eyebrow: "R12 COACH", title: "Coach the assigned work", body: "R12 Coach shows only organisations and clients covered by your explicit Coach permission and assignment." },
  { eyebrow: "CLIENTS", title: "Find an authorised client", body: "Assigned clients appear in the client list. New client links are prepared through the existing authorised Club and Coach assignment workflow—not by searching every R12 user." },
  { eyebrow: "RELATIONSHIPS", title: "Primary PT and cover PT", body: "The primary PT owns the programme. A cover PT can read it and record what happens in an authorised session without taking ownership." },
  { eyebrow: "CLIENT PROFILE", title: "Open the client", body: "Choose a client to load their programme, completed workout history and Coach session records." },
  { eyebrow: "PROGRAMME", title: "Use the real programme workflow", body: "The client’s active R12 programme is shown read-only here. Programme creation and assignment remain with the existing member/primary-PT workflow; Coach does not invent an upload path." },
  { eyebrow: "RUN A SESSION", title: "Open a programmed session", body: "Choose Run this session from the client programme. The new log is tied to that client, assignment and programmed session." },
  { eyebrow: "LOGGING", title: "Record the session", body: "Log load, reps and RIR for the work delivered, then save in progress or complete the session." },
  { eyebrow: "REVIEW", title: "Review member-completed work", body: "Client history shows completed R12 workouts so coaching decisions can use real recorded work." },
  { eyebrow: "SESSION NOTES", title: "Record adaptations", body: "Notes, substitutions and adaptations describe today’s session. They do not silently rewrite the permanent programme." },
  { eyebrow: "COVER BOUNDARY", title: "Cover changes stay session-scoped", body: "A cover PT may log today’s substitutions and adaptations. Programme ownership and permanent changes remain with the primary PT." },
];

export function tutorialVersion(key: TutorialKey) {
  if (key === "member_core") return MEMBER_TUTORIAL_VERSION;
  if (key === "madhouse_connected") return MADHOUSE_TUTORIAL_VERSION;
  return COACH_TUTORIAL_VERSION;
}
