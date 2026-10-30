# Sistem Nilai: Zero Trust Security

Tugas Praktikum Individu, Keamanan Informasi (KP70065004), Informatika Universitas Siliwangi.

API Gateway sebagai **Policy Enforcement Point (PEP)** yang terpisah dari service, dengan
**Policy Engine/Administrator** di dalam gateway (NIST SP 800-207), **Service Nilai**, **Service Transkrip**,
dan satu database SQLite bersama.

## Arsitektur

```
Client (Postman/curl) ──token + X-Device-ID──► API Gateway (PEP) :3000 ──► Audit Log (tabel audit_log)
                                                 │  ├─ policy.js (PE) ◄── baca atribut ── Database
                                                 │  └─ auth.js   (PA) : login/refresh/logout/service
                                   jika allow +  │
                                 X-Gateway-Secret├──► Service Nilai      :3001 ─┐
                                                 └──► Service Transkrip  :3002 ─┴─► Database (SQLite)
Service Nilai ──(token service)──► Gateway ──► POST /transkrip/sinkron   (antar-service tetap lewat gateway)
```

## Cara Menjalankan

Prasyarat: **Node.js 22.13 atau lebih baru** (termasuk Node 24). Database memakai SQLite bawaan Node.js,
jadi tidak ada paket yang perlu dikompilasi dan tidak perlu Visual Studio.

```bash
npm install          # pasang dependency
npm run seed         # buat database + data awal (MENGHAPUS data lama)
npm start            # jalankan gateway(3000) + service nilai(3001) + service transkrip(3002)
```

`.env` sudah berisi nilai untuk pengembangan. Untuk memulai dari awal, salin `.env.example`
menjadi `.env`. Jangan commit `.env` (sudah ada di `.gitignore`).

Alternatif: jalankan di 3 terminal terpisah (lebih enak untuk demo karena log tiap komponen terlihat):

```bash
npm run start:gateway
npm run start:nilai
npm run start:transkrip
```

Uji otomatis (38 skenario, memakai database terpisah `db/test.db`):

```bash
npm test
```

> Saat server berjalan akan muncul peringatan `ExperimentalWarning: SQLite is an experimental feature`.
> Itu normal dan tidak mempengaruhi hasil.

## Daftar Akun dan Device ID (data seed)

| Username | Password | Role | NIM | Device ID |
|---|---|---|---|---|
| admin | admin123 | admin | - | DEV-ADMIN-01 |
| dosen1 | dosen123 | dosen (mengampu Kelas 1: Keamanan Informasi) | - | DEV-DOSEN1-01 |
| dosen2 | dosen123 | dosen (mengampu Kelas 2: Basis Data) | - | DEV-DOSEN2-01 |
| mhs1 | mhs123 | mahasiswa | 2021001 | DEV-MHS1-01 |
| mhs2 | mhs123 | mahasiswa | 2021002 | DEV-MHS2-01 |
| mhs3 | mhs123 | mahasiswa | 2021003 | DEV-MHS3-01 |

Data nilai: Kelas 1 → nilai id 1-3, Kelas 2 → nilai id 4-6 (semua berstatus `draft`).

## Mengatur Jam Akses

Ubah di `.env` lalu restart gateway:

```
ACCESS_HOUR_START=7    # boleh jika START <= jam < END
ACCESS_HOUR_END=21
ACCESS_TZ=Asia/Jakarta
```

Untuk demo "di luar jam akses", set `ACCESS_HOUR_START=0` dan `ACCESS_HOUR_END=0` (selalu di luar jam).

## Contoh Request (curl)

```bash
GW=http://localhost:3000

# 1. Login (device wajib terdaftar)
curl -X POST $GW/auth/login -H "Content-Type: application/json" -H "X-Device-ID: DEV-DOSEN1-01" \
     -d '{"username":"dosen1","password":"dosen123"}'
# simpan access_token & refresh_token dari respons
TOKEN=<isi access_token>

# 2. Dosen melihat nilai kelasnya
curl $GW/nilai -H "Authorization: Bearer $TOKEN" -H "X-Device-ID: DEV-DOSEN1-01"

# 3. Dosen mengubah nilai (id 1 milik kelas dosen1)
curl -X PUT $GW/nilai/1 -H "Authorization: Bearer $TOKEN" -H "X-Device-ID: DEV-DOSEN1-01" \
     -H "Content-Type: application/json" -d '{"nilai": 90}'

# 4. Finalisasi kelas 1 (otomatis sinkron ke transkrip lewat gateway)
curl -X POST $GW/kelas/1/finalisasi -H "Authorization: Bearer $TOKEN" -H "X-Device-ID: DEV-DOSEN1-01"

# 5. Admin melihat transkrip (login sebagai admin dulu, device DEV-ADMIN-01)
curl $GW/transkrip/2021001 -H "Authorization: Bearer $ADMIN_TOKEN" -H "X-Device-ID: DEV-ADMIN-01"

# 6. Refresh & logout
curl -X POST $GW/auth/refresh -H "Content-Type: application/json" -d '{"refresh_token":"<refresh>"}'
curl -X POST $GW/auth/logout  -H "Content-Type: application/json" -d '{"refresh_token":"<refresh>"}'

# 7. Token service
curl -X POST $GW/auth/service -H "Content-Type: application/json" \
     -d '{"client_id":"service-nilai","client_secret":"<SERVICE_CLIENT_SECRET di .env>"}'

# 8. Akses langsung ke service (harus 403: tanpa X-Gateway-Secret)
curl -i http://localhost:3001/nilai
```

Melihat audit log: buka `db/app.db` dengan DB Browser for SQLite (tabel `audit_log`), atau lihat baris `[AUDIT]` di terminal gateway.

## Koleksi Postman

File: `postman/sistem-nilai.postman_collection.json` (Postman → Import). Isinya 44 request yang dikelompokkan
per segmen video. Setiap request punya assertion, sehingga hijau = perilaku sesuai harapan.

1. Jalankan server (`npm run seed` lalu `npm start`).
2. Klik kanan folder yang diinginkan (S2 sampai S6) → Run. **Tidak perlu menjalankan S0 dulu**: koleksi login
   otomatis dan memperbarui token yang hampir kedaluwarsa (folder S0 hanya opsional, untuk menunjukkan proses login).
3. Jalankan folder S2 → S3 → S4 → S5 Device → S6 secara berurutan. Folder **S5 · Jam Akses** hanya dijalankan
   setelah `.env` diubah ke `ACCESS_HOUR_START=0` dan `ACCESS_HOUR_END=0` (restart gateway); jangan lewat "Run collection" saat jam normal.
4. Variabel (secret, port) ada di tab *Variables* koleksi; samakan dengan `.env` jika Anda mengubahnya.
5. Untuk mengulang dari awal: hentikan server, `npm run seed`, jalankan server lagi.

## Peta Kebutuhan → Kode (untuk video demo)

| Kebutuhan | File | Bagian |
|---|---|---|
| Access token JWT 10 menit (`sub`, `role`) | `gateway/auth.js` | `signAccess()` |
| Refresh token 1 hari di DB, dapat dicabut | `gateway/auth.js` | `/login`, `/refresh`, `/logout`; tabel `refresh_tokens` |
| Token service 5 menit, `role: service` | `gateway/auth.js` | `POST /service` |
| Service Nilai meminta token service | `service-nilai/index.js` | `getServiceToken()` |
| `X-Gateway-Secret` ditambahkan gateway | `gateway/index.js` | `proxyTo()` → `proxyReq.setHeader` |
| Service menolak tanpa secret dan verifikasi ulang token | `common/guard.js` | dipakai kedua service |
| Gateway sebagai PEP (verifikasi → keputusan → audit → proxy) | `gateway/index.js` | fungsi `pep()` |
| Policy Engine (Tabel 3, atribut dari DB) | `gateway/policy.js` | `decide()` |
| Device terdaftar (`X-Device-ID`) | `gateway/policy.js`, `gateway/auth.js` | cek tabel `devices` |
| Jam akses dapat dikonfigurasi | `common/config.js`, `gateway/policy.js` | `withinAccessHours()` |
| Finalisasi → sinkron antar-service via gateway | `service-nilai/index.js` | `POST /kelas/:id/finalisasi` |
| Sinkron hanya token service | `gateway/policy.js`, `service-transkrip/index.js` | `/transkrip/sinkron` |
| Audit log (waktu, subjek, endpoint, device, hasil, alasan) | `gateway/audit.js` | dipanggil setelah tiap keputusan |

## Prinsip Zero Trust yang Diterapkan

- **Never trust, always verify**: setiap request diperiksa gateway; service memverifikasi ulang secret dan token.
- **Least privilege**: kebijakan per role + kepemilikan data (kelas diampu, NIM sendiri); token service hanya boleh `POST /transkrip/sinkron`.
- **Assume breach**: service tidak percaya penuh pada gateway (cek token + cek kepemilikan ulang); default deny;
  refresh token disimpan sebagai hash dan dapat dicabut; role di token dicocokkan dengan database.

## Catatan Keterbatasan

- JWT memakai HS256 dengan secret bersama. Pada produksi, sebaiknya RS256 (service hanya memegang public key).
- Komunikasi antar-komponen memakai HTTP biasa karena berjalan di satu komputer. Produksi memerlukan TLS/mTLS.
- Tidak ada rate limiting pada `/auth/login`.
