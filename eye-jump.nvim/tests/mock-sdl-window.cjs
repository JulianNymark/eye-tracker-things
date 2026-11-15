const Module = require('node:module');
const { EventEmitter } = require('node:events');
const display = JSON.parse(process.argv[2]);
const originalLoad = Module._load;
const displayObject = { name: 'test', geometry: { x: display.x, y: display.y, width: display.width, height: display.height } };

class Window extends EventEmitter {
  constructor() {
    super();
    this.display = displayObject;
    this.x = display.x + 10;
    this.y = display.y + 20;
    this.width = display.width - 20;
    this.height = display.height - 40;
    this.pixelWidth = this.width * 2;
    this.pixelHeight = this.height * 2;
    this.fullscreen = true;
    this.destroyed = false;
    this.step = 0;
  }
  show() {}
  focus() {}
  render(width, height, stride, format, pixels) {
    const positions = [[0.5, 0.5], [0.5, 0.5], [0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9],
      [0.5, 0.1], [0.9, 0.5], [0.5, 0.9], [0.1, 0.5]];
    const [x, y] = positions[this.step++];
    const cx = Math.floor(x * width), cy = Math.floor(y * height);
    const offset = cy * stride + cx * 4;
    if (format !== 'rgba32' || width !== this.pixelWidth || height !== this.pixelHeight ||
        pixels.readUInt32LE(offset) !== 0xffffffff) throw new Error('The calibration dot was not rendered correctly');
    const key = display.id === 'cancel-before' && this.step === 1 ? 'escape' : 'space';
    setImmediate(() => this.emit('keyDown', { key, repeat: false }));
  }
  destroy() { this.destroyed = true; this.emit('close'); }
}

Module._load = function(request, parent, main) {
  if (request === '@kmamal/sdl') {
    const video = new EventEmitter();
    const addListener = video.on;
    video.on = function(name, listener) {
      if (!['displayAdd', 'displayRemove', 'displayOrient'].includes(name)) throw new Error(`Unsupported SDL2 event: ${name}`);
      return addListener.call(this, name, listener);
    };
    const other = { name: 'other', geometry: { x: display.x + display.width, y: display.y,
      width: display.width, height: display.height } };
    video.displays = display.id === 'multiple' ? [other, displayObject] :
      display.id === 'duplicate' ? [displayObject, { ...displayObject }] : [displayObject];
    video.createWindow = options => {
      if (options.display !== displayObject) throw new Error('The wrong monitor was selected');
      return new Window();
    };
    return { video };
  }
  return originalLoad.call(this, request, parent, main);
};
require('../src/fullscreen-calibration-sdl.cjs');
