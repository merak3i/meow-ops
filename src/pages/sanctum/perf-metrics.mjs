export function summarizeFrameDeltas(deltasSeconds) {
  const frameTimesMs = deltasSeconds
    .filter(delta => Number.isFinite(delta) && delta > 0)
    .map(delta => delta * 1000);
  if (frameTimesMs.length === 0) return { fps: 0, p95Ms: 0 };

  const averageFrameTimeMs = frameTimesMs.reduce((sum, value) => sum + value, 0) / frameTimesMs.length;
  const sortedFrameTimesMs = [...frameTimesMs].sort((a, b) => a - b);
  const p95Index = Math.ceil(sortedFrameTimesMs.length * 0.95) - 1;
  const p95FrameTimeMs = sortedFrameTimesMs[Math.min(p95Index, sortedFrameTimesMs.length - 1)] ?? 0;

  return {
    fps: Math.round(1000 / averageFrameTimeMs),
    p95Ms: Math.round(p95FrameTimeMs * 10) / 10,
  };
}
