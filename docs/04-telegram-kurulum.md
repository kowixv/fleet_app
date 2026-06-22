# 04 — Telegram Bot Kurulumu

Amaç: her şoför grubuna düşen yük (PDF/ekran görüntüsü/mesaj) otomatik okunup onaya düşsün.

## 1) Bot oluştur
1. Telegram'da **@BotFather**'a yaz → `/newbot`.
2. Bota bir ad ve kullanıcı adı ver (kullanıcı adı `bot` ile bitmeli).
3. BotFather sana bir **token** verir (ör. `123456:ABC-DEF...`). → `TELEGRAM_BOT_TOKEN`.

## 2) Botu gruplara ekle
1. Botu her şoför grubuna **üye olarak ekle**.
2. **Admin yap** (BotFather botları varsayılan "privacy mode"da sadece kendilerine yazılanları görür;
   admin yapınca grup mesajlarını/medyayı görebilir). Alternatif: BotFather → `/setprivacy` → ilgili
   bot → **Disable**.

## 3) Webhook'u bağla (deploy sonrası)
Uygulaman Vercel'de yayında olduktan sonra (bkz. [08](08-deploy.md)) bir kez çalıştır:
```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://UYGULAMAN.vercel.app/api/telegram/webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```
- `<TOKEN>` = bot token. `<TELEGRAM_WEBHOOK_SECRET>` = env'de belirlediğin uzun rastgele string.
- Telegram bu secret'ı her istekte `X-Telegram-Bot-Api-Secret-Token` header'ında gönderir; webhook
  bunu doğrular (`app/api/telegram/webhook/route.ts`).
- Webhook durumunu görmek için: `curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"`.

> Lokal geliştirmede webhook yerine [ngrok](https://ngrok.com) gibi bir tünel ile
> `https://....ngrok.app/api/telegram/webhook` kullanabilirsin.

## 4) Grupların Chat ID'sini öğren
1. Bot gruba eklenip webhook bağlı olduktan sonra, **gruba bir mesaj at**.
2. Grup henüz uygulamada eşlenmediği için bot şu yanıtı verir:
   *"Bu grup henüz bir araç/şoför ile eşlenmemiş. Chat ID: `-1234567890`"* → bu numarayı not al.

## 5) Grubu araç + şoför ile eşle
1. Uygulamada **Settings → Telegram Grupları → + Grup Eşle**.
2. **Telegram Chat ID** = az önceki numara; **Araç** ve **Şoför** seç; **Aktif** işaretle → Kaydet.
3. Artık o gruba düşen yükler otomatik o araca/şoföre atanır.

## 6) Uçtan uca test
1. Gruba örnek bir **Amazon Relay ekran görüntüsü** veya **Rate Confirmation PDF** gönder.
2. Bot kısa sürede özet + **✅ Onayla / ❌ Reddet** butonlarıyla yanıt verir.
3. **Onayla** → resmi `loads` kaydı oluşur. Aynı kuyruk web'de **Telegram Yükleri** sayfasında da
   görünür; oradan da düzenleyip onaylayabilirsin.

## Sık sorunlar
- **Bot mesajları görmüyor:** privacy mode açık → admin yap veya `/setprivacy` → Disable.
- **Webhook çalışmıyor:** `getWebhookInfo`'da `last_error_message`'a bak; URL/secret eşleşmeli,
  uygulama yayında olmalı.
- **Yük okunamadı:** `FAL_KEY` tanımlı mı? PDF taranmış (metin katmanı yok) olabilir → web'den elle
  düzelt (bkz. [05](05-fal-ai.md)).
