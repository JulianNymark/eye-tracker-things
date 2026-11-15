import { spawn } from 'node:child_process';
import { chmod, mkdtemp, rmdir } from 'node:fs/promises';
import { createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import type { DisplayInfo, Geometry } from './shared/model';
import { TrackerCalibration } from './tracker-calibration';

/** Owns the temporary fullscreen process; device access stays in the bridge. */
export async function calibrateWithWindow(controller: TrackerCalibration, display: DisplayInfo, geometry: Geometry,
  signal?: AbortSignal, onReady?: (confirmed: DisplayInfo) => void): Promise<void> {
  const script = fileURLToPath(new URL('./fullscreen-calibration-sdl.cjs', import.meta.url));
  return calibrateWithProcess(controller, display, geometry, process.execPath, script, signal, onReady);
}

/** A private socket isolates the lightweight SDL window from tracker access. */
export async function calibrateWithProcess(controller: TrackerCalibration, display: DisplayInfo, geometry: Geometry,
  executable: string, script: string, signal?: AbortSignal, onReady?: (confirmed: DisplayInfo) => void): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'gzc-'));
  const path = process.platform === 'win32' ? `\\\\.\\pipe\\gzc-${process.pid}-${Date.now()}` : join(directory, 'control.sock');
  const server = createServer();
  let socket: Socket | undefined;
  let child: ReturnType<typeof spawn> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let messages: ReturnType<typeof createInterface> | undefined;
  const owner = 'fullscreen';
  const abort = (): void => { socket?.destroy(); child?.kill(); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(path, () => { server.off('error', reject); resolve(); });
    });
    if (process.platform !== 'win32') await chmod(path, 0o600);
    const connection = new Promise<Socket>((resolve, reject) => {
      server.once('connection', resolve);
      server.once('error', reject);
    });
    const args = [script, JSON.stringify(display), path];
    child = spawn(executable, args, { stdio: ['ignore', 'ignore', 'inherit'] });
    const exited = new Promise<void>(resolve => { child!.once('exit', () => resolve()); child!.once('error', () => resolve()); });
    if (signal?.aborted) abort();
    const timedOut = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Timed out opening the calibration window.')), 15000);
    });
    socket = await Promise.race([
      connection,
      exited.then(() => { throw new Error('Calibration window could not be opened.'); }),
      timedOut,
    ]);
    if (timer) { clearTimeout(timer); timer = undefined; }
    // Only the first client is part of this session; reject unexpected extras.
    server.on('connection', other => other.destroy());
    socket.on('error', () => undefined);
    let windowEnded = false;
    socket.on('end', () => { windowEnded = true; });
    socket.on('close', () => { windowEnded = true; });
    messages = createInterface({ input: socket });
    let started = false;
    let complete = false;
    let count = 0;
    for await (const line of messages) {
      if (line.length > 4096) throw new Error('Calibration window message is too large.');
      let message: Record<string, unknown>;
      try { message = JSON.parse(line) as Record<string, unknown>; }
      catch { throw new Error('Calibration window sent an invalid message.'); }
      if (message.type === 'ready' && !started) {
        if (typeof message.scaleFactor !== 'number' || !Number.isFinite(message.scaleFactor) ||
            message.scaleFactor < 0.1 || message.scaleFactor > 10) throw new Error('Invalid display scale from calibration window.');
        onReady?.({ ...display, scaleFactor: message.scaleFactor });
        await controller.start(owner, geometry);
        started = true;
        if (windowEnded || signal?.aborted) throw new Error('Calibration window closed.');
        socket.write(JSON.stringify({ type: 'start', step: 0 }) + '\n');
      } else if (message.type === 'point' && started && message.step === count &&
          typeof message.x === 'number' && typeof message.y === 'number') {
        await controller.point(owner, message.x, message.y);
        count++;
        if (windowEnded || socket.destroyed || signal?.aborted) throw new Error('Calibration window closed.');
        if (count === 9) {
          await controller.finish(owner, () => windowEnded || signal?.aborted === true);
          complete = true;
          socket.write(JSON.stringify({ type: 'exit' }) + '\n');
          break;
        }
        socket.write(JSON.stringify({ type: 'next', step: count }) + '\n');
      } else if (message.type === 'cancel') {
        throw new Error(typeof message.reason === 'string' ? message.reason : 'Calibration cancelled.');
      } else if (message.type === 'error') {
        throw new Error(typeof message.message === 'string' ? message.message : 'Calibration window failed.');
      } else throw new Error('Calibration window sent an unexpected message.');
    }
    if (!complete) throw new Error('Calibration window closed before completion.');
  } catch (error) {
    try { await controller.cancel(owner); }
    catch (recoveryError) { throw new AggregateError([error, recoveryError], 'Calibration failed and recovery failed.'); }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    messages?.close();
    socket?.destroy();
    if (child && child.exitCode === null && child.signalCode === null) child.kill();
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    await rmdir(directory).catch(() => undefined);
    signal?.removeEventListener('abort', abort);
  }
}
