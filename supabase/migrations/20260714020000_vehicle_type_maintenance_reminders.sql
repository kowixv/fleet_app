-- Vehicle-type maintenance reminders with per-vehicle state.
-- File-only migration artifact; run manually in Supabase SQL Editor.

create or replace function public.maintenance_service_key(p_service text)
returns text
language sql
immutable
parallel safe
set search_path = public
as $$
  select btrim(
    regexp_replace(
      lower(
        regexp_replace(
          coalesce(p_service, ''),
          '&',
          ' and ',
          'g'
        )
      ),
      '[^a-z0-9]+',
      ' ',
      'g'
    )
  )
$$;

create or replace function public.manual_maintenance_service_key(p_kind text, p_service text)
returns text
language sql
immutable
parallel safe
set search_path = public
as $$
  select case
    when p_kind = 'periodic' and public.maintenance_service_key(p_service) in (
      public.maintenance_service_key('Engine Air Filter'),
      public.maintenance_service_key('Engine Air Filter Replacement')
    ) then public.maintenance_service_key('Engine Air Filter')
    when p_kind = 'periodic' and public.maintenance_service_key(p_service) in (
      public.maintenance_service_key('Cabin Air Filter'),
      public.maintenance_service_key('Cabin Air Filter Replacement'),
      public.maintenance_service_key('Cabin Air Filter Inspection/Replacement')
    ) then public.maintenance_service_key('Cabin Air Filter Inspection/Replacement')
    when p_kind = 'periodic' and public.maintenance_service_key(p_service) in (
      public.maintenance_service_key('DOT Annual'),
      public.maintenance_service_key('DOT Inspection'),
      public.maintenance_service_key('Annual DOT'),
      public.maintenance_service_key('Annual Inspection')
    ) then public.maintenance_service_key('DOT Annual')
    when p_kind = 'periodic' and public.maintenance_service_key(p_service) in (
      public.maintenance_service_key('Drive Axle Oil'),
      public.maintenance_service_key('Drive Axle Oil Change'),
      public.maintenance_service_key('Synthetic Drive Axle Oil')
    ) then public.maintenance_service_key('Synthetic Drive Axle Oil')
    else public.maintenance_service_key(p_service)
  end
$$;

alter table maintenance_rules add column if not exists vehicle_type text;

alter table maintenance_rules drop constraint if exists maintenance_rules_vehicle_type_chk;
alter table maintenance_rules add constraint maintenance_rules_vehicle_type_chk
  check (vehicle_type is null or vehicle_type in ('truck','box_truck','hotshot','trailer','other')) not valid;
alter table maintenance_rules validate constraint maintenance_rules_vehicle_type_chk;

alter table maintenance_rules drop constraint if exists maintenance_rules_scope_chk;
alter table maintenance_rules add constraint maintenance_rules_scope_chk
  check (
    (vehicle_id is not null and vehicle_type is null)
    or
    (vehicle_id is null and vehicle_type is not null)
  ) not valid;
alter table maintenance_rules validate constraint maintenance_rules_scope_chk;

create table if not exists maintenance_rule_vehicle_states (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  rule_id uuid not null,
  vehicle_id uuid not null,
  last_done_mileage numeric,
  last_done_date date,
  last_done_engine_hours numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint maintenance_rule_vehicle_states_org_id_id_key unique (organization_id, id),
  constraint maintenance_rule_vehicle_states_unique unique (organization_id, rule_id, vehicle_id),
  constraint maintenance_rule_vehicle_states_rule_same_org_fk
    foreign key (organization_id, rule_id)
    references maintenance_rules (organization_id, id) on delete cascade,
  constraint maintenance_rule_vehicle_states_vehicle_same_org_fk
    foreign key (organization_id, vehicle_id)
    references vehicles (organization_id, id) on delete cascade
);

alter table maintenance_rule_vehicle_states enable row level security;
drop policy if exists maintenance_rule_vehicle_states_select on maintenance_rule_vehicle_states;
drop policy if exists maintenance_rule_vehicle_states_insert on maintenance_rule_vehicle_states;
drop policy if exists maintenance_rule_vehicle_states_update on maintenance_rule_vehicle_states;
drop policy if exists maintenance_rule_vehicle_states_delete on maintenance_rule_vehicle_states;
create policy maintenance_rule_vehicle_states_select on maintenance_rule_vehicle_states
  for select to authenticated
  using (organization_id = (select current_org_id()));
create policy maintenance_rule_vehicle_states_insert on maintenance_rule_vehicle_states
  for insert to authenticated
  with check (organization_id = (select current_org_id()) and (select is_org_writer()));
create policy maintenance_rule_vehicle_states_update on maintenance_rule_vehicle_states
  for update to authenticated
  using (organization_id = (select current_org_id()) and (select is_org_writer()))
  with check (organization_id = (select current_org_id()) and (select is_org_writer()));
create policy maintenance_rule_vehicle_states_delete on maintenance_rule_vehicle_states
  for delete to authenticated
  using (organization_id = (select current_org_id()) and (select is_org_writer()));

drop trigger if exists maintenance_rule_vehicle_states_updated_at on maintenance_rule_vehicle_states;
create trigger maintenance_rule_vehicle_states_updated_at
  before update on maintenance_rule_vehicle_states
  for each row execute function touch_maintenance_updated_at();

create index if not exists maintenance_rules_org_vehicle_idx
  on maintenance_rules (organization_id, vehicle_id);
create index if not exists maintenance_rules_org_vehicle_type_idx
  on maintenance_rules (organization_id, vehicle_type);
create index if not exists maintenance_rules_org_active_vehicle_type_idx
  on maintenance_rules (organization_id, active, vehicle_type);
create index if not exists maintenance_rules_service_key_vehicle_idx
  on maintenance_rules (organization_id, vehicle_id, public.manual_maintenance_service_key('periodic', service_type))
  where active = true and vehicle_id is not null;
create index if not exists maintenance_rules_service_key_type_idx
  on maintenance_rules (organization_id, vehicle_type, public.manual_maintenance_service_key('periodic', service_type))
  where active = true and vehicle_type is not null;
create index if not exists maintenance_rule_vehicle_states_vehicle_idx
  on maintenance_rule_vehicle_states (organization_id, vehicle_id);
create index if not exists maintenance_rule_vehicle_states_rule_idx
  on maintenance_rule_vehicle_states (organization_id, rule_id);

-- Existing vehicle-specific duplicate prevention remains:
-- maintenance_rules_one_active_service_idx on organization_id + vehicle_id + canonical service key.
drop index if exists maintenance_rules_one_active_type_service_idx;
create unique index maintenance_rules_one_active_type_service_idx
  on maintenance_rules (organization_id, vehicle_type, public.manual_maintenance_service_key('periodic', service_type))
  where active = true and vehicle_id is null and vehicle_type is not null;

create or replace function sync_maintenance_rule_vehicle_states(p_rule_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := (select current_org_id());
  v_rule maintenance_rules%rowtype;
  v_inserted integer := 0;
begin
  if v_org is null or not (select is_org_writer()) then
    raise exception 'Write permission required.';
  end if;

  select * into v_rule
  from maintenance_rules
  where id = p_rule_id and organization_id = v_org
  for update;
  if not found then raise exception 'Maintenance rule not found.'; end if;
  if v_rule.vehicle_type is null then return 0; end if;

  insert into maintenance_rule_vehicle_states (
    organization_id, rule_id, vehicle_id,
    last_done_mileage, last_done_date, last_done_engine_hours
  )
  select
    v_org,
    v_rule.id,
    v.id,
    case when v_rule.interval_miles is not null then v.current_mileage else null end,
    case when v_rule.interval_days is not null then current_date else null end,
    case when v_rule.interval_engine_hours is not null then p.engine_hours else null end
  from vehicles v
  left join vehicle_maintenance_profiles p on p.organization_id = v.organization_id and p.vehicle_id = v.id
  where v.organization_id = v_org
    and v.status = 'active'
    and v.vehicle_type = v_rule.vehicle_type
  on conflict (organization_id, rule_id, vehicle_id) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke execute on function sync_maintenance_rule_vehicle_states(uuid) from public, anon;
grant execute on function sync_maintenance_rule_vehicle_states(uuid) to authenticated;

create or replace function sync_vehicle_type_maintenance_states_for_vehicle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rule maintenance_rules%rowtype;
  v_engine_hours numeric;
begin
  if new.status <> 'active' then
    return new;
  end if;

  select engine_hours into v_engine_hours
  from vehicle_maintenance_profiles
  where organization_id = new.organization_id and vehicle_id = new.id;

  for v_rule in
    select *
    from maintenance_rules
    where organization_id = new.organization_id
      and vehicle_id is null
      and vehicle_type = new.vehicle_type
      and active = true
  loop
    insert into maintenance_rule_vehicle_states (
      organization_id, rule_id, vehicle_id,
      last_done_mileage, last_done_date, last_done_engine_hours
    )
    values (
      new.organization_id,
      v_rule.id,
      new.id,
      case when v_rule.interval_miles is not null then new.current_mileage else null end,
      case when v_rule.interval_days is not null then current_date else null end,
      case when v_rule.interval_engine_hours is not null then v_engine_hours else null end
    )
    on conflict (organization_id, rule_id, vehicle_id) do nothing;
  end loop;

  return new;
end;
$$;

drop trigger if exists vehicles_sync_type_maintenance_states on vehicles;
create trigger vehicles_sync_type_maintenance_states
  after insert or update of vehicle_type, status on vehicles
  for each row execute function sync_vehicle_type_maintenance_states_for_vehicle();

create or replace function save_maintenance_reminder(p_rule_id uuid, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := (select current_org_id());
  v_user uuid := auth.uid();
  v_existing maintenance_rules%rowtype;
  v_rule uuid := p_rule_id;
  v_vehicle_type text := nullif(btrim(p_payload->>'vehicle_type'), '');
  v_service text := nullif(btrim(p_payload->>'service_type'), '');
  v_interval_miles numeric := nullif(p_payload->>'interval_miles', '')::numeric;
  v_interval_days integer := nullif(p_payload->>'interval_days', '')::integer;
  v_interval_engine_hours numeric := nullif(p_payload->>'interval_engine_hours', '')::numeric;
  v_duplicate uuid;
begin
  if v_org is null or not (select is_org_writer()) then
    raise exception 'Write permission required.';
  end if;
  if v_service is null then raise exception 'Maintenance type is required.'; end if;
  if v_interval_miles is null and v_interval_days is null and v_interval_engine_hours is null then
    raise exception 'At least one interval is required.';
  end if;
  if (v_interval_miles is not null and (v_interval_miles <= 0 or v_interval_miles <> trunc(v_interval_miles)))
    or (v_interval_days is not null and (v_interval_days <= 0))
    or (v_interval_engine_hours is not null and (v_interval_engine_hours <= 0 or v_interval_engine_hours <> trunc(v_interval_engine_hours))) then
    raise exception 'Intervals must be positive whole numbers.';
  end if;

  if p_rule_id is null then
    if v_vehicle_type not in ('truck','box_truck','hotshot','trailer','other') then
      raise exception 'Valid unit type is required.';
    end if;

    select id into v_duplicate
    from maintenance_rules
    where organization_id = v_org
      and active = true
      and vehicle_id is null
      and vehicle_type = v_vehicle_type
      and public.manual_maintenance_service_key('periodic', service_type) = public.manual_maintenance_service_key('periodic', v_service)
    limit 1;
    if v_duplicate is not null then
      raise exception 'An active reminder already exists for this unit type and service.';
    end if;

    insert into maintenance_rules (
      organization_id, vehicle_id, vehicle_type, service_type, interval_type,
      interval_miles, interval_days, interval_engine_hours,
      last_done_mileage, last_done_date, last_done_engine_hours,
      active, service_category, description, checklist_reference, template_applied_by, template_applied_at
    )
    values (
      v_org, null, v_vehicle_type, v_service,
      case when v_interval_miles is not null then 'mileage' else 'date' end,
      v_interval_miles, v_interval_days, v_interval_engine_hours,
      null, null, null,
      true, null, null, null, v_user, now()
    )
    returning id into v_rule;

    perform sync_maintenance_rule_vehicle_states(v_rule);
    return v_rule;
  end if;

  select * into v_existing
  from maintenance_rules
  where id = p_rule_id and organization_id = v_org
  for update;
  if not found then raise exception 'Maintenance reminder not found.'; end if;

  if v_existing.vehicle_type is not null then
    if v_vehicle_type not in ('truck','box_truck','hotshot','trailer','other') then
      raise exception 'Valid unit type is required.';
    end if;
    select id into v_duplicate
    from maintenance_rules
    where organization_id = v_org
      and id <> p_rule_id
      and active = true
      and vehicle_id is null
      and vehicle_type = v_vehicle_type
      and public.manual_maintenance_service_key('periodic', service_type) = public.manual_maintenance_service_key('periodic', v_service)
    limit 1;
    if v_duplicate is not null then
      raise exception 'An active reminder already exists for this unit type and service.';
    end if;

    update maintenance_rules
    set vehicle_type = v_vehicle_type,
        service_type = v_service,
        interval_type = case when v_interval_miles is not null then 'mileage' else 'date' end,
        interval_miles = v_interval_miles,
        interval_days = v_interval_days,
        interval_engine_hours = v_interval_engine_hours,
        active = coalesce((p_payload->>'active')::boolean, active),
        updated_at = now()
    where id = p_rule_id and organization_id = v_org;

    perform sync_maintenance_rule_vehicle_states(p_rule_id);
    return p_rule_id;
  end if;

  update maintenance_rules
  set service_type = v_service,
      interval_type = case when v_interval_miles is not null then 'mileage' else 'date' end,
      interval_miles = v_interval_miles,
      interval_days = v_interval_days,
      interval_engine_hours = v_interval_engine_hours,
      active = coalesce((p_payload->>'active')::boolean, active),
      updated_at = now()
  where id = p_rule_id and organization_id = v_org;

  return p_rule_id;
end;
$$;

revoke execute on function save_maintenance_reminder(uuid,jsonb) from public, anon;
grant execute on function save_maintenance_reminder(uuid,jsonb) to authenticated;

create or replace function set_maintenance_reminder_active(p_rule_id uuid, p_active boolean)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := (select current_org_id());
begin
  if v_org is null or not (select is_org_writer()) then
    raise exception 'Write permission required.';
  end if;
  update maintenance_rules
  set active = p_active, updated_at = now()
  where id = p_rule_id and organization_id = v_org;
  if not found then raise exception 'Maintenance reminder not found.'; end if;
  return p_rule_id;
end;
$$;

revoke execute on function set_maintenance_reminder_active(uuid,boolean) from public, anon;
grant execute on function set_maintenance_reminder_active(uuid,boolean) to authenticated;

create or replace function recalculate_maintenance_rule_baseline(p_rule_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := (select current_org_id());
  v_rule maintenance_rules%rowtype;
  v_state record;
  v_updated integer := 0;
begin
  if v_org is null or not (select is_org_writer()) then
    raise exception 'Write permission required.';
  end if;

  select * into v_rule
  from maintenance_rules
  where id = p_rule_id and organization_id = v_org
  for update;
  if not found then raise exception 'Maintenance rule not found.'; end if;

  if v_rule.vehicle_id is not null then
    update maintenance_rules r
    set last_done_date = latest.performed_date,
        last_done_mileage = latest.mileage
    from (
      select performed_date, mileage
      from maintenance_records
      where organization_id = v_org
        and rule_id = p_rule_id
        and vehicle_id = v_rule.vehicle_id
        and deleted_at is null
        and coalesce(status, 'completed') = 'completed'
        and performed_date is not null
        and mileage is not null
      order by performed_date desc, mileage desc, created_at desc
      limit 1
    ) latest
    where r.id = p_rule_id and r.organization_id = v_org;
    get diagnostics v_updated = row_count;
    return jsonb_build_object('rule_id', p_rule_id, 'vehicle_state_recalculated', false, 'updated', v_updated);
  end if;

  for v_state in
    select distinct vehicle_id
    from maintenance_rule_vehicle_states
    where organization_id = v_org and rule_id = p_rule_id
  loop
    update maintenance_rule_vehicle_states s
    set last_done_date = latest.performed_date,
        last_done_mileage = latest.mileage,
        last_done_engine_hours = coalesce(latest.engine_hours, s.last_done_engine_hours)
    from (
      select r.performed_date, r.mileage, p.engine_hours
      from maintenance_records r
      left join vehicle_maintenance_profiles p on p.organization_id = r.organization_id and p.vehicle_id = r.vehicle_id
      where r.organization_id = v_org
        and r.rule_id = p_rule_id
        and r.vehicle_id = v_state.vehicle_id
        and r.deleted_at is null
        and coalesce(r.status, 'completed') = 'completed'
        and r.performed_date is not null
        and r.mileage is not null
      order by r.performed_date desc, r.mileage desc, r.created_at desc
      limit 1
    ) latest
    where s.organization_id = v_org and s.rule_id = p_rule_id and s.vehicle_id = v_state.vehicle_id;
    get diagnostics v_updated = row_count;
  end loop;

  return jsonb_build_object('rule_id', p_rule_id, 'vehicle_state_recalculated', true);
end;
$$;

revoke execute on function recalculate_maintenance_rule_baseline(uuid) from public, anon;
grant execute on function recalculate_maintenance_rule_baseline(uuid) to authenticated;

create or replace function save_manual_maintenance(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := (select current_org_id());
  v_user uuid := auth.uid();
  v_submission_key text := nullif(btrim(p_payload->>'submission_key'), '');
  v_vehicle uuid := nullif(p_payload->>'vehicle_id', '')::uuid;
  v_vehicle_type text;
  v_kind text := nullif(btrim(p_payload->>'entry_kind'), '');
  v_service text := nullif(btrim(p_payload->>'service_type'), '');
  v_service_key text;
  v_performed_date date := nullif(p_payload->>'performed_date', '')::date;
  v_mileage numeric := nullif(p_payload->>'mileage', '')::numeric;
  v_current_mileage numeric := 0;
  v_cost numeric := nullif(p_payload->>'cost', '')::numeric;
  v_total_cost numeric := nullif(p_payload->>'total_cost', '')::numeric;
  v_labor_cost numeric := coalesce(nullif(p_payload->>'labor_cost', '')::numeric, 0);
  v_parts_cost numeric := coalesce(nullif(p_payload->>'parts_cost', '')::numeric, 0);
  v_shop_fees numeric := coalesce(nullif(p_payload->>'shop_fees', '')::numeric, 0);
  v_tax_cost numeric := coalesce(nullif(p_payload->>'tax_cost', '')::numeric, 0);
  v_parts text[] := '{}';
  v_part jsonb;
  v_update_plan boolean := coalesce((p_payload->>'update_plan')::boolean, false);
  v_rule uuid;
  v_rule_scope text := null;
  v_engine_hours numeric;
  v_record uuid;
  v_existing uuid;
  v_rule_updated boolean := false;
  v_missing_rule boolean := false;
begin
  if v_org is null or not (select is_org_writer()) then
    raise exception 'Write permission required.';
  end if;
  if v_submission_key is null then raise exception 'Submission key is required.'; end if;
  if v_vehicle is null then raise exception 'Vehicle is required.'; end if;
  if v_kind not in ('periodic', 'repair') then raise exception 'Invalid maintenance type.'; end if;
  if v_service is null then raise exception 'Service type is required.'; end if;
  if v_performed_date is null then raise exception 'Performed date is required.'; end if;
  if v_mileage is null or v_mileage < 0 or v_mileage <> trunc(v_mileage) then
    raise exception 'Mileage must be a non-negative whole number.';
  end if;
  if coalesce(v_cost, 0) < 0 or coalesce(v_total_cost, 0) < 0 or v_labor_cost < 0 or v_parts_cost < 0 or v_shop_fees < 0 or v_tax_cost < 0 then
    raise exception 'Cost cannot be negative.';
  end if;

  select id into v_existing
  from maintenance_records
  where organization_id = v_org and manual_submission_key = v_submission_key
  limit 1;
  if v_existing is not null then
    return jsonb_build_object('record_id', v_existing, 'idempotent', true);
  end if;

  select v.current_mileage, v.vehicle_type, p.engine_hours
    into v_current_mileage, v_vehicle_type, v_engine_hours
  from vehicles v
  left join vehicle_maintenance_profiles p on p.organization_id = v.organization_id and p.vehicle_id = v.id
  where v.id = v_vehicle and v.organization_id = v_org
  for update of v;
  if not found then raise exception 'Vehicle not found.'; end if;

  v_service_key := public.manual_maintenance_service_key(v_kind, v_service);
  if v_kind = 'repair' then
    v_update_plan := false;
  end if;

  if jsonb_typeof(coalesce(p_payload->'parts_used', '[]'::jsonb)) = 'array' then
    for v_part in select value from jsonb_array_elements(coalesce(p_payload->'parts_used', '[]'::jsonb))
    loop
      if nullif(btrim(v_part #>> '{}'), '') is not null then
        v_parts := array_append(v_parts, btrim(v_part #>> '{}'));
      end if;
    end loop;
  end if;

  if v_update_plan then
    select id, 'vehicle' into v_rule, v_rule_scope
    from maintenance_rules
    where organization_id = v_org
      and vehicle_id = v_vehicle
      and active = true
      and public.manual_maintenance_service_key(v_kind, service_type) = v_service_key
    limit 1
    for update;

    if v_rule is null then
      select id, 'vehicle_type' into v_rule, v_rule_scope
      from maintenance_rules
      where organization_id = v_org
        and vehicle_id is null
        and vehicle_type = v_vehicle_type
        and active = true
        and public.manual_maintenance_service_key(v_kind, service_type) = v_service_key
      limit 1
      for update;
    end if;

    if v_rule is null then
      v_missing_rule := true;
    end if;
  end if;

  insert into maintenance_records (
    organization_id, vehicle_id, rule_id, service_type, performed_date, mileage,
    cost, total_cost, labor_cost, parts_cost, shop_fees, tax_cost,
    shop_name, vendor, parts_used, invoice_number, notes, source, category, planned,
    downtime_start, downtime_end, manual_submission_key, created_by, status,
    towing_cost, road_service_cost, hotel_travel_cost, diagnostic_cost,
    freight_shipping_cost, core_charge_cost, environmental_fee_cost,
    machine_shop_cost, sublet_cost, other_cost, warranty_recovery,
    refund_credit, cause, breakdown_occurred
  )
  values (
    v_org, v_vehicle, v_rule, v_service, v_performed_date, v_mileage,
    coalesce(v_cost, v_total_cost, 0), v_total_cost, v_labor_cost, v_parts_cost, v_shop_fees, v_tax_cost,
    nullif(btrim(p_payload->>'shop_name'), ''), nullif(btrim(coalesce(p_payload->>'vendor', p_payload->>'shop_name')), ''),
    v_parts, nullif(btrim(p_payload->>'invoice_number'), ''), nullif(btrim(p_payload->>'notes'), ''),
    'manual_maintenance', nullif(btrim(p_payload->>'category'), ''), coalesce((p_payload->>'planned')::boolean, v_kind = 'periodic'),
    nullif(p_payload->>'downtime_start', '')::timestamptz, nullif(p_payload->>'downtime_end', '')::timestamptz,
    v_submission_key, v_user, 'completed',
    coalesce(nullif(p_payload->>'towing_cost', '')::numeric, 0),
    coalesce(nullif(p_payload->>'road_service_cost', '')::numeric, 0),
    coalesce(nullif(p_payload->>'hotel_travel_cost', '')::numeric, 0),
    coalesce(nullif(p_payload->>'diagnostic_cost', '')::numeric, 0),
    coalesce(nullif(p_payload->>'freight_shipping_cost', '')::numeric, 0),
    coalesce(nullif(p_payload->>'core_charge_cost', '')::numeric, 0),
    coalesce(nullif(p_payload->>'environmental_fee_cost', '')::numeric, 0),
    coalesce(nullif(p_payload->>'machine_shop_cost', '')::numeric, 0),
    coalesce(nullif(p_payload->>'sublet_cost', '')::numeric, 0),
    coalesce(nullif(p_payload->>'other_cost', '')::numeric, 0),
    coalesce(nullif(p_payload->>'warranty_recovery', '')::numeric, 0),
    coalesce(nullif(p_payload->>'refund_credit', '')::numeric, 0),
    nullif(btrim(p_payload->>'cause'), ''),
    coalesce((p_payload->>'breakdown_occurred')::boolean, false)
  )
  returning id into v_record;

  insert into vehicle_mileage_logs (
    organization_id, vehicle_id, mileage, source, effective_date, maintenance_record_id, manual_submission_key
  )
  values (
    v_org, v_vehicle, v_mileage, 'manual_maintenance', v_performed_date, v_record, v_submission_key
  )
  on conflict (organization_id, manual_submission_key) where manual_submission_key is not null do nothing;

  if v_mileage > coalesce(v_current_mileage, 0) then
    update vehicles
    set current_mileage = v_mileage
    where id = v_vehicle and organization_id = v_org and coalesce(current_mileage, 0) < v_mileage;
  end if;

  if v_update_plan and v_rule is not null then
    if v_rule_scope = 'vehicle_type' then
      insert into maintenance_rule_vehicle_states (
        organization_id, rule_id, vehicle_id, last_done_date, last_done_mileage, last_done_engine_hours
      )
      values (v_org, v_rule, v_vehicle, v_performed_date, v_mileage, v_engine_hours)
      on conflict (organization_id, rule_id, vehicle_id) do update
      set last_done_date = excluded.last_done_date,
          last_done_mileage = excluded.last_done_mileage,
          last_done_engine_hours = excluded.last_done_engine_hours,
          updated_at = now();
    else
      update maintenance_rules
      set last_done_date = v_performed_date,
          last_done_mileage = v_mileage,
          last_done_engine_hours = coalesce(v_engine_hours, last_done_engine_hours)
      where id = v_rule and organization_id = v_org;
    end if;
    v_rule_updated := true;
  end if;

  return jsonb_build_object(
    'record_id', v_record,
    'rule_id', v_rule,
    'rule_scope', v_rule_scope,
    'rule_updated', v_rule_updated,
    'rule_created', false,
    'missing_rule', v_missing_rule,
    'advanced_current_mileage', v_mileage > coalesce(v_current_mileage, 0)
  );
end;
$$;

revoke execute on function save_manual_maintenance(jsonb) from public, anon;
grant execute on function save_manual_maintenance(jsonb) to authenticated;
