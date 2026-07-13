# Fleet App — Dokümantasyon

Bu klasör projenin **tüm katmanlarını, kurulumunu ve operasyonunu** sıfırdan anlatır. Hiçbir adım
varsayılmaz. Sıralı okuman önerilir.

## İçindekiler

| # | Dosya | Ne anlatır |
|---|---|---|
| 01 | [Mimari](01-mimari.md) | Tüm katmanlar (UI, server actions, lib, API, auth, Supabase, Vercel) + veri akışı |
| 02 | [Veritabanı Şeması](02-veritabani-semasi.md) | 23 tablo kolon-kolon, RLS, trigger, storage, indexler |
| 03 | [Supabase Kurulum](03-supabase-kurulum.md) | Hesap aç → proje → şema yükle → bucket → anahtarlar |
| 04 | [Telegram Kurulum](04-telegram-kurulum.md) | Bot oluştur → gruba ekle → webhook → grup eşleme |
| 05 | [fal.ai (Yapay Zeka)](05-fal-ai.md) | Yük okuma fal.ai ile; key, model, görsel/PDF davranışı, maliyet |
| 06 | [Codex + MCP](06-codex-mcp.md) | Codex MCP kurulumu: Supabase (read-only) + fal MCP |
| 07 | [Ortam Değişkenleri](07-ortam-degiskenleri.md) | Tüm env'ler: ne işe yarar, nereden alınır |
| 08 | [Deploy](08-deploy.md) | GitHub → Vercel → env → webhook → cron |
| 09 | [Kullanım Akışı](09-kullanim-akisi.md) | Haftalık operasyon adımları |
| 10 | [Maliyet & Limitler](10-maliyet-ve-limitler.md) | Ücretsiz katman sınırları, fal maliyeti, v2 kapsamı |
| 11 | [Canlı Takip (GPS)](11-tracking.md) | Tablet token → sürücü sayfası → canlı harita, geofence, ETA, alert |

## Hızlı başlangıç sırası
1. **03** Supabase kur → **07** env doldur → **02**'ye göz at (şemayı anla).
2. **05** fal.ai key al → **04** Telegram botu bağla.
3. `npm install && npm run dev` → **Kayıt ol**.
4. **08** Vercel'e deploy → webhook'u prod URL'e bağla.
5. Geliştirmeye Codex ile devam: **06** + repo kökündeki `AGENTS.md`.

> Çalışan kodun özeti ve komutlar için repo kökündeki [`README.md`](../README.md) ve
> [`AGENTS.md`](../AGENTS.md) dosyalarına da bak.
