"use client";
import { useMemo, useState } from "react";
import { defaultTrainingProfile, type TrainingProfile } from "@/lib/training-profile";
import { generateTrainingProgramme, type GeneratedProgramme } from "@/lib/programme-generator";
import { saveTrainingProfile } from "@/lib/storage";
import { useRouter } from "next/navigation";

const questions = [
  ["goal", "What are you training for?", [["fat_loss", "Fat loss / body composition"], ["muscle_gain", "Build muscle"], ["strength", "Build strength"], ["general_fitness", "General fitness"]]],
  ["experience", "How much training experience do you have?", [["beginner", "I’m new to structured training"], ["intermediate", "I’ve trained before"], ["experienced", "I’m experienced"]]],
  ["daysPerWeek", "How many days can you train?", [[2, "2 days"], [3, "3 days"], [4, "4 days"], [5, "5 days"], [6, "6 days"]]],
  ["sessionMinutes", "How long do you usually have?", [[45, "About 45 minutes"], [60, "About 60 minutes"], [75, "About 75 minutes"], [90, "75–90 minutes"]]],
  ["environment", "Where will you train?", [["full_gym", "Full gym"], ["limited_gym", "Limited gym"], ["home_basic", "Home / basic equipment"], ["bodyweight", "Bodyweight / minimal equipment"]]],
  ["includeCardio", "Include a little conditioning?", [[true, "Yes, keep it manageable"], [false, "Not for now"]]]
] as const;

export default function OnboardingPage() {
  const router = useRouter(); const [step, setStep] = useState(0); const [profile, setProfile] = useState<TrainingProfile>(defaultTrainingProfile); const [programme, setProgramme] = useState<GeneratedProgramme>();
  const question = questions[step]; const choose = (value: string | number | boolean) => { const key = question[0] as keyof TrainingProfile; setProfile(current => ({ ...current, [key]: value })); if (step < questions.length - 1) setStep(step + 1); else setProgramme(generateTrainingProgramme({ ...profile, [key]: value } as TrainingProfile)); };
  const currentProgramme = useMemo(() => programme ?? generateTrainingProgramme(profile), [programme, profile]);
  if (programme) return <main className="shell module-page"><p className="eyebrow">YOUR STARTING PROGRAMME</p><h1>{programme.name}</h1><p>{programme.rationale}</p><section className="card">{programme.week.map(day => <div className="plan-row" key={day.id}><b>{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][day.day - 1]}</b><span>{day.name}<small>{day.exerciseIds.map(id => currentProgramme.week.flatMap(item => item.exerciseIds).includes(id) ? id.replaceAll("-", " ") : id).join(" · ")}</small></span></div>)}</section><button className="primary big" onClick={async () => { saveTrainingProfile(profile, programme); await fetch("/api/training-profile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ trainingProfile: profile, generatedProgramme: programme }) }); router.push("/"); }}>Start programme <span>→</span></button><button className="secondary full" onClick={() => { setProgramme(undefined); setStep(0); }}>Change answers</button></main>;
  return <main className="shell module-page"><p className="eyebrow">THE ROAD TO 12% · {step + 1} OF {questions.length}</p><h1>{question[1]}</h1><div className="empty-grid">{question[2].map(([value, label]) => <button className="secondary" key={String(value)} onClick={() => choose(value)}>{label}</button>)}</div><button className="text-button" disabled={step === 0} onClick={() => setStep(step - 1)}>‹ Back</button></main>;
}
