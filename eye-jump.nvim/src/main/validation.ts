import type { Geometry, Point, RecordingConsent, RecordingSynchronization } from '../shared/model';
import { GEOMETRY_FIELDS } from '../shared/geometry';

export function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Expected an object.');
  return value as Record<string, unknown>;
}
export function text(value: unknown): string {
  if (typeof value !== 'string' || value.length > 256) throw new Error('Expected a short string.');
  return value;
}
export function flag(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Expected a boolean.');
  return value;
}
export function consent(value: unknown): RecordingConsent {
  const v = object(value);
  const result = { screen: flag(v.screen), microphone: flag(v.microphone), eyeTracking: flag(v.eyeTracking), camera: flag(v.camera) };
  if (!Object.values(result).some(Boolean)) throw new Error('Choose at least one recording source.');
  return result;
}
export function finite(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`Expected a number between ${min} and ${max}.`);
  return value;
}
export function thumbnailVersion(value: unknown): number {
  const version = finite(value, 1, 100);
  if (!Number.isInteger(version)) throw new Error('Invalid thumbnail version.');
  return version;
}
export function synchronization(value: unknown, allowed: { primary: boolean; camera: boolean }): RecordingSynchronization {
  const v = object(value);
  if (v.method !== 'monotonic-recorder-start') throw new Error('Unsupported synchronization method.');
  if (Object.keys(v).some(key => !['method', 'screenStartMs', 'cameraStartMs', 'uncertaintyMs'].includes(key))) throw new Error('Invalid synchronization field.');
  if ((!allowed.primary && v.screenStartMs !== undefined) || (!allowed.camera && v.cameraStartMs !== undefined)) throw new Error('This media source was not consented to.');
  return {
    method: 'monotonic-recorder-start',
    ...(v.screenStartMs !== undefined ? { screenStartMs: finite(v.screenStartMs, 0, Number.MAX_SAFE_INTEGER) } : {}),
    ...(v.cameraStartMs !== undefined ? { cameraStartMs: finite(v.cameraStartMs, 0, Number.MAX_SAFE_INTEGER) } : {}),
    uncertaintyMs: finite(v.uncertaintyMs, 0, Number.MAX_SAFE_INTEGER),
  };
}
export function point(value: unknown): Point {
  const v = object(value);
  return { x: finite(v.x, 0, 1), y: finite(v.y, 0, 1) };
}
export function geometry(value: unknown): Geometry {
  const v = object(value);
  const result = {} as Geometry;
  for (const field of GEOMETRY_FIELDS) {
    try { result[field.key] = finite(v[field.key], field.min, field.max); }
    catch { throw new Error(`${field.label} must be a number between ${field.min} and ${field.max} mm.`); }
  }
  return result;
}
