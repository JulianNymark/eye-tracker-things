import { listDisplays } from '../src/displays';

const displays = await listDisplays();
if (!displays.length) console.log('No displays found.');
for (const display of displays) {
  const b = display.geometry;
  console.log(`${display.index + 1}. Display ${display.index + 1}${display.name ? ` (${display.name})` : ''}: ${b.width}×${b.height} at ${b.x},${b.y}${display.orientation ? `, ${display.orientation}` : ''}`);
}
