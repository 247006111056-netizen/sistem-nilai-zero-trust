// API GATEWAY = POLICY ENFORCEMENT POINT (PEP), port 3000. Satu-satunya pintu masuk.
// Alur tiap request ke resource:
//   1) verifikasi access token  2) minta keputusan ke policy.decide()
//   3) catat audit log          4) jika allow -> proxy + X-Gateway-Secret, jika deny -> tolak
const express = require('express');
const jwt = require('jsonwebtoken');
const { createProxyMiddleware } = require('http-proxy-middleware');
const config = require('../common/config');
const { decide } = require('./policy');
const audit = require('./audit');
const authRouter = require('./auth');

const app = express();
app.disable('x-powered-by');

// /auth/* ditangani gateway sendiri (PE/PA), tidak diteruskan ke service.
app.use('/auth', authRouter);

// ---- PEP: berlaku untuk semua endpoint selain /auth/* ----
function pep(req, res, next) {
  const endpoint = `${req.method} ${req.originalUrl.split('?')[0]}`;
  const device = req.get('x-device-id') || null;

  const deny401 = (subjek, alasan) => {
    audit({ subjek, endpoint, device, hasil: 'deny', alasan });
    return res.status(401).json({ error: 'unauthorized', reason: alasan });
  };

  // 1) Verifikasi access token (tanda tangan + masa berlaku)
  const [scheme, token] = (req.get('authorization') || '').split(' ');
  if (scheme !== 'Bearer' || !token) return deny401('anonymous', 'access token tidak ada');
  let claims;
  try {
    claims = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  } catch (e) {
    return deny401('anonymous', e.name === 'TokenExpiredError' ? 'access token kedaluwarsa' : 'access token tidak valid');
  }

  // 2) Keputusan dari Policy Engine
  const d = decide({ claims, method: req.method, url: req.originalUrl, deviceId: device, now: new Date() });

  // 3) Audit log untuk SETIAP keputusan
  audit({ subjek: d.subject, endpoint, device, hasil: d.allow ? 'allow' : 'deny', alasan: d.reason });

  // 4) Tegakkan keputusan
  if (!d.allow) return res.status(d.status).json({ error: 'forbidden', reason: d.reason });
  next();
}
app.use(pep);

// ---- Proxy ke service (hanya tercapai jika PEP mengizinkan) ----
const proxyTo = (target, pathFilter) =>
  createProxyMiddleware({
    target,
    pathFilter,
    on: {
      proxyReq: (proxyReq) => {
        // Penanda bahwa request datang dari gateway. Header dari client ditimpa.
        proxyReq.setHeader('X-Gateway-Secret', config.gatewaySecret);
      },
      error: (err, req, res) => {
        if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'service tidak tersedia' }));
      },
    },
  });

app.use(proxyTo(config.nilaiUrl, ['/nilai', '/kelas']));
app.use(proxyTo(config.transkripUrl, '/transkrip'));

app.listen(config.ports.gateway, () =>
  console.log(`[gateway] PEP berjalan di http://localhost:${config.ports.gateway}`)
);
