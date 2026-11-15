import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import type { DisplayInfo } from './shared/model';

export type DetectedDisplay = {
  index: number;
  name: string;
  geometry: { x: number; y: number; width: number; height: number };
  orientation: string | null;
};

export function sameBounds(a: { x?: number; y?: number; width: number; height: number },
  b: { x?: number; y?: number; width: number; height: number }): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/** SDL2 names/indexes are not stable display IDs; geometry must be unique. */
export function matchingDisplay(displays: readonly DetectedDisplay[], saved: DisplayInfo): DetectedDisplay | null {
  const matches = displays.filter(display => sameBounds(display.geometry, saved));
  return matches.length === 1 ? matches[0]! : null;
}

export function describeDisplay(display: DetectedDisplay, previous: DisplayInfo | null): DisplayInfo {
  const bounds = display.geometry;
  if (previous && sameBounds(bounds, previous)) return { ...previous };
  return {
    id: `sdl:${bounds.x},${bounds.y},${bounds.width},${bounds.height}`,
    name: `SDL display ${display.index + 1}${display.name ? ` (${display.name})` : ''}`.slice(0, 256),
    ...bounds,
    // The fullscreen window replaces this placeholder with the measured pixel ratio.
    scaleFactor: 1,
    rotation: 0,
  };
}

export function parseDisplays(value: unknown): DetectedDisplay[] {
  if (!Array.isArray(value) || value.length > 32) throw new Error('Invalid display list from SDL.');
  return value.map((item: unknown, index: number) => {
    if (!item || typeof item !== 'object') throw new Error('Invalid SDL display.');
    const input = item as Record<string, unknown>;
    if (!input.geometry || typeof input.geometry !== 'object') throw new Error('Invalid SDL display geometry.');
    const geometry = input.geometry as Record<string, unknown>;
    const { x, y, width, height } = geometry;
    if (![x, y, width, height].every(n => typeof n === 'number' && Number.isFinite(n)) ||
        (width as number) <= 0 || (height as number) <= 0 ||
        (width as number) > 32000 || (height as number) > 32000 ||
        Math.abs(x as number) > 100000 || Math.abs(y as number) > 100000) throw new Error('Invalid SDL display bounds.');
    return { index, name: typeof input.name === 'string' ? input.name.replace(/[\x00-\x1f\x7f-\x9f]/g, '').slice(0, 100) : '',
      geometry: { x: x as number, y: y as number, width: width as number, height: height as number },
      orientation: typeof input.orientation === 'string' ? input.orientation : null };
  });
}

export async function listDisplays(): Promise<DetectedDisplay[]> {
  const script = fileURLToPath(new URL('./list-displays.cjs', import.meta.url));
  try {
    const { stdout } = await promisify(execFile)(process.execPath, [script], { timeout: 10000, maxBuffer: 65536 });
    return parseDisplays(JSON.parse(stdout));
  } catch (error) {
    const detail = error && typeof error === 'object' && 'stderr' in error && typeof error.stderr === 'string'
      ? error.stderr.trim() : error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to list displays: ${detail}`);
  }
}
