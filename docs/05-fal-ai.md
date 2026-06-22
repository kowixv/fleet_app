# 05 — fal.ai (Yük Okuma / Yapay Zeka)

Telegram'dan gelen yükleri (görsel/PDF/metin) yapılandırılmış JSON'a çeviren yapay zeka tamamen
**fal.ai** üzerinden, senin **`FAL_KEY`**'inle çalışır. Anthropic/OpenAI anahtarı **gerekmez**.

## Neden fal.ai + bu endpoint?
- fal.ai tek bir key ile çok sayıda modele erişim verir (OpenRouter router üzerinden).
- Eski `fal-ai/any-llm/vision` endpoint'i **deprecated**. Bu proje **güncel** olan
  **`openrouter/router/vision`** (görseller) ve **`openrouter/router`** (metin) endpoint'lerini
  kullanır.

## Key alma
1. [fal.ai](https://fal.ai) → hesap aç.
2. **Dashboard → Keys** → yeni key oluştur → `FAL_KEY` olarak env'e koy.
3. Modeli `AI_MODEL` ile seç (varsayılan **`google/gemini-2.5-flash`** — ucuz ve görselde güçlü).
   Alternatifler: `google/gemini-2.5-flash-lite` (daha ucuz), `anthropic/claude-3.5-sonnet` (daha
   güçlü, daha pahalı), `openai/gpt-4o-mini` vb.

## Kodda nasıl çalışır
- `lib/ai.ts` — fal istemcisi:
  - `runVision(imageDataUris, system, prompt)` → `fal.subscribe("openrouter/router/vision", { input:
    { prompt, system_prompt, image_urls, model, temperature: 0 } })`, çıktı `result.data.output`.
  - `runText(system, prompt)` → `openrouter/router`.
- `lib/parse.ts` — medya tipine göre yönlendirir:
  | Girdi | İşlem |
  |---|---|
  | Görsel (jpg/png/webp) | base64 data URI → `runVision` |
  | PDF (metin katmanlı) | `unpdf` ile metin çıkar → `runText` |
  | PDF (taranmış, metinsiz) | `null` döner → web'den elle giriş |
  | Düz metin mesajı | `runText` |
- Çıktı her zaman şu JSON'a indirgenir (`ParsedLoad`): `load_number, broker_name, driver_name,
  pickup_date, pickup_location, delivery_date, delivery_location, total_miles, gross_rate, notes`.
- **Asla otomatik load oluşturulmaz** — her zaman `imported_loads` (pending) → insan onayı.

## Örnek istek/yanıt (kavramsal)
```js
const r = await fal.subscribe("openrouter/router/vision", {
  input: {
    prompt: "Extract the load and return ONLY JSON {...}",
    system_prompt: "You extract trucking LOAD information...",
    image_urls: ["data:image/jpeg;base64,...."],
    model: "google/gemini-2.5-flash",
    temperature: 0,
  },
});
// r.data.output === '{"load_number":"111WCQBHG","gross_rate":1570.51, ... }'
```

## Anahtarı test et (smoke test)
Key'in ve modelin çalıştığını uygulamayı açmadan doğrula:
```bash
# .env.local'de FAL_KEY varsa
npm run smoke:fal                      # metin endpoint testi
node scripts/fal-smoke.mjs ./ornek.jpg # vision endpoint testi (bir yük ekran görüntüsü)
```
Başarılıysa model çıktısını ve "✅ fal.ai çağrısı başarılı" yazısını görürsün.

## Maliyet
- fal, model + token bazlı ücretlendirir. gemini-flash ile tipik bir yük okuma birkaç **cent**
  civarıdır. Aylık birkaç yüz yük → birkaç dolar mertebesi.
- Düşürmek için: `AI_MODEL`'i `-lite` modele çek; PDF'lerde metin katmanı varsa zaten görsel değil
  ucuz metin yolu kullanılır.

## Sınırlar / ipuçları
- **Taranmış PDF** (sadece resim, metin katmanı yok) bu sürümde otomatik okunmaz → web'den elle
  düzelt. (İleride: PDF'i görsele rasterize edip vision'a verme eklenebilir — v2.)
- Yanlış okuma olursa **Telegram Yükleri** sayfasından **Düzenle** ile düzeltip onayla.
- Tüm AI çağrıları sunucu tarafındadır; `FAL_KEY` tarayıcıya hiçbir zaman gönderilmez.
