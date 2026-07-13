# 02 — Veritabanı Şeması (tam, kolon-kolon)

Kaynak dosya: [`supabase/schema.sql`](../supabase/schema.sql) — tek seferde çalıştırılır, tekrar
çalıştırmak güvenlidir (idempotent). Tüm tablolar **`organization_id`** taşır ve **RLS** ile
organizasyona izole edilir. Aşağıdaki tablo adları ve kolonlar kodla birebir eşleşir.

## Genel kurallar
- **Tenancy (kiracılık):** Her satır bir `organizations.id`'ye bağlıdır. Kullanıcı yalnızca kendi
  organizasyonunun verisini görür/yazar.
- **PK:** `id uuid default gen_random_uuid()` (aksi belirtilmedikçe).
- **Para:** `numeric`. **Yüzdeler:** kesir olarak saklanır (ör. %33 → `0.33`).
- **Zaman:** `created_at timestamptz default now()`.

---

## Katman 1 — Kiracılık & kullanıcı

### `organizations`
Her hesabın izole alanı (kiracı).
| Kolon | Tip | Açıklama |
|---|---|---|
| id | uuid PK | |
| name | text | Varsayılan "My Fleet" |
| created_at | timestamptz | |

### `profiles`
Supabase Auth kullanıcısını bir organizasyona ve role bağlar.
| Kolon | Tip | Açıklama |
|---|---|---|
| id | uuid PK → auth.users.id | Kullanıcı kimliği |
| organization_id | uuid FK → organizations | Zorunlu |
| email | text | |
| full_name | text | |
| role | text | `owner` \| `admin` \| `manager` \| `viewer` (varsayılan owner) |
| created_at | timestamptz | |

---

## Katman 2 — Referans veriler

### `companies`
Bizim kendi taşıyıcı şirketlerimiz (ör. ZYNP LLC).
| Kolon | Tip | Açıklama |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid FK | |
| name | text | Zorunlu |
| scac | text | PDF başlığında kullanılır |
| mc_number / usdot_number | text | Kayıt için (PDF imza bloğunda **gösterilmez**) |
| notes | text | |

Kullanım: `vehicles`, `loads`, `expenses`, `settlements`, `telegram_groups`, PDF.

### `external_carriers`
Bizim altımızda olmayan, statement gönderen dış taşıyıcılar (Model 5).
| Kolon | Tip | Açıklama |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid FK | |
| name | text | Zorunlu |
| default_commission | numeric | Varsayılan $250 |
| notes | text | |

### `people`
Şoförler, owner-operator'lar, yatırımcılar.
| Kolon | Tip | Açıklama |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid FK | |
| full_name | text | Zorunlu |
| type | text | `company_driver` \| `owner_operator` \| `investor` \| `external_carrier_driver` |
| phone / email | text | |
| default_pay_pct | numeric | Şoför varsayılan pay yüzdesi (kesir) |
| default_insurance_deduction | numeric | Varsayılan sigorta kesintisi |
| default_eld_ifta_deduction | numeric | Varsayılan ELD/IFTA kesintisi |
| status | text | `active` \| `inactive` |
| notes | text | |

### `vehicles` — **settlement esnekliğinin kalbi**
Araç/unit ve ona ait **ödeme konfigürasyonu**. Bir aracın nasıl hesaplanacağı buradaki kolonlardan
çözülür (bkz. `lib/settlement/resolve.ts`).
| Kolon | Tip | Açıklama |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid FK | |
| unit_number | text | Zorunlu |
| vehicle_type | text | `truck` \| `box_truck` \| `hotshot` \| `trailer` \| `other` |
| ownership_type | text | `company_owned` \| `owner_operator` \| `investor_managed` \| `external_carrier_statement` \| `partner_carrier` |
| company_id | uuid FK → companies | |
| external_carrier_id | uuid FK → external_carriers | |
| owner_id | uuid FK → people | Owner/yatırımcı |
| assigned_driver_id | uuid FK → people | Atanmış şoför |
| **default_driver_pay_pct** | numeric | Driver % (kesir) |
| **company_fee_pct** | numeric | Şirket kesintisi (0.12 / 0.10 / 0) |
| **company_fee_is_our_revenue** | boolean | Fee bizim gelirimiz mi? (komisyon raporu için) |
| **external_carrier_fee_pct** | numeric | Dış carrier kesintisi (Model 4; bizim gelirimiz değil) |
| **management_commission_type** | text | `none` \| `flat` \| `percent` |
| **management_commission_amount** | numeric | Sabit $ veya yüzde |
| vin, year, make, model, plate | — | Araç kimliği |
| current_mileage | numeric | Bakım hesabı için güncel mil |
| status | text | `active` \| `in_repair` \| `inactive` |
| notes | text | |

---

## Katman 3 — Operasyon

### `loads`
Yük (gelir) kayıtları. Telegram onayından veya elle gelir.
| Kolon | Tip | Açıklama |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid FK | |
| load_number | text | |
| load_source | text | `amazon_relay` \| `street_load` \| `broker` \| `dat` \| `direct_customer` \| `other` |
| company_id / external_carrier_id / vehicle_id / driver_id | uuid FK | |
| pickup_date / delivery_date | date | |
| pickup_location / delivery_location / route | text | |
| gross_amount | numeric | Yükün brüt tutarı (zorunlu mantıksal alan) |
| fuel_surcharge | numeric | |
| loaded_miles / empty_miles / total_miles | numeric | |
| status | text | `pending` \| `booked` \| `delivered` \| `paid` \| `cancelled` \| `rejected` |
| settlement_id | uuid | Bir settlement'a dahil edildiğinde dolar (çift sayımı önler) |
| source_file_url | text | Telegram dosyasının Storage yolu |
| notes | text | |

### `expenses`
Masraflar; hangi tarafın hakedişinden düşüleceği işaretlenir.
| Kolon | Tip | Açıklama |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid FK | |
| date | date | |
| company_id / external_carrier_id / vehicle_id / driver_id / owner_id | uuid FK | |
| category | text | fuel, def, fees, insurance, eld, ifta, tolls, repair, maintenance, advance, trailer_rental, chargeback, comcheck, misc, other |
| amount | numeric | |
| receipt_url | text | |
| deduct_from_settlement | boolean | Settlement'ta düşülsün mü (varsayılan true) |
| deduct_from_driver / deduct_from_owner / deduct_from_investor | boolean | Hedefli kesinti bayrakları |
| settlement_id | uuid | Dahil edildiğinde dolar |
| notes | text | |

### `settlements`
Bir hafta + araç için hesaplanmış hakediş başlığı (config snapshot + toplamlar).
| Kolon | Tip | Açıklama |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid FK | |
| settlement_type | text | `company_driver` \| `box_truck_driver` \| `owner_operator` \| `managed_investor` \| `external_carrier_statement` |
| company_id / external_carrier_id / vehicle_id / driver_id / owner_id | uuid FK | |
| week_start / week_end | date | |
| config | jsonb | Hesapta kullanılan çözülmüş config (denetim için snapshot) |
| gross_revenue | numeric | |
| total_deductions | numeric | |
| our_commission_earned | numeric | Bizim kazandığımız komisyon/fee |
| net_pay | numeric | Ödenecek net |
| external_net_pay | numeric | Model 5 girdisi |
| status | text | `draft` \| `pending_review` \| `finalized` \| `paid` \| `void` |
| pdf_url | text | (opsiyonel) üretilen PDF |
| notes | text | |

> **Kural:** `finalized` ve `paid` düzenlenemez/silinemez (UI + action guard). `paid` yalnızca `void`
> yapılabilir.

### `settlement_items`
Settlement'ın satır satır dökümü (motorun ürettiği line item'lar).
| Kolon | Tip | Açıklama |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid FK | |
| settlement_id | uuid FK → settlements (cascade) | |
| key | text | `driver_pay`, `company_fee`, `our_commission`… |
| label_en / label_tr | text | Bilingual etiket (PDF için) |
| amount | numeric | İşaretli (negatif = kesinti) |
| is_our_revenue | boolean | Komisyon raporuna sayılır mı |
| sort_order | int | Sıra |

---

## Katman 4 — Telegram içe aktarma

### `telegram_groups`
Her şoför grubunu araç+şoför+şirketle eşler.
| Kolon | Tip | Açıklama |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid FK | |
| chat_id | text | Telegram chat id (org içinde benzersiz) |
| title | text | |
| vehicle_id / driver_id / company_id | uuid FK | Eşleme |
| active | boolean | |

### `imported_loads`
Telegram'dan gelen ve **onay bekleyen** ham + AI-okunmuş yükler.
| Kolon | Tip | Açıklama |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid FK | |
| telegram_group_id | uuid FK | |
| chat_id / message_id | text | |
| source_type | text | `pdf` \| `photo` \| `text` |
| raw_text | text | Mesaj metni |
| file_url | text | Storage yolu |
| extracted | jsonb | AI'ın çıkardığı ham JSON |
| load_number, broker_name, driver_name, pickup_date, pickup_location, delivery_date, delivery_location, total_miles, gross_rate | — | Düzenlenebilir okunmuş alanlar |
| status | text | `pending` \| `approved` \| `rejected` |
| created_load_id | uuid FK → loads | Onaylanınca oluşan load |

---

## Katman 5 — Bakım

### `maintenance_rules`
Her araç için bakım aralıkları.
| Kolon | Tip | Açıklama |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid FK | |
| vehicle_id | uuid FK | |
| service_type | text | "Oil Change", "PM Service", "Annual Inspection"… |
| interval_type | text | `mileage` \| `date` |
| interval_miles | numeric | Mil bazlı aralık (ör. 25000) |
| interval_days | int | Tarih bazlı aralık |
| last_done_mileage | numeric | Son yapılan mil |
| last_done_date | date | Son yapılan tarih |
| active | boolean | |

### `maintenance_records`
Yapılan bakımların geçmişi.
| Kolon | Tip | Açıklama |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid FK | |
| vehicle_id | uuid FK | |
| rule_id | uuid FK → maintenance_rules | |
| service_type | text | |
| performed_date | date | |
| mileage | numeric | |
| cost | numeric | |
| shop_name | text | |
| invoice_url | text | |
| notes | text | |

### `vehicle_mileage_logs`
Mil güncelleme geçmişi (denetim).
| Kolon | Tip | Açıklama |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid FK | |
| vehicle_id | uuid FK | |
| mileage | numeric | |
| logged_at | timestamptz | |
| source | text | `manual`… |

---

## Katman 6 — Ayarlar

### `settings` (org başına tek satır)
| Kolon | Tip | Açıklama |
|---|---|---|
| organization_id | uuid PK FK | |
| default_commission | numeric | Model 5 vb. için varsayılan komisyon ($250) |
| pm_due_soon_miles | numeric | "Due Soon" eşiği (2500) |
| repair_warning_amount | numeric | Repair uyarı tutarı (v2) |
| fuel_warning_pct | numeric | Fuel uyarı eşiği (kesir, v2) |
| data | jsonb | Genişleme için serbest alan |
| updated_at | timestamptz | |

---

## Güvenlik objeleri (tablo değil ama şemanın parçası)

### `current_org_id()` (SQL fonksiyonu, security definer)
`auth.uid()`'den kullanıcının `organization_id`'sini döner. **Tüm RLS politikaları bunu kullanır.**

### `handle_new_user()` + `on_auth_user_created` trigger
Yeni kayıt olduğunda otomatik olarak: bir `organizations` satırı + `profiles` (role `owner`) +
`settings` oluşturur. Yani kayıt olur olmaz hesap kullanılabilir.

### RLS politikaları
Her tabloda tek politika: `using (organization_id = current_org_id()) with check (organization_id =
current_org_id())`. `organizations` ve `profiles` için kendi varyantları var. Servis-rol anahtarı
(webhook/cron) RLS'i bypass eder — yalnızca güvenli sunucu bağlamında kullanılır.

### Storage
`imports` adında **private** bucket — Telegram'dan gelen PDF/görseller burada. Erişim
`app/api/imports/file` üzerinden imzalı URL ile (auth korumalı).

### Indexler
`loads(organization_id, delivery_date)`, `expenses(organization_id, date)`,
`settlements(organization_id, week_end)`, `imported_loads(organization_id, status)`,
`telegram_groups(chat_id)`.

### `maintenance_invoices` (2026-07-12)
PDF bakım invoice metadata ve duplicate kontrolü.

| Kolon | Tip | Açıklama |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid FK | Tenant |
| vehicle_id | uuid FK | Tespit/Seçilen unit |
| invoice_number | text | Invoice numarası |
| invoice_date | date | Invoice tarihi |
| shop_name | text | Servis/Shop |
| file_name | text | Orijinal dosya adı |
| storage_path | text | Private `maintenance-invoices` bucket yolu |
| file_hash | text unique/org | SHA-256 duplicate anahtarı |
| raw_text | text | PDF metin katmanı |
| parsed_data | jsonb | Doğrulanmış AI çıktısı |
| created_by | uuid FK | Web kullanıcısı varsa |

`maintenance_records` ayrıca `invoice_id`, `part_name`, `next_due_mileage`, `next_due_date`, `source`, `created_by`, `updated_at` alanlarını taşır. `settings.pm_due_soon_days` tarih uyarı eşiğidir.
