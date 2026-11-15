import { createHash } from 'node:crypto';
import type { CalibrationProfile } from './main/calibration-profile';
import type { DisplayInfo } from './shared/model';

function hash(profile: CalibrationProfile, display: DisplayInfo): string {
  // Property order is intentional: the original fingerprint used JSON.stringify.
  return createHash('sha256').update(JSON.stringify({
    identity: profile.trackerIdentity, savedAt: profile.savedAt, display, geometry: {
      widthMm: profile.geometry.widthMm, heightMm: profile.geometry.heightMm,
      bottomMm: profile.geometry.bottomMm, depthMm: profile.geometry.depthMm,
    },
  })).digest('hex');
}

/** Canonical ID plus the two legacy display orders used before/after reload. */
export function setupIdentity(profile: CalibrationProfile): { setup: string; setupAliases: string[] } {
  const d = profile.display;
  const loadedOrder: DisplayInfo = { id: d.id, name: d.name, width: d.width, height: d.height,
    scaleFactor: d.scaleFactor, x: d.x, y: d.y, rotation: d.rotation };
  const createdOrder: DisplayInfo = { id: d.id, name: d.name, x: d.x, y: d.y,
    width: d.width, height: d.height, scaleFactor: d.scaleFactor, rotation: d.rotation };
  const setup = hash(profile, loadedOrder);
  const alternate = hash(profile, createdOrder);
  return { setup, setupAliases: alternate === setup ? [] : [alternate] };
}
