import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import type { CalibrationProfile } from '../src/main/calibration-profile';
import { setupIdentity } from '../src/setup-identity';

const geometry = { widthMm: 390, heightMm: 250, bottomMm: 20, depthMm: -10 };
const loaded: CalibrationProfile = {
  schemaVersion: 1, trackerIdentity: 'tracker', savedAt: '2026-11-15T12:00:00Z', blob: Uint8Array.of(1), geometry,
  display: { id: 'screen', name: 'Screen', width: 1920, height: 1200, scaleFactor: 2, x: 100, y: -1200, rotation: 0 },
};
const created: CalibrationProfile = { ...loaded, display: {
  id: 'screen', name: 'Screen', x: 100, y: -1200, width: 1920, height: 1200, scaleFactor: 2, rotation: 0,
} };

function legacy(profile: CalibrationProfile): string {
  return createHash('sha256').update(JSON.stringify({ identity: profile.trackerIdentity,
    savedAt: profile.savedAt, display: profile.display, geometry: profile.geometry })).digest('hex');
}

test('setup fingerprint is stable across profile save and reload ordering', () => {
  const fresh = setupIdentity(created);
  const reopened = setupIdentity(loaded);
  assert.deepEqual(fresh, reopened);
  assert.equal(fresh.setup, legacy(loaded));
  assert.notEqual(legacy(created), fresh.setup);
  assert.ok(fresh.setupAliases.includes(legacy(created)));
});

test('legacy aliases do not match a different tracker, calibration or display', () => {
  const previous = setupIdentity(created);
  for (const next of [
    { ...loaded, trackerIdentity: 'different' },
    { ...loaded, savedAt: '2026-11-16T12:00:00Z' },
    { ...loaded, display: { ...loaded.display, width: 1600 } },
    { ...loaded, geometry: { ...geometry, bottomMm: 21 } },
  ]) {
    const changed = setupIdentity(next);
    assert.notEqual(changed.setup, previous.setup);
    assert.ok(!changed.setupAliases.includes(previous.setup));
    assert.ok(!changed.setupAliases.includes(previous.setupAliases[0]!));
  }
});
