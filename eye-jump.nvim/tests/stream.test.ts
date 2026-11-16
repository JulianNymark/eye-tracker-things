import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { GazeStream, type GazeFrame } from '../src/stream';

test('broadcasts framed gaze and invalidation over a private socket', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'eye-jump-'));
  const path = join(dir, 'gaze.sock');
  const stream = new GazeStream();
  try {
    await stream.listen(path);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    const client = connect(path);
    await once(client, 'connect');
    const frame: GazeFrame = { version: 1, source: 'demo', point: { x: 0.25, y: 0.75 },
      display: { id: 'screen-2', name: 'Tracked', x: -1920, y: 0, width: 1920, height: 1080, scaleFactor: 2 } };
    const received = once(client, 'data');
    stream.publish(frame);
    const [data] = await received;
    assert.deepEqual(JSON.parse(String(data)), frame);
    const invalid = once(client, 'data');
    stream.publish({ ...frame, point: null });
    const [invalidData] = await invalid;
    assert.equal(JSON.parse(String(invalidData)).point, null);
    client.destroy();
  } finally {
    await stream.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('demo bridge produces synthetic gaze without hardware', { timeout: 10000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gaze-demo-'));
  const path = join(dir, 'gaze.sock');
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/bridge.ts', '--demo'], {
    env: { ...process.env, EYE_JUMP_SOCKET: path },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = once(child, 'exit');
  let output = '';
  child.stdout.on('data', data => { output += String(data); });
  child.stderr.on('data', data => { output += String(data); });
  try {
    await new Promise<void>((resolve, reject) => {
      const onData = (): void => {
        if (output.includes('Gaze stream listening')) {
          child.stdout.off('data', onData);
          child.off('exit', onExit);
          resolve();
        }
      };
      const onExit = (): void => reject(new Error(`Bridge exited before starting: ${output}`));
      child.stdout.on('data', onData);
      child.once('exit', onExit);
      onData();
    });
    const client = connect(path);
    await once(client, 'connect');
    const [data] = await once(client, 'data');
    const frame = JSON.parse(String(data).split('\n')[0]!);
    assert.equal(frame.source, 'demo');
    assert.equal(frame.version, 1);
    assert.ok(frame.point.x >= 0 && frame.point.x <= 1);
    client.destroy();
  } finally {
    child.kill('SIGTERM');
    await exited;
    await rm(dir, { recursive: true, force: true });
  }
});
