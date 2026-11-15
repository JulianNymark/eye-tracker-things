import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

test('fresh Neovim processes restore saved alignment and adapt to resized grids', { timeout: 15000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gpr-'));
  const socketPath = join(directory, 'sock');
  const alignmentPath = join(directory, 'alignment.json');
  const profile = { version: 1, source: 'tobii', setup: 'legacy', rows: 24, cols: 80,
    display: { width: 1920, height: 1080 },
    transform: { x: [0.8, 0, 0.1], y: [0, 0.8, 0.1], rms: 0 } };
  await writeFile(alignmentPath, JSON.stringify(profile));
  let setup = 'canonical';
  let aliases = ['legacy'];
  const server = createServer(client => {
    const publish = (): void => {
      client.write(JSON.stringify({ version: 1, source: 'tobii', setup, setupAliases: aliases,
        display: profile.display, point: { x: 0.5, y: 0.5 } }) + '\n');
    };
    const timer = setInterval(publish, 30);
    client.on('error', () => undefined);
    client.on('close', () => clearInterval(timer));
    publish();
  });
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
    const run = async (rows: number, cols: number, state: string): Promise<void> => {
      const { stdout, stderr } = await promisify(execFile)('nvim', ['--headless', '-u', 'NONE', '-i', 'NONE', '-l', 'tests/nvim-restart.lua'], {
        timeout: 10000, env: { ...process.env, GAZE_TEST_SOCKET: socketPath, GAZE_TEST_ALIGNMENT: alignmentPath,
          GAZE_TEST_ROWS: String(rows), GAZE_TEST_COLS: String(cols), GAZE_TEST_ALIGNMENT_STATE: state },
      });
      assert.match(stdout + stderr, new RegExp(`Fresh Neovim alignment: ${state}`));
    };
    await run(24, 80, 'ready');
    await run(30, 100, 'resized');
    setup = 'different-tracker';
    aliases = [];
    await run(24, 80, 'tracker_setup_changed');
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
