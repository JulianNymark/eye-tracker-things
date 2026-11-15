import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { calibrateWithWindow } from '../src/calibration-window';
import { TrackerCalibration, type CalibrationTracker } from '../src/tracker-calibration';

test('real SDL dummy driver renders all nine targets', { skip: process.env.GAZE_TEST_SDL !== '1', timeout: 15000 }, async () => {
  const oldDriver = process.env.SDL_VIDEODRIVER;
  const oldOptions = process.env.NODE_OPTIONS;
  process.env.SDL_VIDEODRIVER = 'dummy';
  process.env.NODE_OPTIONS = `--require=${JSON.stringify(fileURLToPath(new URL('./sdl-dummy-preload.cjs', import.meta.url)))}`;
  const geometry = { widthMm: 390, heightMm: 250, bottomMm: 20, depthMm: -10 };
  const points: Array<{ x: number; y: number }> = [];
  const tracker: CalibrationTracker = {
    identity: 'test', geometry: async () => undefined, calibrationStart: async () => undefined,
    calibrationPoint: async (x, y) => { points.push({ x, y }); },
    calibrationFinish: async () => Uint8Array.of(9), disconnect: async () => undefined,
    connect: async () => undefined, restoreCalibration: async () => undefined,
  };
  const controller = new TrackerCalibration(tracker, { trackerIdentity: 'test', geometry, blob: Uint8Array.of(1) }, async () => undefined);
  try {
    let confirmedScale: number | undefined;
    await calibrateWithWindow(controller, { id: 'test', name: 'test', width: 1024, height: 768,
      x: 0, y: 0, scaleFactor: 1, rotation: 0 }, geometry, undefined, display => { confirmedScale = display.scaleFactor; });
    assert.equal(points.length, 9);
    assert.equal(confirmedScale, 1);
  } finally {
    if (oldDriver === undefined) delete process.env.SDL_VIDEODRIVER;
    else process.env.SDL_VIDEODRIVER = oldDriver;
    if (oldOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = oldOptions;
  }
});
