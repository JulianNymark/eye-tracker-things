import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TrackerCalibration, type CalibrationTracker, type DeviceCalibration } from '../src/tracker-calibration';
import type { Geometry } from '../src/shared/model';

const oldGeometry = { widthMm: 390, heightMm: 250, bottomMm: 20, depthMm: -10 };
const newGeometry = { widthMm: 400, heightMm: 250, bottomMm: 15, depthMm: 0 };

class FakeTracker implements CalibrationTracker {
  identity: string | null = 'tracker';
  calls: string[] = [];
  failPoint = false;
  failReconnect = false;
  async geometry(value: Geometry): Promise<void> { this.calls.push(`geometry:${value.widthMm}`); }
  async calibrationStart(points: 5 | 9): Promise<void> { this.calls.push(`start:${points}`); }
  async calibrationPoint(x: number, y: number): Promise<void> {
    this.calls.push(`point:${x}:${y}`);
    if (this.failPoint) throw new Error('point failed');
  }
  async calibrationFinish(): Promise<Uint8Array> { this.calls.push('finish'); return Uint8Array.of(9); }
  async disconnect(): Promise<void> { this.calls.push('disconnect'); }
  async connect(): Promise<void> { this.calls.push('connect'); if (this.failReconnect) throw new Error('reconnect failed'); }
  async restoreCalibration(blob: Uint8Array): Promise<void> { this.calls.push(`restore:${blob[0]}`); }
}

const previous: DeviceCalibration = { trackerIdentity: 'tracker', geometry: oldGeometry, blob: Uint8Array.of(1) };

test('first calibration works without a recovery profile', async () => {
  const tracker = new FakeTracker();
  let saved: DeviceCalibration | undefined;
  const calibration = new TrackerCalibration(tracker, null, async value => { saved = value; });
  await calibration.start('owner', newGeometry);
  for (let i = 0; i < 9; i++) await calibration.point('owner', i / 10, 0.5);
  await calibration.finish('owner');
  assert.equal(saved?.trackerIdentity, 'tracker');
  assert.deepEqual(saved?.blob, Uint8Array.of(9));
  assert.equal(calibration.ready, true);
});

test('cancel first calibration reconnects without restoring and can retry', async () => {
  const tracker = new FakeTracker();
  const calibration = new TrackerCalibration(tracker, null, async () => assert.fail('no save'));
  await calibration.start('owner', newGeometry);
  await calibration.cancel('owner');
  assert.deepEqual(tracker.calls.slice(-2), ['disconnect', 'connect']);
  assert.equal(calibration.ready, true);
  await calibration.start('owner', newGeometry);
  await calibration.cancel('owner');
});

test('first calibration rejects an unidentified or changed tracker', async () => {
  const tracker = new FakeTracker();
  const calibration = new TrackerCalibration(tracker, null, async () => assert.fail('no save'));
  tracker.identity = null;
  await assert.rejects(calibration.start('owner', newGeometry), /identified tracker/);
  tracker.identity = 'tracker';
  await calibration.start('owner', newGeometry);
  tracker.identity = 'different tracker';
  await assert.rejects(calibration.cancel('owner'), /tracker changed/);
  assert.equal(calibration.ready, false);
});

test('success persists a complete independent calibration', async () => {
  const tracker = new FakeTracker();
  let saved: DeviceCalibration | undefined;
  const calibration = new TrackerCalibration(tracker, previous, async value => { saved = value; });
  await calibration.start('owner', newGeometry);
  await assert.rejects(calibration.finish('owner'), /nine/);
  for (let i = 0; i < 9; i++) await calibration.point('owner', i / 10, 0.5);
  await calibration.finish('owner');
  assert.equal(calibration.ready, true);
  assert.equal(saved?.geometry.widthMm, 400);
  assert.deepEqual(saved?.blob, Uint8Array.of(9));
  assert.equal(tracker.calls.includes('disconnect'), false);
});

test('cancel restores the last calibration and rejects competing clients', async () => {
  const tracker = new FakeTracker();
  const calibration = new TrackerCalibration(tracker, previous, async () => assert.fail('no save'));
  await calibration.start('owner', newGeometry);
  await assert.rejects(calibration.point('other', 0.5, 0.5), /matching/);
  await assert.rejects(calibration.point('owner', 1.1, 0.5), /display/);
  await calibration.cancel('owner');
  assert.equal(calibration.ready, true);
  assert.deepEqual(tracker.calls.slice(-4), ['disconnect', 'connect', 'geometry:390', 'restore:1']);
});

test('device errors and save failures restore the previous calibration', async () => {
  const tracker = new FakeTracker();
  const calibration = new TrackerCalibration(tracker, previous, async () => { throw new Error('save failed'); });
  await calibration.start('owner', newGeometry);
  tracker.failPoint = true;
  await assert.rejects(calibration.point('owner', 0.5, 0.5), /point failed/);
  assert.equal(calibration.ready, true);
  assert.equal(tracker.calls.at(-1), 'restore:1');
  tracker.failPoint = false;
  await calibration.start('owner', newGeometry);
  for (let i = 0; i < 9; i++) await calibration.point('owner', 0.5, 0.5);
  await assert.rejects(calibration.finish('owner'), /save failed/);
  assert.equal(tracker.calls.at(-1), 'restore:1');
});

test('failed recovery leaves the tracker unavailable', async () => {
  const tracker = new FakeTracker();
  const calibration = new TrackerCalibration(tracker, previous, async () => undefined);
  await calibration.start('owner', newGeometry);
  tracker.failReconnect = true;
  await assert.rejects(calibration.cancel('owner'), /reconnect failed/);
  assert.equal(calibration.ready, false);
  await assert.rejects(calibration.start('owner', newGeometry), /unavailable/);
});

test('cancellation during fitting restores the previous calibration', async () => {
  const tracker = new FakeTracker();
  let finishFit: (() => void) | undefined;
  tracker.calibrationFinish = async () => {
    await new Promise<void>(resolve => { finishFit = resolve; });
    return Uint8Array.of(9);
  };
  const calibration = new TrackerCalibration(tracker, previous, async () => assert.fail('cancel must not save'));
  await calibration.start('owner', newGeometry);
  for (let i = 0; i < 9; i++) await calibration.point('owner', 0.5, 0.5);
  let cancelled = false;
  const result = calibration.finish('owner', () => cancelled);
  await new Promise<void>(resolve => setImmediate(resolve));
  cancelled = true;
  assert.ok(finishFit);
  finishFit();
  await assert.rejects(result, /cancelled/);
  assert.equal(tracker.calls.at(-1), 'restore:1');
  assert.equal(calibration.ready, true);
});

test('recovery refuses to apply a calibration to a different tracker', async () => {
  const tracker = new FakeTracker();
  const calibration = new TrackerCalibration(tracker, previous, async () => undefined);
  await calibration.start('owner', newGeometry);
  tracker.identity = 'different tracker';
  await assert.rejects(calibration.cancel('owner'), /tracker changed/);
  assert.equal(tracker.calls.some(call => call.startsWith('restore:')), false);
  assert.equal(calibration.ready, false);
});
