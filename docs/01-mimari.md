# 01 — Mimari (Tüm Katmanlar)

Uygulama tek bir **Next.js 15 (App Router)** projesidir; hem web arayüzünü hem de tüm sunucu
mantığını (API, server actions, cron, webhook) aynı kod tabanında barındırır. Veri/oturum/dosya
için **Supabase**, barındırma ve zamanlanmış görev için **Vercel**, yük okuma için **fal.ai**,
yük girişi için **Telegram Bot** kullanılır.

```
                ┌────────────────────────── Vercel (ücretsiz) ──────────────────────────┐
  Tarayıcı ───► │  Next.js App Router                                                    │
  (web UI)      │   ├─ app/(app)/* ............ korumalı sayfalar (dashboard, loads…)     │
                │   ├─ app/login/* ............ giriş/kayıt                               │
                │   ├─ middleware.ts .......... oturum koruması (auth guard)             │
                │   ├─ components/* ........... istemci bileşenleri (tablo/form/inbox)    │
                │   ├─ lib/* .................. iş mantığı (engine, ai, parse, pdf…)      │
                │   └─ app/api/* .............. webhook / cron / pdf / dosya             │
                │        ▲              ▲                  ▲                              │
                └────────┼──────────────┼──────────────────┼──────────────────────────────┘
                         │              │                  │
        Telegram Bot ────┘     fal.ai (vision/LLM)     Supabase (Postgres + Auth + Storage)
        (yük mesajları)        (yük okuma)             (veri + giriş + dosya)
                                                       ▲
                                       Vercel Cron ────┘ (günlük bakım kontrolü)
```

## Katmanlar

### 1) Sunum / UI katmanı — `app/(app)/*` ve `components/*`
- **Sayfalar (Server Components):** `app/(app)/` altındaki her klasör bir sayfadır: `page.tsx`
  (dashboard), `loads`, `expenses`, `settlements`, `settlements/[id]`, `vehicles`, `people`,
  `companies`, `carriers`, `imported`, `maintenance`, `settings`. Sayfalar sunucuda veriyi çeker
  (Supabase) ve istemci bileşenlerine prop olarak verir. Hepsi `export const dynamic = "force-dynamic"`
  (her istekte taze veri).
- **Ortak yerleşim:** `app/(app)/layout.tsx` → sol menü (`components/Sidebar.tsx`) + üst bar + çıkış.
  Bu layout `requireProfile()` ile girişi zorunlu kılar.
- **İstemci bileşenleri (`"use client"`):**
  - `components/ResourceManager.tsx` — genel tablo + ekle/düzenle/sil formu (companies, carriers,
    people, vehicles, loads, expenses, maintenance kuralları, telegram grupları hepsi bunu kullanır).
  - `components/SettlementForm.tsx` — settlement oluşturma formu.
  - `components/ImportedInbox.tsx` — Telegram'dan gelen yüklerin onay kuyruğu.
  - `components/MaintenanceTable.tsx` — bakım durumu + mileage güncelleme.

### 2) Eylem / yazma katmanı — Server Actions
İstemciden gelen yazma işlemleri **server action** olarak çalışır (RPC gibi; istemciye SQL sızmaz):
- `lib/crud.ts` — genel `createRow/updateRow/deleteRow`. **Güvenlik:** tablo + kolon allowlist'i,
  `organization_id` her zaman oturumdan enjekte edilir.
- `app/(app)/settlements/actions.ts` — `createSettlement` (motoru çağırır, loadları/masrafları
  toplar), `setSettlementStatus`, `deleteSettlement`.
- `app/(app)/imported/actions.ts` — `approveImported`/`rejectImported`/`updateImported`.
- `app/(app)/maintenance/actions.ts` — `updateMileage`, `markServiced`.
- `app/(app)/settings/actions.ts` — `updateSettings`.
- `app/login/actions.ts` — `signIn`/`signUp`/`signOut`.

### 3) İş mantığı — `lib/*` (UI'dan bağımsız, saf modüller)
- `lib/settlement/engine.ts` — **config-driven settlement motoru** (5 model). Saf fonksiyon,
  yan etkisiz. Projenin kalbi; `engine.test.ts` ile kilitli.
- `lib/settlement/resolve.ts` — araç/şoför varsayılanlarından + override'lardan motor config'ini
  çözer (öncelik: Settlement Override → Vehicle → Driver/Company default).
- `lib/ai.ts` — fal.ai sarmalayıcı (`runVision`, `runText`).
- `lib/parse.ts` — Telegram medyasını (görsel/PDF/metin) yük JSON'una çevirir (fal.ai kullanır).
- `lib/telegram.ts` — Telegram Bot API yardımcıları (sendMessage, downloadFile, inline buttons…).
- `lib/maintenance.ts` — bakım durumu hesabı (`computePM`).
- `lib/pdf/statement.tsx` — bilingual PDF statement (react-pdf).
- `lib/format.ts` — `usd`, `pct`, `shortDate`.
- `lib/data.ts` — sayfalar için ortak veri/seçenek çekme yardımcıları.
- `lib/auth.ts` — `requireProfile()` (oturum + organizasyon).
- `lib/supabase/{server,client,middleware}.ts` — Supabase istemcileri.

### 4) API / entegrasyon katmanı — `app/api/*` (Route Handlers, Node runtime)
- `app/api/telegram/webhook/route.ts` — Telegram update'lerini alır; medyayı Storage'a koyar,
  `parseLoad` ile okur, `imported_loads` (pending) oluşturur, gruba onay butonları gönderir;
  callback'lerde onay/ret → `loads` kaydı. **Kendi secret'ı ile korunur** (middleware dışı).
- `app/api/cron/pm-check/route.ts` — günlük bakım taraması; due/overdue olanlar için Telegram
  uyarısı. **`CRON_SECRET` ile korunur** (middleware dışı).
- `app/api/settlements/[id]/pdf/route.ts` — settlement PDF'ini üretir (auth korumalı).
- `app/api/imports/file/route.ts` — Storage'daki import dosyası için imzalı URL (auth korumalı).

### 5) Kimlik & koruma — `middleware.ts` + Supabase Auth
- `middleware.ts` her istekte oturumu tazeler ve giriş yapmamış kullanıcıyı `/login`'e yönlendirir.
  `api/telegram` ve `api/cron` hariç tutulur (onlar kendi secret'larıyla korunur).
- Supabase Auth (email + şifre). İlk kayıt → trigger otomatik organizasyon + owner profili açar.

### 6) Veri & depolama — Supabase
- **Postgres:** 16 tablo, hepsi `organization_id` taşır, **RLS** ile organizasyona izole (bkz. 02).
- **Auth:** kullanıcılar; `profiles` tablosu org + rol tutar.
- **Storage:** `imports` private bucket (Telegram'dan gelen PDF/görseller).

### 7) Barındırma & zamanlama — Vercel
- Web + API serverless olarak çalışır. `vercel.json` günlük cron'u (`/api/cron/pm-check`) kurar.

## Uçtan uca veri akışı (en kritik akış)
```
Telegram grubu (yük mesajı/PDF/foto)
   → app/api/telegram/webhook  (medya → Storage)
   → lib/parse.parseLoad → lib/ai (fal.ai vision/LLM)  →  yapılandırılmış JSON
   → imported_loads (status=pending)
   → bot mesajı [Onayla/Reddet]  ·  web: /imported inbox
   → onay → loads (status=booked)
   → /settlements: createSettlement → lib/settlement/engine → settlements + settlement_items
   → /api/settlements/[id]/pdf → lib/pdf/statement  →  bilingual PDF
```
Paralel akış: `vehicles.current_mileage` güncellenir → `lib/maintenance.computePM` → dashboard kartı
+ günlük cron → Telegram bakım uyarısı.
