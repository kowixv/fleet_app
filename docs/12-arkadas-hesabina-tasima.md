# 12 — Arkadaşın Hesabına Taşıma (Supabase + Vercel)

Aynı uygulamayı **arkadaşının** Supabase ve Vercel hesabına kurma rehberi. **Sadece Supabase
ve Vercel** kimlik bilgileri değişir; diğer tüm anahtarlar **aynı kalır**. Temel deploy akışı
için [08-deploy.md](08-deploy.md), env tablosu için [07-ortam-degiskenleri.md](07-ortam-degiskenleri.md).

> ⚠️ **MCP KULLANMA.** Supabase/Vercel MCP bu makinede **senin** hesabına bağlı. MCP "hangi
> kelimeyi yazdığına" göre değil, **bağlı olduğu token'a** göre çalışır → MCP ile deploy edilirse
> proje yanlışlıkla **senin** hesabına kurulur. Bütün işlemler aşağıdaki gibi **arkadaşının
> token'larıyla CLI** üzerinden yapılır.

---

## Durum / kaldığın yer

| # | Adım | Durum |
|---|---|---|
| 1 | Arkadaşın token'ları: `VERCEL_TOKEN`, `SUPABASE_ACCESS_TOKEN`, org-id + region | ⬜ **Bekliyor** |
| 2 | Supabase projesi oluştur + `db push` (migration'lar) | ⬜ |
| 3 | Vercel projesi + env değişkenleri + `vercel --prod` | ⬜ |
| 4 | Telegram webhook'u yeni dom'a çevir | ⏸️ **Şimdilik dokunma** (aşağıdaki nota bak) |
| 5 | Cron + ilk kullanım doğrulaması | ⬜ |

> Token'lar geldiğinde 1 → 5 sırayla ilerlenir. İlerledikçe bu tabloyu güncelle.

---

## Değişen vs. aynı kalan anahtarlar

**Sadece bunlar değişir** (arkadaşın yeni Supabase projesinden gelir):

| Değişken | Nereden |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yeni Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yeni Supabase → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Yeni Supabase → API |
| `NEXT_PUBLIC_APP_URL` | Arkadaşın yeni Vercel domain'i |

**Aynı kalır** (mevcut değerleri kopyala):
`FAL_KEY`, `AI_MODEL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `CRON_SECRET`,
`GOOGLE_ROUTES_API_KEY`.

---

## Token nereden alınır (arkadaşın kendi hesabından üretir)

- **Vercel token:** `vercel.com/account/settings/tokens` → **Create Token** → `VERCEL_TOKEN`.
- **Supabase access token:** `supabase.com/dashboard/account/tokens` → **Generate new token**
  → `SUPABASE_ACCESS_TOKEN`.
- **Supabase org-id + region:** CLI ile proje açılacaksa gerekir (`npx supabase orgs list`),
  ya da arkadaşın projeyi panelden açar.

> Token'ları `.env.local`'a yaz, sohbete/koda yapıştırma. `.gitignore` zaten `.env*`'i hariç tutar.

---

## Adım adım (CLI, MCP'siz)

CLI'lar global kurulu değil — `npx` ile çalıştır (node 20+ / npm yeterli). Proje kökü: `cd fleet-app`.

### 1) Supabase — yeni proje + migration'lar
```bash
export SUPABASE_ACCESS_TOKEN=<arkadasin-token>

# (a) Proje: CLI ile oluştur VEYA arkadaşın panelden açsın
npx supabase projects create fleet-app --org-id <org> --region <bolge> --db-password '<guclu-sifre>'
#   → çıkan PROJECT REF'i not et

# (b) Repoyu projeye bağla ve migration'ları uygula
npx supabase link --project-ref <ref>
npx supabase db push     # supabase/migrations/* yeni veritabanına uygulanır
```
Ardından **Project Settings → API**'den `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` değerlerini al.
> Seed (`supabase/seed.sql`) yalnızca örnek veri istiyorsan; canlı kurulumda atla.

### 2) Vercel — yeni proje + env + deploy
```bash
export VERCEL_TOKEN=<arkadasin-token>
SCOPE=<arkadasin-takim-veya-kullanici>

npx vercel link --token $VERCEL_TOKEN --scope $SCOPE --yes

# Env değişkenleri (production). Değişenler = yeni Supabase; gerisi aynı:
npx vercel env add NEXT_PUBLIC_SUPABASE_URL production --token $VERCEL_TOKEN
npx vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production --token $VERCEL_TOKEN
npx vercel env add SUPABASE_SERVICE_ROLE_KEY production --token $VERCEL_TOKEN
npx vercel env add NEXT_PUBLIC_APP_URL production --token $VERCEL_TOKEN   # yeni vercel domaini
# Aynı kalanlar:
npx vercel env add FAL_KEY production --token $VERCEL_TOKEN
npx vercel env add AI_MODEL production --token $VERCEL_TOKEN
npx vercel env add TELEGRAM_BOT_TOKEN production --token $VERCEL_TOKEN
npx vercel env add TELEGRAM_WEBHOOK_SECRET production --token $VERCEL_TOKEN
npx vercel env add CRON_SECRET production --token $VERCEL_TOKEN
npx vercel env add GOOGLE_ROUTES_API_KEY production --token $VERCEL_TOKEN   # opsiyonel

npx vercel --prod --token $VERCEL_TOKEN
```
`vercel.json`'daki cron (`/api/cron/pm-check`, her gün 13:00 UTC) otomatik kurulur.

### 3) Telegram webhook — ⏸️ ŞİMDİLİK DOKUNMA
Telegram botu **aynı token'la** kalıyor. Bir botun **yalnızca tek** webhook URL'si olabilir;
webhook'u yeni dom'a çevirmek eski deploy'un Telegram akışını koparır. Bu yüzden **şu an
ertelendi**. Tam geçişe hazır olunca:
```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -d "url=https://<YENI-DOMAIN>.vercel.app/api/telegram/webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```
> Alternatif: arkadaşın @BotFather'dan **yeni bir bot** açar → iki deploy paralel çalışır.

---

## Deploy sonrası doğrulama
1. `cd fleet-app && npm run build` → lokal build temiz mi?
2. Yeni Supabase'de tablolar oluştu mu (`npx supabase db diff` boş, ya da SQL editor'de liste).
3. Yeni Vercel dom.'ü açılıyor, kayıt/login + dashboard çalışıyor mu?
4. Cron: Vercel → Project → **Cron Jobs** → `/api/cron/pm-check` `CRON_SECRET` ile 200 dönüyor mu.
5. Telegram: (ertelendi) webhook çevrilince bir mesajla test et.

> Bu dosya repoya girer — değişiklikten sonra **push etmeyi unutma** (commit/push'u sen yaparsın).
