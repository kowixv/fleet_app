-- Vehicle-specific reminder creation used only by engine-specific program presets.
-- Common vehicle-type presets continue to use public.save_maintenance_reminder.

create or replace function public.save_vehicle_maintenance_reminder(
  p_vehicle_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := (select public.current_org_id());
  v_user uuid := auth.uid();
  v_vehicle vehicles%rowtype;
  v_service text := nullif(btrim(p_payload->>'service_type'), '');
  v_interval_miles numeric := nullif(p_payload->>'interval_miles', '')::numeric;
  v_interval_days integer := nullif(p_payload->>'interval_days', '')::integer;
  v_interval_engine_hours numeric := nullif(p_payload->>'interval_engine_hours', '')::numeric;
  v_interval_type text;
  v_engine_hours numeric;
  v_rule uuid;
begin
  if v_org is null or not (select public.is_org_writer()) then
    raise exception 'Write permission required.';
  end if;
  if p_vehicle_id is null then
    raise exception 'Vehicle is required.';
  end if;
  if v_service is null
    or length(v_service) < 2
    or length(v_service) > 120
    or v_service ~ '[[:cntrl:]]'
    or v_service !~ '[[:alnum:]]' then
    raise exception 'Valid maintenance type is required.';
  end if;
  if v_interval_miles is null and v_interval_days is null and v_interval_engine_hours is null then
    raise exception 'At least one interval is required.';
  end if;
  if (v_interval_miles is not null and (v_interval_miles <= 0 or v_interval_miles <> trunc(v_interval_miles)))
    or (v_interval_days is not null and v_interval_days <= 0)
    or (v_interval_engine_hours is not null and (v_interval_engine_hours <= 0 or v_interval_engine_hours <> trunc(v_interval_engine_hours))) then
    raise exception 'Intervals must be positive whole numbers.';
  end if;
  if v_interval_miles is null and v_interval_days is null then
    raise exception 'Engine-hours-only reminders are not supported; provide interval_miles or interval_days.';
  end if;

  v_interval_type := case
    when v_interval_miles is not null then 'mileage'
    when v_interval_days is not null then 'date'
  end;

  select * into v_vehicle
  from vehicles
  where id = p_vehicle_id
    and organization_id = v_org
    and status = 'active'
  for update;
  if not found then
    raise exception 'Active vehicle not found.';
  end if;

  select engine_hours into v_engine_hours
  from vehicle_maintenance_profiles
  where organization_id = v_org and vehicle_id = p_vehicle_id;

  perform pg_advisory_xact_lock(
    hashtextextended(
      v_org::text || ':' || p_vehicle_id::text || ':' || public.manual_maintenance_service_key('periodic', v_service),
      0
    )
  );

  select id into v_rule
  from maintenance_rules
  where organization_id = v_org
    and vehicle_id = p_vehicle_id
    and active = true
    and public.manual_maintenance_service_key('periodic', service_type)
      = public.manual_maintenance_service_key('periodic', v_service)
  limit 1
  for update;

  if v_rule is not null then
    return jsonb_build_object('rule_id', v_rule, 'created', false);
  end if;

  insert into maintenance_rules (
    organization_id, vehicle_id, vehicle_type, service_type, interval_type,
    interval_miles, interval_days, interval_engine_hours,
    last_done_mileage, last_done_date, last_done_engine_hours,
    active, service_category, description, checklist_reference,
    template_source, template_applied_by, template_applied_at
  )
  values (
    v_org, p_vehicle_id, null, v_service,
    v_interval_type,
    v_interval_miles, v_interval_days, v_interval_engine_hours,
    case when v_interval_miles is not null then v_vehicle.current_mileage else null end,
    case when v_interval_days is not null then current_date else null end,
    case when v_interval_engine_hours is not null then v_engine_hours else null end,
    true, null, null, null,
    'maintenance_program_installer', v_user, now()
  )
  on conflict do nothing
  returning id into v_rule;

  if v_rule is null then
    select id into v_rule
    from maintenance_rules
    where organization_id = v_org
      and vehicle_id = p_vehicle_id
      and active = true
      and public.manual_maintenance_service_key('periodic', service_type)
        = public.manual_maintenance_service_key('periodic', v_service)
    limit 1;
    if v_rule is null then
      raise exception 'Maintenance reminder could not be created.';
    end if;
    return jsonb_build_object('rule_id', v_rule, 'created', false);
  end if;

  return jsonb_build_object('rule_id', v_rule, 'created', true);
end;
$$;

revoke execute on function public.save_vehicle_maintenance_reminder(uuid,jsonb) from public, anon;
grant execute on function public.save_vehicle_maintenance_reminder(uuid,jsonb) to authenticated;
