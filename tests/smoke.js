// Uji otomatis: menyalakan sendiri gateway + 2 service dengan database terpisah (db/test.db),
// lalu menjalankan skenario keamanan. Jalankan: npm test
process.env.DB_PATH = 'db/test.db';
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const jwt = require('jsonwebtoken');
const config = require('../common/config');
const ROOT = path.join(__dirname, '..');
const GW = config.gatewayUrl;

const procs = {};
function start(name, file, extraEnv = {}) {
  procs[name] = spawn(process.execPath, [file], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, ACCESS_HOUR_START: '0', ACCESS_HOUR_END: '24', ...extraEnv },
  });
}
async function waitUp(url) {
  for (let i = 0; i < 50; i++) {
    try { await fetch(url); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('server tidak naik: ' + url);
}
async function call(method, url, { headers = {}, body } = {}) {
  const r = await fetch(url, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
}

let pass = 0, failN = 0, n = 0;
function check(label, got, expected, extra = true) {
  n++;
  const ok = got === expected && extra;
  ok ? pass++ : failN++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${String(n).padStart(2)}. ${label}  (status ${got}, harapan ${expected})`);
}

const DEV = { admin: 'DEV-ADMIN-01', dosen1: 'DEV-DOSEN1-01', dosen2: 'DEV-DOSEN2-01', mhs1: 'DEV-MHS1-01', mhs2: 'DEV-MHS2-01' };
const PW = { admin: 'admin123', dosen1: 'dosen123', dosen2: 'dosen123', mhs1: 'mhs123', mhs2: 'mhs123' };
async function login(u, device = DEV[u]) {
  const r = await call('POST', `${GW}/auth/login`, { headers: { 'X-Device-ID': device }, body: { username: u, password: PW[u] } });
  return r;
}
const auth = (r, u) => ({ Authorization: `Bearer ${r.json.access_token}`, 'X-Device-ID': DEV[u] });

(async () => {
  execFileSync(process.execPath, ['db/seed.js'], { cwd: ROOT, env: process.env, stdio: 'ignore' });
  start('gateway', 'gateway/index.js');
  start('nilai', 'service-nilai/index.js');
  start('transkrip', 'service-transkrip/index.js');
  await Promise.all([waitUp(GW), waitUp(config.nilaiUrl), waitUp(config.transkripUrl)]);

  console.log('\n== Autentikasi & token ==');
  const mhs1 = await login('mhs1');
  check('Login benar + device terdaftar', mhs1.status, 200, !!mhs1.json.access_token && !!mhs1.json.refresh_token);
  check('Login dengan device TIDAK terdaftar', (await login('mhs1', 'DEV-LAIN')).status, 403);
  check('Login password salah', (await call('POST', `${GW}/auth/login`, { headers: { 'X-Device-ID': DEV.mhs1 }, body: { username: 'mhs1', password: 'salah' } })).status, 401);
  check('Akses tanpa token', (await call('GET', `${GW}/nilai`, { headers: { 'X-Device-ID': DEV.mhs1 } })).status, 401);
  const forged = jwt.sign({ sub: '4', role: 'mahasiswa' }, 'secret-palsu');
  check('Token dengan tanda tangan palsu', (await call('GET', `${GW}/nilai`, { headers: { Authorization: `Bearer ${forged}`, 'X-Device-ID': DEV.mhs1 } })).status, 401);
  const expired = jwt.sign({ sub: '4', role: 'mahasiswa' }, config.jwtSecret, { expiresIn: -10 });
  check('Token kedaluwarsa', (await call('GET', `${GW}/nilai`, { headers: { Authorization: `Bearer ${expired}`, 'X-Device-ID': DEV.mhs1 } })).status, 401);
  check('Request user tanpa X-Device-ID', (await call('GET', `${GW}/nilai`, { headers: { Authorization: `Bearer ${mhs1.json.access_token}` } })).status, 403);
  check('Device milik user lain dipakai mhs1', (await call('GET', `${GW}/nilai`, { headers: { Authorization: `Bearer ${mhs1.json.access_token}`, 'X-Device-ID': DEV.mhs2 } })).status, 403);

  console.log('\n== Gateway secret & verifikasi ulang di service ==');
  check('Akses langsung port 3001 tanpa secret', (await call('GET', `${config.nilaiUrl}/nilai`)).status, 403);
  check('Akses langsung port 3002 tanpa secret', (await call('GET', `${config.transkripUrl}/transkrip/2021001`)).status, 403);
  check('Secret benar tetapi TANPA token', (await call('GET', `${config.nilaiUrl}/nilai`, { headers: { 'X-Gateway-Secret': config.gatewaySecret } })).status, 401);
  check('Secret benar + token palsu', (await call('GET', `${config.nilaiUrl}/nilai`, { headers: { 'X-Gateway-Secret': config.gatewaySecret, Authorization: `Bearer ${forged}` } })).status, 401);

  console.log('\n== Kebijakan per role ==');
  const own = await call('GET', `${GW}/nilai`, { headers: auth(mhs1, 'mhs1') });
  check('Mahasiswa melihat nilai sendiri (hanya miliknya)', own.status, 200, own.json.length === 2 && own.json.every((x) => x.nim === '2021001'));
  check('Mahasiswa A lihat nilai mahasiswa B', (await call('GET', `${GW}/nilai?nim=2021002`, { headers: auth(mhs1, 'mhs1') })).status, 403);
  check('Mahasiswa A lihat transkrip mahasiswa B', (await call('GET', `${GW}/transkrip/2021002`, { headers: auth(mhs1, 'mhs1') })).status, 403);
  check('Mahasiswa ubah nilai', (await call('PUT', `${GW}/nilai/1`, { headers: auth(mhs1, 'mhs1'), body: { nilai: 100 } })).status, 403);

  const dosen1 = await login('dosen1'); const dosen2 = await login('dosen2');
  check('Dosen1 ubah nilai kelas milik dosen2', (await call('PUT', `${GW}/nilai/4`, { headers: auth(dosen1, 'dosen1'), body: { nilai: 99 } })).status, 403);
  check('Dosen1 ubah nilai kelas sendiri', (await call('PUT', `${GW}/nilai/1`, { headers: auth(dosen1, 'dosen1'), body: { nilai: 88 } })).status, 200);
  check('Dosen1 finalisasi kelas milik dosen2', (await call('POST', `${GW}/kelas/2/finalisasi`, { headers: auth(dosen1, 'dosen1') })).status, 403);
  check('Dosen lihat transkrip', (await call('GET', `${GW}/transkrip/2021001`, { headers: auth(dosen1, 'dosen1') })).status, 403);

  console.log('\n== Token service & sinkron ==');
  check('Token user memanggil /transkrip/sinkron', (await call('POST', `${GW}/transkrip/sinkron`, { headers: auth(dosen1, 'dosen1'), body: { kelas_id: 1, items: [] } })).status, 403);
  check('/auth/service dengan secret salah', (await call('POST', `${GW}/auth/service`, { body: { client_id: config.serviceClientId, client_secret: 'salah' } })).status, 401);
  const svc = await call('POST', `${GW}/auth/service`, { body: { client_id: config.serviceClientId, client_secret: config.serviceClientSecret } });
  check('/auth/service dengan kredensial benar', svc.status, 200, jwt.decode(svc.json.access_token).role === 'service');
  check('Token service membaca /nilai (tidak boleh)', (await call('GET', `${GW}/nilai`, { headers: { Authorization: `Bearer ${svc.json.access_token}` } })).status, 403);

  console.log('\n== Finalisasi -> sinkron transkrip lewat gateway ==');
  check('Dosen1 finalisasi kelas 1', (await call('POST', `${GW}/kelas/1/finalisasi`, { headers: auth(dosen1, 'dosen1') })).status, 200);
  check('Dosen1 ubah nilai yang sudah final', (await call('PUT', `${GW}/nilai/1`, { headers: auth(dosen1, 'dosen1'), body: { nilai: 50 } })).status, 403);
  const admin = await login('admin');
  const tr = await call('GET', `${GW}/transkrip/2021001`, { headers: auth(admin, 'admin') });
  check('Admin melihat transkrip (terisi setelah sinkron)', tr.status, 200, tr.json.mata_kuliah.length === 1 && tr.json.mata_kuliah[0].nilai === 88);
  const trMhs = await call('GET', `${GW}/transkrip/2021001`, { headers: auth(mhs1, 'mhs1') });
  check('Mahasiswa melihat transkrip sendiri', trMhs.status, 200, trMhs.json.mata_kuliah.length === 1);
  check('Admin melihat transkrip NIM lain', (await call('GET', `${GW}/transkrip/2021003`, { headers: auth(admin, 'admin') })).status, 200);
  check('Admin melihat nilai (tidak boleh)', (await call('GET', `${GW}/nilai`, { headers: auth(admin, 'admin') })).status, 403);

  console.log('\n== Refresh & logout ==');
  const rf = await call('POST', `${GW}/auth/refresh`, { body: { refresh_token: mhs1.json.refresh_token } });
  check('Refresh dengan token valid', rf.status, 200, !!rf.json.access_token);
  check('Logout', (await call('POST', `${GW}/auth/logout`, { body: { refresh_token: mhs1.json.refresh_token } })).status, 200);
  check('Refresh setelah logout', (await call('POST', `${GW}/auth/refresh`, { body: { refresh_token: mhs1.json.refresh_token } })).status, 401);

  console.log('\n== Jam akses (gateway dinyalakan ulang dengan jam 0-0 = selalu di luar jam) ==');
  procs.gateway.kill();
  await new Promise((r) => setTimeout(r, 400));
  start('gateway', 'gateway/index.js', { ACCESS_HOUR_START: '0', ACCESS_HOUR_END: '0' });
  await waitUp(GW);
  check('Dosen2 ubah nilai di luar jam akses', (await call('PUT', `${GW}/nilai/4`, { headers: auth(dosen2, 'dosen2'), body: { nilai: 77 } })).status, 403);
  check('Dosen2 finalisasi di luar jam akses', (await call('POST', `${GW}/kelas/2/finalisasi`, { headers: auth(dosen2, 'dosen2') })).status, 403);
  check('Dosen2 MELIHAT nilai tetap boleh di luar jam', (await call('GET', `${GW}/nilai`, { headers: auth(dosen2, 'dosen2') })).status, 200);

  console.log('\n== Audit log ==');
  const db = require('../db/db').open();
  const c = (h) => db.prepare('SELECT COUNT(*) c FROM audit_log WHERE hasil = ?').get(h).c;
  const sample = db.prepare("SELECT waktu,subjek,endpoint,device,hasil,alasan FROM audit_log WHERE alasan LIKE '%jam akses%' LIMIT 1").get();
  check('Audit log berisi keputusan allow & deny', 200, 200, c('allow') > 5 && c('deny') > 15);
  check('Audit log mencatat alasan jam akses', 200, 200, !!sample && !!sample.device);
  console.log('Contoh baris audit:', sample);

  Object.values(procs).forEach((p) => p.kill());
  console.log(`\nHasil: ${pass} lulus, ${failN} gagal`);
  process.exit(failN ? 1 : 0);
})().catch((e) => { console.error(e); Object.values(procs).forEach((p) => p.kill()); process.exit(1); });
