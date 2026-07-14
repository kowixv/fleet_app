-- Phase 1 maintenance usability: safe manual record service/type edits.
-- File-only migration artifact; run manually in Supabase SQL Editor.

create or replace function edit_manual_maintenance_record(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := (select current_org_id());
  v_record_id uuid := nullif(p_payload->>'record_id', '')::uuid;
  v_record maintenance_records%rowtype;
  v_performed_date date := nullif(p_payload->>'performed_date', '')::date;
  v_mileage numeric := nullif(p_payload->>'mileage', '')::numeric;
  v_current_mileage numeric := 0;
  v_cost numeric := nullif(p_payload->>'cost', '')::numeric;
  v_kind text := nullif(btrim(p_payload->>'entry_kind'), '');
  v_service text := nullif(btrim(p_payload->>'service_type'), '');
  v_service_key text;
  v_category text := nullif(btrim(p_payload->>'category'), '');
  v_parts text[] := '{}';
  v_part jsonb;
  v_old_rule uuid;
  v_new_rule uuid;
begin
  if v_org is null or not (select is_org_writer()) then
    raise exception 'Write permission required.';
  end if;
  if v_record_id is null then raise exception 'Record is required.'; end if;
  if v_kind not in ('periodic', 'repair') then raise exception 'Invalid maintenance type.'; end if;
  if v_service is null then raise exception 'Service type is required.'; end if;
  if v_performed_date is null then raise exception 'Performed date is required.'; end if;
  if v_mileage is null or v_mileage < 0 or v_mileage <> trunc(v_mileage) then
    raise exception 'Mileage must be a non-negative whole number.';
  end if;
  if coalesce(v_cost, 0) < 0 then raise exception 'Cost cannot be negative.'; end if;

  select * into v_record
  from maintenance_records
  where id = v_record_id
    and organization_id = v_org
    and source = 'manual_maintenance'
    and deleted_at is null
  for update;
  if not found then raise exception 'Manual maintenance record not found.'; end if;

  v_old_rule := v_record.rule_id;

  select current_mileage into v_current_mileage
  from vehicles
  where id = v_record.vehicle_id and organization_id = v_org
  for update;
  if not found then raise exception 'Vehicle not found.'; end if;

  if jsonb_typeof(coalesce(p_payload->'parts_used', '[]'::jsonb)) = 'array' then
    for v_part in select value from jsonb_array_elements(coalesce(p_payload->'parts_used', '[]'::jsonb))
    loop
      if nullif(btrim(v_part #>> '{}'), '') is not null then
        v_parts := array_append(v_parts, btrim(v_part #>> '{}'));
      end if;
    end loop;
  end if;

  if v_kind = 'periodic' then
    v_service_key := manual_maintenance_service_key(v_kind, v_service);
    select id into v_new_rule
    from maintenance_rules
    where organization_id = v_org
      and vehicle_id = v_record.vehicle_id
      and active = true
      and manual_maintenance_service_key(v_kind, service_type) = v_service_key
    limit 1
    for update;
  else
    v_new_rule := null;
  end if;

  update maintenance_records
  set performed_date = v_performed_date,
      mileage = v_mileage,
      service_type = v_service,
      rule_id = v_new_rule,
      planned = (v_kind = 'periodic'),
      category = coalesce(v_category, case when v_kind = 'periodic' then 'routine_pm' else 'other' end),
      cost = coalesce(v_cost, 0),
      total_cost = v_cost,
      shop_name = nullif(btrim(p_payload->>'shop_name'), ''),
      vendor = nullif(btrim(p_payload->>'shop_name'), ''),
      parts_used = v_parts,
      invoice_number = nullif(btrim(p_payload->>'invoice_number'), ''),
      notes = nullif(btrim(p_payload->>'notes'), ''),
      edited_at = now(),
      edited_by = auth.uid()
  where id = v_record_id and organization_id = v_org;

  update vehicle_mileage_logs
  set mileage = v_mileage,
      effective_date = v_performed_date
  where organization_id = v_org and maintenance_record_id = v_record_id and source = 'manual_maintenance';

  if not found then
    insert into vehicle_mileage_logs (organization_id, vehicle_id, mileage, source, effective_date, maintenance_record_id)
    values (v_org, v_record.vehicle_id, v_mileage, 'manual_maintenance', v_performed_date, v_record_id);
  end if;

  if v_mileage > coalesce(v_current_mileage, 0) then
    update vehicles
    set current_mileage = v_mileage
    where id = v_record.vehicle_id and organization_id = v_org and coalesce(current_mileage, 0) < v_mileage;
  end if;

  if v_old_rule is not null and (v_new_rule is null or v_new_rule <> v_old_rule) then
    perform recalculate_maintenance_rule_baseline(v_old_rule);
  end if;

  if v_new_rule is not null then
    perform recalculate_maintenance_rule_baseline(v_new_rule);
  end if;

  return jsonb_build_object(
    'record_id', v_record_id,
    'old_rule_id', v_old_rule,
    'new_rule_id', v_new_rule,
    'old_rule_recalculated', v_old_rule is not null and (v_new_rule is null or v_new_rule <> v_old_rule),
    'new_rule_recalculated', v_new_rule is not null
  );
end;
$$;

revoke execute on function edit_manual_maintenance_record(jsonb) from public, anon;
grant execute on function edit_manual_maintenance_record(jsonb) to authenticated;
