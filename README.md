# Proktor Ujian Sanaci

Aplikasi web untuk **pengawasan (proctoring) ujian** berbasis Google Form.  
Ujian ditampilkan **layar penuh** di browser siswa; keluar dari layar penuh, berpindah tab, atau melakukan aksi terlarang akan dikenai **penalti poin** dan dicatat. Guru/admin memantau sesi, pelanggaran, dan mengekspor hasil.

Dibangun dengan Node.js (tanpa dependensi eksternal) + SQLite. Dirancang untuk menangani **ribuan siswa** (diuji hingga 1600 siswa bersamaan).

## Fitur

### Guru / Admin
- Login dengan kata sandi (env `PROKTOR_ADMIN_PASSWORD`).
- Buat, **edit**, aktifkan/nonaktifkan, dan **hapus permanen** ujian.
- Atur per ujian: judul, link Google Form, durasi (menit, 0 = bebas), potongan poin per pelanggaran, batas pelanggaran sebelum auto-submit.
- Kode ujian 6 karakter (auto-generate).
- Dashboard hasil per ujian: NIS, nama, kelas, mulai/selesai, pelanggaran, potongan, status.
- Timeline pelanggaran per sesi (tipe + detail + waktu).
- **Hapus sesi siswa** (beserta data pelanggarannya).
- **Export CSV** hasil.
- Cache statis + gzip (untuk skala besar).

### Siswa
- Masuk dengan kode ujian + identitas (NIS, nama, kelas).
- Ujian ditampilkan **layar penuh** (Fullscreen API) dengan Google Form di-embed.
- Timer global (jika durasi diset) dengan auto-submit saat waktu habis.
- Deteksi pelanggaran:
  - Keluar dari layar penuh
  - Berpindah tab / minimize
  - Klik kanan, copy/paste/cut
  - Pintasan terlarang (F12, Ctrl+Shift+I/J/C, Ctrl+U/S/P/A)
  - Tab/jendela ganda (lock via localStorage)
  - Perubahan ukuran layar / keluar fullscreen
  - DevTools terbuka (heuristik)
- **Suara peringatan** (beep) setiap pelanggaran.
- Overlay pelanggaran + tombol kembali ke layar penuh.
- Deteksi idle (2 menit tanpa aktivitas) → overlay "Anda tidak aktif" (tanpa penalti).
- Auto-submit jika pelanggaran melebihi batas.
- Ringkasan akhir: pelanggaran & potongan poin.

## Persyaratan

- Node.js **≥ 20** (disarankan 22+; `node:sqlite` dipakai). Tanpa npm install (tanpa dependensi).
- Browser modern (Chrome/Firefox/Edge/Safari) dengan dukungan Fullscreen API.

## Instalasi

```bash
git clone https://github.com/natedekaka/proktor-ujian.git
cd proktor-ujian
cp .env.example .env
# edit .env sesuai kebutuhan
mkdir -p data
```

## Menjalankan

```bash
node server.js
# atau
./run.sh
```

- Siswa: `http://localhost:9340/`
- Admin: `http://localhost:9340/admin.html`

## Variabel Lingkungan (`.env`)

| Variabel | Default | Keterangan |
|---|---|---|
| `PROKTOR_TITLE` | `Proktor Ujian Sanaci` | Judul tampilan |
| `PROKTOR_HOST` | `0.0.0.0` | Alamat bind |
| `PROKTOR_PORT` | `9340` | Port server |
| `PROKTOR_ADMIN_PASSWORD` | `rahasia` | Kata sandi admin |
| `PROKTOR_DATA_DIR` | `./data` | Direktori data (SQLite) |
| `PROKTOR_SESSION_HOURS` | `12` | Masa berlaku sesi admin (jam) |
| `PROKTOR_PENALTY_PER_VIOLATION` | `5` | Potongan default per pelanggaran |
| `PROKTOR_MAX_VIOLATIONS` | `10` | Batas default sebelum auto-submit |
| `PROKTOR_LOG_LEVEL` | `info` | Level log: debug/info/warn/error |

## Alur Guru

1. Buka `http://<host>:9340/admin.html`, masuk dengan password.
2. Tab **Ujian** → lihat daftar ujian; **Buat Ujian** → isi judul, link Google Form, durasi, potongan, maks pelanggaran → **Buat Ujian** (kode auto-generate).
3. Bagikan kode ujian ke siswa.
4. Tab **Hasil** → pilih ujian → lihat sesi, pelanggaran, potongan; klik **Detail** untuk timeline; **Hapus** untuk menghapus sesi; **Export CSV** untuk rekap.
5. **Edit** ujian kapan saja (ubah link, durasi, dll.).
6. **Hapus** ujian = hapus permanen (beserta sesi & pelanggarannya).

## Alur Siswa

1. Buka `http://<host>:9340/`, masukkan kode ujian + identitas.
2. Klik **Mulai Ujian (Layar Penuh)** → browser masuk mode layar penuh, Google Form tampil.
3. Kerjakan ujian. Jangan keluar dari layar penuh / berpindah tab (akan kena penalti).
4. Klik **Selesai** setelah selesai, atau tunggu timer habis / auto-submit jika pelanggaran berlebihan.
5. Lihat ringkasan pelanggaran & potongan poin.

## Catatan Penting

- **Nilai akhir** = nilai Google Form − potongan poin (penggabungan dilakukan guru; aplikasi tidak mengubah nilai Google Form).
- **Keamanan berbasis browser** (client-side) dapat dibobol siswa teknis; gunakan sebagai lapisan pengawasan, bukan keamanan mutlak. Untuk lab, gunakan browser kiosk.
- Link Google Form harus mengizinkan embedding (link standar Google Form mendukung `?embedded=true`, ditambahkan otomatis).
- Suara peringatan memerlukan interaksi pengguna (klik "Mulai") agar AudioContext aktif (kebijakan browser).

## Skala & Performa (1600 Siswa)

Diujikan dengan simulasi 1600 siswa bersamaan (buat sesi → heartbeat → selesai): **1600/1600 OK**, p95 ~493 ms. Optimasi yang diterapkan:

- Cache file statis di memori + gzip (~60% lebih kecil).
- Logo dioptimasi (734 KB → 50 KB).
- SQLite WAL mode + indeks.
- Heartbeat tidak menulis DB.

### Rekomendasi untuk skala besar
- Jalankan di mesin dengan SSD + RAM ≥4 GB.
- Letakkan di belakang **nginx** (static + gzip + TLS).
- Bagi siswa menjadi gelombang (stagger start) 3–5 menit.
- Prewarm: minta siswa buka halaman 5–10 menit sebelum ujian.
- Backup DB sebelum ujian: `cp data/proktor.db data/proktor.db.bak`.
- Uji beban dengan `tools/loadtest.js`:
  ```bash
  node tools/loadtest.js http://<host>:9340 <KODE_UJIAN> 1600 60
  ```

## Akses Publik (Produksi)

Aplikasi dipublikasikan secara publik melalui **Tailscale Funnel** (HTTPS):

- Siswa: `https://debian6-1.tailef18bd.ts.net/`
- Admin: `https://debian6-1.tailef18bd.ts.net/admin.html`

URL ini dapat diakses dari internet (HP siswa) tanpa VPN. Untuk 500 siswa, gunakan stagger start (gelombang) agar tidak terjadi thundering herd.

## Deploy di Debian (systemd)

1. Clone:
   ```bash
   git clone https://github.com/natedekaka/proktor-ujian.git
   cd proktor-ujian
   ```
2. Pastikan Node.js ≥20 (jika belum, instal via NodeSource atau binary ke `~/.local/node`).
3. Konfigurasi:
   ```bash
   cp .env.example .env
   # edit .env
   mkdir -p data
   ```
4. Buat service `~/.config/systemd/user/proktor-ujian.service`:
   ```ini
   [Unit]
   Description=Proktor Ujian Sanaci
   After=network.target

   [Service]
   Type=simple
   WorkingDirectory=/home/exam/proktor-ujian
   Environment=PATH=/home/exam/.local/node/bin:/usr/local/bin:/usr/bin:/bin
   ExecStart=/home/exam/.local/node/bin/node server.js
   Restart=always
   RestartSec=5

   [Install]
   WantedBy=default.target
   ```
5. Aktifkan:
   ```bash
   systemctl --user daemon-reload
   systemctl --user enable --now proktor-ujian
   loginctl enable-linger exam   # agar jalan saat boot tanpa login
   ```
6. Buka port firewall (jika perlu): `sudo ufw allow 9340/tcp` (atau iptables).

### Update aplikasi
```bash
cd proktor-ujian && git pull && systemctl --user restart proktor-ujian
```

## Struktur Proyek

```
proktor-ujian/
├── server.js              # entry point
├── src/
│   ├── config.js          # konfigurasi env
│   ├── db.js              # SQLite (node:sqlite)
│   ├── auth.js            # auth admin
│   ├── http.js            # routing + static cache/gzip
│   ├── util.js            # helper
│   └── server.js          # bootstrap
├── public/
│   ├── index.html         # landing
│   ├── admin.html / admin.js
│   ├── student.html / student.js
│   ├── common.css
│   └── img/logo-sman6.png
├── tools/
│   └── loadtest.js        # uji beban
├── data/                  # SQLite (dibuat saat runtime, di-gitignore)
├── .env.example
├── run.sh
└── README.md
```

## Troubleshooting

- **`ERR_UNKNOWN_BUILTIN_MODULE` (node:sqlite)**: Node <20.5/22. Pastikan Node ≥22 (atau ≥20.5 dengan flag). Disarankan 22 LTS.
- **Port sudah dipakai**: ubah `PROKTOR_PORT` di `.env` atau hentikan proses lain.
- **Fullscreen tidak jalan di HP**: beberapa browser memerlukan HTTPS atau izin; uji di Chrome Android.
- **Suara tidak bunyi**: AudioContext dibuat saat klik "Mulai"; pastikan volume HP tidak mute.
- **DevTools false positive**: threshold 200px; sesuaikan di `student.js` jika perlu.

## Lisensi

MIT.
EOF
echo written