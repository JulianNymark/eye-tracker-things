// Optional integration test: use the real SDL dummy video driver and generate
// one Space event after each rendered frame. No hardware or desktop is touched.
const sdl = require('@kmamal/sdl');
const create = sdl.video.createWindow.bind(sdl.video);
sdl.video.createWindow = options => {
  const window = create({ ...options, accelerated: false });
  const render = window.render.bind(window);
  window.render = (...args) => {
    render(...args);
    setImmediate(() => window.emit('keyDown', { key: 'space', repeat: false }));
  };
  return window;
};
