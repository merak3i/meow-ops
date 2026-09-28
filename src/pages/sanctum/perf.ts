// Perf infrastructure for the Scrying Sanctum.
//
//   PerfContext / usePerfLevel — three-tier perf preset that env components
//                                read to decide whether to render expensive
//                                particles, weather, fog, etc.
//   PerfReader                  — measures per-frame stats inside the Canvas
//                                and writes them into a shared ref (read by
//                                the perf HUD overlay outside the Canvas).
//   WebGLContextWatcher         — listens for webglcontextlost/restored,
//                                preventDefaults the loss, and surfaces the
//                                event so the page can show a warning chip.
//   SceneErrorBoundary          — wraps the 3D Scene; on render error returns
//                                null so the Canvas stays alive instead of
//                                black-screening the page.
//
// All four were defined inline in ScryingSanctum.tsx; pulling them here lets
// the environment / champion / Sun / Archive Warden modules import what they need
// without dragging the 5500-line page file in.

import { Component, createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { summarizeFrameDeltas } from './perf-metrics.mjs';
import type { PerfLevel, PerfStats } from './types';

// ─── Perf context ────────────────────────────────────────────────────────────

export const PerfContext = createContext<PerfLevel>('normal');

export function usePerfLevel(): PerfLevel {
  return useContext(PerfContext);
}

// ─── Scene error boundary ────────────────────────────────────────────────────

export class SceneErrorBoundary extends Component<
  { children: ReactNode; onError: (err: Error) => void },
  { hasError: boolean }
> {
  override state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  override componentDidCatch(err: Error) { this.props.onError(err); }
  override render() {
    if (this.state.hasError) return null; // Scene crashed → keep Canvas alive, show DOM warning
    return this.props.children;
  }
}

// ─── PerfReader (in-Canvas FPS/MS/draws sampler) ─────────────────────────────

export function PerfReader({ statsRef }: { statsRef: React.MutableRefObject<PerfStats> }) {
  const { gl } = useThree();
  const frameDeltas = useRef<number[]>(Array(120).fill(0));
  const nextFrameDelta = useRef(0);
  const sampleCount = useRef(0);
  const framesSinceSummary = useRef(0);

  useFrame((_, delta) => {
    if (!Number.isFinite(delta) || delta <= 0) return;
    frameDeltas.current[nextFrameDelta.current] = delta;
    nextFrameDelta.current = (nextFrameDelta.current + 1) % frameDeltas.current.length;
    sampleCount.current = Math.min(sampleCount.current + 1, frameDeltas.current.length);
    framesSinceSummary.current += 1;
    if (framesSinceSummary.current < 30) return;
    framesSinceSummary.current = 0;
    const { fps, p95Ms } = summarizeFrameDeltas(frameDeltas.current.slice(0, sampleCount.current));
    statsRef.current = {
      fps,
      p95Ms,
      calls:      gl.info.render.calls,
      triangles:  gl.info.render.triangles,
      geometries: gl.info.memory.geometries,
    };
  });

  return null;
}

// ─── WebGL context watcher ───────────────────────────────────────────────────
//
// Listens for WebGL context loss, prevents the browser default (which
// permanently kills the renderer), and notifies the outer component so it
// can surface a warning badge.

export function WebGLContextWatcher({ onContextLost, onContextRestored }: {
  onContextLost: () => void;
  onContextRestored: () => void;
}) {
  const { gl } = useThree();
  useEffect(() => {
    const canvas = gl.domElement;
    const handleLost = (e: Event) => { e.preventDefault(); onContextLost(); };
    canvas.addEventListener('webglcontextlost', handleLost);
    canvas.addEventListener('webglcontextrestored', onContextRestored);
    return () => {
      canvas.removeEventListener('webglcontextlost', handleLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
    };
  }, [gl, onContextLost, onContextRestored]);
  return null;
}
