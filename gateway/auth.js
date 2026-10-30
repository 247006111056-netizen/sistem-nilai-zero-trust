// Policy Administrator (PA): login, refresh, logout, dan token service.
// Semua endpoint /auth/* ditangani langsung oleh gateway (tidak diteruskan ke service).
const crypto = require('crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const config = require('../common/config');
const { safeEqual, sha256 } = require('../common/util');
const db = require('../db/db').open();
const audit = require('./audit');

const q = {
  userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  device: db.prepare('SELECT 1 FROM devices WHERE user_id = ? AND device_id = ?'),
  insRefresh: db.prepare('INSERT INTO refresh_tokens (token_hash,user_id,expires_at) VALUES (?,?,?)'),
  getRefresh: db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?'),
  revoke: db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?'),
};

const DUMMY_HASH = bcrypt.hashSync('dummy-password', 10); // menyamakan waktu respons

const router = express.Router();
router.use(express.json());

// Access token: JWT 10 menit, berisi sub + role
const signAccess = (user) =>
  jwt.sign({ sub: String(user.id), role: user.role }, config.jwtSecret, {
    algorithm: 'HS256', expiresIn: config.accessTokenTtl,
  });

// Cari refresh token yang valid (ada, belum dicabut, belum kedaluwarsa)
function findValidRefresh(token) {
  if (typeof token !== 'string' || !token) return { error: 'refresh token tidak ada' };
  const row = q.getRefresh.get(sha256(token));
  if (!row) return { error: 'refresh token tidak dikenal' };
  if (row.revoked) return { error: 'refresh token sudah dicabut' };
  if (new Date(row.expires_at) < new Date()) return { error: 'refresh token kedaluwarsa' };
  return { row };
}

// POST /auth/login  (kredensial valid + device terdaftar)
router.post('/login', (req, res) => {
  const ep = 'POST /auth/login';
  const device = req.get('x-device-id') || null;
  const { username, password } = req.body || {};
  const fail = (status, alasan, msg) => {
    audit({ subjek: `user:${username || '?'}`, endpoint: ep, device, hasil: 'deny', alasan });
    return res.status(status).json({ error: msg });
  };

  if (typeof username !== 'string' || typeof password !== 'string') {
    return fail(400, 'body login tidak lengkap', 'username dan password wajib diisi');
  }
  const user = q.userByName.get(username);
  const passOk = bcrypt.compareSync(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !passOk) return fail(401, 'kredensial tidak valid', 'kredensial tidak valid');

  if (!device || !q.device.get(user.id, device)) {
    return fail(403, 'device tidak terdaftar untuk user ini', 'device tidak terdaftar');
  }

  const refreshToken = crypto.randomBytes(32).toString('hex');
  q.insRefresh.run(
    sha256(refreshToken), user.id, new Date(Date.now() + config.refreshTokenTtlMs).toISOString()
  );
  audit({ subjek: `user:${user.username}(${user.role})`, endpoint: ep, device, hasil: 'allow', alasan: 'login berhasil' });
  res.json({
    token_type: 'Bearer',
    access_token: signAccess(user),
    expires_in: 600,
    refresh_token: refreshToken,
  });
});

// POST /auth/refresh  (refresh token valid dan belum dicabut)
router.post('/refresh', (req, res) => {
  const ep = 'POST /auth/refresh';
  const device = req.get('x-device-id') || null;
  const { error, row } = findValidRefresh((req.body || {}).refresh_token);
  if (error) {
    audit({ subjek: 'anonymous', endpoint: ep, device, hasil: 'deny', alasan: error });
    return res.status(401).json({ error });
  }
  const user = q.userById.get(row.user_id);
  audit({ subjek: `user:${user.username}(${user.role})`, endpoint: ep, device, hasil: 'allow', alasan: 'access token diperbarui' });
  res.json({ token_type: 'Bearer', access_token: signAccess(user), expires_in: 600 });
});

// POST /auth/logout  (mencabut refresh token)
router.post('/logout', (req, res) => {
  const ep = 'POST /auth/logout';
  const device = req.get('x-device-id') || null;
  const { error, row } = findValidRefresh((req.body || {}).refresh_token);
  if (error) {
    audit({ subjek: 'anonymous', endpoint: ep, device, hasil: 'deny', alasan: error });
    return res.status(401).json({ error });
  }
  q.revoke.run(row.id);
  const user = q.userById.get(row.user_id);
  audit({ subjek: `user:${user.username}(${user.role})`, endpoint: ep, device, hasil: 'allow', alasan: 'refresh token dicabut' });
  res.json({ message: 'logout berhasil, refresh token dicabut' });
});

// POST /auth/service  (client ID + secret Service Nilai -> token 5 menit, role: service)
router.post('/service', (req, res) => {
  const ep = 'POST /auth/service';
  const { client_id, client_secret } = req.body || {};
  const ok =
    typeof client_id === 'string' && typeof client_secret === 'string' &&
    safeEqual(client_id, config.serviceClientId) &&
    safeEqual(client_secret, config.serviceClientSecret);
  if (!ok) {
    audit({ subjek: `service:${client_id || '?'}`, endpoint: ep, device: null, hasil: 'deny', alasan: 'client ID/secret tidak valid' });
    return res.status(401).json({ error: 'client ID atau secret tidak valid' });
  }
  const token = jwt.sign({ sub: client_id, role: 'service' }, config.jwtSecret, {
    algorithm: 'HS256', expiresIn: config.serviceTokenTtl,
  });
  audit({ subjek: `service:${client_id}`, endpoint: ep, device: null, hasil: 'allow', alasan: 'token service diterbitkan' });
  res.json({ token_type: 'Bearer', access_token: token, expires_in: 300 });
});

module.exports = router;
