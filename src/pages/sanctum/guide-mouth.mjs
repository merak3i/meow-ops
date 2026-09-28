// Rhubarb's documented mouth classes mapped to the guide's Meta visemes.
// This mapping is an authored approximation and still needs visual speech QA.
export const GUIDE_MOUTH_SHAPES = Object.freeze({
  A: 'viseme_PP', B: 'viseme_kk', C: 'viseme_E', D: 'viseme_aa',
  E: 'viseme_O', F: 'viseme_U', G: 'viseme_FF', H: 'viseme_DD', X: 'viseme_sil',
});
const SILENT_MOUTH_WEIGHTS = Object.freeze({ viseme_sil: 1 });

export function validateMouthCues(data) {
  if (!Array.isArray(data?.mouthCues) || !data.mouthCues.length || data.mouthCues.length > 10_000) return null;
  let previous = 0;
  const cues = [];
  for (const cue of data.mouthCues) {
    if (!cue || typeof cue !== 'object' || !Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < previous
        || cue.end <= cue.start || cue.end > 600 || !Object.hasOwn(GUIDE_MOUTH_SHAPES, cue.value)) return null;
    cues.push({start: cue.start, end: cue.end, value: cue.value});
    previous = cue.end;
  }
  return cues;
}

export function mouthShapeAt(cues, seconds) {
  if (!Array.isArray(cues) || !Number.isFinite(seconds) || seconds < 0) return 'viseme_sil';
  let low = 0, high = cues.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const cue = cues[middle];
    if (seconds < cue.start) high = middle - 1;
    else if (seconds >= cue.end) low = middle + 1;
    else return GUIDE_MOUTH_SHAPES[cue.value] || 'viseme_sil';
  }
  return 'viseme_sil';
}

// A short, audio-clock-based blend avoids frame-rate-dependent mouth snapping.
// Callers pass validated cues; seeking produces the same pose as normal playback.
export function mouthWeightsAt(cues, seconds) {
  if (!Array.isArray(cues) || !Number.isFinite(seconds) || seconds < 0) return SILENT_MOUTH_WEIGHTS;
  let low = 0, high = cues.length - 1;
  while (low <= high) {
    const index = (low + high) >> 1;
    const cue = cues[index];
    if (seconds < cue.start) { high = index - 1; continue; }
    if (seconds >= cue.end) { low = index + 1; continue; }
    const current = GUIDE_MOUTH_SHAPES[cue.value];
    const previous = cues[index - 1], next = cues[index + 1];
    const width = Math.min(.04, (cue.end - cue.start) / 2);
    let from = current, to = current, progress = 1;
    if (seconds - cue.start < width) {
      from = previous?.end === cue.start ? GUIDE_MOUTH_SHAPES[previous.value] : 'viseme_sil';
      progress = (seconds - cue.start) / width;
    } else if (next?.start !== cue.end && cue.end - seconds < width) {
      to = 'viseme_sil';
      progress = 1 - (cue.end - seconds) / width;
    }
    const blend = progress * progress * (3 - 2 * progress);
    if (from === to) return { [current]: 1 };
    return { [from]: 1 - blend, [to]: blend };
  }
  return SILENT_MOUTH_WEIGHTS;
}
