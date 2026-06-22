-- ============================================================================
-- Örnek (seed) veri — uygulamayı anında denemek için.
-- ÖNCE en az bir kez "Kayıt ol" ile hesap oluştur (bir organizasyon doğsun),
-- SONRA bu dosyayı Supabase SQL Editor'de çalıştır. İlk organizasyona ekler.
-- Tekrar çalıştırma önerilmez (kopya kayıt oluşturur).
-- ============================================================================
do $$
declare
  org uuid;
  comp uuid;
  drv uuid;       -- company driver
  own uuid;       -- owner operator
  inv uuid;       -- investor
  v_box uuid;     -- company-owned box truck
  v_oo uuid;      -- owner operator truck
  v_inv uuid;     -- investor-managed truck
begin
  select id into org from organizations order by created_at limit 1;
  if org is null then
    raise exception 'Önce uygulamadan Kayıt ol (organizasyon yok).';
  end if;

  -- Şirket
  insert into companies (organization_id, name, scac)
  values (org, 'ZYNP LLC', 'AVFYC') returning id into comp;

  -- Kişiler
  insert into people (organization_id, full_name, type, default_pay_pct)
  values (org, 'A. Driver', 'company_driver', 0.33) returning id into drv;
  insert into people (organization_id, full_name, type)
  values (org, 'M. Celebi', 'owner_operator') returning id into own;
  insert into people (organization_id, full_name, type)
  values (org, 'I. Investor', 'investor') returning id into inv;

  -- Araçlar (3 farklı model)
  insert into vehicles (organization_id, unit_number, vehicle_type, ownership_type,
    company_id, assigned_driver_id, default_driver_pay_pct, company_fee_pct, current_mileage, status)
  values (org, '14105', 'box_truck', 'company_owned',
    comp, drv, 0.20, 0.10, 272500, 'active') returning id into v_box;

  insert into vehicles (organization_id, unit_number, vehicle_type, ownership_type,
    company_id, owner_id, company_fee_pct, current_mileage, status)
  values (org, '18', 'truck', 'owner_operator',
    comp, own, 0.12, 540000, 'active') returning id into v_oo;

  insert into vehicles (organization_id, unit_number, vehicle_type, ownership_type,
    company_id, owner_id, default_driver_pay_pct, external_carrier_fee_pct,
    management_commission_type, management_commission_amount, current_mileage, status)
  values (org, '14125', 'truck', 'investor_managed',
    comp, inv, 0.30, 0.12, 'flat', 250, 310000, 'active') returning id into v_inv;

  -- Owner operator (Unit 18) için bu haftaya yükler + masraflar (settlement denemek için)
  insert into loads (organization_id, load_number, load_source, company_id, vehicle_id,
    route, gross_amount, total_miles, delivery_date, status)
  values
    (org, '111WCQBHG', 'amazon_relay', comp, v_oo, 'BNA3 -> CSG1 -> MOB5', 1570.51, 410, current_date, 'delivered'),
    (org, '115PL5S93', 'amazon_relay', comp, v_oo, 'MOB5 -> MEM4', 1117.13, 295, current_date, 'delivered'),
    (org, '1163XMCBQ', 'broker',       comp, v_oo, 'MDW5 -> BNA7', 1227.03, 470, current_date, 'delivered');

  insert into expenses (organization_id, date, company_id, vehicle_id, category, amount, deduct_from_settlement)
  values
    (org, current_date, comp, v_oo, 'fuel',      980.00, true),
    (org, current_date, comp, v_oo, 'insurance', 400.00, true),
    (org, current_date, comp, v_oo, 'eld',       100.00, true);

  -- Box truck için bakım kuralı (Due Soon çıkması için)
  insert into maintenance_rules (organization_id, vehicle_id, service_type, interval_type,
    interval_miles, last_done_mileage)
  values (org, v_box, 'Oil Change', 'mileage', 25000, 250000);

  -- Örnek Telegram grup eşlemesi (placeholder chat id — gerçek chat ile değiştir)
  insert into telegram_groups (organization_id, chat_id, title, vehicle_id, driver_id, company_id, active)
  values (org, '-1000000000000', 'Driver A — Unit 14105', v_box, drv, comp, true)
  on conflict (organization_id, chat_id) do nothing;

  raise notice 'Seed tamam: company=% box=% oo=% inv=%', comp, v_box, v_oo, v_inv;
end $$;
