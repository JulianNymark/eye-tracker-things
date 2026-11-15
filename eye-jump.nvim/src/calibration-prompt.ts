import { GEOMETRY_FIELDS } from './shared/geometry';
import { describeDisplay, matchingDisplay, sameBounds, type DetectedDisplay } from './displays';
import type { DisplayInfo, Geometry } from './shared/model';

/** Pure interactive flow: never changes tracker or persisted calibration. */
export async function promptCalibration(options: {
  displays: () => Promise<DetectedDisplay[]>;
  currentDisplay: () => DisplayInfo | null;
  geometry: () => Geometry | null;
  ask: (prompt: string) => Promise<string>;
  print: (message: string) => void;
  signal?: AbortSignal;
}): Promise<{ display: DisplayInfo; geometry: Geometry }> {
  const displays = await options.displays();
  if (options.signal?.aborted) throw new Error('Calibration cancelled.');
  if (displays.length === 0) throw new Error('No displays found.');
  const previous = options.currentDisplay();
  const current = previous ? matchingDisplay(displays, previous) : null;
  options.print('Choose the display with the tracker mounted below it:');
  for (const candidate of displays) {
    const b = candidate.geometry;
    const label = candidate.name ? ` (${candidate.name})` : '';
    options.print(`  ${candidate.index + 1}. Display ${candidate.index + 1}${label}: ${b.width}×${b.height} at ${b.x},${b.y}${candidate === current ? ' [current]' : ''}`);
  }
  let selected: DetectedDisplay;
  for (;;) {
    const defaultText = current ? ` [${current.index + 1}]` : '';
    const input = (await options.ask(`Display number${defaultText} (q cancels): `)).trim();
    if (input.toLowerCase() === 'q') throw new Error('Calibration cancelled.');
    const choice = input === '' && current ? current.index + 1 : /^\d+$/.test(input) ? Number(input) : 0;
    const candidate = displays[choice - 1];
    if (!candidate) { options.print('Choose a display number from the list.'); continue; }
    if (displays.filter(other => sameBounds(other.geometry, candidate.geometry)).length !== 1) {
      options.print('Mirrored/overlapping displays cannot be distinguished safely. Choose an unambiguous display.');
      continue;
    }
    if (candidate.orientation && candidate.orientation !== 'landscape') {
      options.print('Rotated displays are not supported. Choose an unrotated display.');
      continue;
    }
    selected = candidate;
    break;
  }
  const display = describeDisplay(selected, previous);
  const prior = previous && sameBounds(selected.geometry, previous) ? options.geometry() : null;
  const result: Partial<Geometry> = prior ? { ...prior } : {};
  if (!prior) options.print('No measurements are saved for this display; enter all four values.');
  options.print('Measure the visible screen, not its bezel. Bottom offset is from the tracker sensor center.');
  options.print('Depth: negative = screen behind tracker, positive = screen toward you. Enter q to cancel.');
  for (const field of GEOMETRY_FIELDS) {
    for (;;) {
      const saved = result[field.key];
      const defaultText = saved === undefined ? '' : ` [${saved}]`;
      const input = (await options.ask(`${field.label} (mm)${defaultText}: `)).trim();
      if (input.toLowerCase() === 'q') throw new Error('Calibration cancelled.');
      if (!input && saved !== undefined) break;
      if (/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(input)) {
        const value = Number(input.replace(',', '.'));
        if (Number.isFinite(value) && value >= field.min && value <= field.max) {
          result[field.key] = value;
          break;
        }
      }
      options.print(`Enter a number between ${field.min} and ${field.max} mm.`);
    }
  }
  return { display, geometry: result as Geometry };
}
