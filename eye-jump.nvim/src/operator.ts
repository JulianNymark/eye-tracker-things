import { emitKeypressEvents } from 'node:readline';
import { createInterface } from 'node:readline/promises';
import { promptCalibration } from './calibration-prompt';
import type { DetectedDisplay } from './displays';
import type { DisplayInfo, Geometry } from './shared/model';

/** Single-key operator menu; interactive input never runs in non-TTY sessions. */
export function operator(options: {
  geometry: () => Geometry | null;
  currentDisplay: () => DisplayInfo | null;
  displays: () => Promise<DetectedDisplay[]>;
  calibrate: (display: DisplayInfo, geometry: Geometry) => Promise<void>;
  quit: () => void;
}): () => void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return () => undefined;
  let stopped = false;
  let busy = false;
  let promptAbort: AbortController | null = null;
  emitKeypressEvents(process.stdin);
  process.stdin.resume();

  const enable = (): void => {
    if (stopped) return;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('keypress', keypress);
    console.log('\n[c] Calibrate tracker  [q] Quit');
  };
  const disable = (): void => {
    process.stdin.off('keypress', keypress);
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  };
  const prompt = async (): Promise<{ display: DisplayInfo; geometry: Geometry }> => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const abort = new AbortController();
    promptAbort = abort;
    rl.on('SIGINT', () => abort.abort());
    try {
      return await promptCalibration({ ...options,
        ask: text => rl.question(text, { signal: abort.signal }),
        print: message => console.log(message), signal: abort.signal });
    } finally { promptAbort = null; rl.close(); }
  };
  const keypress = (_value: string, key: { name?: string; ctrl?: boolean }): void => {
    if (stopped || busy) return;
    if (key.name === 'q' || (key.ctrl && key.name === 'c')) { options.quit(); return; }
    if (key.name !== 'c') return;
    busy = true;
    disable();
    void prompt().then(({ display, geometry }) => options.calibrate(display, geometry)).catch(error => {
      console.error(error instanceof Error ? error.message : error);
    }).finally(() => { busy = false; enable(); });
  };
  enable();
  return () => { stopped = true; promptAbort?.abort(); disable(); };
}
