-- Manual maintenance daily workflow.
-- File-only migration artifact; run manually in Supabase SQL Editor.

alter table maintenance_records add column if not exists manual_submission_key text;
alter table maintenance_records add column if not exists invoice_number text;
alter table maintenance_records add column if not exists deleted_at timestamptz;
alter table maintenance_records add column if not exists deleted_by uuid references profiles (id) on delete set null;
alter table maintenance_records add column if not exists edited_by uuid references profiles (id) on delete set null;
alter table maintenance_records add column if not exists edited_at timestamptz;

alter table vehicle_mileage_logs add column if not exists effective_date date;
alter table vehicle_mileage_logs add column if not exists maintenance_record_id uuid;
alter table vehicle_mileage_logs add column if not exists manual_submission_key text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vehicle_mileage_logs_record_same_org_fk') then
    alter table vehicle_mileage_logs
      add constraint vehicle_mileage_logs_record_same_org_fk
      foreign key (organization_id, maintenance_record_id)
      references maintenance_records (organization_id, id) on delete set null not valid;
  end if;
end $$;

create unique index if not exists maintenance_records_manual_submission_key_idx
  on maintenance_records (organization_id, manual_submission_key)
  where manual_submission_key is not null;

create unique index if not exists vehicle_mileage_logs_manual_submission_key_idx
  on vehicle_mileage_logs (organization_id, manual_submission_key)
  where manual_submission_key is not null;

create index if not exists maintenance_records_deleted_idx
  on maintenance_records (organization_id, deleted_at, vehicle_id, performed_date desc);

create or replace function canonical_unit_number(p_value text)
returns text
language sql
immutable
as $$
  select nullif(upper(regexp_replace(regexp_replace(btrim(coalesce(p_value, '')), '^(unit|truck|tractor|vehicle|veh|#)\s*[:#-]?\s*', '', 'i'), '\s+', '', 'g')), '')
$$;

create or replace function recalculate_maintenance_rule_baseline(p_rule_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := (select current_org_id());
  v_rule maintenance_rules%rowtype;
  v_record maintenance_records%rowtype;
begin
  if v_org is null or not (select is_org_writer()) then
    raise exception 'Write permission required.';
  end if;

  select * into v_rule
  from maintenance_rules
  where id = p_rule_id and organization_id = v_org
  for update;
  if not found then raise exception 'Maintenance rule not found.'; end if;

  select * into v_record
  from maintenance_records
  where organization_id = v_org
    and rule_id = p_rule_id
    and deleted_at is null
    and coalesce(status, 'completed') = 'completed'
    and performed_date is not null
    and mileage is not null
  order by performed_date desc, mileage desc, created_at desc
  limit 1;

  if found then
    update maintenance_rules
    set last_done_date = v_record.performed_date,
        last_done_mileage = v_record.mileage
    where id = p_rule_id and organization_id = v_org;
    return jsonb_build_object('rule_id', p_rule_id, 'baseline_record_id', v_record.id);
  end if;

  return jsonb_build_object('rule_id', p_rule_id, 'baseline_record_id', null);
end;
$$;

revoke execute on function recalculate_maintenance_rule_baseline(uuid) from public, anon;
grant execute on function recalculate_maintenance_rule_baseline(uuid) to authenticated;

create or replace function manual_maintenance_service_key(p_kind text, p_service text)
returns text
language sql
immutable
as $$
  select case
    when p_kind = 'periodic' and maintenance_service_key(p_service) in (
      maintenance_service_key('Engine Air Filter'),
      maintenance_service_key('Engine Air Filter Replacement')
    ) then maintenance_service_key('Engine Air Filter')
    when p_kind = 'periodic' and maintenance_service_key(p_service) in (
      maintenance_service_key('Cabin Air Filter'),
      maintenance_service_key('Cabin Air Filter Replacement'),
      maintenance_service_key('Cabin Air Filter Inspection/Replacement')
    ) then maintenance_service_key('Cabin Air Filter Inspection/Replacement')
    when p_kind = 'periodic' and maintenance_service_key(p_service) in (
      maintenance_service_key('DOT Annual'),
      maintenance_service_key('DOT Inspection'),
      maintenance_service_key('Annual DOT'),
      maintenance_service_key('Annual Inspection')
    ) then maintenance_service_key('DOT Annual')
    when p_kind = 'periodic' and maintenance_service_key(p_service) in (
      maintenance_service_key('Drive Axle Oil'),
      maintenance_service_key('Drive Axle Oil Change'),
      maintenance_service_key('Synthetic Drive Axle Oil')
    ) then maintenance_service_key('Synthetic Drive Axle Oil')
    else maintenance_service_key(p_service)
  end
$$;

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
  v_create_missing_rule boolean := coalesce((p_payload->>'create_missing_rule')::boolean, false);
  v_rule uuid;
  v_template maintenance_templates%rowtype;
  v_template_item maintenance_template_items%rowtype;
  v_engine_hours numeric;
  v_record uuid;
  v_existing uuid;
  v_rule_created boolean := false;
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

  select v.current_mileage, p.engine_hours
    into v_current_mileage, v_engine_hours
  from vehicles v
  left join vehicle_maintenance_profiles p on p.organization_id = v.organization_id and p.vehicle_id = v.id
  where v.id = v_vehicle and v.organization_id = v_org
  for update of v;
  if not found then raise exception 'Vehicle not found.'; end if;

  v_service_key := manual_maintenance_service_key(v_kind, v_service);
  if v_kind = 'repair' then
    v_update_plan := false;
    v_create_missing_rule := false;
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
    select id into v_rule
    from maintenance_rules
    where organization_id = v_org
      and vehicle_id = v_vehicle
      and active = true
      and manual_maintenance_service_key(v_kind, service_type) = v_service_key
    limit 1
    for update;

    if v_rule is null and v_create_missing_rule then
      select * into v_template
      from maintenance_templates
      where organization_id = v_org and name = '2023 Peterbilt 579 + Cummins X15 EPA21'
      limit 1;

      if found then
        select * into v_template_item
        from maintenance_template_items
        where organization_id = v_org
          and template_id = v_template.id
          and active = true
          and manual_maintenance_service_key(v_kind, service_type) = v_service_key
        limit 1;

        if found then
          insert into maintenance_rules (
            organization_id, vehicle_id, service_type, interval_type,
            interval_miles, interval_days, interval_engine_hours,
            last_done_mileage, last_done_date, last_done_engine_hours,
            active, service_category, description, checklist_reference,
            template_id, template_item_id, template_source, template_applied_by, template_applied_at
          )
          values (
            v_org, v_vehicle, v_template_item.service_type,
            case when v_template_item.interval_miles is not null then 'mileage' else 'date' end,
            v_template_item.interval_miles, v_template_item.interval_days, v_template_item.interval_engine_hours,
            v_mileage, v_performed_date, v_engine_hours,
            true, v_template_item.service_category, v_template_item.description, v_template_item.default_checklist_reference,
            v_template.id, v_template_item.id, v_template.name, v_user, now()
          )
          on conflict do nothing
          returning id into v_rule;

          if v_rule is null then
            select id into v_rule
            from maintenance_rules
            where organization_id = v_org and vehicle_id = v_vehicle and active = true
              and manual_maintenance_service_key(v_kind, service_type) = v_service_key
            limit 1
            for update;
          else
            v_rule_created := true;
          end if;
        end if;
      end if;
    end if;

    if v_rule is null then
      v_missing_rule := true;
    end if;
  end if;

  insert into maintenance_records (
    organization_id, vehicle_id, rule_id, service_type, performed_date, mileage,
    cost, total_cost, labor_cost, parts_cost, shop_fees, tax_cost,
    shop_name, vendor, parts_used, invoice_number, notes, source, category, planned,
    downtime_start, downtime_end, manual_submission_key, created_by, status
  )
  values (
    v_org, v_vehicle, v_rule, v_service, v_performed_date, v_mileage,
    coalesce(v_cost, v_total_cost, 0), v_total_cost, v_labor_cost, v_parts_cost, v_shop_fees, v_tax_cost,
    nullif(btrim(p_payload->>'shop_name'), ''), nullif(btrim(coalesce(p_payload->>'vendor', p_payload->>'shop_name')), ''),
    v_parts, nullif(btrim(p_payload->>'invoice_number'), ''), nullif(btrim(p_payload->>'notes'), ''),
    'manual_maintenance', nullif(btrim(p_payload->>'category'), ''), coalesce((p_payload->>'planned')::boolean, v_kind = 'periodic'),
    nullif(p_payload->>'downtime_start', '')::timestamptz, nullif(p_payload->>'downtime_end', '')::timestamptz,
    v_submission_key, v_user, 'completed'
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
    update maintenance_rules
    set last_done_date = v_performed_date,
        last_done_mileage = v_mileage,
        last_done_engine_hours = coalesce(v_engine_hours, last_done_engine_hours)
    where id = v_rule and organization_id = v_org;
    v_rule_updated := true;
  end if;

  return jsonb_build_object(
    'record_id', v_record,
    'rule_id', v_rule,
    'rule_created', v_rule_created,
    'rule_updated', v_rule_updated,
    'missing_rule', v_missing_rule,
    'advanced_current_mileage', v_mileage > coalesce(v_current_mileage, 0)
  );
end;
$$;

revoke execute on function save_manual_maintenance(jsonb) from public, anon;
grant execute on function save_manual_maintenance(jsonb) to authenticated;

create or replace function quick_create_maintenance_vehicle(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := (select current_org_id());
  v_user uuid := auth.uid();
  v_unit text := canonical_unit_number(p_payload->>'unit_number');
  v_display_unit text := nullif(btrim(p_payload->>'unit_number'), '');
  v_mileage numeric := coalesce(nullif(p_payload->>'current_mileage', '')::numeric, 0);
  v_vehicle uuid;
  v_template maintenance_templates%rowtype;
  v_item maintenance_template_items%rowtype;
  v_created_rules integer := 0;
  v_created boolean := false;
begin
  if v_org is null or not (select is_org_writer()) then
    raise exception 'Write permission required.';
  end if;
  if v_unit is null then raise exception 'Unit Number is required.'; end if;
  if v_mileage < 0 or v_mileage <> trunc(v_mileage) then raise exception 'Mileage must be a non-negative whole number.'; end if;

  select id into v_vehicle
  from vehicles
  where organization_id = v_org and canonical_unit_number(unit_number) = v_unit
  limit 1
  for update;
  if v_vehicle is not null then
    return jsonb_build_object('vehicle_id', v_vehicle, 'created', false, 'created_rules', 0);
  end if;

  insert into vehicles (organization_id, unit_number, vehicle_type, ownership_type, year, make, model, current_mileage, status)
  values (v_org, coalesce(v_display_unit, v_unit), 'truck', 'company_owned', 2023, 'Peterbilt', '579', v_mileage, 'active')
  returning id into v_vehicle;
  v_created := true;

  insert into vehicle_maintenance_profiles (
    organization_id, vehicle_id, model_year, make, model, engine_model, duty_cycle, updated_by
  )
  values (v_org, v_vehicle, 2023, 'Peterbilt', '579', 'Cummins X15 EPA21', 'normal_otr', v_user)
  on conflict (organization_id, vehicle_id) do nothing;

  insert into vehicle_mileage_logs (organization_id, vehicle_id, mileage, source, effective_date)
  values (v_org, v_vehicle, v_mileage, 'quick_vehicle_create', current_date);

  select * into v_template
  from maintenance_templates
  where organization_id = v_org and name = '2023 Peterbilt 579 + Cummins X15 EPA21'
  limit 1;

  if found then
    for v_item in
      select * from maintenance_template_items
      where organization_id = v_org and template_id = v_template.id and active = true
      order by sort_order
    loop
      insert into maintenance_rules (
        organization_id, vehicle_id, service_type, interval_type,
        interval_miles, interval_days, interval_engine_hours,
        last_done_mileage, last_done_date, last_done_engine_hours,
        active, service_category, description, checklist_reference,
        template_id, template_item_id, template_source, template_applied_by, template_applied_at
      )
      values (
        v_org, v_vehicle, v_item.service_type,
        case when v_item.interval_miles is not null then 'mileage' else 'date' end,
        v_item.interval_miles, v_item.interval_days, v_item.interval_engine_hours,
        v_mileage, null, null,
        true, v_item.service_category, v_item.description, v_item.default_checklist_reference,
        v_template.id, v_item.id, v_template.name, v_user, now()
      )
      on conflict do nothing;
      if found then
        v_created_rules := v_created_rules + 1;
      end if;
    end loop;
  end if;

  return jsonb_build_object('vehicle_id', v_vehicle, 'created', v_created, 'created_rules', v_created_rules);
end;
$$;

revoke execute on function quick_create_maintenance_vehicle(jsonb) from public, anon;
grant execute on function quick_create_maintenance_vehicle(jsonb) to authenticated;

create or replace function delete_manual_maintenance_record(p_record_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := (select current_org_id());
  v_rule uuid;
begin
  if v_org is null or not (select is_org_writer()) then
    raise exception 'Write permission required.';
  end if;

  select rule_id into v_rule
  from maintenance_records
  where id = p_record_id and organization_id = v_org and source = 'manual_maintenance'
  for update;
  if not found then raise exception 'Manual maintenance record not found.'; end if;

  update maintenance_records
  set deleted_at = now(), deleted_by = auth.uid(), status = 'cancelled'
  where id = p_record_id and organization_id = v_org and deleted_at is null;

  if v_rule is not null then
    perform recalculate_maintenance_rule_baseline(v_rule);
  end if;

  return jsonb_build_object('record_id', p_record_id, 'rule_recalculated', v_rule is not null);
end;
$$;

revoke execute on function delete_manual_maintenance_record(uuid) from public, anon;
grant execute on function delete_manual_maintenance_record(uuid) to authenticated;

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
  v_parts text[] := '{}';
  v_part jsonb;
begin
  if v_org is null or not (select is_org_writer()) then
    raise exception 'Write permission required.';
  end if;
  if v_record_id is null then raise exception 'Record is required.'; end if;
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

  update maintenance_records
  set performed_date = v_performed_date,
      mileage = v_mileage,
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

  if v_record.rule_id is not null then
    perform recalculate_maintenance_rule_baseline(v_record.rule_id);
  end if;

  return jsonb_build_object('record_id', v_record_id, 'rule_recalculated', v_record.rule_id is not null);
end;
$$;

revoke execute on function edit_manual_maintenance_record(jsonb) from public, anon;
grant execute on function edit_manual_maintenance_record(jsonb) to authenticated;
