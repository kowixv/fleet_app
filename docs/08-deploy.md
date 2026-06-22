# 08 — Deploy (Vercel, ücretsiz)

## Ön koşullar
- Supabase kuruldu ([03](03-supabase-kurulum.md)), `FAL_KEY` ([05](05-fal-ai.md)) ve Telegram bot
  ([04](04-telegram-kurulum.md)) hazır.
- Kod bir **GitHub** reposunda.

## 1) GitHub'a yükle
```bash
cd fleet-app
git init
git add .
git commit -m "Fleet app"
# GitHub'da boş repo oluştur, sonra:
git remote add origin https://github.com/<kullanici>/fleet-app.git
git branch -M main
git push -u origin main
```
> `.gitignore` zaten `node_modules`, `.next`, `.env*`'i hariç tutar — gizli anahtarlar push edilmez.

## 2) Vercel'e import et
1. [vercel.com](https://vercel.com) → GitHub ile giriş → **Add New → Project**.
2. `fleet-app` reposunu seç → **Import**. Framework otomatik **Next.js** algılanır.
3. **Environment Variables** bölümüne [07](07-ortam-degiskenleri.md)'deki **tüm** değişkenleri ekle.
   `NEXT_PUBLIC_APP_URL`'yi Vercel'in vereceği gerçek domain yap (ör. `https://fleet-app-xxx.vercel.app`).
4. **Deploy** → birkaç dakikada yayında.

## 3) Cron otomatik kurulur
Repodaki [`vercel.json`](../vercel.json) günlük bakım kontrolünü tanımlar:
```json
{ "crons": [ { "path": "/api/cron/pm-check", "schedule": "0 13 * * *" } ] }
```
Vercel bunu otomatik zamanlar (her gün 13:00 UTC). Cron, `CRON_SECRET` ile korunur.

## 4) Telegram webhook'u prod URL'e bağla
```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://UYGULAMAN.vercel.app/api/telegram/webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

## 5) İlk kullanım
1. `https://UYGULAMAN.vercel.app` → **Kayıt ol** (ilk hesap = owner).
2. **Settings** → komisyon/eşikler + **Telegram Grupları** eşle.
3. **Vehicles / People / Companies** ekle → operasyona başla.

## Güncelleme akışı
`main`'e her push → Vercel otomatik yeniden deploy eder. Codex ile geliştirip push'larsın.

## Sorun giderme
- **500 / DB hatası:** env değişkenleri eksik/yanlış olabilir → Vercel'de kontrol et, redeploy.
- **Cron çalışmadı:** Vercel → Project → **Cron Jobs** sekmesinden son çalışmayı gör; `CRON_SECRET`
  eşleşmeli.
- **Build hatası:** lokal `npm run build` ile aynı hatayı çoğalt.
