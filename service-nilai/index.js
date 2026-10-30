// SERVICE NILAI (port 3001): data nilai dan kelas.
// Hanya bisa dipanggil lewat gateway (guard: X-Gateway-Secret + verifikasi ulang JWT).
const express = require('express');
const config = require('../common/config');
const guard = require('../common/guard');
const db = require('../db/db').open();

const q = {
  user: db.prepare('SELECT id,role,nim FROM users WHERE id = ?'),
  kelas: db.prepare('SELECT * FROM kelas WHERE id = ?'),
  nilaiRow: db.prepare(
    'SELECT n.*, k.dosen_id FROM nilai n JOIN kelas k ON k.id = n.kelas_id WHERE n.id = ?'
  ),
  nilaiKelas: db.prepare('SELECT id,nim,nilai,status FROM nilai WHERE kelas_id = ?'),
  update: db.prepare('UPDATE nilai SET nilai = ? WHERE id = ?'),
  setFinal: db.prepare("UPDATE nilai SET status = 'final' WHERE id = ?"),
  setDraft: db.prepare("UPDATE nilai SET status = 'draft' WHERE id = ?"),
};

const app = express();
app.disable('x-powered-by');
app.use(guard);          // 1) gateway secret + 2) token, WAJIB lolos dua-duanya
app.use(express.json());

// User dari token (token user berisi sub = id user). Token service tidak punya user.
const currentUser = (req) => (req.auth.role === 'service' ? null : q.user.get(Number(req.auth.sub)));

// GET /nilai  -> mahasiswa: nilai sendiri, dosen: nilai kelas yang diampu
app.get('/nilai', (req, res) => {
  const user = currentUser(req);
  if (!user || !['mahasiswa', 'dosen'].includes(user.role)) {
    return res.status(403).json({ error: 'forbidden', reason: 'role tidak diizinkan' });
  }
  let sql = `SELECT n.id, n.kelas_id, k.nama AS kelas, n.nim, n.nilai, n.status
             FROM nilai n JOIN kelas k ON k.id = n.kelas_id WHERE 1=1`;
  const params = [];
  // Defense in depth: hasil selalu difilter sesuai pemilik, apa pun query-nya.
  if (user.role === 'mahasiswa') { sql += ' AND n.nim = ?'; params.push(user.nim); }
  else { sql += ' AND k.dosen_id = ?'; params.push(user.id); }
  if (req.query.nim) { sql += ' AND n.nim = ?'; params.push(String(req.query.nim)); }
  if (req.query.kelas_id) { sql += ' AND n.kelas_id = ?'; params.push(Number(req.query.kelas_id)); }
  res.json(db.prepare(sql + ' ORDER BY n.id').all(...params));
});

// PUT /nilai/:id  -> dosen pengampu, nilai belum final
app.put('/nilai/:id', (req, res) => {
  const user = currentUser(req);
  const row = q.nilaiRow.get(Number(req.params.id));
  if (!user || user.role !== 'dosen') return res.status(403).json({ error: 'forbidden' });
  if (!row) return res.status(404).json({ error: 'nilai tidak ditemukan' });
  if (row.dosen_id !== user.id) return res.status(403).json({ error: 'bukan pengampu kelas' });
  if (row.status === 'final') return res.status(409).json({ error: 'nilai sudah final' });

  const nilai = Number(req.body && req.body.nilai);
  if (!Number.isFinite(nilai) || nilai < 0 || nilai > 100) {
    return res.status(400).json({ error: 'nilai harus angka 0-100' });
  }
  q.update.run(nilai, row.id);
  res.json({ id: row.id, nim: row.nim, nilai, status: row.status });
});

// Token service untuk memanggil gateway (POST /auth/service)
async function getServiceToken() {
  const r = await fetch(`${config.gatewayUrl}/auth/service`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: config.serviceClientId, client_secret: config.serviceClientSecret }),
  });
  if (!r.ok) throw new Error(`gagal mendapat token service (${r.status})`);
  return (await r.json()).access_token;
}

// POST /kelas/:id/finalisasi -> final-kan nilai, lalu sinkron ke Service Transkrip LEWAT GATEWAY
app.post('/kelas/:id/finalisasi', async (req, res) => {
  const user = currentUser(req);
  const kelas = q.kelas.get(Number(req.params.id));
  if (!user || user.role !== 'dosen') return res.status(403).json({ error: 'forbidden' });
  if (!kelas) return res.status(404).json({ error: 'kelas tidak ditemukan' });
  if (kelas.dosen_id !== user.id) return res.status(403).json({ error: 'bukan pengampu kelas' });

  const rows = q.nilaiKelas.all(kelas.id);
  if (rows.length === 0) return res.status(404).json({ error: 'kelas belum punya data nilai' });
  if (rows.some((r) => r.nilai === null)) {
    return res.status(422).json({ error: 'masih ada nilai kosong, lengkapi sebelum finalisasi' });
  }

  // 1) Ubah status menjadi final (transaksi)
  const drafts = rows.filter((r) => r.status !== 'final').map((r) => r.id);
  db.transaction((ids) => ids.forEach((id) => q.setFinal.run(id)))(drafts);

  // 2) Minta token service, 3) panggil sinkron transkrip melalui gateway
  try {
    const token = await getServiceToken();
    const r = await fetch(`${config.gatewayUrl}/transkrip/sinkron`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ kelas_id: kelas.id, items: rows.map((x) => ({ nim: x.nim, nilai: x.nilai })) }),
    });
    if (!r.ok) throw new Error(`sinkron ditolak (${r.status})`);
    res.json({ message: 'kelas difinalisasi dan transkrip tersinkron', kelas_id: kelas.id, jumlah_nilai: rows.length });
  } catch (e) {
    // Sinkron gagal -> kembalikan status agar data tetap konsisten
    db.transaction((ids) => ids.forEach((id) => q.setDraft.run(id)))(drafts);
    res.status(502).json({ error: 'finalisasi dibatalkan', reason: e.message });
  }
});

app.listen(config.ports.nilai, () =>
  console.log(`[service-nilai] berjalan di http://localhost:${config.ports.nilai}`)
);
