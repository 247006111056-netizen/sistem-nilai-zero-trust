// Konfigurasi terpusat. Semua nilai dibaca dari .env (lihat .env.example).
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function need(key) {
  const v = process.env[key];
  if (!v) throw new Error(`Env ${key} belum diisi. Salin .env.example menjadi .env`);
  return v;
}

const ports = {
  gateway: Number(process.env.GATEWAY_PORT || 3000),
  nilai: Number(process.env.NILAI_PORT || 3001),
  transkrip: Number(process.env.TRANSKRIP_PORT || 3002),
};

module.exports = {
  ports,
  gatewayUrl: process.env.GATEWAY_URL || `http://localhost:${ports.gateway}`,
  nilaiUrl: process.env.NILAI_URL || `http://localhost:${ports.nilai}`,
  transkripUrl: process.env.TRANSKRIP_URL || `http://localhost:${ports.transkrip}`,

  jwtSecret: need('JWT_SECRET'),
  gatewaySecret: need('GATEWAY_SECRET'),
  serviceClientId: need('SERVICE_CLIENT_ID'),
  serviceClientSecret: need('SERVICE_CLIENT_SECRET'),

  accessTokenTtl: '10m',   // access token user
  serviceTokenTtl: '5m',   // token service
  refreshTokenTtlMs: 24 * 60 * 60 * 1000, // refresh token 1 hari

  // Jam akses (dapat diatur lewat .env agar mudah didemokan)
  accessHours: {
    start: Number(process.env.ACCESS_HOUR_START ?? 7),
    end: Number(process.env.ACCESS_HOUR_END ?? 21),
    tz: process.env.ACCESS_TZ || 'Asia/Jakarta',
  },

  dbPath: process.env.DB_PATH || 'db/app.db',
};
