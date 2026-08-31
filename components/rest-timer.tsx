"use client";
import { useEffect, useRef, useState } from "react";

type AlertMode = "silent" | "beep" | "countdown";
function beep() { try { const context = new AudioContext(); const oscillator = context.createOscillator(); const gain = context.createGain(); oscillator.frequency.value = 880; gain.gain.value = 0.04; oscillator.connect(gain).connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + 0.08); } catch { /* Mobile browsers may block audio until a gesture. */ } }
export function RestTimer({ seconds, onSkip }: { seconds: number; onSkip: () => void }) {
  const [remaining, setRemaining] = useState(seconds); const [running, setRunning] = useState(true); const [mode, setMode] = useState<AlertMode>(() => { if (typeof window === "undefined") return "beep"; const saved = localStorage.getItem("road-to-12-rest-alert"); return saved === "silent" || saved === "beep" || saved === "countdown" ? saved : "beep"; }); const announced = useRef(false); const countdown = useRef(4);
  useEffect(() => { if (!running || remaining <= 0) return; const id = window.setInterval(() => setRemaining(n => { if (n <= 1) { if (!announced.current && mode !== "silent") beep(); announced.current = true; return 0; } if (mode === "countdown" && n <= 3 && n < countdown.current) { beep(); countdown.current = n; } return n - 1; }), 1000); return () => clearInterval(id); }, [running, remaining, mode]);
  const min = Math.floor(remaining / 60); const sec = String(remaining % 60).padStart(2, "0");
  const setAlert = (value: AlertMode) => { setMode(value); localStorage.setItem("road-to-12-rest-alert", value); };
  return <section className="timer" aria-live="polite"><div><span className="eyebrow">REST {remaining === 0 ? "COMPLETE" : "TIMER"}</span><strong>{min}:{sec}</strong></div><div className="timer-actions"><button className="secondary" onClick={() => setRemaining(r => r + 30)}>+30 sec</button><button className="secondary" onClick={() => setRunning(r => !r)}>{running ? "Pause" : "Resume"}</button><button className="danger" onClick={onSkip}>Skip</button><select aria-label="Rest alert" value={mode} onChange={event => setAlert(event.target.value as AlertMode)}><option value="silent">Silent</option><option value="beep">Beep</option><option value="countdown">Countdown + beep</option></select></div></section>;
}
