# Maintenance Invoice Upgrade — 2026-07-12

## Kapsam

- PDF invoice SHA-256 hash ile duplicate kontrolü.
- Metin katmanlı PDF analizi; taranmış PDF için sayfaları görsele çevirip fal.ai vision fallback.
- Tek invoice içindeki her servis ayrı `maintenance_records` satırı.
- Terminalde sonraki tarih/mileage ve mevcut kuralı overwrite/history seçimi.
- `maintenance_invoices` private Storage + metadata tablosu.
- `save_maintenance_invoice`, `set_vehicle_mileage`, `mark_maintenance_serviced` atomik PostgreSQL RPC işlemleri.
- Bakım geçmişi, invoice görüntüleme, mileage audit tablosu ve yüksek maliyet uyarıları.
- Ayarlanabilir `pm_due_soon_miles` (varsayılan 2000) ve `pm_due_soon_days` (varsayılan 7).

## Çalıştırma

```bash
npm install
# Supabase SQL Editor'da supabase/migrations/20260712000000_maintenance_invoice_upgrade.sql çalıştır.
npm run maintenance:invoice -- "C:\\Invoices\\invoice.pdf"
```

CLI her başlangıçta ve invoice kaydından sonra yaklaşan bakımları terminalde gösterir.

## Güvenlik ve tutarlılık

- PDF dosya hash’i organizasyon içinde unique.
- Invoice metadata, tüm servis kayıtları ve kural güncellemeleri tek transaction.
- Mileage düşürülemez; araç ve mileage logu tek transaction.
- “Yapıldı” işlemi client mileage’ına güvenmez, DB’den güncel odometreyi tekrar okur ve aynı gün/mileage tekrarını idempotent işler.
- Tarih hesapları `YYYY-MM-DD` calendar arithmetic kullanır; browser/Vercel timezone farkı oluşturmaz.
- Telegram API HTTP ve `ok:false` cevapları hata kabul edilir; cron gerçek teslimat sayısını raporlar.

## Doğrulama

- `npx tsc --noEmit`: başarılı
- `npm test`: 60/60 başarılı
- `npm run lint`: başarılı
