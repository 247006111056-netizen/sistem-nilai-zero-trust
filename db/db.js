// Pembuka koneksi SQLite bersama. Semua proses memakai file yang sama (satu database bersama).
// Memakai SQLite BAWAAN Node.js (node:sqlite, Node 22.13+), jadi tidak ada paket native
// yang harus dikompilasi. Pembungkus kecil ini menjaga API tetap: prepare/exec/transaction.
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../common/config');

const file = path.resolve(__dirname, '..', config.dbPath);

function open({ create = false } = {}) {
  if (!create && !fs.existsSync(file)) {
    throw new Error(`Database ${file} belum ada. Jalankan dulu: npm run seed`);
  }
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL');   // aman dibuka oleh 3 proses sekaligus
  raw.exec('PRAGMA busy_timeout = 5000');
  raw.exec('PRAGMA foreign_keys = ON');

  return {
    prepare: (sql) => raw.prepare(sql),
    exec: (sql) => raw.exec(sql),
    // transaction(fn) -> fungsi yang menjalankan fn di dalam BEGIN/COMMIT (ROLLBACK jika error)
    transaction: (fn) => (...args) => {
      raw.exec('BEGIN IMMEDIATE');
      try {
        const result = fn(...args);
        raw.exec('COMMIT');
        return result;
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      }
    },
    close: () => raw.close(),
  };
}

module.exports = { open, file };
