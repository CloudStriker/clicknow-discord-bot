# ClickNow-Discord-Bot — bot musik Discord untuk YouTube yang kamu jalankan sendiri

**ClickNow-Discord-Bot adalah bot musik Discord gratis dan open-source yang memutar lagu
dan playlist YouTube di voice channel server kamu.** Ketik `/play` lalu judul lagu atau
link YouTube, dan bot akan masuk ke voice channel-mu lalu memutarnya. Bot ini kamu
jalankan sendiri di server Linux kecil dengan Docker, jadi tidak ada versi premium,
iklan, atau batas pemakaian.

🇬🇧 [Read in English](README.md)

---

## Apa yang bisa dilakukan

- 🎵 **Memutar musik dari YouTube** lewat judul lagu, link video, atau satu playlist.
- 📜 **Antrean lagu** sampai 100 lagu per server, jadi semua orang bisa menambah lagu.
- 📋 **Mengambil playlist.** Tempel link playlist, lalu pilih 20, 50, atau 100 lagu.
- 🔊 **Mengingat volume dan pengaturan** tiap server, bahkan setelah bot restart.
- 👋 **Keluar sendiri** kalau semua orang sudah keluar dari voice channel atau tidak ada
  lagu yang diputar selama beberapa menit.
- 🔒 **Mendukung voice terenkripsi Discord** (DAVE), yang wajib di semua voice channel
  sejak Maret 2026.
- 🛠️ **Hampir tanpa perawatan.** Pengunduh YouTube-nya (yt-dlp) memperbarui diri sendiri
  setiap kali bot dinyalakan.

## Daftar perintah

Ketik `/` di channel mana pun pada server yang sudah memasang bot ini untuk melihat
perintah-perintah berikut.

| Perintah | Fungsinya |
|---|---|
| `/play <judul atau link>` | Memutar lagu, atau menambahkannya ke antrean kalau sedang ada lagu. Bisa pakai kata kunci, link video YouTube, atau link playlist. |
| `/play <link playlist> grab_limit:50` | Mengambil 20 (bawaan), 50, atau 100 lagu pertama dari playlist. |
| `/skip` | Lanjut ke lagu berikutnya. |
| `/stop` | Menghentikan musik, mengosongkan antrean, dan keluar dari voice channel. |
| `/queue` | Menampilkan lagu yang sedang diputar dan lagu berikutnya. |
| `/volume <1–100>` | Mengatur volume untuk server ini. Disimpan, dan berlaku mulai lagu berikutnya. |
| `/settings` | Melihat atau mengubah pengaturan keluar otomatis (on/off) dan batas waktu diam (1–30 menit). |
| `/help` | Menampilkan semua perintah. |

> 💡 Kamu harus **sudah berada di voice channel** sebelum memakai `/play`. Bot akan masuk
> ke channel tempat kamu berada. Untuk mengatur keras-pelannya bot **khusus untukmu**,
> klik kanan bot di voice channel lalu atur **User Volume**.

---

## Tanya jawab

### Apakah bot ini gratis?
Ya. Kodenya berlisensi MIT. Kamu hanya membayar server tempat bot berjalan, dan server
kecil sudah cukup.

### Apa yang dibutuhkan untuk menjalankan bot musik Discord sendiri?
Komputer atau VPS yang menyala 24 jam dan bisa menjalankan Docker, plus token bot
Discord (gratis). Bot hanya membuat koneksi **keluar**, jadi tidak perlu membuka port.

### Butuh RAM dan CPU berapa?
Sangat sedikit. Container dibatasi **0,25 vCPU dan 512 MB RAM**. Saat diam, bot memakai
sekitar 85 MB. Audio di-encode oleh ffmpeg native (libopus), jadi satu stream hanya
memakai beberapa persen dari satu core.

### Bisa dijalankan di Cloudflare Workers, Vercel, atau layanan serverless lain?
Tidak bisa. Voice Discord butuh program yang terus berjalan dan mengirim audio lewat
**UDP** setiap 20 ms, dan layanan serverless tidak mendukung itu. Pakai VPS, server
rumahan, atau Raspberry Pi.

### Perlu cookies atau akun YouTube?
Biasanya tidak. Kalau YouTube memblokir IP server-mu (di log akan muncul *"Sign in to
confirm you're not a bot"*), kamu bisa memberi cookies dari browser. Lihat
[Cookies YouTube](#cookies-youtube-hanya-kalau-perlu).

### Bisa memutar Spotify atau SoundCloud?
Belum. Versi 1 hanya mendukung YouTube.

### Bot masuk voice dan lingkarannya hijau, tapi tidak ada suara. Kenapa?
Sejak Maret 2026, Discord mewajibkan voice terenkripsi end-to-end (DAVE). Bot ini memakai
`@discordjs/voice` 0.19 dengan `@snazzah/davey` yang sudah mendukungnya. Kalau masih tidak
ada suara, isi `VOICE_DEBUG=1` di `.env`, restart bot, lalu periksa
`docker compose logs -f`.

---

## Panduan pemasangan

Siapkan waktu sekitar **15 menit**, server Linux dengan
[Docker](https://docs.docker.com/engine/install/), dan akun Discord.

### Langkah 1: Buat bot di Discord

1. Buka [Discord Developer Portal](https://discord.com/developers/applications), klik
   **New Application**, beri nama, lalu klik **Create**.
2. Buka **Installation** dan atur **Install behavior** hanya **Guild Install**. Biarkan
   **User Install** mati, karena bot musik harus berada di server untuk masuk voice.
3. Buka **Bot**, klik **Reset Token**, lalu **Copy**. Itu `DISCORD_TOKEN` kamu, dan hanya
   tampil sekali.
   ⚠️ Token adalah kata sandi bot, jadi jangan dibagikan ke siapa pun. Token yang benar
   panjangnya sekitar 70 karakter dan memiliki **dua titik**. Kalau lebih pendek dan tanpa
   titik, itu *Client Secret*, dan itu bukan yang dibutuhkan.
4. Buka **General Information** dan salin **Application ID**. Itu `CLIENT_ID` kamu.
5. Buka **OAuth2 → URL Generator**:
   - Scopes: ✅ `bot` dan ✅ `applications.commands`.
   - Bot permissions: **View Channels**, **Send Messages**, **Embed Links**, **Connect**,
     dan **Speak**. Angka izinnya `3165184`.
   - Buka link yang dihasilkan, lalu tambahkan bot ke server-mu.

### Langkah 2: Jalankan di server

```bash
git clone https://github.com/CloudStriker/clicknow-discord-bot.git
cd clicknow-discord-bot
cp .env.example .env
nano .env                      # isi DISCORD_TOKEN dan CLIENT_ID (tanpa tanda kutip)
docker compose up -d --build   # build lalu jalankan; otomatis menyala lagi setelah reboot
docker compose logs -f         # lihat proses start (Ctrl+C hanya berhenti melihat, bot tetap jalan)
```

Kalau di log muncul `✅ Logged in as …` dan `✅ 7 slash command(s) registered`, buka
Discord, masuk ke voice channel, lalu ketik `/play never gonna give you up` 🎉

Perintah slash terdaftar otomatis setiap kali bot menyala. Saat pertama kali, Discord
bisa butuh beberapa menit sampai perintahnya muncul.

### Perintah sehari-hari

```bash
docker compose logs -f                      # lihat log langsung
docker compose restart                      # restart bot
docker compose down                         # matikan bot
git pull && docker compose up -d --build    # perbarui ke versi terbaru
```

### Cookies YouTube (hanya kalau perlu)

1. Ekspor cookies YouTube dengan ekstensi browser (misalnya "Get cookies.txt LOCALLY"),
   lalu simpan sebagai `cookies.txt` di folder yang sama dengan `docker-compose.yaml`.
2. Di `docker-compose.yaml`, hapus tanda komentar pada baris
   `- ./cookies.txt:/app/cookies.txt:ro`.
3. Di `.env`, isi `YT_DLP_COOKIES=/app/cookies.txt`.
4. Jalankan `docker compose up -d`.

Pakai akun Google cadangan, karena cookies memberi bot akses ke akun tersebut.

### Pengaturan (`.env`)

| Variabel | Wajib | Arti |
|---|---|---|
| `DISCORD_TOKEN` | ✅ | Token bot (Developer Portal → Bot) |
| `CLIENT_ID` | ✅ | Application ID (Developer Portal → General Information) |
| `YT_DLP_COOKIES` | – | Lokasi file cookies, hanya kalau YouTube memblokir IP-mu |
| `VOICE_DEBUG` | – | Isi `1` untuk mencatat detail koneksi voice di log (untuk mencari masalah) |

Pengaturan per server (volume, keluar otomatis, batas waktu) disimpan di
`data/settings.json`.

---

## Mengatasi masalah

| Masalah | Solusi |
|---|---|
| Log menunjukkan `TokenInvalid` | Nilai yang ditempel salah. Reset token di tab **Bot** dan tempel lagi, tanpa tanda kutip. |
| `/play` tidak muncul di Discord | Tunggu beberapa menit setelah start pertama. Kalau tetap tidak muncul, undang ulang bot dengan scope `applications.commands`. |
| "Join a voice channel first" | Masuk ke voice channel dulu, lalu pakai `/play`. |
| Lagu dilewati dengan pesan "Couldn't play" | Jalankan `docker compose restart` untuk memperbarui yt-dlp. Kalau log menyebut soal sign in, lihat [Cookies YouTube](#cookies-youtube-hanya-kalau-perlu). |
| Bot ada di voice tapi tidak bersuara | Isi `VOICE_DEBUG=1` di `.env`, jalankan `docker compose up -d`, lalu periksa log. |
| Bot terlihat offline | Jalankan `docker compose ps`, lalu `docker compose logs --tail 50`. |

Untuk detail teknis (arsitektur, struktur folder, cara menjalankan test), lihat bagian
**For developers** di [README.md](README.md#for-developers).

## Catatan

Proyek ini tidak berafiliasi dengan Discord atau YouTube. Pakai di server milikmu sendiri,
dan patuhi Ketentuan Layanan YouTube serta aturan hak cipta di negaramu.

## Lisensi

[MIT](LICENSE) © 2026 CloudStriker / ClickNow
