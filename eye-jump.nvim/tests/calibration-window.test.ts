import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { calibrateWithProcess } from '../src/calibration-window';
import { TrackerCalibration, type CalibrationTracker, type DeviceCalibration } from '../src/tracker-calibration';
import type { DisplayInfo, Geometry } from '../src/shared/model';

const geometry = { widthMm: 390, heightMm: 250, bottomMm: 20, depthMm: -10 };
const display: DisplayInfo = { id: 'success', name: 'test', width: 1000, height: 800, scaleFactor: 1, x: 0, y: 0, rotation: 0 };
const script = fileURLToPath(new URL('./calibration-window-child.cjs', import.meta.url));

class FakeTracker implements CalibrationTracker {
  identity = 'tracker';
  points: number[] = [];
  pointsY: number[] = [];
  starts = 0;
  geometryCalls = 0;
  restored = false;
  async geometry(_value: Geometry): Promise<void> { this.geometryCalls++; }
  async calibrationStart(): Promise<void> { this.starts++; }
  async calibrationPoint(x: number, y: number): Promise<void> { this.points.push(x); this.pointsY.push(y); }
  async calibrationFinish(): Promise<Uint8Array> { return Uint8Array.of(9); }
  async disconnect(): Promise<void> {}
  async connect(): Promise<void> {}
  async restoreCalibration(): Promise<void> { this.restored = true; }
}

test('window protocol collects nine ordered points and saves once', { timeout: 10000 }, async () => {
  const tracker = new FakeTracker();
  let saved: DeviceCalibration | undefined;
  const controller = new TrackerCalibration(tracker, { trackerIdentity: 'tracker', geometry, blob: Uint8Array.of(1) },
    async value => { saved = value; });
  await calibrateWithProcess(controller, display, geometry, process.execPath, script);
  assert.deepEqual(tracker.points, [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]);
  assert.deepEqual(saved?.blob, Uint8Array.of(9));
  assert.equal(controller.ready, true);
});

test('fullscreen UI maps inset content points to display coordinates', { timeout: 10000 }, async () => {
  const tracker = new FakeTracker();
  const controller = new TrackerCalibration(tracker, { trackerIdentity: 'tracker', geometry, blob: Uint8Array.of(1) },
    async () => undefined);
  const mock = fileURLToPath(new URL('./mock-sdl-window.cjs', import.meta.url));
  let confirmed: DisplayInfo | undefined;
  await calibrateWithProcess(controller, display, geometry, process.execPath, mock, undefined, value => { confirmed = value; });
  assert.equal(confirmed?.scaleFactor, 2);
  assert.equal(confirmed?.id, display.id);
  assert.equal(tracker.points.length, 9);
  assert.ok(Math.abs(tracker.points[1]! - 0.10825) < 1e-10);
  assert.ok(Math.abs(tracker.pointsY[1]! - 0.1203125) < 1e-10);
  assert.ok(Math.abs(tracker.points[2]! - 0.89225) < 1e-10);
});

test('window cancellation restores previous calibration without saving', { timeout: 10000 }, async () => {
  const tracker = new FakeTracker();
  const controller = new TrackerCalibration(tracker, { trackerIdentity: 'tracker', geometry, blob: Uint8Array.of(1) },
    async () => assert.fail('cancel must not save'));
  await assert.rejects(calibrateWithProcess(controller, { ...display, id: 'cancel' }, geometry, process.execPath, script), /cancelled/);
  assert.equal(tracker.restored, true);
  assert.equal(controller.ready, true);
});

test('cancel before confirming the display never touches the tracker', { timeout: 10000 }, async () => {
  const tracker = new FakeTracker();
  const controller = new TrackerCalibration(tracker, { trackerIdentity: 'tracker', geometry, blob: Uint8Array.of(1) },
    async () => assert.fail('cancel must not save'));
  const mock = fileURLToPath(new URL('./mock-sdl-window.cjs', import.meta.url));
  await assert.rejects(calibrateWithProcess(controller, { ...display, id: 'cancel-before' }, geometry, process.execPath, mock), /cancelled/i);
  assert.equal(tracker.starts, 0);
  assert.equal(tracker.geometryCalls, 0);
  assert.equal(tracker.restored, false);
  assert.equal(controller.ready, true);
});

test('fullscreen window selects the requested monitor, not the first monitor', { timeout: 10000 }, async () => {
  const tracker = new FakeTracker();
  const controller = new TrackerCalibration(tracker, { trackerIdentity: 'tracker', geometry, blob: Uint8Array.of(1) },
    async () => undefined);
  const mock = fileURLToPath(new URL('./mock-sdl-window.cjs', import.meta.url));
  await calibrateWithProcess(controller, { ...display, id: 'multiple' }, geometry, process.execPath, mock);
  assert.equal(tracker.points.length, 9);
});

test('duplicate display bounds abort before tracker access', { timeout: 10000 }, async () => {
  const tracker = new FakeTracker();
  const controller = new TrackerCalibration(tracker, { trackerIdentity: 'tracker', geometry, blob: Uint8Array.of(1) },
    async () => assert.fail('must not save'));
  const mock = fileURLToPath(new URL('./mock-sdl-window.cjs', import.meta.url));
  await assert.rejects(calibrateWithProcess(controller, { ...display, id: 'duplicate' }, geometry, process.execPath, mock), /uniquely match/);
  assert.equal(tracker.geometryCalls, 0);
  assert.equal(tracker.starts, 0);
});
