# Proktor Ujian Sanaci

Aplikasi web (Node.js) untuk pengawasan (proctoring) ujian berbasis Google Form.

- Ujian ditampilkan **layar penuh** di browser siswa.
- Keluar dari layar penuh / berpindah tab / pintasan terlarang = **penalti poin** (default -5 per pelanggaran).
- Pelanggaran melebihi batas (default 10) → ujian dihentikan otomatis.
- Guru/admin membuat ujian, memantau sesi, pelanggaran, dan mengekspor CSV.

## Menjalankan

```bash
cd proktor-ujian
cp .env.example .env   # opsional
node server.js
# atau ./run.sh
```

Buka:
- Siswa: http://localhost:9340/
- Admin: http://localhost:9340/admin.html (password default `rahasia`)

## Catatan keamanan

- Mode klien (browser) dapat dibobol oleh siswa teknis; gunakan sebagai lapisan pengawasan, bukan keamanan mutlak.
- Disarankan ujian di lab komputer dengan browser kiosk jika perlu keamanan lebih tinggi.
- Nilai Google Form tidak diubah aplikasi; potongan penalti dilaporkan terpisah dan digabungkan guru.

## Struktur

```
proktor-ujian/
├── server.js
├── src/ (config, db, auth, http, util)
├── public/ (index, admin, student + js/css)
└── data/ (SQLite)
```
EOF
echo done