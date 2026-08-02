-- New-vehicle maintenance onboarding. Additive and safe for existing rows.

alter table public.settings
  add column if not exists new_vehicle_auto_maintenance_setup boolean not null default true,
  add column if not exists new_truck_maintenance_package text not null default 'basic',
  add column if not exists new_box_truck_maintenance_package text not null default 'basic',
  add column if not exists new_vehicle_maintenance_baseline_mode text not null default 'current';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'settings_new_vehicle_maintenance_packages_chk'
      and conrelid = 'public.settings'::regclass
  ) then
    alter table public.settings
      add constraint settings_new_vehicle_maintenance_packages_chk
      check (
        new_truck_maintenance_package in ('basic', 'full')
        and new_box_truck_maintenance_package in ('basic', 'full')
      ) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'settings_new_vehicle_maintenance_baseline_chk'
      and conrelid = 'public.settings'::regclass
  ) then
    alter table public.settings
      add constraint settings_new_vehicle_maintenance_baseline_chk
      check (new_vehicle_maintenance_baseline_mode in ('current', 'manual')) not valid;
  end if;
end $$;

alter table public.settings validate constraint settings_new_vehicle_maintenance_packages_chk;
alter table public.settings validate constraint settings_new_vehicle_maintenance_baseline_chk;

alter table public.vehicles
  add column if not exists creation_request_key uuid;

alter table public.maintenance_rules
  add column if not exists tracking_baseline_mileage numeric,
  add column if not exists tracking_baseline_date date,
  add column if not exists tracking_baseline_engine_hours numeric;

alter table public.maintenance_rule_vehicle_states
  add column if not exists tracking_baseline_mileage numeric,
  add column if not exists tracking_baseline_date date,
  add column if not exists tracking_baseline_engine_hours numeric;

create unique index if not exists vehicles_org_creation_request_key_uidx
  on public.vehicles (organization_id, creation_request_key);

comment on column public.vehicles.creation_request_key is
  'Server-scoped idempotency key for the new-vehicle form. Never used as organization identity.';

create or replace function public.initialize_vehicle_maintenance_baseline(
  p_vehicle_id uuid,
  p_mode text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select public.current_org_id());
  v_vehicle public.vehicles%rowtype;
  v_engine_hours numeric;
  v_needs_information jsonb := '[]'::jsonb;
begin
  if v_org is null or (select auth.uid()) is null or not (select public.is_org_writer()) then
    raise exception 'Write permission required.';
  end if;
  if p_mode not in ('current', 'manual') then
    raise exception 'Valid maintenance baseline mode is required.';
  end if;

  select v.* into v_vehicle
  from public.vehicles v
  where v.organization_id = v_org
    and v.id = p_vehicle_id
    and v.status in ('active', 'in_repair', 'yard_hometime')
  for update;
  if not found then
    raise exception 'Active vehicle not found.';
  end if;

  select p.engine_hours into v_engine_hours
  from public.vehicle_maintenance_profiles p
  where p.organization_id = v_org
    and p.vehicle_id = p_vehicle_id;

  perform pg_advisory_xact_lock(
    hashtextextended(v_org::text || ':' || p_vehicle_id::text || ':maintenance-baseline', 0)
  );

  insert into public.maintenance_rule_vehicle_states (
    organization_id,
    rule_id,
    vehicle_id,
    last_done_mileage,
    last_done_date,
    last_done_engine_hours,
    tracking_baseline_mileage,
    tracking_baseline_date,
    tracking_baseline_engine_hours
  )
  select
    v_org,
    r.id,
    p_vehicle_id,
    null,
    null,
    null,
    case when p_mode = 'current' and r.interval_miles is not null then v_vehicle.current_mileage else null end,
    case when p_mode = 'current' and r.interval_days is not null then current_date else null end,
    case when p_mode = 'current' and r.interval_engine_hours is not null then v_engine_hours else null end
  from public.maintenance_rules r
  where r.organization_id = v_org
    and r.vehicle_id is null
    and r.vehicle_type = v_vehicle.vehicle_type
    and r.active = true
  on conflict (organization_id, rule_id, vehicle_id) do update
  set tracking_baseline_mileage = excluded.tracking_baseline_mileage,
      tracking_baseline_date = excluded.tracking_baseline_date,
      tracking_baseline_engine_hours = excluded.tracking_baseline_engine_hours,
      updated_at = now();

  update public.maintenance_rules r
  set tracking_baseline_mileage = case
        when p_mode = 'current' and r.interval_miles is not null then v_vehicle.current_mileage
        else null
      end,
      tracking_baseline_date = case
        when p_mode = 'current' and r.interval_days is not null then current_date
        else null
      end,
      tracking_baseline_engine_hours = case
        when p_mode = 'current' and r.interval_engine_hours is not null then v_engine_hours
        else null
      end,
      updated_at = now()
  where r.organization_id = v_org
    and r.vehicle_id = p_vehicle_id
    and r.active = true;

  -- The existing installer/vehicle trigger historically writes baselines into
  -- last_done_*. Clear only rows without a real completed service record so a
  -- tracking start is never presented as work that was performed.
  update public.maintenance_rule_vehicle_states s
  set last_done_mileage = null,
      last_done_date = null,
      last_done_engine_hours = null,
      updated_at = now()
  where s.organization_id = v_org
    and s.vehicle_id = p_vehicle_id
    and not exists (
      select 1
      from public.maintenance_records mr
      where mr.organization_id = v_org
        and mr.rule_id = s.rule_id
        and mr.vehicle_id = p_vehicle_id
        and mr.deleted_at is null
        and coalesce(mr.status, 'completed') = 'completed'
    );

  update public.maintenance_rules r
  set last_done_mileage = null,
      last_done_date = null,
      last_done_engine_hours = null,
      updated_at = now()
  where r.organization_id = v_org
    and r.vehicle_id = p_vehicle_id
    and r.active = true
    and not exists (
      select 1
      from public.maintenance_records mr
      where mr.organization_id = v_org
        and mr.rule_id = r.id
        and mr.vehicle_id = p_vehicle_id
        and mr.deleted_at is null
        and coalesce(mr.status, 'completed') = 'completed'
    );

  select coalesce(jsonb_agg(x.service_type order by x.service_type), '[]'::jsonb)
    into v_needs_information
  from (
    select distinct r.service_type
    from public.maintenance_rules r
    where r.organization_id = v_org
      and r.active = true
      and (
        (r.vehicle_id = p_vehicle_id)
        or (r.vehicle_id is null and r.vehicle_type = v_vehicle.vehicle_type)
      )
      and (
        p_mode = 'manual'
        or (r.interval_miles is not null and v_vehicle.current_mileage is null)
        or (r.interval_engine_hours is not null and v_engine_hours is null)
      )
  ) x;

  return jsonb_build_object(
    'vehicleId', p_vehicle_id,
    'mode', p_mode,
    'needsInformation', v_needs_information
  );
end;
$$;

revoke execute on function public.initialize_vehicle_maintenance_baseline(uuid,text)
  from public, anon;
grant execute on function public.initialize_vehicle_maintenance_baseline(uuid,text)
  to authenticated;
