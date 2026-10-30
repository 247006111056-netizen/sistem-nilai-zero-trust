const crypto = require('crypto');

// Perbandingan string yang tahan timing attack.
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

module.exports = { safeEqual, sha256 };
