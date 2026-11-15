import { createRequire } from 'node:module';
import { calibrateWithWindow } from '../src/calibration-window';
import { TrackerCalibration, type CalibrationTracker } from '../src/tracker-calibration';
import type { Geometry } from '../src/shared/model';

const require = createRequire(import.meta.url);
let sdl: { video: { displays: Array<{ geometry: { x: number; y: number; width: number; height: number } }> } };
try { sdl = require('@kmamal/sdl') as typeof sdl; }
catch { throw new Error('SDL native binding is missing. Run pnpm setup:sdl first.'); }

const number = process.argv[2] === undefined ? 1 : Number(process.argv[2]);
if (!Number.isInteger(number) || number < 1 || !sdl.video.displays[number - 1]) {
  throw new Error(`Choose a display number from 1 to ${sdl.video.displays.length}.`);
}
const bounds = sdl.video.displays[number - 1]!.geometry;
const geometry: Geometry = { widthMm: 390, heightMm: 250, bottomMm: 20, depthMm: 0 };
const tracker: CalibrationTracker = {
  identity: 'preview', geometry: async () => undefined, calibrationStart: async () => undefined,
  calibrationPoint: async (x, y) => { console.log(`Preview target: ${x.toFixed(4)}, ${y.toFixed(4)}`); },
  calibrationFinish: async () => Uint8Array.of(1), disconnect: async () => undefined,
  connect: async () => undefined, restoreCalibration: async () => undefined,
};
const controller = new TrackerCalibration(tracker, { trackerIdentity: 'preview', geometry, blob: Uint8Array.of(1) }, async () => undefined);
console.log('Preview only: no tracker or calibration profile is touched.');
console.log(`Opening display ${number}: ${bounds.width}×${bounds.height} at ${bounds.x},${bounds.y}.`);
console.log('Press Space to start, then look at each dot and press Space; Escape cancels.');
try {
  await calibrateWithWindow(controller, { id: 'preview', name: 'preview', ...bounds, scaleFactor: 1, rotation: 0 }, geometry);
  console.log('Fullscreen preview completed.');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
