# 10 — Maliyet & Limitler

## Ücretsiz katman — ne bedava, ne değil
| Servis | Ücretsiz katman | Bu proje için sınır mı? |
|---|---|---|
| **Vercel (Hobby)** | Web + serverless API + **günde cron çalışması sınırlı** | Hayır — günlük 1 PM cron yeterli |
| **Supabase (Free)** | 500 MB DB, 1 GB Storage, sınırsız API isteği, **7 gün inaktivitede pause** | Hayır — düzenli kullanım canlı tutar; 10–15 araç verisi küçüktür |
| **Telegram Bot** | Tamamen ücretsiz | Hayır |
| **fal.ai** | **Kullandıkça öde** (tek ücretli parça) | Çok düşük — aşağıya bak |

## fal.ai maliyeti (tek gerçek gider)
- Yük okuma model + token bazlı ücretlenir. `google/gemini-2.5-flash` ile yük başına tipik birkaç
  **cent**.
- Kaba tahmin: ayda ~300 yük × ~birkaç cent ≈ **birkaç dolar/ay**.
- Düşürmek: `AI_MODEL`'i `google/gemini-2.5-flash-lite` yap; metin katmanlı PDF'ler zaten ucuz metin
  yoluyla işlenir.

## Ücretsiz katman uyarıları (pratik)
- **Supabase 7-gün pause:** Hiç istek gelmezse proje uyur; panelden tek tıkla uyandırılır. Bot/cron
  düzenli çalıştığı sürece sorun olmaz.
- **Vercel cron:** Hobby planda sınırlı sayıda/sıklıkta; günde 1 PM kontrolü için uygundur. Daha sık
  isteğe Pro gerekir.
- **Storage:** Telegram dosyaları `imports` bucket'ında birikir; periyodik temizlik (eski importlar)
  ileride eklenebilir.

## Kapsam dışı (v2 — bu sürümde yok, Codex ile eklenebilir)
- Repairs (tamir kayıtları), Driver Scorecard, Unit Profitability (aylık/yıllık kârlılık),
  Fuel Efficiency (MPG), Repair Cost Warning.
- Gelişmiş raporlar + CSV export.
- Rol bazlı yetki matrisi (Owner/Admin/Manager/Viewer ayrı izinler) — şu an tek-org basit auth.
- Taranmış (metinsiz) PDF için OCR/rasterize.
- Telegram dosyalarının otomatik arşivlenmesi/temizliği.

Bu modüller için tablolar şemada büyük ölçüde **hazır** (ör. `repair_orders` v2'de eklenecek,
`maintenance_records`, `vehicle_mileage_logs` mevcut). Settlement motoru ve veri modeli bu
genişlemelere uygun tasarlandı.
