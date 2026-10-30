// Audit log (4.4): satu-satunya tempat penulisan log, dipanggil setelah SETIAP keputusan.
// Kolom: waktu, subjek (user/service), endpoint, device, hasil (allow/deny), alasan.
const db = require('../db/db').open();

const insert = db.prepare(
  'INSERT INTO audit_log (waktu,subjek,endpoint,device,hasil,alasan) VALUES (?,?,?,?,?,?)'
);

module.exports = function audit({ subjek, endpoint, device, hasil, alasan }) {
  const waktu = new Date().toISOString();
  insert.run(waktu, subjek, endpoint, device || null, hasil, alasan);
  console.log(
    `[AUDIT] ${waktu} ${hasil.toUpperCase().padEnd(5)} ${subjek} ${endpoint} device=${device || '-'} :: ${alasan}`
  );
};
