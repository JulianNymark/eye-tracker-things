const net = require('node:net');
const readline = require('node:readline');
const display = JSON.parse(process.argv[2]);
const socket = net.createConnection(process.argv[3]);
const send = value => socket.write(JSON.stringify(value) + '\n');
socket.on('connect', () => send({ type: 'ready', scaleFactor: 1 }));
readline.createInterface({ input: socket }).on('line', line => {
  const msg = JSON.parse(line);
  if (msg.type === 'exit') { process.exit(0); return; }
  if (display.id === 'cancel') { socket.end(JSON.stringify({ type: 'cancel', reason: 'cancelled by test' }) + '\n'); return; }
  if (msg.type === 'start' || msg.type === 'next') {
    send({ type: 'point', step: msg.step, x: (msg.step + 1) / 10, y: 0.5 });
  }
});
