import { homedir } from 'node:os';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Tracker } from './main/tracker';
import { CalibrationProfiles, type CalibrationProfile } from './main/calibration-profile';
import { normalizedPoint } from './shared/gaze';
import { GazeStream } from './stream';
import { TrackerCalibration } from './tracker-calibration';
import { calibrateWithWindow } from './calibration-window';
import { operator } from './operator';
import { listDisplays, matchingDisplay } from './displays';
import type { DisplayInfo } from './shared/model';
import { setupIdentity } from './setup-identity';

process.umask(0o077);
const socketPath = process.env.EYE_JUMP_SOCKET ?? join(homedir(), '.local', 'share', 'eye-jump', 'gaze.sock');
const ownProfilePath = join(homedir(), '.local', 'share', 'eye-jump', 'tracker-calibration.json');
const args = process.argv.slice(2);
const demo = args.includes('--demo');
if (args.some(arg => arg !== '--demo')) throw new Error('Usage: pnpm bridge [--demo]');

const tracker = new Tracker();
const stream = new GazeStream();
let closing = false;
let stopOperator: (() => void) | undefined;
let calibrationAbort: AbortController | undefined;
let calibrationTask: Promise<void> | undefined;

async function close(): Promise<void> {
  if (closing) return;
  closing = true;
  stopOperator?.();
  calibrationAbort?.abort();
  await calibrationTask?.catch(() => undefined);
  try { await stream.close(); }
  finally { await tracker.disconnect(); }
}

async function main(): Promise<void> {
  let display: DisplayInfo = { id: 'demo', name: 'Synthetic display', width: 1920, height: 1080,
    x: 0, y: 0, scaleFactor: 1, rotation: 0 };
  let setup = demo ? 'demo' : 'unconfigured';
  let setupAliases: string[] = [];
  let profile: CalibrationProfile | null = null;
  let controller: TrackerCalibration | null = null;
  let displayVerified = demo;
  let pendingDisplay: DisplayInfo | null = null;
  const verifyDisplay = async (saved: DisplayInfo): Promise<boolean> => {
    try {
      const match = matchingDisplay(await listDisplays(), saved);
      return Boolean(match && (!match.orientation || match.orientation === 'landscape'));
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      return false;
    }
  };
  if (!demo) {
    const ownProfiles = new CalibrationProfiles(ownProfilePath);
    await ownProfiles.load();
    if (!ownProfiles.saved) {
      const exists = await stat(ownProfilePath).then(() => true, (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return false;
        throw error;
      });
      if (exists) throw new Error(`Saved calibration is invalid or unreadable; back it up and move it before recalibrating: ${ownProfilePath}`);
    }
    await tracker.connect(false);
    if (!tracker.identity) throw new Error('The connected tracker could not be identified.');
    if (ownProfiles.saved && ownProfiles.saved.trackerIdentity !== tracker.identity) {
      throw new Error('The saved calibration belongs to a different tracker; back it up and move it before calibrating this tracker.');
    }
    profile = ownProfiles.saved;
    if (profile) {
      if (profile.display.rotation !== 0) throw new Error('Rotated displays are not supported in this prototype.');
      display = { ...profile.display };
      ({ setup, setupAliases } = setupIdentity(profile));
      await tracker.geometry(profile.geometry);
      await tracker.restoreCalibration(profile.blob);
      console.log(`Using saved calibration for ${profile.display.name}: ${profile.display.width}×${profile.display.height} at ${profile.display.x},${profile.display.y}.`);
      console.log('Ensure display layout and physical tracker setup are unchanged.');
      displayVerified = await verifyDisplay(profile.display);
      if (!displayVerified) console.warn('The saved display is missing, rotated, or ambiguous; gaze is disabled. Press c to choose a display and recalibrate.');
    } else {
      console.log('No calibration for this tracker. Press c to choose a display and calibrate; gaze is disabled until then.');
    }
    controller = new TrackerCalibration(tracker, profile, async result => {
      if (!pendingDisplay) throw new Error('Missing confirmed display setup.');
      await ownProfiles.save(result.trackerIdentity, pendingDisplay, result.geometry, result.blob);
      if (!ownProfiles.saved) throw new Error('Calibration could not be saved.');
      profile = ownProfiles.saved;
      display = { ...profile.display };
      ({ setup, setupAliases } = setupIdentity(profile));
      console.log(`Tracker calibration saved at ${ownProfilePath}.`);
    });
  } else {
    await tracker.connect(true);
    console.log('DEMO: synthetic gaze, not hardware data.');
  }

  tracker.onSample(sample => stream.publish({ version: 1, point: !displayVerified || (controller && !controller.ready) ? null : normalizedPoint(sample, false), display, source: demo ? 'demo' : 'tobii', setup, setupAliases }));
  await stream.listen(socketPath);
  console.log(`Gaze stream listening on ${socketPath}`);
  if (controller) {
    const activeController = controller;
    stopOperator = operator({
      geometry: () => profile?.geometry ?? null,
      currentDisplay: () => profile?.display ?? null,
      displays: listDisplays,
      calibrate: async (selected, geometry) => {
        if (!activeController.ready) throw new Error('Tracker is not ready for calibration.');
        console.log('Confirm the fullscreen dot is on the tracker-mounted display, then press Space to start.');
        console.log('Look at each of the nine dots and press Space; Escape cancels.');
        displayVerified = false;
        calibrationAbort = new AbortController();
        calibrationTask = calibrateWithWindow(activeController, selected, geometry, calibrationAbort.signal,
          confirmed => { pendingDisplay = confirmed; });
        try { await calibrationTask; console.log('Tracker calibration complete. Recheck gaze before use.'); }
        finally {
          pendingDisplay = null;
          calibrationTask = undefined;
          calibrationAbort = undefined;
          if (profile && !closing) {
            displayVerified = await verifyDisplay(profile.display);
            if (!displayVerified) console.warn('The saved display is unavailable or ambiguous; gaze remains disabled.');
          }
        }
      },
      quit: () => { void close().then(() => process.exit(0), error => { console.error(error); process.exit(1); }); },
    });
  }
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
    void close().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
  });
}

main().catch(async error => {
  console.error(error);
  try { await close(); } catch (cleanupError) { console.error(cleanupError); }
  process.exitCode = 1;
});
