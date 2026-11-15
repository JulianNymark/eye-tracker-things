import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

test('lazy.nvim loads the local plugin via user-owned mappings',
  { skip: !process.env.GAZE_TEST_LAZY_PATH, timeout: 15000 }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'glz-'));
    const socketPath = join(directory, 'sock');
    const alignment = { version: 1, source: 'tobii', setup: 'test', rows: 24, cols: 80,
      display: { width: 1920, height: 1080 }, transform: { x: [1, 0, 0], y: [0, 1, 0], rms: 0 } };
    await writeFile(join(directory, 'alignment.json'), JSON.stringify(alignment));
    for (const name of ['config', 'data', 'state', 'cache']) await mkdir(join(directory, name));
    const server = createServer(client => {
      const publish = (): void => { client.write(JSON.stringify({ version: 1, source: 'tobii', setup: 'test',
        display: alignment.display, point: { x: 0.5, y: 0.5 } }) + '\n'); };
      const timer = setInterval(publish, 30);
      client.on('error', () => undefined);
      client.on('close', () => clearInterval(timer));
      publish();
    });
    try {
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
      const { stdout, stderr } = await promisify(execFile)('nvim', ['--headless', '-u', 'NONE', '-i', 'NONE', '-l', 'tests/lazy-loading.lua'], {
        timeout: 10000, env: { ...process.env, GAZE_TEST_SOCKET: socketPath, GAZE_TEST_DIR: directory,
          XDG_CONFIG_HOME: join(directory, 'config'), XDG_DATA_HOME: join(directory, 'data'),
          XDG_STATE_HOME: join(directory, 'state'), XDG_CACHE_HOME: join(directory, 'cache') },
      });
      assert.match(stdout + stderr, /lazy.nvim local plugin and keybindings passed/);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  });
