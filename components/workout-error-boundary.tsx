"use client";
import { Component, type ErrorInfo, type ReactNode } from "react";
import type { Workout } from "@/lib/types";
import { brand } from "@/lib/brand";

type Props = { children: ReactNode; workout?: Workout; exerciseId?: string; exerciseName?: string; exerciseIndex?: number; phase?: string; onHome?: (workout?: Workout) => void };
type State = { error: Error | null; componentStack?: string };

export class WorkoutErrorBoundary extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("Workout screen error", error, info.componentStack); this.setState({ componentStack: info.componentStack ?? undefined }); }
  render() {
    if (!this.state.error) return this.props.children;
    const error = this.state.error;
    return <main className="shell" role="alert"><header><span className="brand-mark">{brand.name}</span><div><p className="eyebrow">WORKOUT SCREEN ERROR</p><h1>Workout screen error</h1></div></header><section className="card"><p><b>{error.name}</b>: {error.message || "Unexpected rendering failure"}</p><p>Phase: {this.props.phase ?? "active"}</p>{this.props.workout?.id && <p>Workout: {this.props.workout.id.slice(0, 8)}</p>}{this.props.exerciseId && <p>Exercise: {this.props.exerciseName ?? this.props.exerciseId} · {this.props.exerciseIndex ?? 0}</p>}<details><summary>Technical details</summary><pre>{this.state.componentStack ?? "No component stack available"}</pre></details></section><button className="primary big" onClick={() => this.props.onHome?.(this.props.workout)}>⌂ Home</button></main>;
  }
}
