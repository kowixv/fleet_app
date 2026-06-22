# 09 — Haftalık Kullanım Akışı

## Günlük: Telegram yükleri
1. Şoför grubuna yük düşer (PDF/ekran görüntüsü/mesaj) → bot okur → gruba **özet + Onayla/Reddet**.
2. **Onayla** (Telegram'dan veya web **Telegram Yükleri** sayfasından) → resmi `loads` kaydı oluşur,
   gruba bağlı araç/şoföre atanır.
3. Yanlış okuma varsa web'de **Düzenle** → düzelt → onayla.

## Gün içi: masraflar
- **Expenses** → fuel/def/insurance/tolls vb. ekle. Aracı ve gerekirse "Settlement'tan düş"ü işaretle.
  (Telegram onayından gelen yükler gelir; masrafları elle ya da ileride otomatik girersin.)

## Hafta sonu: settlement (hakediş)
1. **Settlements → + Yeni Settlement Oluştur**.
2. **Tip** seç (company driver / box truck / owner operator / managed-investor / external carrier),
   **araç**, **şoför/owner**, **hafta** aralığı. (Model 5 için **External Net Pay** gir.)
3. İstersen **override** alanlarıyla o haftaya özel driver % / company fee % / komisyon ver
   (boş bırakırsan araç/şoför varsayılanı kullanılır).
4. **Hesapla & Kaydet** → motor o aralıktaki loadları + "settlement'tan düş" masraflarını toplar,
   net + bizim komisyonu hesaplar; loadlar/masraflar bu settlement'a kilitlenir (çift sayım olmaz).
5. Detay sayfasında dökümü gör → **PDF İndir** (bilingual statement).
6. Doğruysa **Finalize** → ödeyince **Paid**. (Finalized/Paid artık düzenlenemez/silinemez.)

## Sürekli: bakım
1. **Maintenance** → araç başına bakım kuralı ekle (ör. "Oil Change" her 25.000 mil).
2. Aracın **mileage**'ını periyodik güncelle (tablodan satır içi).
3. Eşiği yaklaşınca **Dashboard**'da kart + günlük **Telegram uyarısı** gelir.
4. Bakım yapıldığında **Yapıldı işaretle** → yeni baz mil/tarih alınır, geçmişe kayıt düşer.

## Her gün: dashboard
- Bu hafta **gross / masraf / net**, **bekleyen Telegram yükü**, **bekleyen settlement**, **aktif/tamirde
  araç**, **toplam komisyon** ve **bakım uyarıları** tek ekranda.

## Başarı kriteri
Hafta sonunda her unit için doğru settlement hesaplanır, PDF üretilir, Telegram yükleri onaylanır ve
araçların bakım durumu dashboard'da görülür.
