const net = require('node:net');
const os = require('node:os');
const readline = require('node:readline');

const expected = JSON.parse(process.argv[2]);
const socket = net.createConnection(process.argv[3]);
const points = [
  [0.5, 0.5], [0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9],
  [0.5, 0.1], [0.9, 0.5], [0.5, 0.9], [0.1, 0.5],
];
let sdl;
let window;
let initial;
let timer;
let step = 0;
let busy = true;
let phase = 'confirm';
let closing = false;

function send(message) { socket.write(JSON.stringify(message) + '\n'); }
function equal(a, b) { return ['x', 'y', 'width', 'height'].every(key => a[key] === b[key]); }
function matchingDisplays() { return sdl.video.displays.filter(display => equal(display.geometry, expected)); }
function bounds() {
  return { x: window.x, y: window.y, width: window.width, height: window.height,
    pixelWidth: window.pixelWidth, pixelHeight: window.pixelHeight };
}
function sameWindow(a, b) {
  return equal(a, b) && a.pixelWidth === b.pixelWidth && a.pixelHeight === b.pixelHeight;
}
function inside(rect, display) {
  return rect.x >= display.x && rect.y >= display.y &&
    rect.x + rect.width <= display.x + display.width && rect.y + rect.height <= display.y + display.height;
}
function usable(rect) {
  return rect.width > 0 && rect.height > 0 && rect.pixelWidth > 0 && rect.pixelHeight > 0 &&
    rect.pixelWidth * rect.pixelHeight <= 50_000_000 && inside(rect, expected) &&
    rect.width >= expected.width * 0.9 && rect.height >= expected.height * 0.9;
}
function geometryValid() {
  const displays = matchingDisplays();
  return displays.length === 1 && window.fullscreen && window.display &&
    equal(window.display.geometry, expected) && sameWindow(bounds(), initial);
}
function stop(reason, type = 'cancel') {
  if (closing) return;
  closing = true;
  if (timer) clearInterval(timer);
  if (reason && !socket.destroyed) socket.end(JSON.stringify({ type, ...(type === 'error' ? { message: reason } : { reason }) }) + '\n');
  else socket.end();
  if (window && !window.destroyed) window.destroy();
}
function checkGeometry() {
  if (initial && !closing && !geometryValid()) stop('Display or calibration-window geometry changed');
}

function draw() {
  if (!initial || !geometryValid()) throw new Error('Calibration window geometry changed.');
  const width = initial.pixelWidth, height = initial.pixelHeight;
  const pixels = Buffer.allocUnsafe(width * height * 4);
  const words = new Uint32Array(pixels.buffer, pixels.byteOffset, width * height);
  words.fill(os.endianness() === 'LE' ? 0xff000000 : 0x000000ff);
  const [x, y] = points[step];
  const cx = Math.floor(x * width), cy = Math.floor(y * height);
  const scale = Math.min(width / initial.width, height / initial.height);
  const radius = Math.max(10, Math.round(27 * scale));
  const inner = Math.max(0, radius - Math.max(2, Math.round(3 * scale)));
  const dot = Math.max(2, Math.round(4 * scale));
  for (let py = Math.max(0, cy - radius); py <= Math.min(height - 1, cy + radius); py++) {
    for (let px = Math.max(0, cx - radius); px <= Math.min(width - 1, cx + radius); px++) {
      const distance = (px - cx) ** 2 + (py - cy) ** 2;
      if ((distance <= radius ** 2 && distance >= inner ** 2) || distance <= dot ** 2) words[py * width + px] = 0xffffffff;
    }
  }
  window.render(width, height, width * 4, 'rgba32', pixels);
}

function target() {
  if (!geometryValid()) throw new Error('Calibration window geometry changed.');
  const [x, y] = points[step];
  const cx = (Math.floor(x * initial.pixelWidth) + 0.5) / initial.pixelWidth;
  const cy = (Math.floor(y * initial.pixelHeight) + 0.5) / initial.pixelHeight;
  const px = (initial.x + cx * initial.width - expected.x) / expected.width;
  const py = (initial.y + cy * initial.height - expected.y) / expected.height;
  if (px < 0 || px > 1 || py < 0 || py > 1) throw new Error('Target is outside the calibrated display.');
  return { x: px, y: py };
}

socket.on('connect', () => {
  try {
    try { sdl = require('@kmamal/sdl'); }
    catch { throw new Error('SDL native binding is missing. Run pnpm setup:sdl first.'); }
    const displays = matchingDisplays();
    if (displays.length !== 1) throw new Error('Saved display bounds do not uniquely match an active SDL display.');
    window = sdl.video.createWindow({ title: 'Eye tracker calibration', display: displays[0],
      visible: false, fullscreen: true, borderless: true });
    window.on('close', () => stop('Calibration window closed'));
    window.on('move', checkGeometry);
    window.on('resize', checkGeometry);
    window.on('displayChange', checkGeometry);
    sdl.video.on('displayAdd', checkGeometry);
    sdl.video.on('displayRemove', checkGeometry);
    sdl.video.on('displayOrient', checkGeometry);
    window.on('keyDown', event => {
      if (event.repeat) return;
      if (event.key === 'escape' || event.key === 'Escape') { stop('Calibration cancelled'); return; }
      if ((event.key === 'space' || event.key === ' ') && !busy) {
        try {
          const point = target();
          busy = true;
          if (phase === 'confirm') {
            const xScale = initial.pixelWidth / initial.width;
            const yScale = initial.pixelHeight / initial.height;
            if (!Number.isFinite(xScale) || !Number.isFinite(yScale) || xScale < 0.1 || xScale > 10 ||
                Math.abs(xScale - yScale) > 0.05) throw new Error('Could not determine consistent display scaling.');
            phase = 'starting';
            send({ type: 'ready', scaleFactor: (xScale + yScale) / 2 });
          }
          else if (phase === 'collecting') send({ type: 'point', step, ...point });
        }
        catch (error) { stop(error.message); }
      }
    });
    window.show();
    window.focus();
    let previous;
    let stable = 0;
    let attempts = 0;
    timer = setInterval(() => {
      try {
        const current = bounds();
        const displays = matchingDisplays();
        const valid = displays.length === 1 && window.fullscreen && window.display &&
          equal(window.display.geometry, expected) && usable(current);
        stable = valid && previous && sameWindow(current, previous) ? stable + 1 : 0;
        previous = current;
        if (stable >= 3) {
          clearInterval(timer); timer = undefined;
          initial = current;
          busy = false;
          draw();
        } else if (++attempts >= 100) stop('Could not establish a stable fullscreen window on the calibrated display.', 'error');
      } catch (error) { stop(error.message, 'error'); }
    }, 50);
  } catch (error) { stop(error.message, 'error'); }
});

readline.createInterface({ input: socket }).on('line', line => {
  try {
    const message = JSON.parse(line);
    if (message.type === 'start' || message.type === 'next') {
      if ((message.type === 'start' && phase !== 'starting') ||
          (message.type === 'next' && phase !== 'collecting')) throw new Error('Unexpected calibration state.');
      if (!Number.isInteger(message.step) || message.step < 0 || message.step >= points.length) throw new Error('Invalid calibration point.');
      step = message.step;
      draw();
      phase = 'collecting';
      busy = false;
    } else if (message.type === 'exit') stop();
    else throw new Error('Invalid bridge message.');
  } catch (error) { stop(error.message); }
});
socket.on('end', () => stop());
socket.on('error', () => { if (window && !window.destroyed) window.destroy(); });
