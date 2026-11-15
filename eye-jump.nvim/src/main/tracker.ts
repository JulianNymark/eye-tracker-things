import { UsbSource } from '../../vendor/tobiifree/src/usb_source';
import { wasmBytes } from '../../vendor/tobiifree/src/wasm-bundle';
import type { DisplayArea } from '../../vendor/tobiifree/src/protocol';
import type { TrackedGazeSample } from '../shared/gaze';
import { GazePair } from './gaze-pair';
import type { Geometry, TrackerStatus } from '../shared/model';
import { openRuntimeTransport } from './usb-transport';
import type { CancellableUsbTransport } from './usb-transport';

export class Tracker {
  status: TrackerStatus = { state: 'disconnected', message: 'Connect a tracker, or try the explicit demo.', calibrated: false };
  private source: UsbSource | null = null;
  private transport: CancellableUsbTransport | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private calibrating = false;
  private pointsCollected = 0;
  private expectedPoints: 5 | 9 = 5;
  private lastSampleMs = 0;
  private geometryConfigured = false;
  private measuredGeometry: Geometry | null = null;
  private listeners = new Set<(s: TrackedGazeSample) => void>();

  get area(): DisplayArea | null { return this.source?.displayArea ?? null; }
  get ready(): boolean { return this.status.state === 'connected' || this.status.state === 'demo'; }
  get demo(): boolean { return this.status.state === 'demo'; }
  get identity(): string | null { return this.transport?.identity ?? null; }
  get geometryValue(): Geometry | null { return this.measuredGeometry ? { ...this.measuredGeometry } : null; }
  onSample(listener: (s: TrackedGazeSample) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async connect(demo: boolean): Promise<TrackerStatus> {
    if (this.status.state !== 'disconnected' && this.status.state !== 'error') throw new Error('Disconnect before connecting again.');
    if (this.status.state === 'error') await this.disconnect();
    this.status = { state: 'connecting', message: 'Opening USB and handshaking…', calibrated: false };
    try {
      if (demo) {
        this.status = { state: 'demo', message: 'Synthetic gaze — not hardware data.', calibrated: false };
        const start = performance.now();
        this.timer = setInterval(() => {
          const t = (performance.now() - start) / 1000;
          const point = { x: 0.5 + 0.35 * Math.sin(t), y: 0.5 + 0.3 * Math.cos(t * 0.7) };
          const unfiltered = { x: point.x + 0.012 * Math.sin(t * 47), y: point.y + 0.012 * Math.cos(t * 53) };
          this.emit({ timestamp_us: Math.round(t * 1e6), validity_L: 0, validity_R: 0,
            gaze_point_2d_norm: point, gaze_point_2d_unfiltered: unfiltered, gaze_2d_unfiltered_valid: true });
        }, 16);
        return this.status;
      }
      // Keep ownership of transport so a failed handshake can release the USB claim.
      this.transport = await openRuntimeTransport();
      this.source = await UsbSource.create({ transport: this.transport, wasmBytes: wasmBytes(), requestTimeoutMs: 3000 });
      this.lastSampleMs = performance.now();
      const pair = new GazePair(sample => this.emit(sample));
      const unsubscribeFrame = this.source.onFrame(() => pair.flush());
      const unsubscribeGaze = this.source.subscribeToGaze(sample => pair.gaze(sample));
      const unsubscribeRaw = this.source.subscribeToRawGaze(columns => pair.columns(columns));
      this.unsubscribe = () => { unsubscribeFrame(); unsubscribeGaze(); unsubscribeRaw(); pair.flush(); };
      this.status = { state: 'connected', message: 'USB connected. Configure display geometry, then calibrate.', calibrated: false };
      this.timer = setInterval(() => {
        if (!this.calibrating && performance.now() - this.lastSampleMs > 5000) {
          this.status = { ...this.status, state: 'error', message: 'No USB gaze frames for 5 seconds. Stop recording, disconnect, and check the device.' };
        }
      }, 1000);
      return this.status;
    } catch (error) {
      await this.disconnect();
      const message = error instanceof Error ? error.message : String(error);
      this.status = { state: 'error', message, calibrated: false };
      throw error;
    }
  }

  private emit(sample: TrackedGazeSample): void {
    this.lastSampleMs = performance.now();
    for (const listener of this.listeners) listener(sample);
  }

  async disconnect(): Promise<void> {
    this.status = { state: 'disconnecting', message: 'Closing USB.', calibrated: false };
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    // Source abort now cancels Node's pending read. Let it own transport close;
    // closing both concurrently can release the same interface twice.
    const source = this.source;
    const transport = this.transport;
    this.source = null;
    this.transport = null;
    try {
      if (source) await source.close();
      else await transport?.close();
    } catch (error) {
      this.status = { state: 'error', message: `USB cleanup failed: ${error instanceof Error ? error.message : String(error)}`, calibrated: false };
      throw error;
    }
    this.calibrating = false;
    this.pointsCollected = 0;
    this.geometryConfigured = false;
    this.measuredGeometry = null;
    this.status = { state: 'disconnected', message: 'Disconnected.', calibrated: false };
  }

  async geometry(g: Geometry): Promise<void> {
    if (!this.source) throw new Error('Connect real hardware before setting physical display geometry.');
    await this.source.setDisplayArea({ w: g.widthMm, h: g.heightMm, ox: -g.widthMm / 2, oy: g.bottomMm, z: g.depthMm });
    this.geometryConfigured = true;
    this.measuredGeometry = { ...g };
    this.status.calibrated = false;
  }

  async calibrationStart(expectedPoints: 5 | 9 = 5): Promise<void> {
    if (!this.ready || this.calibrating) throw new Error('Connect first; only one calibration may run.');
    if (!this.demo && !this.geometryConfigured) throw new Error('Apply measured display geometry before calibration.');
    this.status.calibrated = false;
    this.calibrating = true;
    this.pointsCollected = 0;
    this.expectedPoints = expectedPoints;
    try { await this.source?.startCalibration(); }
    catch (e) { this.calibrating = false; throw e; }
  }

  async restoreCalibration(blob: Uint8Array): Promise<void> {
    if (!this.source || !this.ready || !this.geometryConfigured || this.calibrating) throw new Error('Connect and apply geometry before restoring calibration.');
    this.status.calibrated = false;
    this.calibrating = true;
    try {
      await this.source.calApply(blob);
      this.status.calibrated = true;
    } finally { this.calibrating = false; this.lastSampleMs = performance.now(); }
  }

  async calibrationPoint(x: number, y: number): Promise<void> {
    if (!this.calibrating) throw new Error('Calibration is not running.');
    if (this.pointsCollected >= this.expectedPoints) throw new Error('All calibration points have already been collected.');
    await this.source?.addCalibrationPoint(x, y);
    this.pointsCollected++;
  }

  async calibrationFinish(): Promise<Uint8Array | null> {
    if (!this.calibrating || this.pointsCollected < this.expectedPoints) throw new Error(`Collect all ${this.expectedPoints} calibration points first.`);
    try {
      const blob = await this.source?.finishCalibration() ?? null;
      this.status.calibrated = true;
      return blob;
    } finally { this.calibrating = false; this.lastSampleMs = performance.now(); }
  }
}
