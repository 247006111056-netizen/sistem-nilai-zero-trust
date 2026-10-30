// Middleware keamanan di sisi SERVICE (bukan di gateway).
// Prinsip zero trust: service tidak percaya begitu saja pada gateway.
//   1) Cek X-Gateway-Secret  -> service tidak bisa diakses langsung.
//   2) Verifikasi ulang tanda tangan + masa berlaku JWT (access token / token service).
// Kedua cek WAJIB lolos. Secret benar tapi tanpa token valid tetap ditolak (401).
const jwt = require('jsonwebtoken');
const config = require('./config');
const { safeEqual } = require('./util');

module.exports = function guard(req, res, next) {
  // 1) Gateway secret
  const secret = req.get('x-gateway-secret');
  if (!secret || !safeEqual(secret, config.gatewaySecret)) {
    return res.status(403).json({
      error: 'forbidden',
      reason: 'X-Gateway-Secret tidak ada/salah. Service hanya boleh diakses lewat gateway.',
    });
  }

  // 2) Verifikasi ulang token
  const [scheme, token] = (req.get('authorization') || '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'unauthorized', reason: 'Bearer token tidak ada' });
  }
  try {
    req.auth = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  } catch (e) {
    const reason = e.name === 'TokenExpiredError' ? 'token kedaluwarsa' : 'token tidak valid';
    return res.status(401).json({ error: 'unauthorized', reason });
  }
  next();
};
