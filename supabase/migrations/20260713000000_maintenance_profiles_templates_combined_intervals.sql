-- Maintenance profiles, templates, and combined PM intervals.
-- File-only migration artifact; run manually in Supabase SQL Editor.

alter table settings add column if not exists pm_due_soon_engine_hours integer not null default 100;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'settings_pm_due_soon_engine_hours_chk') then
    alter table settings add constraint settings_pm_due_soon_engine_hours_chk
      check (pm_due_soon_engine_hours between 1 and 10000) not valid;
  end if;
end $$;

create table if not exists vehicle_maintenance_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  vehicle_id uuid not null references vehicles (id) on delete cascade,
  vin text,
  model_year integer,
  make text,
  model text,
  engine_model text,
  engine_esn text,
  transmission_model text,
  transmission_serial text,
  front_axle_model text,
  rear_axle_model text,
  dpf_serial text,
  turbo_part_number text,
  engine_hours numeric,
  idle_hours numeric,
  idle_percentage numeric,
  rolling_30_day_mpg numeric,
  duty_cycle text not null default 'normal_otr',
  coolant_specification text,
  axle_oil_specification text,
  last_dot_annual_inspection_date date,
  notes text,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles (id) on delete set null,
  constraint vehicle_maintenance_profiles_vehicle_unique unique (organization_id, vehicle_id),
  constraint vehicle_maintenance_profiles_org_id_id_key unique (organization_id, id),
  constraint vehicle_maintenance_profiles_duty_cycle_chk check (duty_cycle in ('heavy','short_haul','normal_otr','light')),
  constraint vehicle_maintenance_profiles_numbers_chk check (
    (model_year is null or model_year between 1900 and 2200)
    and (engine_hours is null or engine_hours >= 0)
    and (idle_hours is null or idle_hours >= 0)
    and (idle_percentage is null or idle_percentage between 0 and 100)
    and (rolling_30_day_mpg is null or rolling_30_day_mpg >= 0)
  )
);

alter table vehicle_maintenance_profiles
  drop constraint if exists vehicle_maintenance_profiles_vehicle_same_org_fk;
alter table vehicle_maintenance_profiles
  add constraint vehicle_maintenance_profiles_vehicle_same_org_fk
  foreign key (organization_id, vehicle_id)
  references vehicles (organization_id, id) on delete cascade not valid;

create index if not exists idx_vehicle_maintenance_profiles_org_vehicle
  on vehicle_maintenance_profiles (organization_id, vehicle_id);

alter table vehicle_maintenance_profiles enable row level security;
drop policy if exists vehicle_maintenance_profiles_select on vehicle_maintenance_profiles;
drop policy if exists vehicle_maintenance_profiles_insert on vehicle_maintenance_profiles;
drop policy if exists vehicle_maintenance_profiles_update on vehicle_maintenance_profiles;
drop policy if exists vehicle_maintenance_profiles_delete on vehicle_maintenance_profiles;
create policy vehicle_maintenance_profiles_select on vehicle_maintenance_profiles
  for select to authenticated
  using (organization_id = (select current_org_id()));
create policy vehicle_maintenance_profiles_insert on vehicle_maintenance_profiles
  for insert to authenticated
  with check (organization_id = (select current_org_id()) and (select is_org_writer()));
create policy vehicle_maintenance_profiles_update on vehicle_maintenance_profiles
  for update to authenticated
  using (organization_id = (select current_org_id()) and (select is_org_writer()))
  with check (organization_id = (select current_org_id()) and (select is_org_writer()));
create policy vehicle_maintenance_profiles_delete on vehicle_maintenance_profiles
  for delete to authenticated
  using (organization_id = (select current_org_id()) and (select is_org_writer()));

create table if not exists maintenance_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name text not null,
  description text,
  warning text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles (id) on delete set null,
  constraint maintenance_templates_org_name_key unique (organization_id, name),
  constraint maintenance_templates_org_id_id_key unique (organization_id, id)
);

create table if not exists maintenance_template_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  template_id uuid not null,
  service_type text not null,
  service_key text not null,
  service_category text,
  description text,
  default_checklist_reference text,
  interval_miles numeric,
  interval_days integer,
  interval_engine_hours numeric,
  duty_cycle_adjusted boolean not null default false,
  configurable boolean not null default false,
  warning text,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint maintenance_template_items_org_template_service_key unique (organization_id, template_id, service_key),
  constraint maintenance_template_items_org_id_id_key unique (organization_id, id),
  constraint maintenance_template_items_intervals_chk check (
    (interval_miles is null or interval_miles > 0)
    and (interval_days is null or interval_days > 0)
    and (interval_engine_hours is null or interval_engine_hours > 0)
    and (interval_miles is not null or interval_days is not null or interval_engine_hours is not null)
  )
);

alter table maintenance_template_items
  drop constraint if exists maintenance_template_items_template_same_org_fk;
alter table maintenance_template_items
  add constraint maintenance_template_items_template_same_org_fk
  foreign key (organization_id, template_id)
  references maintenance_templates (organization_id, id) on delete cascade not valid;

create index if not exists idx_maintenance_templates_org_name
  on maintenance_templates (organization_id, name);
create index if not exists idx_maintenance_template_items_template
  on maintenance_template_items (organization_id, template_id, sort_order);

drop trigger if exists vehicle_maintenance_profiles_updated_at on vehicle_maintenance_profiles;
create trigger vehicle_maintenance_profiles_updated_at
  before update on vehicle_maintenance_profiles
  for each row execute function touch_maintenance_updated_at();
drop trigger if exists maintenance_templates_updated_at on maintenance_templates;
create trigger maintenance_templates_updated_at
  before update on maintenance_templates
  for each row execute function touch_maintenance_updated_at();
drop trigger if exists maintenance_template_items_updated_at on maintenance_template_items;
create trigger maintenance_template_items_updated_at
  before update on maintenance_template_items
  for each row execute function touch_maintenance_updated_at();

alter table maintenance_templates enable row level security;
alter table maintenance_template_items enable row level security;

drop policy if exists maintenance_templates_select on maintenance_templates;
drop policy if exists maintenance_templates_insert on maintenance_templates;
drop policy if exists maintenance_templates_update on maintenance_templates;
drop policy if exists maintenance_templates_delete on maintenance_templates;
create policy maintenance_templates_select on maintenance_templates
  for select to authenticated
  using (organization_id = (select current_org_id()));
create policy maintenance_templates_insert on maintenance_templates
  for insert to authenticated
  with check (organization_id = (select current_org_id()) and (select is_org_writer()));
create policy maintenance_templates_update on maintenance_templates
  for update to authenticated
  using (organization_id = (select current_org_id()) and (select is_org_writer()))
  with check (organization_id = (select current_org_id()) and (select is_org_writer()));
create policy maintenance_templates_delete on maintenance_templates
  for delete to authenticated
  using (organization_id = (select current_org_id()) and (select is_org_writer()));

drop policy if exists maintenance_template_items_select on maintenance_template_items;
drop policy if exists maintenance_template_items_insert on maintenance_template_items;
drop policy if exists maintenance_template_items_update on maintenance_template_items;
drop policy if exists maintenance_template_items_delete on maintenance_template_items;
create policy maintenance_template_items_select on maintenance_template_items
  for select to authenticated
  using (organization_id = (select current_org_id()));
create policy maintenance_template_items_insert on maintenance_template_items
  for insert to authenticated
  with check (organization_id = (select current_org_id()) and (select is_org_writer()));
create policy maintenance_template_items_update on maintenance_template_items
  for update to authenticated
  using (organization_id = (select current_org_id()) and (select is_org_writer()))
  with check (organization_id = (select current_org_id()) and (select is_org_writer()));
create policy maintenance_template_items_delete on maintenance_template_items
  for delete to authenticated
  using (organization_id = (select current_org_id()) and (select is_org_writer()));

alter table maintenance_rules add column if not exists interval_engine_hours numeric;
alter table maintenance_rules add column if not exists last_done_engine_hours numeric;
alter table maintenance_rules add column if not exists service_category text;
alter table maintenance_rules add column if not exists description text;
alter table maintenance_rules add column if not exists checklist_reference text;
alter table maintenance_rules add column if not exists template_id uuid;
alter table maintenance_rules add column if not exists template_item_id uuid;
alter table maintenance_rules add column if not exists template_source text;
alter table maintenance_rules add column if not exists template_applied_by uuid references profiles (id) on delete set null;
alter table maintenance_rules add column if not exists template_applied_at timestamptz;

alter table maintenance_records add column if not exists next_due_engine_hours numeric;

alter table maintenance_rules
  drop constraint if exists maintenance_rules_interval_shape_chk;
alter table maintenance_rules
  drop constraint if exists maintenance_rules_combined_intervals_chk;
alter table maintenance_rules add constraint maintenance_rules_combined_intervals_chk check (
  (interval_miles is null or interval_miles > 0)
  and (interval_days is null or interval_days > 0)
  and (interval_engine_hours is null or interval_engine_hours > 0)
  and (interval_miles is not null or interval_days is not null or interval_engine_hours is not null)
) not valid;

alter table maintenance_rules
  drop constraint if exists maintenance_rules_last_done_nonnegative_chk;
alter table maintenance_rules add constraint maintenance_rules_last_done_nonnegative_chk check (
  coalesce(last_done_mileage, 0) >= 0
  and coalesce(last_done_engine_hours, 0) >= 0
) not valid;

alter table maintenance_records
  drop constraint if exists maintenance_records_next_due_chk;
alter table maintenance_records add constraint maintenance_records_next_due_chk check (
  (next_due_mileage is null or next_due_mileage >= 0)
  and (next_due_engine_hours is null or next_due_engine_hours >= 0)
  and (mileage is null or next_due_mileage is null or next_due_mileage > mileage)
  and (performed_date is null or next_due_date is null or next_due_date > performed_date)
) not valid;

alter table maintenance_rules
  drop constraint if exists maintenance_rules_template_same_org_fk;
alter table maintenance_rules
  add constraint maintenance_rules_template_same_org_fk
  foreign key (organization_id, template_id)
  references maintenance_templates (organization_id, id) on delete set null not valid;

alter table maintenance_rules
  drop constraint if exists maintenance_rules_template_item_same_org_fk;
alter table maintenance_rules
  add constraint maintenance_rules_template_item_same_org_fk
  foreign key (organization_id, template_item_id)
  references maintenance_template_items (organization_id, id) on delete set null not valid;

create or replace function maintenance_service_key(p_service text)
returns text
language sql
immutable
as $$
  select btrim(regexp_replace(lower(regexp_replace(coalesce(p_service, ''), '&', ' and ', 'g')), '[^a-z0-9]+', ' ', 'g'))
$$;

create or replace function seed_default_maintenance_template(p_organization_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template uuid;
  v_warning text := 'Configurable defaults only. VIN/build-sheet specifications take precedence for transmission, axle, coolant, wheel-end, and duty-cycle-dependent service intervals.';
begin
  if p_organization_id is null then
    raise exception 'organization_id is required.';
  end if;

  insert into maintenance_templates (organization_id, name, description, warning)
  values (
    p_organization_id,
    '2023 Peterbilt 579 + Cummins X15 EPA21',
    'Default preventive maintenance starter template. Review VIN/build-sheet specs before applying.',
    v_warning
  )
  on conflict (organization_id, name) do update set
    warning = excluded.warning,
    description = excluded.description,
    updated_at = now()
  returning id into v_template;

  insert into maintenance_template_items (
    organization_id, template_id, service_type, service_key, service_category,
    description, default_checklist_reference, interval_miles, interval_days,
    interval_engine_hours, duty_cycle_adjusted, configurable, warning, sort_order
  ) values
    (p_organization_id, v_template, 'PM-A', maintenance_service_key('PM-A'), 'PM', 'Basic PM inspection and lubrication service.', 'fleet-guide:pm-a', 15000, 30, null, false, false, null, 10),
    (p_organization_id, v_template, 'PM-B', maintenance_service_key('PM-B'), 'PM', 'Expanded PM service.', 'fleet-guide:pm-b', 30000, null, null, false, false, null, 20),
    (p_organization_id, v_template, 'Wet PM / Oil Service', maintenance_service_key('Wet PM / Oil Service'), 'Oil', 'Oil service interval should be selected from duty cycle, MPG, idle and oil analysis.', 'fleet-guide:wet-pm', 50000, null, null, true, true, 'Duty-cycle recommendation only. Values above 60,000 miles require visible oil-analysis support.', 30),
    (p_organization_id, v_template, 'Heavy Inspection', maintenance_service_key('Heavy Inspection'), 'Inspection', 'Heavy inspection interval.', 'fleet-guide:heavy-inspection', 60000, 183, null, false, false, null, 40),
    (p_organization_id, v_template, 'Annual Inspection', maintenance_service_key('Annual Inspection'), 'Inspection', 'Annual vehicle inspection.', 'fleet-guide:annual-inspection', 120000, 365, null, false, false, null, 50),
    (p_organization_id, v_template, 'Coolant Chemistry Test', maintenance_service_key('Coolant Chemistry Test'), 'Coolant', 'Coolant test interval; coolant specification must match build sheet.', 'fleet-guide:coolant-chemistry', 30000, 183, null, false, true, 'Coolant specification is configurable; VIN/build-sheet specifications take precedence.', 60),
    (p_organization_id, v_template, 'DEF Filter', maintenance_service_key('DEF Filter'), 'Emissions', 'DEF filter service.', 'fleet-guide:def-filter', 300000, null, null, false, false, null, 70),
    (p_organization_id, v_template, 'Valve Overhead', maintenance_service_key('Valve Overhead'), 'Engine', 'Valve overhead adjustment.', 'fleet-guide:valve-overhead', 500000, 1826, 10000, false, false, null, 80),
    (p_organization_id, v_template, 'Cabin Air Filter Inspection/Replacement', maintenance_service_key('Cabin Air Filter Inspection/Replacement'), 'Cabin', 'Configurable cabin filter inspection/replacement.', 'fleet-guide:cabin-air-filter', null, 183, null, false, true, 'Default is six months; adjust for operating environment.', 90),
    (p_organization_id, v_template, 'Air Dryer', maintenance_service_key('Air Dryer'), 'Air System', 'Air dryer service.', 'fleet-guide:air-dryer', 300000, null, null, false, true, 'Air system configuration can vary; VIN/build-sheet specifications take precedence.', 100),
    (p_organization_id, v_template, 'Synthetic Drive Axle Oil', maintenance_service_key('Synthetic Drive Axle Oil'), 'Axle', 'Synthetic drive axle oil service.', 'fleet-guide:drive-axle-oil', 240000, null, null, false, true, 'Axle and wheel-end configuration is configurable; VIN/build-sheet specifications take precedence.', 110),
    (p_organization_id, v_template, 'DOT Annual', maintenance_service_key('DOT Annual'), 'DOT', 'DOT annual inspection.', 'fleet-guide:dot-annual', null, 365, null, false, false, null, 120)
  on conflict (organization_id, template_id, service_key) do update set
    service_type = excluded.service_type,
    service_category = excluded.service_category,
    description = excluded.description,
    default_checklist_reference = excluded.default_checklist_reference,
    interval_miles = excluded.interval_miles,
    interval_days = excluded.interval_days,
    interval_engine_hours = excluded.interval_engine_hours,
    duty_cycle_adjusted = excluded.duty_cycle_adjusted,
    configurable = excluded.configurable,
    warning = excluded.warning,
    sort_order = excluded.sort_order,
    active = true,
    updated_at = now();

  return v_template;
end;
$$;

revoke execute on function seed_default_maintenance_template(uuid) from public, anon;
grant execute on function seed_default_maintenance_template(uuid) to authenticated, service_role;

select seed_default_maintenance_template(id) from organizations;

create or replace function seed_default_maintenance_template_for_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform seed_default_maintenance_template(new.id);
  return new;
end;
$$;

drop trigger if exists organizations_seed_default_maintenance_template on organizations;
create trigger organizations_seed_default_maintenance_template
  after insert on organizations
  for each row execute function seed_default_maintenance_template_for_org();

create or replace function apply_maintenance_template(
  p_vehicle_id uuid,
  p_template_id uuid,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := (select current_org_id());
  v_user uuid := auth.uid();
  v_item jsonb;
  v_template maintenance_templates%rowtype;
  v_profile vehicle_maintenance_profiles%rowtype;
  v_service text;
  v_service_key text;
  v_rule uuid;
  v_created integer := 0;
  v_skipped integer := 0;
  v_created_ids uuid[] := '{}';
begin
  if v_org is null or not (select is_org_writer()) then
    raise exception 'Write permission required.';
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'Template items must be an array.';
  end if;

  if not exists (
    select 1 from vehicles
    where id = p_vehicle_id and organization_id = v_org
    for update
  ) then
    raise exception 'Vehicle does not belong to organization.';
  end if;

  select * into v_template
  from maintenance_templates
  where id = p_template_id and organization_id = v_org
  for update;
  if not found then raise exception 'Template not found.'; end if;

  select * into v_profile
  from vehicle_maintenance_profiles
  where organization_id = v_org and vehicle_id = p_vehicle_id;

  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    if not coalesce((v_item->>'enabled')::boolean, false) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_service := nullif(btrim(v_item->>'service_type'), '');
    if v_service is null then raise exception 'service_type is required.'; end if;
    v_service_key := maintenance_service_key(v_service);

    select id into v_rule
    from maintenance_rules
    where organization_id = v_org and vehicle_id = p_vehicle_id and active = true
      and maintenance_service_key(service_type) = v_service_key
    limit 1
    for update;

    if v_rule is not null then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    insert into maintenance_rules (
      organization_id, vehicle_id, service_type, interval_type,
      interval_miles, interval_days, interval_engine_hours,
      last_done_mileage, last_done_date, last_done_engine_hours,
      active, service_category, description, checklist_reference,
      template_id, template_item_id, template_source, template_applied_by, template_applied_at
    ) values (
      v_org,
      p_vehicle_id,
      v_service,
      case when nullif(v_item->>'interval_miles', '') is not null then 'mileage' else 'date' end,
      nullif(v_item->>'interval_miles', '')::numeric,
      nullif(v_item->>'interval_days', '')::integer,
      nullif(v_item->>'interval_engine_hours', '')::numeric,
      coalesce(nullif(v_item->>'last_done_mileage', '')::numeric, 0),
      nullif(v_item->>'last_done_date', '')::date,
      coalesce(nullif(v_item->>'last_done_engine_hours', '')::numeric, v_profile.engine_hours, 0),
      true,
      nullif(btrim(v_item->>'service_category'), ''),
      nullif(btrim(v_item->>'description'), ''),
      nullif(btrim(v_item->>'checklist_reference'), ''),
      p_template_id,
      nullif(v_item->>'template_item_id', '')::uuid,
      v_template.name,
      v_user,
      now()
    ) returning id into v_rule;
    v_created := v_created + 1;
    v_created_ids := array_append(v_created_ids, v_rule);
  end loop;

  return jsonb_build_object(
    'created', v_created,
    'skipped', v_skipped,
    'rule_ids', v_created_ids,
    'template', v_template.name
  );
end;
$$;

revoke execute on function apply_maintenance_template(uuid,uuid,jsonb) from public, anon;
grant execute on function apply_maintenance_template(uuid,uuid,jsonb) to authenticated;

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
  v_engine_hours numeric;
  v_existing uuid;
  v_record uuid;
begin
  if v_org is null or not (select is_org_writer()) then
    raise exception 'Write permission required.';
  end if;
  if p_performed_date is null then raise exception 'Performed date is required.'; end if;
  if coalesce(p_cost, 0) < 0 then raise exception 'Cost cannot be negative.'; end if;

  select r.vehicle_id, r.service_type, v.current_mileage, p.engine_hours
    into v_vehicle, v_service, v_mileage, v_engine_hours
  from maintenance_rules r
  join vehicles v on v.id = r.vehicle_id and v.organization_id = r.organization_id
  left join vehicle_maintenance_profiles p on p.vehicle_id = r.vehicle_id and p.organization_id = r.organization_id
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
  set last_done_mileage = v_mileage,
      last_done_date = p_performed_date,
      last_done_engine_hours = coalesce(v_engine_hours, last_done_engine_hours)
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
