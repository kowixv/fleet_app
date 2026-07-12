# 14 — Denetim Düzeltmeleri (2026-07-03)

`docs/13`'teki 24 bulgunun tamamının çözüm kaydı. Tüm değişiklikler `fleet-app`
içinde (bir uyarı dosyası hariç); ayrıntılı gerekçeler için docs/13'teki madde
numaralarına atıf yapılır.

## Veritabanı (3 yeni migration + `schema.sql` sonuna ayna)

| Dosya | İçerik | Bulgu |
|---|---|---|
| `supabase/migrations/20260703100000_rls_roles.sql` | `current_user_role()` + `is_org_writer()` (SECURITY DEFINER); `profiles` → yalnız SELECT; `organizations` → SELECT + yalnız owner/admin UPDATE (INSERT/DELETE yok); 20 org tablosunda `%_rw` yerine `%_select` (üye) + `%_insert/update/delete` (owner/admin/manager) | 1 |
| `supabase/migrations/20260703100001_tablet_token_hash.sql` | `tablet_tokens.token_hash` (SHA-256) + backfill + unique + partial index; `token` kolonu düşürüldü | Devreden: düz metin token |
| `supabase/migrations/20260703100002_constraints_indexes.sql` | `imported_loads.created_load_id` partial unique (çift onay kemeri); `tracking_events(organization_id, created_at desc)` | 4, 18 |

Signup akışı etkilenmez (`handle_new_user` SECURITY DEFINER); webhook/cron/tracking
service client kullandığından RLS değişikliğinden etkilenmez; UI yazmaları zaten
`requireWriteRole` kapılıydı — DB katmanı artık aynı kuralı uyguluyor.

> **UYGULAMA SIRASI ÖNEMLİ:** migration `token` kolonunu düşürdüğü için canlıdaki
> ESKİ kod (`.eq('token', ...)`) migration sonrası tablet endpoint'lerinde hata verir.
> Doğru sıra: **migration'ı uygula → hemen push et** (Vercel yeni kodu alır).
> Şu an aktif gönderim yapan tablet olmadığı için aradaki kısa pencere risksizdir.
> Mevcut eşleşmiş token'lar backfill sayesinde çalışmaya devam eder (cihazdaki ham
> token'ın hash'i eşleşir).

## Kod değişiklikleri

- **Token hash** — `lib/tracking/tablet-auth.ts` (`hashTabletToken` + `token_hash` lookup),
  `app/api/admin/tablet-pair/route.ts` (token Node'da üretilir, yalnız hash saklanır,
  ham değer bir kez döner).
- **Sayfalama (2)** — `lib/data.ts` (`fetchRowsPaged` + `parsePage`, sayfa boyu 50, exact count),
  `components/ResourceManager.tsx` (`pagination` prop'u + Önceki/Sonraki footer);
  `loads`, `expenses`, `people`, `vehicles`, `companies`, `carriers` sayfaları
  `searchParams.page` okur; `settlements/page.tsx` kendi tablosunda aynı desen.
- **Geocode (3+6)** — `lib/tracking/activate.ts`: sıralı Nominatim istekleri;
  `geocoded_at` yalnız verilen tüm adresler çözüldüğünde damgalanır (başarısızlıkta
  null kalır → sonraki create/update otomatik yeniden dener).
- **Atomik claim (4)** — `app/api/telegram/webhook/route.ts`: approve/reject
  `update ... where status='pending'` + returning ile claim; insert başarısızsa claim
  geri açılır; `confirm_cmd` delete-first claim; `select_vehicle`'daki mükerrer UPDATE
  kaldırıldı. Aynı desen web tarafına da uygulandı: `app/(app)/imported/actions.ts`.
- **Saat dilimi (5, 11, 21)** — yeni `lib/tz.ts` (`FLEET_TIMEZONE` env ?? `America/Chicago`;
  `endOfDayTs`, `todayISO`, `weekRange`, DST-doğru); `lib/tracking/risk-score.ts` teslim
  günü sonunu filo saatiyle hesaplar; `arrived/departed_delivery` artık gün devrildi diye
  `late` olmaz; `app/(app)/page.tsx` hafta penceresi filo saatine geçti.
- **computePM (7)** — `lib/maintenance.ts`: mil dalı `last_done_mileage != null` guard'ı
  (tarih dalıyla simetrik); bilinmeyen baseline nötr "—" döner.
- **Hata gösterimi (8, 9, 10, 13, 14)** — `ResourceManager.onDelete` alert;
  `ImportedInbox` satır içi hata + hata yollarında revalidate; `StatusActions` inline hata;
  `TrackingDashboard.handleAcknowledge` `res.ok` kontrolü (başarısızsa optimistic işaret yok);
  `TabletManagement.handleRevoke` hata banner'ı.
- **signUp (15)** — `app/login/actions.ts` + `page.tsx`: e-posta onayı bekleyen kayıtta
  yeşil "onay linkine tıklayın" mesajı (sessiz bounce yok).
- **Rol kontrolleri (16)** — `tracking/dashboard` + `tracking/eta` route'ları
  owner/admin/manager şartı (acknowledge/tablet-pair ile aynı desen).
- **CSP (17)** — `next.config.mjs`: `Content-Security-Policy` (tek dış köken OSM tile'ları;
  Next.js gereği `unsafe-inline/eval`).
- **Yarış/kapsam (19, 20)** — `lib/tracking/process-location.ts`: `load_tracking`
  güncellemesine `updated_at` optimistic kilidi; `prevLocation` sorgusuna org filtresi.
- **Aktif yük (devreden)** — yeni `lib/tracking/resolve-active-load.ts`: önce `booked`
  (pickup_date desc), yoksa **son 48 saatte** teslim edilmiş yük; `active-load` route ve
  `process-location` bunu kullanır (eski delivered yük artık booked'u gölgeleyemez).
- **`/drive` URL sırrı (devreden)** — `components/DriverTracker.tsx`: token okunduktan
  sonra `history.replaceState` ile adres çubuğundan silinir.
- **`fleet-app-yukle` (devreden)** — `_ESKI-KOPYA-KULLANMA.md` uyarı dosyası eklendi.

## Testler / doğrulama

- Yeni: `lib/tz.test.ts` (9 test — CDT/CST, DST geçişi, hafta sınırı),
  `lib/maintenance.test.ts` (7 test — null baseline dahil).
- `npm test`: **56/56 yeşil** (settlement sabitleri değişmedi); `npm run build` temiz.
- Migration'lar henüz canlıya uygulanmadı (kullanıcı uygular — üstteki sıra notuna bak);
  uygulandıktan sonra: `pg_policies`'te `%_select/%_insert/...` politikaları,
  yeni token üret → `Bearer` ile `active-load` 200, `tablet_tokens`'ta `token`
  kolonunun kalktığı doğrulanmalı.
