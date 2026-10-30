-- Skema database bersama (dipakai gateway/policy engine, Service Nilai, Service Transkrip)
DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS transkrip;
DROP TABLE IF EXISTS nilai;
DROP TABLE IF EXISTS kelas;
DROP TABLE IF EXISTS devices;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('mahasiswa','dosen','admin')),
  nama          TEXT NOT NULL,
  nim           TEXT UNIQUE            -- hanya diisi untuk mahasiswa
);

CREATE TABLE devices (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER NOT NULL REFERENCES users(id),
  device_id TEXT NOT NULL,
  UNIQUE (user_id, device_id)
);

CREATE TABLE kelas (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  kode     TEXT NOT NULL,
  nama     TEXT NOT NULL,
  dosen_id INTEGER NOT NULL REFERENCES users(id)
);

CREATE TABLE nilai (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  kelas_id INTEGER NOT NULL REFERENCES kelas(id),
  nim      TEXT NOT NULL,
  nilai    REAL,
  status   TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','final')),
  UNIQUE (kelas_id, nim)
);

CREATE TABLE transkrip (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  nim      TEXT NOT NULL,
  kelas_id INTEGER NOT NULL REFERENCES kelas(id),
  nilai    REAL NOT NULL,
  UNIQUE (nim, kelas_id)
);

-- Refresh token disimpan sebagai HASH (SHA-256) agar bocornya DB tidak membocorkan token.
CREATE TABLE refresh_tokens (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  revoked    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE audit_log (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  waktu    TEXT NOT NULL,
  subjek   TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  device   TEXT,
  hasil    TEXT NOT NULL CHECK (hasil IN ('allow','deny')),
  alasan   TEXT NOT NULL
);
