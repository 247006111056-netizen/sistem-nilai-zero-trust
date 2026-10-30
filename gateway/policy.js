// POLICY ENGINE (PE). Satu fungsi: decide() -> { allow, status, reason, subject }.
// Kebijakan mengikuti Tabel 3. Keputusan yang bergantung pada KEPEMILIKAN DATA
// (kelas yang diampu, NIM milik sendiri, status final) dibaca dari DATABASE,
// bukan dari isi token. Prinsip: default deny.
const db = require('../db/db').open();
const config = require('../common/config');

const q = {
  user: db.prepare('SELECT id,username,role,nim FROM users WHERE id = ?'),
  device: db.prepare('SELECT 1 FROM devices WHERE user_id = ? AND device_id = ?'),
  kelas: db.prepare('SELECT id,dosen_id FROM kelas WHERE id = ?'),
  nilai: db.prepare(
    'SELECT n.id,n.status,k.dosen_id FROM nilai n JOIN kelas k ON k.id = n.kelas_id WHERE n.id = ?'
  ),
};

// Jam saat ini pada zona waktu yang dikonfigurasi (default Asia/Jakarta).
function currentHour(now) {
  const h = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', hourCycle: 'h23', timeZone: config.accessHours.tz,
  }).format(now);
  return parseInt(h, 10);
}

function withinAccessHours(now) {
  const { start, end } = config.accessHours;
  const h = currentHour(now);
  return h >= start && h < end;
}

/**
 * @param {object} p
 * @param {object} p.claims   payload JWT yang SUDAH diverifikasi gateway ({sub, role})
 * @param {string} p.method   HTTP method
 * @param {string} p.url      URL asli (path + query)
 * @param {string|null} p.deviceId  header X-Device-ID
 * @param {Date}   p.now
 */
function decide({ claims, method, url, deviceId, now = new Date() }) {
  let subject = `${claims.role === 'service' ? 'service' : 'user'}:${claims.sub}`;
  const allow = (reason) => ({ allow: true, status: 200, reason, subject });
  const deny = (reason, status = 403) => ({ allow: false, status, reason, subject });

  const u = new URL(url, 'http://gateway');
  const p = u.pathname.replace(/\/+$/, '') || '/';
  method = method.toUpperCase();

  // ---------- Token SERVICE ----------
  if (claims.role === 'service') {
    if (method === 'POST' && p === '/transkrip/sinkron') {
      return allow('token service valid memanggil sinkron transkrip');
    }
    return deny('token service hanya boleh memanggil POST /transkrip/sinkron');
  }

  // ---------- Token USER: verifikasi atribut dari database ----------
  const user = q.user.get(Number(claims.sub));
  if (!user) return deny('user pada token tidak ada di database', 401);
  subject = `user:${user.username}(${user.role})`;
  if (user.role !== claims.role) return deny('role pada token tidak sesuai dengan database');

  // Verifikasi konteks 1: device terdaftar
  if (!deviceId) return deny('header X-Device-ID tidak ada');
  if (!q.device.get(user.id, deviceId)) return deny('device tidak terdaftar untuk user ini');

  let m;

  // GET /nilai : mahasiswa (nilai sendiri), dosen (kelas yang diampu)
  if (method === 'GET' && p === '/nilai') {
    const nim = u.searchParams.get('nim');
    const kelasId = u.searchParams.get('kelas_id');
    if (user.role === 'mahasiswa') {
      if (nim && nim !== user.nim) return deny('mahasiswa hanya boleh melihat nilai miliknya sendiri');
      return allow('mahasiswa melihat nilai sendiri');
    }
    if (user.role === 'dosen') {
      if (kelasId) {
        const k = q.kelas.get(Number(kelasId));
        if (!k || k.dosen_id !== user.id) return deny('dosen hanya boleh melihat kelas yang diampu');
      }
      return allow('dosen melihat nilai kelas yang diampu');
    }
    return deny('role admin tidak boleh melihat nilai');
  }

  // PUT /nilai/:id : dosen, kelas diampu, belum final, dalam jam akses
  if (method === 'PUT' && (m = p.match(/^\/nilai\/(\d+)$/))) {
    if (user.role !== 'dosen') return deny('hanya dosen yang boleh mengubah nilai');
    const row = q.nilai.get(Number(m[1]));
    if (!row) return deny('data nilai tidak ditemukan', 404);
    if (row.dosen_id !== user.id) return deny('dosen bukan pengampu kelas ini');
    if (row.status === 'final') return deny('nilai sudah final dan tidak boleh diubah');
    if (!withinAccessHours(now)) return deny('di luar jam akses perubahan nilai');
    return allow('dosen mengubah nilai kelas yang diampu');
  }

  // POST /kelas/:id/finalisasi : dosen, kelas diampu, dalam jam akses
  if (method === 'POST' && (m = p.match(/^\/kelas\/(\d+)\/finalisasi$/))) {
    if (user.role !== 'dosen') return deny('hanya dosen yang boleh memfinalisasi nilai');
    const k = q.kelas.get(Number(m[1]));
    if (!k) return deny('kelas tidak ditemukan', 404);
    if (k.dosen_id !== user.id) return deny('dosen bukan pengampu kelas ini');
    if (!withinAccessHours(now)) return deny('di luar jam akses finalisasi nilai');
    return allow('dosen memfinalisasi kelas yang diampu');
  }

  // POST /transkrip/sinkron : HANYA token service (token user mana pun ditolak)
  if (method === 'POST' && p === '/transkrip/sinkron') {
    return deny('sinkron transkrip hanya untuk token service');
  }

  // GET /transkrip/:nim : mahasiswa (NIM sendiri), admin (semua)
  if (method === 'GET' && (m = p.match(/^\/transkrip\/([^/]+)$/))) {
    const nim = decodeURIComponent(m[1]);
    if (user.role === 'admin') return allow('admin melihat transkrip');
    if (user.role === 'mahasiswa') {
      if (nim !== user.nim) return deny('mahasiswa hanya boleh melihat transkrip miliknya sendiri');
      return allow('mahasiswa melihat transkrip sendiri');
    }
    return deny('role dosen tidak boleh melihat transkrip');
  }

  return deny('tidak ada kebijakan yang mengizinkan (default deny)');
}

module.exports = { decide, withinAccessHours };
