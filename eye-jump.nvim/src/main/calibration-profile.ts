import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { DisplayInfo, Geometry, SavedCalibration } from '../shared/model';
import * as validate from './validation';

const MAX_BLOB_BYTES = 640 * 1024; // Pinned SDK's CAL_BLOB_MAX.
export type CalibrationProfile = SavedCalibration & { schemaVersion: 1; trackerIdentity: string; blob: Uint8Array };

export function sameDisplay(a: DisplayInfo | null, b: DisplayInfo): boolean {
  return Boolean(a && a.id === b.id && a.name === b.name && a.width === b.width && a.height === b.height &&
    a.scaleFactor === b.scaleFactor && a.x === b.x && a.y === b.y && a.rotation === b.rotation);
}

/** One local user's latest calibration. Legacy unbound calibration.bin is not trusted. */
export class CalibrationProfiles {
  saved: CalibrationProfile | null = null;
  constructor(private path: string) {}

  async load(): Promise<void> {
    this.saved = null;
    try {
      if ((await stat(this.path)).size > 1024 * 1024) return;
      const v = validate.object(JSON.parse(await readFile(this.path, 'utf8')));
      if (v.schemaVersion !== 1) return;
      const d = validate.object(v.display);
      const display: DisplayInfo = {
        id: validate.text(d.id), name: validate.text(d.name),
        width: validate.finite(d.width, 1, 32000), height: validate.finite(d.height, 1, 32000),
        scaleFactor: validate.finite(d.scaleFactor, 0.1, 10),
        x: validate.finite(d.x, -100000, 100000), y: validate.finite(d.y, -100000, 100000),
        rotation: validate.finite(d.rotation, 0, 360),
      };
      const trackerIdentity = validate.text(v.trackerIdentity);
      const savedAt = validate.text(v.savedAt);
      if (!trackerIdentity || !Number.isFinite(Date.parse(savedAt)) || typeof v.blob !== 'string') return;
      const blob = Buffer.from(v.blob, 'base64');
      if (!blob.length || blob.length > MAX_BLOB_BYTES || blob.toString('base64') !== v.blob) return;
      this.saved = { schemaVersion: 1, trackerIdentity, display, geometry: validate.geometry(v.geometry), savedAt, blob: Uint8Array.from(blob) };
    } catch { /* Missing, inaccessible or malformed profile: require calibration. */ }
  }

  matching(display: DisplayInfo): CalibrationProfile | null {
    return this.saved && sameDisplay(this.saved.display, display) ? this.saved : null;
  }

  async save(trackerIdentity: string, display: DisplayInfo, geometry: Geometry, blob: Uint8Array): Promise<void> {
    if (!trackerIdentity || !blob.length || blob.length > MAX_BLOB_BYTES) throw new Error('Calibration cannot be remembered safely.');
    const profile: CalibrationProfile = { schemaVersion: 1, trackerIdentity, display: { ...display }, geometry: validate.geometry(geometry), savedAt: new Date().toISOString(), blob: Uint8Array.from(blob) };
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    try {
      await writeFile(temporary, JSON.stringify({ ...profile, blob: Buffer.from(profile.blob).toString('base64') }), { flag: 'wx', mode: 0o600 });
      await rename(temporary, this.path);
      this.saved = profile;
    } finally { await rm(temporary, { force: true }); }
  }

  async clear(): Promise<void> {
    await rm(this.path, { force: true });
    this.saved = null;
  }
}
