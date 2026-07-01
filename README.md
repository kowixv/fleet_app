# Fleet Settlement App

10–15 araçlık trucking operasyonu için **settlement (hakediş) + Telegram yük otomasyonu + bakım takibi + PDF statement** uygulaması. Tamamı **ücretsiz** katmanda çalışır: Next.js (Vercel) + Supabase + Telegram Bot. Yük okuma için **fal.ai** (vision/LLM) kullanır (düşük API maliyeti).

## Ne yapar?

- **Telegram otomasyonu** — her şoför grubuna düşen Rate Confirmation PDF / Amazon Relay ekran görüntüsü / mesaj otomatik okunur (fal.ai vision), güzergah–mil–tutar çıkarılır, **onaya** düşer. Hem Telegram'dan (Onayla/Reddet butonu) hem web'den onaylanır → resmi Load kaydı oluşur.
- **Esnek settlement motoru** — hiçbir ödeme modeli sabit değil. Her araç için company fee %12/%10/yok, $250 komisyon, driver %, dış carrier fee ayrı ayrı tanımlanır. 5 modeli destekler (company driver, box truck, owner operator, managed/investor, external carrier statement).
- **Bilingual PDF statement** — EN/TR settlement statement üretir (imza bloğunda logo/MC/DOT/telefon/email/adres yok).
- **Preventive maintenance** — mileage/tarih bazlı bakım takibi, dashboard uyarısı + günlük Telegram uyarısı (Vercel Cron).
- **Canlı GPS takip** — sürücünün telefonu/tableti `/drive?token=…` sayfasından konum gönderir; harita
  üzerinde araçlar, geofence (pickup/delivery), ETA, risk skoru ve alertler canlı görünür. Detay:
  [docs/11-tracking.md](docs/11-tracking.md).
- **Dashboard** — haftalık gross/masraf/net, bekleyen yükler, komisyon, bakım uyarıları.

Settlement motoru `lib/settlement/engine.ts` içinde; brief'teki 5 örnek rakam birim testleriyle doğrulanır (`npm test`).

---

## Kurulum (ücretsiz)

### 1) Supabase (veritabanı + auth + storage)
1. [supabase.com](https://supabase.com) → ücretsiz proje oluştur.
2. **SQL Editor** → `supabase/schema.sql` dosyasının tamamını yapıştır ve çalıştır (tablolar, RLS, signup trigger).
3. **Storage** → `imports` adında bir **private bucket** oluştur (Telegram dosyaları buraya yüklenir).
4. **Project Settings → API**'den şu değerleri al: `Project URL`, `anon key`, `service_role key`.

### 2) fal.ai (yük okuma)
[fal.ai](https://fal.ai) → hesap aç → **Dashboard → Keys**'den bir key al (`FAL_KEY`). Yük okuma
(görsel + PDF) bu key ile fal'ın `openrouter/router/vision` endpoint'i üzerinden yapılır.

### 3) Telegram bot
1. Telegram'da **@BotFather** → `/newbot` → token al (`TELEGRAM_BOT_TOKEN`).
2. Botu her şoför grubuna ekle ve **admin** yap (grup mesajlarını görmesi için).

### 4) Ortam değişkenleri
`.env.example` → `.env.local` olarak kopyala ve doldur:

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
FAL_KEY=...
AI_MODEL=google/gemini-2.5-flash   # opsiyonel; yük okuma modeli (fal/OpenRouter)
TELEGRAM_BOT_TOKEN=...
TELEGRAM_WEBHOOK_SECRET=uzun-rastgele-bir-string
CRON_SECRET=baska-uzun-bir-string
NEXT_PUBLIC_APP_URL=https://uygulaman.vercel.app
GOOGLE_ROUTES_API_KEY=...                 # opsiyonel; gerçek yol-bazlı ETA (yoksa haversine tahmini)
```

> Yük okuma (Telegram → load) tamamen **fal.ai** ile yapılır (`FAL_KEY`). Detay: [docs/05-fal-ai.md](docs/05-fal-ai.md).

### 5) Lokal çalıştırma
```
npm install
npm run dev        # http://localhost:3000
npm test           # settlement motoru testleri (7/7)
npm run lint       # eslint
npm run smoke:fal  # fal.ai key testi (FAL_KEY gerekir)
```
İlk açılışta **Kayıt ol** ile hesap oluştur — otomatik olarak bir organizasyon + owner profili açılır.
İstersen `supabase/seed.sql`'i (kayıttan sonra) çalıştırıp örnek araç/yük/masraf ile hemen
settlement + PDF dene. Node ≥ 20 (`.nvmrc` = 22).

### 6) Vercel'e deploy (ücretsiz)
1. Repoyu GitHub'a push et, [vercel.com](https://vercel.com)'de import et.
2. Tüm env değişkenlerini Vercel **Environment Variables**'a ekle (`NEXT_PUBLIC_APP_URL`'yi gerçek domain yap).
3. Deploy. `vercel.json` günlük PM cron'unu (13:00 UTC) otomatik kurar.

### 7) Telegram webhook'u bağla
Deploy sonrası bir kez çalıştır:
```
curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://uygulaman.vercel.app/api/telegram/webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```
Sonra uygulamada **Settings → Telegram Grupları**'ndan her grubu araç+şoför ile eşle. (Grubun Chat ID'sini öğrenmek için: botu gruba ekle, gruba bir mesaj at; bot yanıtında Chat ID görünür.)

---

## Akış (haftalık kullanım)
1. Şoför grubuna yük düşer → bot okur → **Telegram Yükleri** kuyruğunda onaya bekler → onayla → Load oluşur.
2. Hafta sonu **Settlements → Yeni Settlement** → tip + araç + hafta seç → motor loadları/masrafları toplar, net hesaplar.
3. Settlement detayında **PDF İndir** → bilingual statement.
4. **Finalize → Paid** ile kilitle (Paid düzenlenemez).
5. **Maintenance**'ta mileage gir; eşiği aşınca dashboard + Telegram uyarısı.

## Ücretsiz katman notları
- Supabase free DB ~7 gün hiç istek almazsa duraklar; düzenli bot/cron kullanımı canlı tutar.
- Vercel free Cron günde 1 çalışma — PM kontrolü için yeterli.
- Tek ücretli parça: fal.ai (yük başına birkaç cent). `AI_MODEL`'i daha ucuz bir modele çekerek düşürebilirsin.

## v2 (kapsam dışı)
Repairs, driver scorecard, unit profitability, fuel efficiency, repair-cost warning, gelişmiş raporlar/CSV, rol bazlı yetki.
