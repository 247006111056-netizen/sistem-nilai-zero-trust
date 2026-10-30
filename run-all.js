// Menjalankan gateway + 2 service sekaligus dalam satu terminal (npm start).
// Boleh juga dijalankan terpisah: npm run start:gateway / start:nilai / start:transkrip
const { spawn } = require('child_process');
const apps = [
  ['gateway', 'gateway/index.js'],
  ['nilai', 'service-nilai/index.js'],
  ['transkrip', 'service-transkrip/index.js'],
];
const children = apps.map(([name, file]) => {
  const c = spawn(process.execPath, [file], { stdio: 'inherit' });
  c.on('exit', (code) => { console.log(`[${name}] berhenti (kode ${code})`); });
  return c;
});
const stop = () => { children.forEach((c) => c.kill()); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
