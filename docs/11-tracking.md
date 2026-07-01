# 11 — Canlı Takip (GPS Tracking)

Araçların canlı konumunu haritada gösteren modül. Tablet/telefon GPS'i konumu gönderir; sunucu modu
(hareket/park/yaklaşıyor), geofence (pickup/delivery), ETA ve risk skorunu hesaplar; dashboard 10
saniyede bir yeniler.

## Parçalar

- **Sürücü sayfası** — `app/drive/page.tsx` + `components/DriverTracker.tsx`. Tarayıcıda açılır,
  `navigator.geolocation` ile konumu okuyup `POST /api/tracking/location`'a gönderir. **Auth'suz**
  herkese açık sayfa (tablet token ile yetkilenir); `middleware.ts` matcher'ında muaftır.
- **Tablet token** — her araca bir token. `Settings → Tablet Yönetimi`'nden üretilir
  (`/api/admin/tablet-pair`), `tablet_tokens` tablosunda tutulur. Token üretilince yanında hazır
  `/drive?token=...` sürücü linki gösterilir.
- **Konum API** — `POST /api/tracking/location` (`Authorization: Bearer <token>`). Tek payload veya
  `{ batch: [...] }` (çevrimdışı kuyruk boşaltma) kabul eder.
- **İşleme** — `lib/tracking/process-location.ts`: mod motoru (`mode-engine.ts`), geofence
  (`geofence.ts`), risk (`risk-score.ts`), alert (`alert-manager.ts`). Sonuçlar `unit_locations`,
  `load_tracking`, `tracking_events` tablolarına yazılır.
- **Dashboard** — `/tracking` (`components/tracking/*`, Leaflet + OpenStreetMap). `/api/tracking/dashboard`
  oturum (owner/admin/manager) ile yetkilenir.
- **Aktif yük** — yük onaylanınca `lib/tracking/activate.ts` adresleri geocode edip (Nominatim) bir
  `load_tracking` (active) kaydı açar. Sürücü sayfası `GET /api/tracking/active-load` ile yükü gösterir.

## Veritabanı

Tablolar migration'da: `supabase/migrations/20260627000000_tracking_module.sql` — `unit_locations`,
`load_tracking`, `tracking_events`, `tablet_tokens` + `loads`'a `pickup_lat/lng`, `delivery_lat/lng`,
`geocoded_at`. Hepsi `organization_id` + aynı RLS deseni. Aynı tanımların aynası `supabase/schema.sql`
sonundadır (sıfırdan kurulum bunu çalıştırır).

> **Mevcut bir Supabase'e ilk kez uyguluyorsan:** SQL Editor'de migration dosyasını çalıştır
> (veya `npx supabase db push`). Uygulanıp uygulanmadığını doğrula:
> `select 1 from unit_locations limit 1;` hata vermemeli.

## Kurulum / kullanım

1. **Settings → Tablet Yönetimi** → araç seç → **Token Oluştur**.
2. Çıkan **sürücü linkini** (`/drive?token=...`) sürücünün telefonuna gönder (veya QR ile aç).
3. Telefonda link açılır → **Takibi Başlat** → konum izni verilir.
4. **/tracking** sayfasında araç haritada belirir; mod/ETA/risk rozetleri ve alertler güncellenir.

## Güvenli bağlam (ÖNEMLİ)

`navigator.geolocation` yalnızca **HTTPS** veya **`localhost`** üzerinde çalışır:

- **Laptop'ta demo:** `http://localhost:3000/drive?token=...` çalışır (localhost güvenli sayılır).
- **Telefonda demo:** `http://192.168.x.x:3000` gibi **LAN IP'si GPS'i engeller**. Çözüm: telefon
  **HTTPS** üzerinden açsın — ör. yayındaki Vercel adresi `https://<app>.vercel.app/drive?token=...`
  (dashboard lokal kalabilir; ikisi de aynı Supabase'i kullanır). Alternatif:
  `next dev --experimental-https` veya bir ngrok tüneli.

`components/TabletManagement.tsx` sürücü linkini `NEXT_PUBLIC_APP_URL`'i (HTTPS) baz alarak üretir;
bu yüzden bu env'in gerçek domain'e ayarlı olması telefon demosunu kolaylaştırır.

## ETA

`lib/tracking/eta.ts` Google Routes API kullanır (`GOOGLE_ROUTES_API_KEY`). Key **opsiyoneldir** —
yoksa kuş-uçuşu (haversine) mesafeye göre tahmini ETA döner ve bir uyarı loglar. Gerçek yol-bazlı ETA
istiyorsan key ekle (bkz. `.env.example`).

## İlgili dosyalar

- Sayfa/istemci: `app/drive/page.tsx`, `components/DriverTracker.tsx`
- API: `app/api/tracking/{location,dashboard,active-load,eta,acknowledge}/route.ts`,
  `app/api/admin/tablet-pair/route.ts`
- Mantık: `lib/tracking/*` (`process-location`, `mode-engine`, `geofence`, `risk-score`,
  `alert-manager`, `eta`, `distance`, `geocode`, `activate`, `tablet-auth`, `types`)
- UI: `components/tracking/*` (`TrackingDashboard`, `TrackingMap`, `LeafletMapInner`, `TrackingTable`,
  `AlertPanel`, `Badges`)
