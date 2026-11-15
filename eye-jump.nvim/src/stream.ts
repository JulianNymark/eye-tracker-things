import { chmod, mkdir, stat } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { dirname } from 'node:path';

export type GazeFrame = {
  version: 1;
  point: { x: number; y: number } | null;
  display: { width: number; height: number; id?: string; name?: string; x?: number; y?: number; scaleFactor?: number; rotation?: number };
  source: 'tobii' | 'demo';
  setup?: string;
  setupAliases?: string[];
};

/** Newline-delimited frames; stale frames are never replayed to new clients. */
export class GazeStream {
  private clients = new Set<Socket>();
  private server: Server | null = null;

  async listen(path: string): Promise<void> {
    const directory = dirname(path);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const info = await stat(directory);
    if (info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0) {
      throw new Error(`Socket directory must be owned by you and private: ${directory}`);
    }
    const server = createServer(client => {
      this.clients.add(client);
      client.on('error', () => client.destroy());
      client.on('close', () => this.clients.delete(client));
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(path, () => { server.off('error', reject); resolve(); });
    });
    this.server = server;
    try { await chmod(path, 0o600); }
    catch (error) { await this.close(); throw error; }
  }

  publish(frame: GazeFrame): void {
    const message = JSON.stringify(frame) + '\n';
    for (const client of this.clients) {
      // A slow client must not build an unbounded queue of gaze data.
      if (client.writableLength > 65536) client.destroy();
      else client.write(message);
    }
  }

  async close(): Promise<void> {
    for (const client of this.clients) client.destroy();
    this.clients.clear();
    const server = this.server;
    this.server = null;
    if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}
