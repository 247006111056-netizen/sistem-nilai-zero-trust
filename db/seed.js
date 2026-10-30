// Data awal: 1 admin, 2 dosen, 3 mahasiswa, 2 kelas (dosen berbeda), 1 device per user.
// PERINGATAN: menjalankan seed MENGHAPUS & membuat ulang semua tabel.
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { open, file } = require('./db');

const db = open({ create: true });
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

const users = [
  // username, password, role, nama, nim, device
  ['admin',   'admin123',  'admin',     'Admin Akademik',  null,      'DEV-ADMIN-01'],
  ['dosen1',  'dosen123',  'dosen',     'Dr. Budi Santoso', null,     'DEV-DOSEN1-01'],
  ['dosen2',  'dosen123',  'dosen',     'Dr. Sari Wulandari', null,   'DEV-DOSEN2-01'],
  ['mhs1',    'mhs123',    'mahasiswa', 'Andi Pratama',    '2021001', 'DEV-MHS1-01'],
  ['mhs2',    'mhs123',    'mahasiswa', 'Citra Lestari',   '2021002', 'DEV-MHS2-01'],
  ['mhs3',    'mhs123',    'mahasiswa', 'Dewi Anggraini',  '2021003', 'DEV-MHS3-01'],
];

const insUser = db.prepare('INSERT INTO users (username,password_hash,role,nama,nim) VALUES (?,?,?,?,?)');
const insDev = db.prepare('INSERT INTO devices (user_id,device_id) VALUES (?,?)');
const ids = {};
for (const [username, pw, role, nama, nim, dev] of users) {
  const r = insUser.run(username, bcrypt.hashSync(pw, 10), role, nama, nim);
  insDev.run(r.lastInsertRowid, dev);
  ids[username] = Number(r.lastInsertRowid);
}

// Dua kelas, diampu dosen berbeda
const insKelas = db.prepare('INSERT INTO kelas (kode,nama,dosen_id) VALUES (?,?,?)');
const k1 = Number(insKelas.run('KP70065004', 'Keamanan Informasi', ids.dosen1).lastInsertRowid);
const k2 = Number(insKelas.run('KP70023003', 'Basis Data', ids.dosen2).lastInsertRowid);

// Nilai (status draft). Urutan id: kelas 1 -> id 1..3, kelas 2 -> id 4..6
const insNilai = db.prepare('INSERT INTO nilai (kelas_id,nim,nilai,status) VALUES (?,?,?,?)');
const skor = { 2021001: [80, 75], 2021002: [85, 90], 2021003: [70, 65] };
for (const nim of Object.keys(skor)) insNilai.run(k1, nim, skor[nim][0], 'draft');
for (const nim of Object.keys(skor)) insNilai.run(k2, nim, skor[nim][1], 'draft');

console.log(`Seed selesai -> ${file}`);
console.table(users.map(([u, p, r, , nim, d]) => ({ username: u, password: p, role: r, nim: nim || '-', device_id: d })));
