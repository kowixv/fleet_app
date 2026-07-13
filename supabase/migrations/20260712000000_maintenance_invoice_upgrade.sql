-- Maintenance invoice import, atomic mileage/service writes, configurable alerts.

alter table settings add column if not exists pm_due_soon_days integer not null default 7;
alter table settings alter column pm_due_soon_miles set default 2000;
update settings set pm_due_soon_miles = 2000 where pm_due_soon_miles = 2500;

alter table maintenance_rules add column if not exists updated_at timestamptz not null default now();
alter table maintenance_records add column if not exists invoice_id uuid;
alter table maintenance_records add column if not exists part_name text;
alter table maintenance_records add column if not exists parts_used text[] not null default '{}'::text[];
alter table maintenance_records add column if not exists next_due_mileage numeric;
alter table maintenance_records add column if not exists next_due_date date;
alter table maintenance_records add column if not exists source text not null default 'manual';
alter table maintenance_records add column if not exists created_by uuid references profiles (id) on delete set null;
alter table maintenance_records add column if not exists updated_at timestamptz not null default now();

create table if not exists maintenance_invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  vehicle_id uuid,
  invoice_number text,
  invoice_date date,
  shop_name text,
  file_name text not null,
  storage_path text not null,
  file_hash text not null,
  raw_text text,
  parsed_data jsonb not null default '{}'::jsonb,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint maintenance_invoices_hash_chk check (file_hash ~ '^[a-f0-9]{64}$'),
  constraint maintenance_invoices_org_hash_key unique (organization_id, file_hash),
  constraint maintenance_invoices_org_id_id_key unique (organization_id, id),
  constraint maintenance_invoices_vehicle_same_org_fk
    foreign key (organization_id, vehicle_id)
    references vehicles (organization_id, id) on delete set null
);

alter table maintenance_records
  drop constraint if exists maintenance_records_invoice_id_fkey;
alter table maintenance_records
  drop constraint if exists maintenance_records_invoice_same_org_fk;
alter table maintenance_records
  add constraint maintenance_records_invoice_same_org_fk
  foreign key (organization_id, invoice_id)
  references maintenance_invoices (organization_id, id) on delete restrict not valid;

alter table maintenance_rules drop constraint if exists maintenance_rules_interval_shape_chk;
alter table maintenance_rules add constraint maintenance_rules_interval_shape_chk check (
  (interval_type = 'mileage' and interval_miles > 0 and interval_days is null)
  or
  (interval_type = 'date' and interval_days > 0 and interval_miles is null)
) not valid;

alter table maintenance_records drop constraint if exists maintenance_records_next_due_chk;
alter table maintenance_records add constraint maintenance_records_next_due_chk check (
  (next_due_mileage is null or next_due_mileage >= 0)
  and (mileage is null or next_due_mileage is null or next_due_mileage > mileage)
  and (performed_date is null or next_due_date is null or next_due_date > performed_date)
) not valid;

alter table settings drop constraint if exists settings_pm_due_soon_days_chk;
alter table settings add constraint settings_pm_due_soon_days_chk
  check (pm_due_soon_days between 1 and 3650) not valid;

with ranked as (
  select id, row_number() over (
    partition by organization_id, vehicle_id, lower(btrim(service_type))
    order by updated_at desc nulls last, created_at desc, id desc
  ) as row_number
  from maintenance_rules
  where active = true and vehicle_id is not null
)
update maintenance_rules set active = false
where id in (select id from ranked where row_number > 1);

create unique index if not exists maintenance_rules_one_active_service_idx
  on maintenance_rules (organization_id, vehicle_id, lower(btrim(service_type)))
  where active = true and vehicle_id is not null;

create index if not exists maintenance_invoices_org_created_idx
  on maintenance_invoices (organization_id, created_at desc);
create index if not exists maintenance_records_invoice_idx
  on maintenance_records (organization_id, invoice_id);

insert into storage.buckets (id, name, public)
values ('maintenance-invoices', 'maintenance-invoices', false)
on conflict (id) do nothing;

alter table maintenance_invoices enable row level security;
drop policy if exists maintenance_invoices_select on maintenance_invoices;
drop policy if exists maintenance_invoices_insert on maintenance_invoices;
drop policy if exists maintenance_invoices_update on maintenance_invoices;
drop policy if exists maintenance_invoices_delete on maintenance_invoices;
create policy maintenance_invoices_select on maintenance_invoices
  for select to authenticated
  using (organization_id = (select current_org_id()));
create policy maintenance_invoices_insert on maintenance_invoices
  for insert to authenticated
  with check (organization_id = (select current_org_id()) and (select is_org_writer()));
create policy maintenance_invoices_update on maintenance_invoices
  for update to authenticated
  using (organization_id = (select current_org_id()) and (select is_org_writer()))
  with check (organization_id = (select current_org_id()) and (select is_org_writer()));
create policy maintenance_invoices_delete on maintenance_invoices
  for delete to authenticated
  using (organization_id = (select current_org_id()) and (select is_org_writer()));

create or replace function touch_maintenance_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists maintenance_rules_updated_at on maintenance_rules;
create trigger maintenance_rules_updated_at
  before update on maintenance_rules
  for each row execute function touch_maintenance_updated_at();
drop trigger if exists maintenance_records_updated_at on maintenance_records;
create trigger maintenance_records_updated_at
  before update on maintenance_records
  for each row execute function touch_maintenance_updated_at();

-- Atomic odometer write. Authenticated callers are scoped to their org; service-role
-- callers (Telegram) must pass p_organization_id explicitly.
create or replace function set_vehicle_mileage(
  p_vehicle_id uuid,
  p_mileage numeric,
  p_source text default 'manual',
  p_organization_id uuid default null
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_current numeric;
begin
  if p_mileage is null or p_mileage < 0 or p_mileage <> trunc(p_mileage) then
    raise exception 'Mileage must be a non-negative whole number.';
  end if;

  v_org := coalesce((select current_org_id()), p_organization_id);
  if v_org is null then raise exception 'Organization is required.'; end if;
  if auth.uid() is not null and not (select is_org_writer()) then
    raise exception 'Write permission required.';
  end if;

  select current_mileage into v_current
  from vehicles
  where id = p_vehicle_id and organization_id = v_org
  for update;
  if not found then raise exception 'Vehicle not found.'; end if;
  if p_mileage < coalesce(v_current, 0) then
    raise exception 'Mileage cannot be lower than the current odometer (%).', coalesce(v_current, 0);
  end if;

  update vehicles set current_mileage = p_mileage
  where id = p_vehicle_id and organization_id = v_org;

  insert into vehicle_mileage_logs (organization_id, vehicle_id, mileage, source)
  values (v_org, p_vehicle_id, p_mileage, coalesce(nullif(btrim(p_source), ''), 'manual'));

  return p_mileage;
end;
$$;
revoke execute on function set_vehicle_mileage(uuid,numeric,text,uuid) from public, anon;
grant execute on function set_vehicle_mileage(uuid,numeric,text,uuid) to authenticated, service_role;

-- Atomic and idempotent "serviced now" action. Mileage is always re-read from the
-- vehicle row, never trusted from stale browser props.
create or replace function mark_maintenance_serviced(
  p_rule_id uuid,
  p_performed_date date,
  p_cost numeric default 0,
  p_shop_name text default null,
  p_part_name text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := (select current_org_id());
  v_vehicle uuid;
  v_service text;
  v_mileage numeric;
  v_existing uuid;
  v_record uuid;
begin
  if v_org is null or not (select is_org_writer()) then
    raise exception 'Write permission required.';
  end if;
  if p_performed_date is null then raise exception 'Performed date is required.'; end if;
  if coalesce(p_cost, 0) < 0 then raise exception 'Cost cannot be negative.'; end if;

  select r.vehicle_id, r.service_type, v.current_mileage
    into v_vehicle, v_service, v_mileage
  from maintenance_rules r
  join vehicles v on v.id = r.vehicle_id and v.organization_id = r.organization_id
  where r.id = p_rule_id and r.organization_id = v_org and r.active = true
  for update of r, v;
  if not found then raise exception 'Active maintenance rule not found.'; end if;

  select id into v_existing
  from maintenance_records
  where organization_id = v_org
    and rule_id = p_rule_id
    and performed_date = p_performed_date
    and mileage = v_mileage
    and source = 'manual'
  limit 1;
  if v_existing is not null then return v_existing; end if;

  update maintenance_rules
  set last_done_mileage = v_mileage, last_done_date = p_performed_date
  where id = p_rule_id and organization_id = v_org;

  insert into maintenance_records (
    organization_id, vehicle_id, rule_id, service_type, performed_date,
    mileage, cost, shop_name, part_name, notes, source, created_by
  ) values (
    v_org, v_vehicle, p_rule_id, v_service, p_performed_date,
    v_mileage, coalesce(p_cost, 0), nullif(btrim(p_shop_name), ''),
    nullif(btrim(p_part_name), ''), nullif(btrim(p_notes), ''), 'manual', auth.uid()
  ) returning id into v_record;

  return v_record;
end;
$$;
revoke execute on function mark_maintenance_serviced(uuid,date,numeric,text,text,text) from public, anon;
grant execute on function mark_maintenance_serviced(uuid,date,numeric,text,text,text) to authenticated;

-- One transaction for invoice metadata, all service records, and optional rule updates.
-- Intended for the trusted local CLI; only service_role can execute it.
create or replace function save_maintenance_invoice(
  p_invoice jsonb,
  p_services jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := (p_invoice->>'organization_id')::uuid;
  v_invoice uuid;
  v_item jsonb;
  v_vehicle uuid;
  v_service text;
  v_rule uuid;
  v_resolution text;
  v_performed_date date;
  v_mileage numeric;
  v_next_mileage numeric;
  v_next_date date;
  v_parts text[];
  v_interval_type text;
  v_interval_miles numeric;
  v_interval_days integer;
begin
  if v_org is null then raise exception 'organization_id is required.'; end if;
  if jsonb_typeof(p_services) <> 'array' or jsonb_array_length(p_services) = 0 then
    raise exception 'At least one service is required.';
  end if;

  insert into maintenance_invoices (
    organization_id, vehicle_id, invoice_number, invoice_date, shop_name,
    file_name, storage_path, file_hash, raw_text, parsed_data, created_by
  ) values (
    v_org,
    nullif(p_invoice->>'vehicle_id', '')::uuid,
    nullif(btrim(p_invoice->>'invoice_number'), ''),
    nullif(p_invoice->>'invoice_date', '')::date,
    nullif(btrim(p_invoice->>'shop_name'), ''),
    p_invoice->>'file_name',
    p_invoice->>'storage_path',
    p_invoice->>'file_hash',
    p_invoice->>'raw_text',
    coalesce(p_invoice->'parsed_data', '{}'::jsonb),
    nullif(p_invoice->>'created_by', '')::uuid
  ) returning id into v_invoice;

  for v_item in select value from jsonb_array_elements(p_services)
  loop
    v_vehicle := (v_item->>'vehicle_id')::uuid;
    v_service := btrim(v_item->>'service_type');
    v_resolution := coalesce(v_item->>'resolution', 'overwrite');
    v_performed_date := nullif(v_item->>'performed_date', '')::date;
    v_mileage := nullif(v_item->>'mileage', '')::numeric;
    v_next_mileage := nullif(v_item->>'next_due_mileage', '')::numeric;
    v_next_date := nullif(v_item->>'next_due_date', '')::date;
    select coalesce(array_agg(distinct btrim(value)), '{}'::text[])
      into v_parts
    from jsonb_array_elements_text(coalesce(v_item->'parts_used', '[]'::jsonb))
    where btrim(value) <> '';
    if array_length(v_parts, 1) is null and nullif(btrim(v_item->>'part_name'), '') is not null then
      v_parts := array[nullif(btrim(v_item->>'part_name'), '')];
    end if;

    if v_service is null or v_service = '' then raise exception 'service_type is required.'; end if;
    if not exists (select 1 from vehicles where id = v_vehicle and organization_id = v_org) then
      raise exception 'Vehicle does not belong to organization.';
    end if;

    if v_mileage is not null then
      update vehicles
      set current_mileage = v_mileage
      where id = v_vehicle and organization_id = v_org
        and v_mileage > coalesce(current_mileage, 0);
      if found then
        insert into vehicle_mileage_logs (organization_id, vehicle_id, mileage, source)
        values (v_org, v_vehicle, v_mileage, 'invoice');
      end if;
    end if;

    select id into v_rule
    from maintenance_rules
    where organization_id = v_org and vehicle_id = v_vehicle and active = true
      and lower(btrim(service_type)) = lower(v_service)
    limit 1
    for update;

    v_interval_type := null;
    v_interval_miles := null;
    v_interval_days := null;
    if v_next_mileage is not null and v_mileage is not null and v_next_mileage > v_mileage then
      v_interval_type := 'mileage';
      v_interval_miles := v_next_mileage - v_mileage;
    elsif v_next_date is not null and v_performed_date is not null and v_next_date > v_performed_date then
      v_interval_type := 'date';
      v_interval_days := v_next_date - v_performed_date;
    end if;

    if v_rule is null and v_interval_type is not null then
      insert into maintenance_rules (
        organization_id, vehicle_id, service_type, interval_type,
        interval_miles, interval_days, last_done_mileage, last_done_date, active
      ) values (
        v_org, v_vehicle, v_service, v_interval_type,
        v_interval_miles, v_interval_days, v_mileage, v_performed_date, true
      ) returning id into v_rule;
    elsif v_rule is not null and v_resolution = 'overwrite' and v_interval_type is not null then
      update maintenance_rules set
        service_type = v_service,
        interval_type = v_interval_type,
        interval_miles = v_interval_miles,
        interval_days = v_interval_days,
        last_done_mileage = v_mileage,
        last_done_date = v_performed_date,
        active = true
      where id = v_rule and organization_id = v_org;
    end if;

    insert into maintenance_records (
      organization_id, vehicle_id, rule_id, invoice_id, service_type,
      performed_date, mileage, cost, shop_name, part_name, parts_used, notes,
      next_due_mileage, next_due_date, source
    ) values (
      v_org, v_vehicle, v_rule, v_invoice, v_service,
      v_performed_date, v_mileage,
      coalesce(nullif(v_item->>'cost', '')::numeric, 0),
      nullif(btrim(coalesce(v_item->>'shop_name', p_invoice->>'shop_name')), ''),
      nullif(btrim(v_item->>'part_name'), ''),
      coalesce(v_parts, '{}'::text[]),
      nullif(btrim(v_item->>'notes'), ''),
      v_next_mileage, v_next_date, 'invoice'
    );
  end loop;

  return v_invoice;
exception
  when unique_violation then
    if sqlerrm like '%maintenance_invoices_org_hash_key%' then
      raise exception 'DUPLICATE_INVOICE';
    end if;
    raise;
end;
$$;
revoke execute on function save_maintenance_invoice(jsonb,jsonb) from public, anon, authenticated;
grant execute on function save_maintenance_invoice(jsonb,jsonb) to service_role;
