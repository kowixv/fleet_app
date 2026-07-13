-- Maintenance cost analytics: canonical service allocations, mileage snapshots, views and RPCs.
-- File-only migration artifact; run manually in Supabase SQL Editor.

alter table settings add column if not exists maintenance_invoice_allocation_tolerance numeric not null default 1;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'settings_maintenance_invoice_allocation_tolerance_chk') then
    alter table settings add constraint settings_maintenance_invoice_allocation_tolerance_chk
      check (maintenance_invoice_allocation_tolerance >= 0 and maintenance_invoice_allocation_tolerance <= 1000) not valid;
  end if;
end $$;

alter table maintenance_invoices add column if not exists expense_id uuid;
alter table maintenance_invoices add column if not exists canonical_cost_source text not null default 'maintenance_records';
alter table maintenance_invoices add column if not exists allocation_tolerance numeric not null default 1;
alter table maintenance_invoices add column if not exists parts_cost numeric not null default 0;
alter table maintenance_invoices add column if not exists labor_cost numeric not null default 0;
alter table maintenance_invoices add column if not exists shop_fees numeric not null default 0;
alter table maintenance_invoices add column if not exists tax_cost numeric not null default 0;
alter table maintenance_invoices add column if not exists towing_cost numeric not null default 0;
alter table maintenance_invoices add column if not exists road_service_cost numeric not null default 0;
alter table maintenance_invoices add column if not exists hotel_travel_cost numeric not null default 0;
alter table maintenance_invoices add column if not exists other_cost numeric not null default 0;
alter table maintenance_invoices add column if not exists warranty_recovery numeric not null default 0;

alter table maintenance_records add column if not exists category text not null default 'other';
alter table maintenance_records add column if not exists planned boolean not null default false;
alter table maintenance_records add column if not exists status text not null default 'completed';
alter table maintenance_records add column if not exists parts_cost numeric not null default 0;
alter table maintenance_records add column if not exists labor_cost numeric not null default 0;
alter table maintenance_records add column if not exists shop_fees numeric not null default 0;
alter table maintenance_records add column if not exists tax_cost numeric not null default 0;
alter table maintenance_records add column if not exists towing_cost numeric not null default 0;
alter table maintenance_records add column if not exists road_service_cost numeric not null default 0;
alter table maintenance_records add column if not exists hotel_travel_cost numeric not null default 0;
alter table maintenance_records add column if not exists other_cost numeric not null default 0;
alter table maintenance_records add column if not exists warranty_recovery numeric not null default 0;
alter table maintenance_records add column if not exists total_cost numeric;
alter table maintenance_records add column if not exists downtime_start timestamptz;
alter table maintenance_records add column if not exists downtime_end timestamptz;
alter table maintenance_records add column if not exists vendor text;
alter table maintenance_records add column if not exists invoice_hash text;
alter table maintenance_records add column if not exists expense_id uuid;

alter table inspection_findings add column if not exists category text not null default 'other';
alter table inspection_findings add column if not exists planned boolean not null default false;
alter table inspection_findings add column if not exists parts_cost numeric not null default 0;
alter table inspection_findings add column if not exists labor_cost numeric not null default 0;
alter table inspection_findings add column if not exists shop_fees numeric not null default 0;
alter table inspection_findings add column if not exists tax_cost numeric not null default 0;
alter table inspection_findings add column if not exists towing_cost numeric not null default 0;
alter table inspection_findings add column if not exists road_service_cost numeric not null default 0;
alter table inspection_findings add column if not exists hotel_travel_cost numeric not null default 0;
alter table inspection_findings add column if not exists other_cost numeric not null default 0;
alter table inspection_findings add column if not exists warranty_recovery numeric not null default 0;
alter table inspection_findings add column if not exists total_cost numeric;
alter table inspection_findings add column if not exists downtime_start timestamptz;
alter table inspection_findings add column if not exists downtime_end timestamptz;
alter table inspection_findings add column if not exists vendor text;

do $$
declare
  v_category_check text := '(category in (''routine_pm'',''tires'',''brakes_wheel_end'',''engine'',''aftertreatment'',''transmission_driveline'',''suspension_steering'',''cooling'',''electrical'',''road_service_towing'',''driver_damage'',''warranty_recovery'',''other''))';
begin
  if not exists (select 1 from pg_constraint where conname = 'maintenance_records_category_chk') then
    execute 'alter table maintenance_records add constraint maintenance_records_category_chk check ' || v_category_check || ' not valid';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'inspection_findings_category_chk') then
    execute 'alter table inspection_findings add constraint inspection_findings_category_chk check ' || v_category_check || ' not valid';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'maintenance_records_cost_breakdown_chk') then
    alter table maintenance_records add constraint maintenance_records_cost_breakdown_chk check (
      parts_cost >= 0 and labor_cost >= 0 and shop_fees >= 0 and tax_cost >= 0
      and towing_cost >= 0 and road_service_cost >= 0 and hotel_travel_cost >= 0
      and other_cost >= 0 and warranty_recovery >= 0
      and (total_cost is null or total_cost >= 0)
      and (downtime_start is null or downtime_end is null or downtime_end >= downtime_start)
    ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'maintenance_invoices_cost_breakdown_chk') then
    alter table maintenance_invoices add constraint maintenance_invoices_cost_breakdown_chk check (
      canonical_cost_source in ('maintenance_records','expense')
      and allocation_tolerance >= 0
      and parts_cost >= 0 and labor_cost >= 0 and shop_fees >= 0 and tax_cost >= 0
      and towing_cost >= 0 and road_service_cost >= 0 and hotel_travel_cost >= 0
      and other_cost >= 0 and warranty_recovery >= 0
    ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'inspection_findings_cost_breakdown_chk') then
    alter table inspection_findings add constraint inspection_findings_cost_breakdown_chk check (
      parts_cost >= 0 and labor_cost >= 0 and shop_fees >= 0 and tax_cost >= 0
      and towing_cost >= 0 and road_service_cost >= 0 and hotel_travel_cost >= 0
      and other_cost >= 0 and warranty_recovery >= 0
      and (total_cost is null or total_cost >= 0)
      and (downtime_start is null or downtime_end is null or downtime_end >= downtime_start)
    ) not valid;
  end if;
end $$;

alter table maintenance_invoices
  drop constraint if exists maintenance_invoices_expense_same_org_fk;
alter table maintenance_invoices
  add constraint maintenance_invoices_expense_same_org_fk
  foreign key (organization_id, expense_id)
  references expenses (organization_id, id) on delete set null not valid;

alter table maintenance_records
  drop constraint if exists maintenance_records_expense_same_org_fk;
alter table maintenance_records
  add constraint maintenance_records_expense_same_org_fk
  foreign key (organization_id, expense_id)
  references expenses (organization_id, id) on delete set null not valid;

create index if not exists maintenance_records_cost_org_vehicle_date_idx
  on maintenance_records (organization_id, vehicle_id, performed_date desc, category);
create index if not exists maintenance_records_cost_invoice_idx
  on maintenance_records (organization_id, invoice_id, invoice_hash);
create index if not exists maintenance_records_cost_shop_idx
  on maintenance_records (organization_id, vendor, shop_name);
create index if not exists maintenance_invoices_expense_idx
  on maintenance_invoices (organization_id, expense_id);
create index if not exists expenses_maintenance_link_idx
  on expenses (organization_id, maintenance_invoice_id, invoice_hash);
create unique index if not exists expenses_org_invoice_hash_key
  on expenses (organization_id, invoice_hash)
  where invoice_hash is not null;

create table if not exists vehicle_mileage_period_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  vehicle_id uuid not null references vehicles (id) on delete cascade,
  period_start date not null,
  period_end date not null,
  start_mileage numeric,
  end_mileage numeric,
  miles_driven numeric,
  source text not null default 'mileage_logs',
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vehicle_mileage_period_snapshots_dates_chk check (period_end >= period_start),
  constraint vehicle_mileage_period_snapshots_miles_chk check (
    (start_mileage is null or start_mileage >= 0)
    and (end_mileage is null or end_mileage >= 0)
    and (miles_driven is null or miles_driven >= 0)
  ),
  constraint vehicle_mileage_period_snapshots_source_chk check (source in ('mileage_logs','loads','manual')),
  constraint vehicle_mileage_period_snapshots_org_period_key unique (organization_id, vehicle_id, period_start, period_end),
  constraint vehicle_mileage_period_snapshots_org_id_id_key unique (organization_id, id)
);

alter table vehicle_mileage_period_snapshots
  drop constraint if exists vehicle_mileage_period_snapshots_vehicle_same_org_fk;
alter table vehicle_mileage_period_snapshots
  add constraint vehicle_mileage_period_snapshots_vehicle_same_org_fk
  foreign key (organization_id, vehicle_id)
  references vehicles (organization_id, id) on delete cascade not valid;

create index if not exists vehicle_mileage_period_snapshots_org_vehicle_period_idx
  on vehicle_mileage_period_snapshots (organization_id, vehicle_id, period_start, period_end);

alter table vehicle_mileage_period_snapshots enable row level security;
drop policy if exists vehicle_mileage_period_snapshots_select on vehicle_mileage_period_snapshots;
drop policy if exists vehicle_mileage_period_snapshots_insert on vehicle_mileage_period_snapshots;
drop policy if exists vehicle_mileage_period_snapshots_update on vehicle_mileage_period_snapshots;
drop policy if exists vehicle_mileage_period_snapshots_delete on vehicle_mileage_period_snapshots;
create policy vehicle_mileage_period_snapshots_select on vehicle_mileage_period_snapshots
  for select to authenticated
  using (organization_id = (select current_org_id()));
create policy vehicle_mileage_period_snapshots_insert on vehicle_mileage_period_snapshots
  for insert to authenticated
  with check (organization_id = (select current_org_id()) and (select is_org_writer()));
create policy vehicle_mileage_period_snapshots_update on vehicle_mileage_period_snapshots
  for update to authenticated
  using (organization_id = (select current_org_id()) and (select is_org_writer()))
  with check (organization_id = (select current_org_id()) and (select is_org_writer()));
create policy vehicle_mileage_period_snapshots_delete on vehicle_mileage_period_snapshots
  for delete to authenticated
  using (organization_id = (select current_org_id()) and (select is_org_writer()));

drop trigger if exists vehicle_mileage_period_snapshots_updated_at on vehicle_mileage_period_snapshots;
create trigger vehicle_mileage_period_snapshots_updated_at
  before update on vehicle_mileage_period_snapshots
  for each row execute function touch_maintenance_updated_at();

create or replace view maintenance_cost_fact_v
with (security_invoker = true)
as
select
  r.organization_id,
  r.id as source_record_id,
  'maintenance_record'::text as source_type,
  r.vehicle_id,
  v.unit_number,
  r.invoice_id,
  r.expense_id,
  coalesce(r.invoice_hash, i.file_hash) as invoice_hash,
  r.performed_date as cost_date,
  coalesce(nullif(r.vendor, ''), nullif(r.shop_name, ''), i.shop_name) as shop,
  r.service_type,
  maintenance_service_key(r.service_type) as service_key,
  r.category,
  r.planned,
  r.status,
  r.mileage as mileage_at_service,
  r.parts_cost,
  r.labor_cost,
  r.shop_fees,
  r.tax_cost,
  r.towing_cost,
  r.road_service_cost,
  r.hotel_travel_cost,
  r.other_cost,
  r.warranty_recovery,
  coalesce(
    r.total_cost,
    nullif(r.cost, 0),
    r.parts_cost + r.labor_cost + r.shop_fees + r.tax_cost + r.towing_cost + r.road_service_cost + r.hotel_travel_cost + r.other_cost
  ) as total_cost,
  r.parts_cost + r.labor_cost + r.shop_fees + r.towing_cost + r.road_service_cost + r.other_cost - r.warranty_recovery as cpm_cost,
  r.downtime_start,
  r.downtime_end,
  case
    when r.downtime_start is not null and r.downtime_end is not null
      then greatest(0, extract(epoch from (r.downtime_end - r.downtime_start)) / 86400.0)
    else 0
  end as downtime_days
from maintenance_records r
left join vehicles v on v.organization_id = r.organization_id and v.id = r.vehicle_id
left join maintenance_invoices i on i.organization_id = r.organization_id and i.id = r.invoice_id
where r.undone_at is null
union all
select
  e.organization_id,
  e.id as source_record_id,
  'expense'::text as source_type,
  e.vehicle_id,
  v.unit_number,
  e.maintenance_invoice_id as invoice_id,
  e.id as expense_id,
  e.invoice_hash,
  e.date as cost_date,
  null::text as shop,
  e.category as service_type,
  maintenance_service_key(e.category) as service_key,
  case when e.category = 'maintenance' then 'routine_pm' else 'other' end as category,
  e.category = 'maintenance' as planned,
  'completed'::text as status,
  null::numeric as mileage_at_service,
  0::numeric as parts_cost,
  0::numeric as labor_cost,
  0::numeric as shop_fees,
  0::numeric as tax_cost,
  0::numeric as towing_cost,
  0::numeric as road_service_cost,
  0::numeric as hotel_travel_cost,
  e.amount as other_cost,
  0::numeric as warranty_recovery,
  e.amount as total_cost,
  e.amount as cpm_cost,
  null::timestamptz as downtime_start,
  null::timestamptz as downtime_end,
  0::numeric as downtime_days
from expenses e
left join vehicles v on v.organization_id = e.organization_id and v.id = e.vehicle_id
where e.category in ('maintenance','repair')
  and e.maintenance_invoice_id is null
  and e.invoice_hash is null;

revoke all on maintenance_cost_fact_v from public, anon;
grant select on maintenance_cost_fact_v to authenticated;

create or replace function get_maintenance_cost_analytics(
  p_start date default null,
  p_end date default null,
  p_vehicle_id uuid default null,
  p_category text default null,
  p_planned boolean default null,
  p_shop text default null,
  p_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := (select current_org_id());
  v_start date := coalesce(p_start, current_date - interval '90 days');
  v_end date := coalesce(p_end, current_date);
  v_result jsonb;
begin
  if v_org is null then raise exception 'Organization is required.'; end if;
  if v_end < v_start then raise exception 'End date must be after start date.'; end if;

  with filtered as (
    select *
    from maintenance_cost_fact_v
    where organization_id = v_org
      and cost_date between v_start and v_end
      and (p_vehicle_id is null or vehicle_id = p_vehicle_id)
      and (p_category is null or category = p_category)
      and (p_planned is null or planned = p_planned)
      and (p_shop is null or shop = p_shop)
      and (p_status is null or status = p_status)
  ),
  mileage as (
    select vehicle_id, sum(coalesce(miles_driven, 0)) as miles_driven
    from vehicle_mileage_period_snapshots
    where organization_id = v_org
      and period_start >= v_start
      and period_end <= v_end
      and (p_vehicle_id is null or vehicle_id = p_vehicle_id)
    group by vehicle_id
  )
  select jsonb_build_object(
    'total_cost', coalesce((select sum(total_cost) from filtered), 0),
    'cpm_cost', coalesce((select sum(cpm_cost) from filtered), 0),
    'planned_cost', coalesce((select sum(total_cost) from filtered where planned), 0),
    'unscheduled_cost', coalesce((select sum(total_cost) from filtered where not planned), 0),
    'warranty_recovery', coalesce((select sum(warranty_recovery) from filtered), 0),
    'downtime_days', coalesce((select sum(downtime_days) from filtered), 0),
    'miles_driven', coalesce((select sum(miles_driven) from mileage), 0),
    'by_category', coalesce((select jsonb_agg(to_jsonb(x) order by x.total_cost desc) from (
      select category, sum(total_cost) as total_cost from filtered group by category
    ) x), '[]'::jsonb),
    'by_shop', coalesce((select jsonb_agg(to_jsonb(x) order by x.total_cost desc) from (
      select coalesce(shop, 'Unknown') as shop, sum(total_cost) as total_cost from filtered group by coalesce(shop, 'Unknown')
    ) x), '[]'::jsonb),
    'unit_costs', coalesce((select jsonb_agg(to_jsonb(x) order by x.total_cost desc) from (
      select
        f.vehicle_id,
        max(f.unit_number) as unit_number,
        sum(f.total_cost) as total_cost,
        coalesce(max(m.miles_driven), 0) as miles_driven
      from filtered f
      left join mileage m on m.vehicle_id = f.vehicle_id
      group by f.vehicle_id
    ) x), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function get_maintenance_cost_analytics(date,date,uuid,text,boolean,text,text) from public, anon;
grant execute on function get_maintenance_cost_analytics(date,date,uuid,text,boolean,text,text) to authenticated;

create or replace function refresh_vehicle_mileage_period_snapshots(
  p_start date,
  p_end date,
  p_vehicle_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := (select current_org_id());
  v_user uuid := auth.uid();
  v_count integer := 0;
begin
  if v_org is null or not (select is_org_writer()) then raise exception 'Write permission required.'; end if;
  if p_start is null or p_end is null or p_end < p_start then raise exception 'Valid period is required.'; end if;

  insert into vehicle_mileage_period_snapshots (
    organization_id, vehicle_id, period_start, period_end,
    start_mileage, end_mileage, miles_driven, source, created_by
  )
  select
    v_org,
    v.id,
    p_start,
    p_end,
    start_log.mileage,
    end_log.mileage,
    case
      when start_log.mileage is not null and end_log.mileage is not null and end_log.mileage >= start_log.mileage
        then end_log.mileage - start_log.mileage
      else coalesce(load_miles.miles_driven, 0)
    end,
    case
      when start_log.mileage is not null and end_log.mileage is not null and end_log.mileage >= start_log.mileage
        then 'mileage_logs'
      else 'loads'
    end,
    v_user
  from vehicles v
  left join lateral (
    select mileage
    from vehicle_mileage_logs
    where organization_id = v_org and vehicle_id = v.id and logged_at::date <= p_start
    order by logged_at desc
    limit 1
  ) start_log on true
  left join lateral (
    select mileage
    from vehicle_mileage_logs
    where organization_id = v_org and vehicle_id = v.id and logged_at::date <= p_end
    order by logged_at desc
    limit 1
  ) end_log on true
  left join lateral (
    select sum(coalesce(total_miles, coalesce(loaded_miles, 0) + coalesce(empty_miles, 0), 0)) as miles_driven
    from loads
    where organization_id = v_org and vehicle_id = v.id
      and delivery_date between p_start and p_end
      and status in ('booked','delivered','paid')
  ) load_miles on true
  where v.organization_id = v_org
    and (p_vehicle_id is null or v.id = p_vehicle_id)
  on conflict (organization_id, vehicle_id, period_start, period_end) do update set
    start_mileage = excluded.start_mileage,
    end_mileage = excluded.end_mileage,
    miles_driven = excluded.miles_driven,
    source = excluded.source,
    updated_at = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function refresh_vehicle_mileage_period_snapshots(date,date,uuid) from public, anon;
grant execute on function refresh_vehicle_mileage_period_snapshots(date,date,uuid) to authenticated;

create or replace function finalize_maintenance_invoice_review(
  p_invoice_id uuid,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := (select current_org_id());
  v_user uuid := auth.uid();
  v_invoice maintenance_invoices%rowtype;
  v_vehicle uuid := nullif(p_payload->>'vehicle_id', '')::uuid;
  v_record jsonb;
  v_service jsonb;
  v_rule uuid;
  v_service_key text;
  v_next_mileage numeric;
  v_next_date date;
  v_mileage numeric;
  v_interval_type text;
  v_interval_miles numeric;
  v_interval_days integer;
  v_parts text[];
  v_created_records integer := 0;
  v_invoice_total numeric := coalesce(nullif(p_payload->>'total', '')::numeric, 0);
  v_alloc_total numeric := 0;
  v_tolerance numeric;
  v_expense_id uuid;
  v_parts_cost numeric;
  v_labor_cost numeric;
  v_shop_fees numeric;
  v_tax_cost numeric;
  v_towing_cost numeric;
  v_road_service_cost numeric;
  v_hotel_travel_cost numeric;
  v_other_cost numeric;
  v_warranty_recovery numeric;
  v_total_cost numeric;
begin
  if v_org is null or not (select is_org_writer()) then
    raise exception 'Write permission required.';
  end if;
  if v_vehicle is null then raise exception 'Vehicle is required.'; end if;

  select * into v_invoice
  from maintenance_invoices
  where id = p_invoice_id and organization_id = v_org
  for update;
  if not found then raise exception 'Invoice not found.'; end if;
  if v_invoice.status <> 'pending_review' then
    raise exception 'Invoice is not pending review.';
  end if;
  if not exists (select 1 from vehicles where id = v_vehicle and organization_id = v_org) then
    raise exception 'Vehicle does not belong to organization.';
  end if;

  select coalesce(maintenance_invoice_allocation_tolerance, 1) into v_tolerance
  from settings
  where organization_id = v_org;
  v_tolerance := coalesce(nullif(p_payload->>'allocation_tolerance', '')::numeric, v_tolerance, 1);

  for v_record in select value from jsonb_array_elements(coalesce(p_payload->'records', '[]'::jsonb))
  loop
    if coalesce(v_record->>'resolution', 'history') = 'skip' then
      continue;
    end if;

    v_parts_cost := coalesce(nullif(v_record->>'parts_cost', '')::numeric, 0);
    v_labor_cost := coalesce(nullif(v_record->>'labor_cost', '')::numeric, 0);
    v_shop_fees := coalesce(nullif(v_record->>'shop_fees', '')::numeric, 0);
    v_tax_cost := coalesce(nullif(v_record->>'tax_cost', '')::numeric, 0);
    v_towing_cost := coalesce(nullif(v_record->>'towing_cost', '')::numeric, 0);
    v_road_service_cost := coalesce(nullif(v_record->>'road_service_cost', '')::numeric, 0);
    v_hotel_travel_cost := coalesce(nullif(v_record->>'hotel_travel_cost', '')::numeric, 0);
    v_other_cost := coalesce(nullif(v_record->>'other_cost', '')::numeric, 0);
    v_warranty_recovery := coalesce(abs(nullif(v_record->>'warranty_recovery', '')::numeric), 0);
    v_total_cost := coalesce(
      nullif(v_record->>'total_cost', '')::numeric,
      nullif(v_record->>'cost', '')::numeric,
      v_parts_cost + v_labor_cost + v_shop_fees + v_tax_cost + v_towing_cost + v_road_service_cost + v_hotel_travel_cost + v_other_cost
    );
    if v_total_cost < 0 then raise exception 'Service total cannot be negative.'; end if;
    v_alloc_total := v_alloc_total + v_total_cost;
  end loop;

  if v_invoice_total > 0 and abs(v_alloc_total - v_invoice_total) > v_tolerance then
    raise exception 'Service allocations (%) do not equal invoice total (%) within tolerance %.', v_alloc_total, v_invoice_total, v_tolerance;
  end if;

  for v_record in select value from jsonb_array_elements(coalesce(p_payload->'records', '[]'::jsonb))
  loop
    if coalesce(v_record->>'resolution', 'history') = 'skip' then
      continue;
    end if;

    v_service_key := maintenance_service_key(v_record->>'service_type');
    v_next_mileage := nullif(v_record->>'next_due_mileage', '')::numeric;
    v_next_date := nullif(v_record->>'next_due_date', '')::date;
    v_mileage := nullif(v_record->>'mileage', '')::numeric;
    v_parts_cost := coalesce(nullif(v_record->>'parts_cost', '')::numeric, 0);
    v_labor_cost := coalesce(nullif(v_record->>'labor_cost', '')::numeric, 0);
    v_shop_fees := coalesce(nullif(v_record->>'shop_fees', '')::numeric, 0);
    v_tax_cost := coalesce(nullif(v_record->>'tax_cost', '')::numeric, 0);
    v_towing_cost := coalesce(nullif(v_record->>'towing_cost', '')::numeric, 0);
    v_road_service_cost := coalesce(nullif(v_record->>'road_service_cost', '')::numeric, 0);
    v_hotel_travel_cost := coalesce(nullif(v_record->>'hotel_travel_cost', '')::numeric, 0);
    v_other_cost := coalesce(nullif(v_record->>'other_cost', '')::numeric, 0);
    v_warranty_recovery := coalesce(abs(nullif(v_record->>'warranty_recovery', '')::numeric), 0);
    v_total_cost := coalesce(
      nullif(v_record->>'total_cost', '')::numeric,
      nullif(v_record->>'cost', '')::numeric,
      v_parts_cost + v_labor_cost + v_shop_fees + v_tax_cost + v_towing_cost + v_road_service_cost + v_hotel_travel_cost + v_other_cost
    );

    select coalesce(array_agg(distinct btrim(value)), '{}'::text[])
      into v_parts
    from jsonb_array_elements_text(coalesce(v_record->'parts_used', '[]'::jsonb))
    where btrim(value) <> '';

    v_rule := null;
    v_interval_type := null;
    v_interval_miles := null;
    v_interval_days := null;
    if v_next_mileage is not null and v_mileage is not null and v_next_mileage > v_mileage then
      v_interval_type := 'mileage';
      v_interval_miles := v_next_mileage - v_mileage;
    elsif v_next_date is not null and nullif(v_record->>'performed_date', '')::date is not null and v_next_date > nullif(v_record->>'performed_date', '')::date then
      v_interval_type := 'date';
      v_interval_days := v_next_date - nullif(v_record->>'performed_date', '')::date;
    end if;

    if coalesce(v_record->>'resolution', 'history') = 'overwrite' and v_interval_type is not null then
      select id into v_rule
      from maintenance_rules
      where organization_id = v_org and vehicle_id = v_vehicle and active = true
        and maintenance_service_key(service_type) = v_service_key
      limit 1
      for update;

      if v_rule is null then
        insert into maintenance_rules (
          organization_id, vehicle_id, service_type, interval_type,
          interval_miles, interval_days, last_done_mileage, last_done_date,
          active, created_by_invoice_id, updated_by_invoice_id
        ) values (
          v_org, v_vehicle, v_record->>'service_type', v_interval_type,
          v_interval_miles, v_interval_days, v_mileage, nullif(v_record->>'performed_date', '')::date,
          true, p_invoice_id, p_invoice_id
        ) returning id into v_rule;
      else
        update maintenance_rules set
          service_type = v_record->>'service_type',
          interval_type = v_interval_type,
          interval_miles = v_interval_miles,
          interval_days = v_interval_days,
          last_done_mileage = v_mileage,
          last_done_date = nullif(v_record->>'performed_date', '')::date,
          updated_by_invoice_id = p_invoice_id,
          active = true
        where id = v_rule and organization_id = v_org;
      end if;
    end if;

    insert into maintenance_records (
      organization_id, vehicle_id, rule_id, invoice_id, service_type,
      performed_date, mileage, cost, shop_name, part_name, parts_used, notes,
      next_due_mileage, next_due_date, source, created_by, category, planned,
      status, parts_cost, labor_cost, shop_fees, tax_cost, towing_cost,
      road_service_cost, hotel_travel_cost, other_cost, warranty_recovery,
      total_cost, downtime_start, downtime_end, vendor, invoice_hash
    ) values (
      v_org, v_vehicle, v_rule, p_invoice_id, v_record->>'service_type',
      nullif(v_record->>'performed_date', '')::date, v_mileage,
      v_total_cost,
      nullif(btrim(coalesce(v_record->>'shop_name', p_payload->>'vendor')), ''),
      nullif(btrim(v_record->>'part_name'), ''),
      coalesce(v_parts, '{}'::text[]),
      nullif(btrim(v_record->>'notes'), ''),
      v_next_mileage, v_next_date, 'invoice', v_user,
      coalesce(nullif(v_record->>'category', ''), 'other'),
      coalesce((v_record->>'planned')::boolean, coalesce(v_record->>'resolution', 'history') = 'overwrite'),
      coalesce(nullif(v_record->>'status', ''), 'completed'),
      v_parts_cost, v_labor_cost, v_shop_fees, v_tax_cost, v_towing_cost,
      v_road_service_cost, v_hotel_travel_cost, v_other_cost, v_warranty_recovery,
      v_total_cost,
      nullif(v_record->>'downtime_start', '')::timestamptz,
      nullif(v_record->>'downtime_end', '')::timestamptz,
      nullif(btrim(coalesce(v_record->>'vendor', p_payload->>'vendor')), ''),
      v_invoice.file_hash
    );
    v_created_records := v_created_records + 1;
  end loop;

  if v_created_records = 0 then raise exception 'No service records to save.'; end if;

  if nullif(p_payload->>'accepted_mileage', '') is not null then
    perform set_vehicle_mileage(v_vehicle, (p_payload->>'accepted_mileage')::numeric, 'invoice', v_org);
  end if;

  if coalesce((p_payload->>'create_expense')::boolean, false) then
    insert into expenses (
      organization_id, vehicle_id, category, amount, date,
      deduct_from_settlement, notes, maintenance_invoice_id, invoice_hash
    )
    select
      v_org, v_vehicle, 'maintenance', v_invoice_total,
      coalesce(nullif(p_payload->>'invoice_date', '')::date, current_date),
      true, 'Maintenance invoice ' || coalesce(v_invoice.invoice_number, v_invoice.file_name),
      p_invoice_id, v_invoice.file_hash
    where not exists (
      select 1 from expenses where organization_id = v_org and invoice_hash = v_invoice.file_hash
    )
    returning id into v_expense_id;
  end if;

  for v_service in select value from jsonb_array_elements(coalesce(p_payload->'services', '[]'::jsonb))
  loop
    v_service_key := maintenance_service_key(v_service->>'service_type');
    insert into maintenance_service_defaults (
      organization_id, service_key, service_type, default_mode,
      interval_type, interval_miles, interval_days, updated_by
    ) values (
      v_org, v_service_key, v_service->>'service_type',
      coalesce(v_service->>'mode', 'history'),
      case
        when nullif(v_service->>'next_due_mileage', '') is not null then 'mileage'
        when nullif(v_service->>'next_due_date', '') is not null then 'date'
        else null
      end,
      case when nullif(v_service->>'next_due_mileage', '') is not null and nullif(v_service->>'mileage', '') is not null
        then nullif(v_service->>'next_due_mileage', '')::numeric - nullif(v_service->>'mileage', '')::numeric
        else null end,
      case when nullif(v_service->>'next_due_date', '') is not null and nullif(v_service->>'performed_date', '') is not null
        then nullif(v_service->>'next_due_date', '')::date - nullif(v_service->>'performed_date', '')::date
        else null end,
      v_user
    )
    on conflict (organization_id, service_key) do update set
      service_type = excluded.service_type,
      default_mode = excluded.default_mode,
      interval_type = excluded.interval_type,
      interval_miles = excluded.interval_miles,
      interval_days = excluded.interval_days,
      updated_by = excluded.updated_by,
      updated_at = now();
  end loop;

  update maintenance_records
  set expense_id = v_expense_id
  where organization_id = v_org and invoice_id = p_invoice_id and v_expense_id is not null;

  update maintenance_invoices set
    vehicle_id = v_vehicle,
    shop_name = nullif(btrim(coalesce(p_payload->>'vendor', shop_name)), ''),
    invoice_date = coalesce(nullif(p_payload->>'invoice_date', '')::date, invoice_date),
    total_amount = v_invoice_total,
    expense_id = v_expense_id,
    allocation_tolerance = v_tolerance,
    canonical_cost_source = 'maintenance_records',
    parsed_data = jsonb_set(coalesce(parsed_data, '{}'::jsonb), '{final_review}', p_payload, true),
    status = 'completed',
    completed_by = v_user,
    completed_at = now()
  where id = p_invoice_id and organization_id = v_org;

  return p_invoice_id;
end;
$$;

revoke execute on function finalize_maintenance_invoice_review(uuid,jsonb) from public, anon;
grant execute on function finalize_maintenance_invoice_review(uuid,jsonb) to authenticated;
