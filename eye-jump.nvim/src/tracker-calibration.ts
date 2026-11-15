import { geometry as validateGeometry } from './main/validation';
import type { Geometry } from './shared/model';

/** The only device operations needed by a real tracker-calibration session. */
export interface CalibrationTracker {
  readonly identity: string | null;
  geometry(value: Geometry): Promise<void>;
  calibrationStart(points: 5 | 9): Promise<void>;
  calibrationPoint(x: number, y: number): Promise<void>;
  calibrationFinish(): Promise<Uint8Array | null>;
  disconnect(): Promise<void>;
  connect(demo: boolean): Promise<unknown>;
  restoreCalibration(blob: Uint8Array): Promise<void>;
}

export type DeviceCalibration = { trackerIdentity: string; geometry: Geometry; blob: Uint8Array };
type Session = { owner: string; trackerIdentity: string; geometry: Geometry; count: number };

/**
 * Serializes calibration operations. A failed or cancelled session reconnects
 * and reapplies the last known calibration when available; no incomplete result is persisted.
 */
export class TrackerCalibration {
  private queue: Promise<unknown> = Promise.resolve();
  private session: Session | null = null;
  private available = true;

  constructor(
    private tracker: CalibrationTracker,
    private previous: DeviceCalibration | null,
    private save: (value: DeviceCalibration) => Promise<void>,
  ) {}

  get active(): boolean { return this.session !== null; }
  get ready(): boolean { return this.available && this.session === null; }

  private serial<T>(run: () => Promise<T>): Promise<T> {
    const result = this.queue.then(run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async recover(): Promise<void> {
    this.available = false;
    const identity = this.session?.trackerIdentity;
    try {
      await this.tracker.disconnect();
      await this.tracker.connect(false);
      if (!identity || this.tracker.identity !== identity) throw new Error('The tracker changed before calibration could be restored.');
      if (this.previous) {
        await this.tracker.geometry(this.previous.geometry);
        await this.tracker.restoreCalibration(this.previous.blob);
      }
      this.available = true;
    } finally { this.session = null; }
  }

  private async failed(error: unknown): Promise<never> {
    try { await this.recover(); }
    catch (recoveryError) {
      throw new AggregateError([error, recoveryError], this.previous
        ? 'Calibration failed and the previous tracker calibration could not be restored.'
        : 'Calibration failed and the tracker could not be reconnected.');
    }
    throw error;
  }

  start(owner: string, input: Geometry): Promise<void> {
    return this.serial(async () => {
      if (!this.available || this.session) throw new Error('The tracker is unavailable or already calibrating.');
      if (!owner) throw new Error('A calibration owner is required.');
      const identity = this.tracker.identity;
      if (!identity || (this.previous && identity !== this.previous.trackerIdentity)) {
        throw new Error('Calibration requires the identified tracker to match the saved recovery profile.');
      }
      const measured = validateGeometry(input);
      this.session = { owner, trackerIdentity: identity, geometry: measured, count: 0 };
      this.available = false;
      try {
        await this.tracker.geometry(measured);
        await this.tracker.calibrationStart(9);
      } catch (error) { await this.failed(error); }
    });
  }

  point(owner: string, x: number, y: number): Promise<void> {
    return this.serial(async () => {
      const session = this.session;
      if (!session || session.owner !== owner || session.count >= 9) throw new Error('No matching calibration is collecting points.');
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
        throw new Error('Calibration target must be on the display.');
      }
      try { await this.tracker.calibrationPoint(x, y); }
      catch (error) { await this.failed(error); }
      session.count++;
    });
  }

  finish(owner: string, cancelled: () => boolean = () => false): Promise<void> {
    return this.serial(async () => {
      const session = this.session;
      if (!session || session.owner !== owner || session.count !== 9) throw new Error('Collect all nine calibration points first.');
      try {
        const blob = await this.tracker.calibrationFinish();
        if (!blob?.length) throw new Error('Tracker returned no calibration blob.');
        if (cancelled()) throw new Error('Calibration cancelled before saving.');
        if (this.tracker.identity !== session.trackerIdentity) throw new Error('The tracker changed during calibration.');
        const result = { trackerIdentity: session.trackerIdentity, geometry: session.geometry, blob: Uint8Array.from(blob) };
        await this.save(result);
        this.previous = result;
        this.session = null;
        this.available = true;
      } catch (error) { await this.failed(error); }
    });
  }

  cancel(owner: string): Promise<void> {
    return this.serial(async () => {
      if (!this.session) return;
      if (this.session.owner !== owner) throw new Error('Another client owns the calibration.');
      await this.recover();
    });
  }
}
