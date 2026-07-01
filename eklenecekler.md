# Telegram Bot — Durum & Yapılacaklar

> Bu dosya nerede kaldığımızı takip etmek içindir. Son güncelleme: 2026-06-26

---

## 🎯 Genel Hedef
Telegram botunu, doğal dille tüm uygulamayı yönetebilen bir asistana dönüştürmek
(kişi/araç/gider/yük/settlement) ve kullanıma başlamayı (pairing) basitleştirmek.

---

## ✅ Tamamlananlar

### Aşama 1 — AI Yönetim Botu (kod + DB hazır)
Doğal dille komut: ekle / listele / güncelle / sil / settlement.

- `lib/bot-intent.ts` — AI ile niyet (intent) tespiti, eksik alan kontrolü, hafta aralığı
- `lib/bot-executor.ts` — komutları Supabase'e yazan executor (org-scoped, service-role)
- `lib/telegram.ts` — `confirmKeyboard` (Onayla/İptal) + `getBotUsername`
- `app/api/telegram/webhook/route.ts` — intent akışı + `confirm_cmd`/`cancel_cmd` callback'leri + pending durum
- `supabase/...20260625000000_telegram_bot_commands.sql` — `bot_pending_commands` tablosu + `create_settlement_atomic`'e `p_organization_id`
- `lib/bot-intent.test.ts` — 7 test
- **DB migration UYGULANDI** ✅ (Supabase'de çalıştırıldı)

### Aşama 2 — Kolay Bağlama (Pairing) + Grup Yönetimi (kod hazır)
Chat ID kopyalama derdi yok; gruplar da tam yönetim yapıyor.

- `supabase/...20260626000000_telegram_pairing.sql` — `telegram_pairing_codes` tablosu (tek kullanımlık, 15 dk)
- `supabase/schema.sql` — tablonun aynası
- `app/(app)/settings/actions.ts` — `createTelegramPairingCode()` (kod + `t.me/bot?start=KOD` linki)
- `components/TelegramConnect.tsx` — "Bağlantı Kodu Oluştur" butonu (link + `/pair KOD` + kopyala)
- `app/(app)/settings/page.tsx` — "Telegram'ı Bağla" kartı; eski elle-eşleme metni sadeleşti
- `app/api/telegram/webhook/route.ts` — `/start KOD`, `/pair KOD`, `/help`, `consumePairingCode`;
  intent akışı gruplara açıldı (grup `unknown` → yük import'a düşer, broker metni korunur)

**Doğrulama:** `tsc --noEmit` ✅ · `lint` ✅ · 34 test ✅ · production build ✅

---

## ⏳ Sıradaki Adımlar (yapılacaklar)

1. **[SEN] Aşama 2 migration'ını uygula** ← ŞU AN BURADAYIZ
   - Supabase → SQL Editor → `supabase/migrations/20260626000000_telegram_pairing.sql` çalıştır
   - (veya `npx supabase db push`)
2. **[SEN] Deploy** — GitHub'a push → Vercel otomatik deploy (webhook URL'i değişmediyse `setWebhook` gerekmez)
3. **[SEN] Uçtan uca test:**
   - Özel: Settings → *Telegram'ı Bağla* → *Telegram'da Aç* → Başlat → "✅ Bağlandı" → `araçları listele`
   - Grup: botu gruba ekle (admin) → `/pair KOD` → `John Doe diye %33 company driver ekle` → Onayla
   - Grupta broker yük metni gönder → eski yük onay akışı çıkmalı
   - Eksik alan: sadece `araç ekle` → bot eksik alanı sorar; `iptal` ile vazgeç

---

## 🔧 Çözülen Önemli Sorunlar (not)
- `create_settlement_atomic` org'u `current_org_id()`'den alıyordu → bot service-role'de null kalıyordu.
  Çözüm: opsiyonel `p_organization_id` (yalnız oturum yokken kullanılır; kullanıcı kendi org'unu override edemez).
- Pairing güvenliği: kod tek kullanımlık + 15 dk; başka org'a bağlı chat yeniden bağlanamaz.

---

## 💡 İleride Eklenebilecekler (opsiyonel fikirler)
- [ ] Gruplarda AI maliyetini azaltmak: intent'i yalnız `@bot` mention / bota reply olunca çalıştır
- [ ] `setMyCommands` ile Telegram menüsüne `/start /pair /help` ekle (keşfedilebilirlik)
- [ ] Eski/kullanılmış pairing kodlarını ve 24 saatten eski `bot_pending_commands` kayıtlarını temizleyen cron
- [ ] `delete_entity` için gider (expense) silmeyi de destekle
- [ ] Listelerde sayfalama (şu an ilk 10 + "uygulamadan görün")
- [ ] Settlement dışı `external_carrier_statement` için bot akışı (net pay girişi)

---

## 🛰️ Canlı Takip (Tracking) — durum

Sunucu tarafı zaten vardı (`/api/tracking/*`, `lib/tracking/*`, `tablet_tokens`). Eksik olan **konum
gönderen istemci** eklendi:

- `app/drive/page.tsx` + `components/DriverTracker.tsx` — tarayıcı sürücü sayfası
  (`navigator.geolocation` → `/api/tracking/location`, mph dönüşümü, çevrimdışı batch kuyruğu, aktif yük).
- `middleware.ts` — `/drive` auth'tan muaf (herkese açık, tablet token ile yetkilenir).
- `components/TabletManagement.tsx` — token üretilince hazır `/drive?token=...` linki + kopyala.
- `supabase/schema.sql` — tracking tabloları migration'dan **aynalandı** (sıfırdan kurulum tutarlı).
- `docs/11-tracking.md` — modül dokümantasyonu.

**[SEN] Yapılacak:** `supabase/migrations/20260627000000_tracking_module.sql` canlı Supabase'e
uygulandı mı doğrula (`select 1 from unit_locations limit 1;`). Telefon demosu için sürücü linkini
**HTTPS** (Vercel) üzerinden aç — localhost dışında GPS yalnız HTTPS'te çalışır.

---

## 📁 İlgili Dosyalar (hızlı referans)
- Webhook: `app/api/telegram/webhook/route.ts`
- AI intent: `lib/bot-intent.ts` · Executor: `lib/bot-executor.ts`
- Pairing UI: `components/TelegramConnect.tsx` · Action: `app/(app)/settings/actions.ts`
- Migrations: `supabase/migrations/20260625000000_*`, `20260626000000_*`
- Plan: `C:\Users\hiart\.claude\plans\c-users-hiart-cursor-plans-telegram-ai-y-linked-parasol.md`
