"use client";

import type { Exercise } from "@/lib/types";
import { getExerciseGuide, type ExerciseGuideContent } from "@/lib/exercise-guides";
import { exerciseKnowledge } from "@/lib/exercise-library";

type Props = { exercise: Exercise; onClose: () => void; audience?: "member" | "coach" };

function MuscleRegions({ guide, audience }: { guide: ExerciseGuideContent; audience: "member" | "coach" }) {
  return <div className="exercise-guide-muscles">
    <div><span className="eyebrow">PRIMARY</span><div className="guide-muscle-list">{guide.primaryMuscles.map(region => <span className="guide-muscle primary" key={region}>{region.replaceAll("_", " ")}</span>)}</div></div>
    <div><span className="eyebrow">SECONDARY</span><div className="guide-muscle-list">{guide.secondaryMuscles.map(region => <span className="guide-muscle secondary" key={region}>{region.replaceAll("_", " ")}</span>)}</div></div>
    {audience === "coach" && guide.stabilisers?.length ? <div><span className="eyebrow">STABILISERS</span><div className="guide-muscle-list">{guide.stabilisers.map(region => <span className="guide-muscle stabiliser" key={region}>{region.replaceAll("_", " ")}</span>)}</div></div> : null}
  </div>;
}

export function ExerciseGuideSheet({ exercise, onClose, audience = "member" }: Props) {
  const guide = getExerciseGuide(exercise.id);
  const knowledge = exerciseKnowledge(exercise.id);
  if (!guide) return null;
  const videoUrl = guide.video?.mp4 ?? guide.video?.webm;
  return <div className="modal exercise-guide-modal" role="dialog" aria-modal="true" aria-label={`${exercise.name} exercise guide`}>
    <section className="exercise-guide" aria-labelledby="exercise-guide-title">
      <div className="sheet-heading"><div><span className="eyebrow">EXERCISE GUIDE</span><h2 id="exercise-guide-title">{knowledge?.name ?? exercise.name}</h2></div><button className="tertiary-button" type="button" onClick={onClose}>Close</button></div>
      {guide.mediaStatus === "video" && videoUrl ? <video className="exercise-guide-media" controls muted playsInline preload="none" poster={guide.video?.poster ?? guide.poster}><source src={videoUrl} /></video> : guide.mediaStatus === "static" && guide.poster ? <img className="exercise-guide-media" src={guide.poster} alt="" loading="lazy" /> : <div className="exercise-guide-written-media" aria-label="Written exercise guide">WRITTEN GUIDE</div>}
      <div className="exercise-guide-meta"><span>{guide.equipment.join(" · ")}</span>{guide.cameraView ? <span>{guide.cameraView} view</span> : null}{guide.reviewStatus === "manual_review" ? <span>Guide under review</span> : null}</div>
      <MuscleRegions guide={guide} audience={audience} />
      {guide.setupCue ? <div className="guide-section"><span className="eyebrow">SET UP</span><p>{guide.setupCue}</p></div> : null}
      {guide.movementDescription ? <div className="guide-section"><span className="eyebrow">HOW IT MOVES</span><p>{guide.movementDescription}</p></div> : null}
      <div className="guide-section"><span className="eyebrow">KEY CUES</span><ul>{guide.formCues.map(cue => <li key={cue}>{cue}</li>)}</ul></div>
      {guide.commonMistakes.length ? <div className="guide-section"><span className="eyebrow">WATCH FOR</span><ul>{guide.commonMistakes.map(mistake => <li key={mistake}>{mistake}</li>)}</ul></div> : null}
    </section>
  </div>;
}
