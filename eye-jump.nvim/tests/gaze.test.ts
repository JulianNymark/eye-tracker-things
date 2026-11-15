import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GazePair } from '../src/main/gaze-pair';
import { normalizedPoint, type TrackedGazeSample } from '../src/shared/gaze';

const sample: TrackedGazeSample = {
  validity_L: 0,
  validity_R: 0,
  gaze_point_2d_norm: { x: 0.2, y: 0.3 },
  gaze_point_2d_unfiltered: { x: 0.7, y: 0.8 },
};

test('unfiltered gaze uses the matching raw validity column, not the smoothed point', () => {
  let paired: TrackedGazeSample | undefined;
  const pair = new GazePair(value => { paired = value; });
  pair.gaze(sample);
  pair.columns([{ colId: 0x21, kind: 'u32', v0: 1, v1: 0, v2: 0 }]);
  assert.ok(paired);
  assert.deepEqual(normalizedPoint(paired, false), { x: 0.7, y: 0.8 });
});

test('missing, invalid, and off-display raw gaze never falls back to filtered gaze', () => {
  assert.equal(normalizedPoint(sample, false), null);
  assert.equal(normalizedPoint({ ...sample, gaze_2d_unfiltered_valid: false }, false), null);
  assert.equal(normalizedPoint({ ...sample, gaze_2d_unfiltered_valid: true,
    gaze_point_2d_unfiltered: { x: 1.01, y: 0.8 } }, false), null);
  assert.equal(normalizedPoint({ ...sample, gaze_2d_unfiltered_valid: true,
    validity_L: 4, validity_R: 4 }, false), null);
});
