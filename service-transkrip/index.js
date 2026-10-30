// SERVICE TRANSKRIP (port 3002): data transkrip mahasiswa.
// Hanya bisa dipanggil lewat gateway (guard: X-Gateway-Secret + verifikasi ulang JWT).
const express = require('express');
const config = require('../common/config');
const guard = require('../common/guard');
const db = require('../db/db').open();

const q = {
  user: db.prepare('SELECT id,role,nim FROM users WHERE id = ?'),
  list: db.prepare(
    `SELECT t.nim, t.kelas_id, k.kode, k.nama AS mata_kuliah, t.nilai
     FROM transkrip t JOIN kelas k ON k.id = t.kelas_id WHERE t.nim = ? ORDER BY t.kelas_id`
  ),
  upsert: db.prepare(
    `INSERT INTO transkrip (nim,kelas_id,nilai) VALUES (?,?,?)
     ON CONFLICT(nim,kelas_id) DO UPDATE SET nilai = excluded.nilai`
  ),
};

const app = express();
app.disable('x-powered-by');
app.use(guard);
app.use(express.json());

// GET /transkrip/:nim -> mahasiswa: NIM sendiri, admin: semua NIM
app.get('/transkrip/:nim', (req, res) => {
  if (req.auth.role === 'service') return res.status(403).json({ error: 'forbidden' });
  const user = q.user.get(Number(req.auth.sub));
  if (!user) return res.status(403).json({ error: 'forbidden' });
  // Defense in depth: cek ulang kepemilikan di service
  if (user.role === 'mahasiswa' && user.nim !== req.params.nim) {
    return res.status(403).json({ error: 'forbidden', reason: 'bukan transkrip milik sendiri' });
  }
  if (!['mahasiswa', 'admin'].includes(user.role)) return res.status(403).json({ error: 'forbidden' });
  res.json({ nim: req.params.nim, mata_kuliah: q.list.all(req.params.nim) });
});

// POST /transkrip/sinkron -> HANYA token service
app.post('/transkrip/sinkron', (req, res) => {
  if (req.auth.role !== 'service') {
    return res.status(403).json({ error: 'forbidden', reason: 'hanya token service' });
  }
  const { kelas_id, items } = req.body || {};
  const valid =
    Number.isInteger(kelas_id) && Array.isArray(items) &&
    items.every((i) => typeof i.nim === 'string' && Number.isFinite(i.nilai));
  if (!valid) return res.status(400).json({ error: 'body harus {kelas_id, items:[{nim, nilai}]}' });

  db.transaction(() => items.forEach((i) => q.upsert.run(i.nim, kelas_id, i.nilai)))();
  res.json({ message: 'transkrip tersinkron', jumlah: items.length });
});

app.listen(config.ports.transkrip, () =>
  console.log(`[service-transkrip] berjalan di http://localhost:${config.ports.transkrip}`)
);
