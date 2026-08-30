"use client";
import { useEffect, useState } from "react";

export function RestTimer({ seconds, onSkip }: { seconds: number; onSkip: () => void }) {
  const [remaining, setRemaining] = useState(seconds); const [running, setRunning] = useState(true);
  useEffect(() => { if (!running || remaining <= 0) return; const id = window.setInterval(() => setRemaining(n => { if (n <= 1) { navigator.vibrate?.([180, 100, 180]); return 0; } return n - 1; }), 1000); return () => clearInterval(id); }, [running, remaining]);
  const min = Math.floor(remaining / 60); const sec = String(remaining % 60).padStart(2, "0");
  return <section className="timer" aria-live="polite"><div><span className="eyebrow">REST {remaining === 0 ? "COMPLETE" : "TIMER"}</span><strong>{min}:{sec}</strong></div><div className="timer-actions"><button className="secondary" onClick={() => setRemaining(r => r + 30)}>+30 sec</button><button className="secondary" onClick={() => setRunning(r => !r)}>{running ? "Pause" : "Resume"}</button><button className="danger" onClick={onSkip}>Skip</button></div></section>;
}
