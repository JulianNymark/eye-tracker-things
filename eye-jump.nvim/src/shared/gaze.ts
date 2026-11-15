import type { GazeSample } from '../../vendor/tobiifree/src/protocol';
import type { GazeRecord, Point } from './model';

/** The SDK's curated sample omits the separate unfiltered validity column. */
export type TrackedGazeSample = GazeSample & { gaze_2d_unfiltered_valid?: boolean };

export function normalizedPoint(sample: TrackedGazeSample, smooth = true): Point | null {
  if (!smooth && sample.gaze_2d_unfiltered_valid !== true) return null;
  const p = smooth ? sample.gaze_point_2d_norm : sample.gaze_point_2d_unfiltered;
  if (sample.validity_L !== 0 && sample.validity_R !== 0) return null;
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  // Do not turn off-screen gaze into a false fixation at a screen edge.
  if (p.x < 0 || p.y < 0 || p.x > 1 || p.y > 1) return null;
  return { x: p.x, y: p.y };
}

/** Rebuild the replay view without modifying the recorded filtered point or raw data. */
export function replaySamples(samples: GazeRecord[], smooth: boolean): GazeRecord[] {
  if (smooth) return samples;
  return samples.map(sample => ({ ...sample, point: sample.raw && typeof sample.raw === 'object' ? normalizedPoint(sample.raw, false) : null }));
}

/** Last sample at/before frame time. Never bridge a blink or a long gap. */
export function gazeAt(samples: readonly GazeRecord[], tMs: number, maxAgeMs = 120): GazeRecord | null {
  let lo = 0;
  let hi = samples.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (samples[mid]!.tMs <= tMs) lo = mid + 1;
    else hi = mid;
  }
  const sample = samples[lo - 1];
  return sample && sample.point && tMs - sample.tMs <= maxAgeMs ? sample : null;
}

export const CALIBRATION_POINTS: readonly Point[] = [
  { x: 0.5, y: 0.5 }, { x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 },
  { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 },
];

/** Nine locations span the same area as the five-point pattern. */
export const CALIBRATION_POINTS_NINE: readonly Point[] = [
  ...CALIBRATION_POINTS,
  { x: 0.5, y: 0.1 }, { x: 0.9, y: 0.5 },
  { x: 0.5, y: 0.9 }, { x: 0.1, y: 0.5 },
];
