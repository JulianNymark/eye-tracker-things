import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
let entry;
try { entry = require.resolve('@kmamal/sdl'); }
catch { throw new Error('Run pnpm install before setting up SDL.'); }
const root = resolve(dirname(entry), '../..');
if (existsSync(join(root, 'dist', 'sdl.node'))) {
  console.log('SDL native binding is already installed.');
} else {
  console.log('Installing the SDL native binding from its upstream release.');
  const result = spawnSync(process.execPath, [join(root, 'scripts', 'install.mjs')], {
    cwd: join(root, 'scripts'), stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
