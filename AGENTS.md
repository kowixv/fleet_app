# AGENTS.md — Codex için proje rehberi

Bu dosyayı her oturumda oku. Fleet Settlement App: ~10–15 araçlık trucking operasyonu için
settlement (hakediş) hesabı + Telegram yük otomasyonu + bakım takibi + bilingual PDF statement.

## Stack
Next.js 15 (App Router, TypeScript) · Tailwind · Supabase (Postgres + Auth + Storage) · Vercel
(hosting + cron) · Telegram Bot · **fal.ai** (yük okuma; `FAL_KEY`). Anthropic/OpenAI **kullanılmaz**.

## Komutlar
```bash
npm install      # bağımlılıklar
npm run dev      # lokal geliştirme (http://localhost:3000)
npm run build    # üretim derlemesi — PR/commit öncesi temiz geçmeli
npm test         # vitest — settlement motoru testleri (7/7 yeşil kalmalı)
npm run lint     # eslint (next/core-web-vitals)
npm run smoke:fal # fal.ai key/model bağlantı testi (FAL_KEY gerekir)
```
İlk kurulum: Supabase'de `supabase/schema.sql` → uygulamada **Kayıt ol** → (ops.) `supabase/seed.sql`
ile örnek veri. Node ≥ 20 (bkz. `.nvmrc` = 22).

## Klasör haritası
- `app/(app)/*` — korumalı sayfalar (dashboard, loads, expenses, settlements, vehicles, people,
  companies, carriers, imported, maintenance, settings). Hepsi server component, `force-dynamic`.
- `app/login/*` — giriş/kayıt. `middleware.ts` — auth guard.
- `app/api/*` — `telegram/webhook`, `cron/pm-check`, `settlements/[id]/pdf`, `imports/file`.
- `components/*` — istemci bileşenleri (ResourceManager, SettlementForm, ImportedInbox, MaintenanceTable, Sidebar).
- `lib/*` — iş mantığı: `settlement/engine.ts` (+`resolve.ts`), `ai.ts`, `parse.ts`, `telegram.ts`,
  `maintenance.ts`, `pdf/statement.tsx`, `crud.ts`, `data.ts`, `auth.ts`, `format.ts`, `supabase/*`.
- `supabase/schema.sql` — tüm tablolar + RLS + trigger. `docs/` — detaylı dokümantasyon.

## DEĞİŞMEZ KURALLAR (bozma)
1. **Settlement motoru config-driven kalır.** `lib/settlement/engine.ts` içinde hiçbir ödeme modeli
   hardcode edilmez; tüm oran/fee/komisyon config'ten gelir. 5 model: company_driver,
   box_truck_driver, owner_operator, managed_investor, external_carrier_statement.
2. **Testler yeşil kalır.** `lib/settlement/engine.test.ts` brief örnek çıktılarını doğrular:
   **322.14 / 391.56 / 6360.98 / 1306.85 / 6421.19**. Motoru değiştirirsen testleri çalıştır; bu
   sayılar değişmemeli (yeni davranış için yeni test ekle, mevcutları kırma).
3. **Çok kiracılık + RLS.** Her tabloda `organization_id` var ve RLS `current_org_id()` ile izole
   eder. Yeni tablo eklersen: `organization_id` kolonu + aynı RLS politikası + yazma yolunda org'u
   **oturumdan** enjekte et (asla client'tan alma — bkz. `lib/crud.ts` allowlist deseni).
4. **AI = fal.ai.** Yük okuma `lib/ai.ts` (`openrouter/router/vision` + `openrouter/router`) üzerinden.
   `lib/parse.ts` arabirimi (`parseLoad({text,file}) → ParsedLoad`) korunur. Otomatik load **yok** —
   her zaman `imported_loads` (pending) → insan onayı.
5. **Settlement kilidi.** `finalized`/`paid` settlement düzenlenmez/silinmez; `paid` yalnızca `void`.
6. **Sırlar.** `SERVICE_ROLE_KEY`, `FAL_KEY`, `TELEGRAM_BOT_TOKEN`, `*_SECRET` sadece sunucu; asla
   `NEXT_PUBLIC_` yapma, git'e koyma.

## Konvansiyonlar
- Yazma işlemleri **server action** (RLS'li normal Supabase client). Webhook/cron **service client**
  (RLS bypass) — yalnızca güvenli sunucu bağlamı.
- Yüzdeler **kesir** olarak saklanır (0.33 = %33). Para `numeric`, cent'e yuvarla (`round2`).
- UI dili Türkçe; PDF bilingual EN/TR ve imza bloğunda logo/MC/DOT/telefon/email/adres **yok**.
- Yeni sayfa/CRUD eklerken mevcut `components/ResourceManager.tsx` + `lib/crud.ts` allowlist desenini
  yeniden kullan (tabloyu allowlist'e ekle).

## Genişleme (v2, henüz yok)
Repairs, driver scorecard, unit profitability, fuel efficiency, repair-cost warning, gelişmiş
raporlar/CSV, rol bazlı yetki, taranmış-PDF OCR. Detay: `docs/10-maliyet-ve-limitler.md`.

## Daha fazlası
Kurulum/operasyon: `docs/` (01 mimari → 10 maliyet). Çalışan özet: `README.md`.
