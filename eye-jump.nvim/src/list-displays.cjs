try {
  const displays = require('@kmamal/sdl').video.displays;
  process.stdout.write(JSON.stringify(displays.map(({ name, geometry, orientation }) => ({ name, geometry, orientation }))));
} catch (error) {
  process.stderr.write(`Cannot enumerate SDL displays: ${error.message}. Run pnpm setup:sdl if needed.\n`);
  process.exitCode = 1;
}
