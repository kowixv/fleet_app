# 07 — Ortam Değişkenleri (env)

Lokal: repo kökünde `.env.local` (örnek: [`.env.example`](../.env.example)). Üretim: Vercel →
**Settings → Environment Variables**. Aynı set her iki yerde de olmalı.

| Değişken | Zorunlu | Ne işe yarar | Nereden alınır |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase proje URL'i (tarayıcı + sunucu) | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Public anon anahtar (RLS ile sınırlı) | Supabase → API |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | **Gizli.** Webhook/cron RLS bypass için (yalnızca sunucu) | Supabase → API |
| `FAL_KEY` | ✅ | Yük okuma (fal.ai vision/LLM) | fal.ai → Dashboard → Keys |
| `AI_MODEL` | ⬜ | Yük okuma modeli (varsayılan `google/gemini-2.5-flash`) | — |
| `TELEGRAM_BOT_TOKEN` | ✅ | Bot API erişimi (mesaj/medya) | @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | ✅ | Webhook'u doğrulayan gizli token | sen belirle (uzun rastgele) |
| `CRON_SECRET` | ✅ | Günlük cron'u koruyan token | sen belirle (uzun rastgele) |
| `NEXT_PUBLIC_APP_URL` | ✅ | Mutlak linkler / webhook URL'i | Vercel domain'in |

## Notlar
- **`NEXT_PUBLIC_` öneki** olanlar tarayıcıya gönderilir → buraya **gizli** bir şey koyma.
- `SUPABASE_SERVICE_ROLE_KEY`, `FAL_KEY`, `TELEGRAM_BOT_TOKEN`, `*_SECRET` → **asla** `NEXT_PUBLIC_`
  yapma, git'e koyma. `.gitignore` zaten `.env*`'i hariç tutar.
- Rastgele secret üretmek için: `openssl rand -hex 32` (veya herhangi uzun rastgele string).
- Değişkenleri değiştirince Vercel'de **redeploy** gerekir.
