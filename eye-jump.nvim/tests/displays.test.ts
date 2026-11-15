import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeDisplay, listDisplays, matchingDisplay, parseDisplays } from '../src/displays';
import { promptCalibration } from '../src/calibration-prompt';
import { CalibrationProfiles } from '../src/main/calibration-profile';
import { calibrateWithProcess } from '../src/calibration-window';
import { TrackerCalibration, type CalibrationTracker } from '../src/tracker-calibration';
import type { DisplayInfo } from '../src/shared/model';

const input = [
  { name: '0', geometry: { x: 0, y: 0, width: 2560, height: 1440 }, orientation: null },
  { name: '1', geometry: { x: 300, y: -1200, width: 1920, height: 1200 }, orientation: 'landscape' },
];
const displays = parseDisplays(input);
const saved: DisplayInfo = { id: 'old-monitor', name: 'Built-in', ...input[1]!.geometry, scaleFactor: 2, rotation: 0 };
const geometry = { widthMm: 390, heightMm: 250, bottomMm: 20, depthMm: -10 };

test('find saved screen uniquely and retain its identity', () => {
  assert.equal(matchingDisplay(displays, saved)?.index, 1);
  assert.deepEqual(describeDisplay(displays[1]!, saved), saved);
  const newDisplay = describeDisplay(displays[0]!, saved);
  assert.match(newDisplay.id, /^sdl:/);
  assert.equal(newDisplay.width, 2560);
  assert.equal(newDisplay.x, 0);
  assert.equal(matchingDisplay(parseDisplays([input[1], input[1]]), saved), null);
});

test('reject malformed display bounds', () => {
  assert.throws(() => parseDisplays([{ geometry: { x: 0, y: 0, width: 0, height: 1 } }]), /bounds/);
  assert.throws(() => parseDisplays([{ geometry: { x: NaN, y: 0, width: 1, height: 1 } }]), /bounds/);
});

function prompt(inputs: string[], available = displays, previous: DisplayInfo | null = saved) {
  const output: string[] = [];
  const questions: string[] = [];
  const queue = [...inputs];
  const result = promptCalibration({
    displays: async () => available,
    currentDisplay: () => previous,
    geometry: () => geometry,
    ask: async question => {
      questions.push(question);
      const next = queue.shift();
      if (next === undefined) throw new Error('Unexpected prompt');
      return next;
    },
    print: message => output.push(message),
  });
  return { result, output, questions };
}

test('existing tracked display and measurements are defaults', async () => {
  const session = prompt(['', '', '', '', '']);
  const result = await session.result;
  assert.deepEqual(result.display, saved);
  assert.deepEqual(result.geometry, geometry);
  assert.match(session.questions[0]!, /\[2\]/);
  assert.match(session.questions[1]!, /\[390\]/);
});

test('first calibration requires selecting a display and entering measurements', async () => {
  const session = prompt(['', '1', '500', '300', '15', '-4'], displays, null);
  const result = await session.result;
  assert.equal(result.display.width, 2560);
  assert.deepEqual(result.geometry, { widthMm: 500, heightMm: 300, bottomMm: 15, depthMm: -4 });
  assert.doesNotMatch(session.questions[0]!, /\[/);
  assert.match(session.output.join('\n'), /enter all four/);
});

test('switching displays requires new measurements and accepts decimal commas', async () => {
  const session = prompt(['1', '', '500,5', '300', '15', '-4,5']);
  const result = await session.result;
  assert.equal(result.display.width, 2560);
  assert.deepEqual(result.geometry, { widthMm: 500.5, heightMm: 300, bottomMm: 15, depthMm: -4.5 });
  assert.doesNotMatch(session.questions[1]!, /\[/);
  assert.match(session.output.join('\n'), /enter all four/);
});

test('ambiguous and rotated screens cannot be selected', async () => {
  const options = parseDisplays([
    input[0], input[0], { ...input[1], orientation: 'portrait' },
  ]);
  const session = prompt(['1', '3', 'q'], options);
  await assert.rejects(session.result, /cancelled/);
  assert.match(session.output.join('\n'), /cannot be distinguished/);
  assert.match(session.output.join('\n'), /Rotated displays/);
});

test('no displays or cancellation leaves the tracker untouched', async () => {
  await assert.rejects(prompt([], []).result, /No displays/);
  await assert.rejects(prompt(['q']).result, /cancelled/);
});

test('successful calibration saves the selected monitor separately from the old profile', { timeout: 10000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gaze-display-test-'));
  try {
    const oldPath = join(dir, 'previous.json');
    const oldProfiles = new CalibrationProfiles(oldPath);
    await oldProfiles.save('tracker', saved, geometry, Uint8Array.of(1));
    const oldContents = await readFile(oldPath, 'utf8');
    const selected = describeDisplay(parseDisplays([{ name: 'new',
      geometry: { x: 0, y: 0, width: 1000, height: 800 }, orientation: 'landscape' }])[0]!, saved);
    const profiles = new CalibrationProfiles(join(dir, 'own.json'));
    const tracker: CalibrationTracker = {
      identity: 'tracker', geometry: async () => undefined, calibrationStart: async () => undefined,
      calibrationPoint: async () => undefined, calibrationFinish: async () => Uint8Array.of(9),
      disconnect: async () => undefined, connect: async () => undefined, restoreCalibration: async () => undefined,
    };
    let confirmed: DisplayInfo | undefined;
    const controller = new TrackerCalibration(tracker, { trackerIdentity: 'tracker', geometry, blob: Uint8Array.of(1) },
      async result => {
        assert.ok(confirmed);
        await profiles.save(result.trackerIdentity, confirmed, result.geometry, result.blob);
      });
    const mock = fileURLToPath(new URL('./mock-sdl-window.cjs', import.meta.url));
    await calibrateWithProcess(controller, selected, geometry, process.execPath, mock, undefined, value => { confirmed = value; });
    const reloaded = new CalibrationProfiles(join(dir, 'own.json'));
    await reloaded.load();
    assert.equal(reloaded.saved?.display.id, selected.id);
    assert.equal(reloaded.saved?.display.width, 1000);
    assert.equal(reloaded.saved?.display.scaleFactor, 2);
    assert.equal(await readFile(oldPath, 'utf8'), oldContents);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('real SDL dummy driver lists a display', { skip: process.env.GAZE_TEST_SDL !== '1' }, async () => {
  const old = process.env.SDL_VIDEODRIVER;
  process.env.SDL_VIDEODRIVER = 'dummy';
  try {
    const result = await listDisplays();
    assert.equal(result.length, 1);
    assert.deepEqual(result[0]!.geometry, { x: 0, y: 0, width: 1024, height: 768 });
  } finally {
    if (old === undefined) delete process.env.SDL_VIDEODRIVER;
    else process.env.SDL_VIDEODRIVER = old;
  }
});
