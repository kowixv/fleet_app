# 03 — Supabase Kurulumu (sıfırdan)

Supabase ücretsiz katmanı bu uygulama için yeterlidir: Postgres veritabanı + kullanıcı girişi +
dosya depolama. Süre: ~10 dakika.

## 1) Hesap aç
1. [supabase.com](https://supabase.com) → **Start your project** / **Sign in**.
2. GitHub ile veya email ile kayıt ol (ücretsiz).

## 2) Yeni proje oluştur
1. **New project**.
2. **Name:** `fleet-app` (istediğin ad).
3. **Database Password:** güçlü bir şifre belirle ve **bir yere kaydet** (sonra lazım olabilir).
4. **Region:** sana/şoförlerine en yakın bölge (ör. Frankfurt / East US).
5. **Create new project** → birkaç dakika kurulum bekler.

## 3) Şemayı yükle (tablolar + RLS + trigger)
1. Sol menü → **SQL Editor** → **New query**.
2. Repodaki [`supabase/schema.sql`](../supabase/schema.sql) dosyasının **tamamını** kopyala, editöre
   yapıştır.
3. **Run** (Ctrl/Cmd+Enter). "Success" görmelisin. Bu; 23 tabloyu, RLS politikalarını,
   `current_org_id()` fonksiyonunu ve kayıt trigger'ını kurar. Tekrar çalıştırmak güvenlidir.
4. Doğrula: sol menü → **Table Editor** → 23 tablo listelenmeli.

## 4) Storage bucket (otomatik)
`schema.sql` çalıştığında **`imports` private bucket'ı otomatik oluşur** — manuel adım gerekmez.
(İstersen **Storage** menüsünden `imports` bucket'ının oluştuğunu doğrulayabilirsin.) Dosyalara erişim
uygulama içinden imzalı URL ile yapılır (`app/api/imports/file`, servis rolüyle imzalar; ekstra
Storage politikası gerekmez).

## 5) API anahtarlarını al
1. Sol menü → **Project Settings** (dişli) → **API**.
2. Şunları kopyala (env'e gidecek — bkz. [07](07-ortam-degiskenleri.md)):
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon / public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role key** → `SUPABASE_SERVICE_ROLE_KEY` (**GİZLİ** — sadece sunucu; webhook/cron
     RLS'i bypass etmek için kullanır, tarayıcıya asla gitmez)

## 6) Auth ayarı (önemli — hızlı giriş için)
Varsayılan olarak Supabase, kayıtta **email doğrulaması** ister. Tek/küçük ekip kullanımında bunu
kapatmak en pratiğidir:
1. Sol menü → **Authentication** → **Providers** → **Email**.
2. **Confirm email** seçeneğini **kapat** → kayıt olur olmaz giriş yapılır.
   - (İstersen açık bırak; o zaman kayıt sonrası gelen maildeki linke tıklaman gerekir.)

## 7) Test
- Lokal `.env.local`'i doldurduktan sonra `npm run dev` → `http://localhost:3000` → **Kayıt ol**.
- Kayıt başarılıysa trigger çalışmış, otomatik bir organizasyon + owner profilin oluşmuş demektir.

## 8) (Opsiyonel) Örnek veri yükle
Uygulamayı hemen denemek için: **Kayıt olduktan sonra** SQL Editor'de
[`supabase/seed.sql`](../supabase/seed.sql) dosyasını çalıştır. İlk organizasyona örnek şirket,
3 araç (3 farklı model), şoför/owner/investor, bu haftaya yükler+masraflar ve bir bakım kuralı ekler;
böylece **Settlements**'tan anında bir hesap + PDF üretebilirsin.

## Notlar
- **7 gün kuralı:** Ücretsiz proje 7 gün hiç istek almazsa "pause" olur; panelden tek tıkla geri
  açılır. Düzenli bot/cron kullanımı bunu engeller.
- Veritabanını ileride değiştirmek istersen migration'ları yine **SQL Editor**'den çalıştırırsın
  (veya Codex'e Supabase MCP ile yaptırırsın — bkz. [06](06-codex-mcp.md)).
