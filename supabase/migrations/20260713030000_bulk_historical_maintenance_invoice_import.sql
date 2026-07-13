-- Bulk historical maintenance invoice import.
-- Ordered after maintenance cost analytics because it depends on invoice review,
-- combined rules, mileage audit logs, templates and cost fields.

create table if not exists maintenance_invoice_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  status text not null default 'pending_review',
  source text not null default 'bulk_historical_invoice_import',
  summary jsonb not null default '{}'::jsonb,
  created_by uuid references profiles (id) on delete set null,
  completed_by uuid references profiles (id) on delete set null,
  completed_at timestamptz,
  undone_by uuid references profiles (id) on delete set null,
  undone_at timestamptz,
  created_at timestamptz not null default now(),
  constraint maintenance_invoice_batches_org_id_key unique (organization_id, id),
  constraint maintenance_invoice_batches_status_chk check (status in ('pending_review','completed','failed','cancelled'))
);

alter table maintenance_invoice_batches enable row level security;
drop policy if exists maintenance_invoice_batches_select on maintenance_invoice_batches;
drop policy if exists maintenance_invoice_batches_insert on maintenance_invoice_batches;
drop policy if exists maintenance_invoice_batches_update on maintenance_invoice_batches;
create policy maintenance_invoice_batches_select on maintenance_invoice_batches
  for select using (organization_id = current_org_id());
create policy maintenance_invoice_batches_insert on maintenance_invoice_batches
  for insert with check (organization_id = current_org_id() and is_org_writer());
create policy maintenance_invoice_batches_update on maintenance_invoice_batches
  for update using (organization_id = current_org_id() and is_org_writer())
  with check (organization_id = current_org_id() and is_org_writer());

alter table maintenance_invoices add column if not exists import_batch_id uuid;
alter table maintenance_invoices add column if not exists bulk_unit_number text;
alter table maintenance_invoices add column if not exists bulk_warnings text[] not null default '{}'::text[];
alter table maintenance_records add column if not exists import_batch_id uuid;
alter table maintenance_rules add column if not exists bulk_import_batch_id uuid;
alter table vehicle_mileage_logs add column if not exists import_batch_id uuid;
alter table vehicle_mileage_logs add column if not exists invoice_id uuid;
alter table vehicle_mileage_logs add column if not exists effective_date date;
alter table vehicles add column if not exists bulk_import_batch_id uuid;
alter table vehicles add column if not exists bulk_import_created boolean not null default false;
alter table vehicle_maintenance_profiles add column if not exists bulk_import_batch_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'maintenance_invoices_batch_fk') then
    alter table maintenance_invoices
      add constraint maintenance_invoices_batch_fk
      foreign key (organization_id, import_batch_id)
      references maintenance_invoice_batches (organization_id, id) on delete set null not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'maintenance_records_batch_fk') then
    alter table maintenance_records
      add constraint maintenance_records_batch_fk
      foreign key (organization_id, import_batch_id)
      references maintenance_invoice_batches (organization_id, id) on delete set null not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vehicle_mileage_logs_invoice_fk') then
    alter table vehicle_mileage_logs
      add constraint vehicle_mileage_logs_invoice_fk
      foreign key (organization_id, invoice_id)
      references maintenance_invoices (organization_id, id) on delete set null not valid;
  end if;
end $$;

create index if not exists maintenance_invoices_batch_idx on maintenance_invoices (organization_id, import_batch_id);
create index if not exists maintenance_records_batch_idx on maintenance_records (organization_id, import_batch_id);
create index if not exists maintenance_rules_bulk_batch_idx on maintenance_rules (organization_id, bulk_import_batch_id);
create index if not exists vehicle_mileage_logs_batch_idx on vehicle_mileage_logs (organization_id, import_batch_id);
create unique index if not exists vehicle_mileage_logs_invoice_mileage_once_idx
  on vehicle_mileage_logs (organization_id, vehicle_id, invoice_id, mileage)
  where invoice_id is not null;

create table if not exists maintenance_service_aliases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  alias_key text not null,
  alias_label text not null,
  mapped_service_type text,
  history_only boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  constraint maintenance_service_aliases_unique unique (organization_id, alias_key)
);

alter table maintenance_service_aliases enable row level security;
drop policy if exists maintenance_service_aliases_select on maintenance_service_aliases;
drop policy if exists maintenance_service_aliases_insert on maintenance_service_aliases;
drop policy if exists maintenance_service_aliases_update on maintenance_service_aliases;
create policy maintenance_service_aliases_select on maintenance_service_aliases
  for select using (organization_id = current_org_id());
create policy maintenance_service_aliases_insert on maintenance_service_aliases
  for insert with check (organization_id = current_org_id() and is_org_writer());
create policy maintenance_service_aliases_update on maintenance_service_aliases
  for update using (organization_id = current_org_id() and is_org_writer())
  with check (organization_id = current_org_id() and is_org_writer());

create or replace function seed_bulk_maintenance_service_aliases(p_org uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into maintenance_service_aliases (organization_id, alias_key, alias_label, mapped_service_type, history_only, notes)
  values
    (p_org, maintenance_service_key('Oil Change'), 'Oil Change', 'Wet PM / Oil Service', false, null),
    (p_org, maintenance_service_key('Engine Oil and Filter'), 'Engine Oil and Filter', 'Wet PM / Oil Service', false, null),
    (p_org, maintenance_service_key('Lube Service'), 'Lube Service', 'Wet PM / Oil Service', false, null),
    (p_org, maintenance_service_key('PM Service'), 'PM Service', 'PM-A', false, null),
    (p_org, maintenance_service_key('Preventive Maintenance A'), 'Preventive Maintenance A', 'PM-A', false, null),
    (p_org, maintenance_service_key('PM-B Service'), 'PM-B Service', 'PM-B', false, null),
    (p_org, maintenance_service_key('Engine Air Filter Replacement'), 'Engine Air Filter Replacement', 'Engine Air Filter', false, null),
    (p_org, maintenance_service_key('Cabin Air Filter Replacement'), 'Cabin Air Filter Replacement', 'Cabin Air Filter Inspection/Replacement', false, null),
    (p_org, maintenance_service_key('DEF Filter Replacement'), 'DEF Filter Replacement', 'DEF Filter', false, null),
    (p_org, maintenance_service_key('Valve Adjustment'), 'Valve Adjustment', 'Valve Overhead', false, null),
    (p_org, maintenance_service_key('Overhead Adjustment'), 'Overhead Adjustment', 'Valve Overhead', false, null),
    (p_org, maintenance_service_key('DOT Inspection'), 'DOT Inspection', 'DOT Annual', false, null),
    (p_org, maintenance_service_key('Annual DOT'), 'Annual DOT', 'DOT Annual', false, null),
    (p_org, maintenance_service_key('Air Dryer Cartridge Replacement'), 'Air Dryer Cartridge Replacement', 'Air Dryer', false, null),
    (p_org, maintenance_service_key('Drive Axle Oil Change'), 'Drive Axle Oil Change', 'Synthetic Drive Axle Oil', false, null),
    (p_org, maintenance_service_key('Coolant Refill'), 'Coolant Refill', null, true, 'History only; do not map to coolant chemistry test.'),
    (p_org, maintenance_service_key('DPF Regeneration'), 'DPF Regeneration', null, true, 'History only; do not map to DPF interval.'),
    (p_org, maintenance_service_key('Electrical Repair'), 'Electrical Repair', null, true, 'History only.'),
    (p_org, maintenance_service_key('Suspension Repair'), 'Suspension Repair', null, true, 'History only.'),
    (p_org, maintenance_service_key('Towing'), 'Towing', null, true, 'History only.')
  on conflict (organization_id, alias_key) do update set
    alias_label = excluded.alias_label,
    mapped_service_type = excluded.mapped_service_type,
    history_only = excluded.history_only,
    notes = excluded.notes;
end;
$$;

do $$
declare
  v_org uuid;
begin
  for v_org in select id from organizations loop
    perform seed_bulk_maintenance_service_aliases(v_org);
  end loop;
end $$;

create or replace function canonical_unit_number(p_value text)
returns text
language sql
immutable
as $$
  select nullif(upper(regexp_replace(regexp_replace(btrim(coalesce(p_value, '')), '^(unit|truck|tractor|vehicle|veh|#)\s*[:#-]?\s*', '', 'i'), '\s+', '', 'g')), '')
$$;

create unique index if not exists vehicles_org_canonical_unit_unique_idx
  on vehicles (organization_id, canonical_unit_number(unit_number))
  where canonical_unit_number(unit_number) is not null;

create unique index if not exists vehicles_org_vin_unique_idx
  on vehicles (organization_id, upper(vin))
  where vin is not null and btrim(vin) <> '';

create or replace function finalize_bulk_maintenance_invoice_unit(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := (select current_org_id());
  v_user uuid := auth.uid();
  v_batch uuid := coalesce(nullif(p_payload->>'batch_id', '')::uuid, gen_random_uuid());
  v_unit text := canonical_unit_number(p_payload->>'canonical_unit_number');
  v_vehicle uuid := nullif(p_payload->>'vehicle_id', '')::uuid;
  v_vin text := nullif(upper(btrim(p_payload->>'vin')), '');
  v_template maintenance_templates%rowtype;
  v_invoice_id uuid;
  v_invoice maintenance_invoices%rowtype;
  v_record jsonb;
  v_baseline jsonb;
  v_template_item jsonb;
  v_rule uuid;
  v_parts text[];
  v_mileage numeric;
  v_target_mileage numeric := nullif(p_payload->>'proposed_current_mileage', '')::numeric;
  v_existing_mileage numeric := 0;
  v_prior_completed_mileage numeric := 0;
  v_history_count integer := 0;
  v_baseline_count integer := 0;
  v_rules_created integer := 0;
  v_logs_created integer := 0;
  v_inserted integer := 0;
  v_vehicle_created boolean := false;
begin
  if v_org is null or not (select is_org_writer()) then
    raise exception 'Write permission required.';
  end if;
  if v_unit is null then raise exception 'Canonical unit number is required.'; end if;
  if coalesce((p_payload->>'auto_create_vehicle')::boolean, true) = false and v_vehicle is null then
    raise exception 'Vehicle selection is required when auto-create is disabled.';
  end if;

  insert into maintenance_invoice_batches (id, organization_id, status, source, created_by)
  values (v_batch, v_org, 'pending_review', 'bulk_historical_invoice_import', v_user)
  on conflict (id) do nothing;

  perform seed_bulk_maintenance_service_aliases(v_org);

  if v_vehicle is null and v_vin is not null then
    select id into v_vehicle
    from vehicles
    where organization_id = v_org and upper(coalesce(vin, '')) = v_vin
    limit 1
    for update;
  end if;

  if v_vehicle is null then
    select id into v_vehicle
    from vehicles
    where organization_id = v_org and canonical_unit_number(unit_number) = v_unit
    limit 1
    for update;
  end if;

  if v_vehicle is null then
    begin
      insert into vehicles (
        organization_id, unit_number, vehicle_type, ownership_type,
        vin, year, make, model, current_mileage, status,
        notes, bulk_import_batch_id, bulk_import_created
      ) values (
        v_org, v_unit, 'truck', 'company_owned',
        v_vin, 2023, 'Peterbilt', '579', 0, 'active',
        'Bulk historical maintenance invoice import ' || v_batch,
        v_batch, true
      ) returning id into v_vehicle;
      v_vehicle_created := true;
    exception when unique_violation then
      select id into v_vehicle
      from vehicles
      where organization_id = v_org
        and (
          canonical_unit_number(unit_number) = v_unit
          or (v_vin is not null and upper(coalesce(vin, '')) = v_vin)
        )
      limit 1
      for update;
      v_vehicle_created := false;
      if v_vehicle is null then
        raise;
      end if;
    end;
  end if;

  select coalesce(current_mileage, 0) into v_existing_mileage
  from vehicles
  where organization_id = v_org and id = v_vehicle
  for update;
  if not found then raise exception 'Vehicle not found.'; end if;

  select coalesce(max(mileage), 0) into v_prior_completed_mileage
  from maintenance_records
  where organization_id = v_org
    and vehicle_id = v_vehicle
    and invoice_id is not null
    and mileage is not null;

  if v_target_mileage is null then v_target_mileage := v_existing_mileage; end if;
  v_target_mileage := greatest(v_target_mileage, v_existing_mileage, v_prior_completed_mileage);
  if v_target_mileage < v_existing_mileage then v_target_mileage := v_existing_mileage; end if;

  insert into vehicle_maintenance_profiles (
    organization_id, vehicle_id, vin, model_year, make, model,
    engine_model, duty_cycle, updated_by, bulk_import_batch_id
  ) values (
    v_org, v_vehicle, v_vin, 2023, 'Peterbilt', '579',
    'Cummins X15 EPA21', 'normal_otr', v_user, v_batch
  )
  on conflict (organization_id, vehicle_id) do update set
    vin = coalesce(vehicle_maintenance_profiles.vin, excluded.vin),
    model_year = coalesce(vehicle_maintenance_profiles.model_year, 2023),
    make = coalesce(vehicle_maintenance_profiles.make, 'Peterbilt'),
    model = coalesce(vehicle_maintenance_profiles.model, '579'),
    engine_model = coalesce(vehicle_maintenance_profiles.engine_model, 'Cummins X15 EPA21'),
    updated_by = excluded.updated_by,
    updated_at = now(),
    bulk_import_batch_id = excluded.bulk_import_batch_id;

  select * into v_template
  from maintenance_templates
  where organization_id = v_org and name = '2023 Peterbilt 579 + Cummins X15 EPA21'
  limit 1;

  if coalesce((p_payload->>'apply_template')::boolean, true) and v_template.id is not null then
    for v_template_item in
      select to_jsonb(ti.*) || jsonb_build_object('enabled', true, 'template_item_id', ti.id)
      from maintenance_template_items ti
      where ti.organization_id = v_org and ti.template_id = v_template.id and ti.active = true
      order by ti.sort_order
    loop
      select id into v_rule
      from maintenance_rules
      where organization_id = v_org and vehicle_id = v_vehicle and active = true
        and maintenance_service_key(service_type) = maintenance_service_key(v_template_item->>'service_type')
      limit 1
      for update;
      if v_rule is null then
        insert into maintenance_rules (
          organization_id, vehicle_id, service_type, interval_type,
          interval_miles, interval_days, interval_engine_hours,
          last_done_mileage, last_done_date, last_done_engine_hours,
          active, service_category, description, checklist_reference,
          template_id, template_item_id, template_source, template_applied_by,
          template_applied_at, bulk_import_batch_id
        ) values (
          v_org, v_vehicle, v_template_item->>'service_type',
          case when nullif(v_template_item->>'interval_miles', '') is not null then 'mileage' else 'date' end,
          nullif(v_template_item->>'interval_miles', '')::numeric,
          nullif(v_template_item->>'interval_days', '')::integer,
          nullif(v_template_item->>'interval_engine_hours', '')::numeric,
          0, null, 0, true,
          nullif(v_template_item->>'service_category', ''),
          nullif(v_template_item->>'description', ''),
          nullif(v_template_item->>'default_checklist_reference', ''),
          v_template.id,
          nullif(v_template_item->>'id', '')::uuid,
          v_template.name,
          v_user,
          now(),
          v_batch
        );
        v_rules_created := v_rules_created + 1;
      end if;
    end loop;
  end if;

  for v_invoice_id in select value::text::uuid from jsonb_array_elements_text(coalesce(p_payload->'invoice_ids', '[]'::jsonb))
  loop
    select * into v_invoice
    from maintenance_invoices
    where id = v_invoice_id and organization_id = v_org and status = 'pending_review'
    for update;
    if not found then
      continue;
    end if;
    update maintenance_invoices set
      vehicle_id = v_vehicle,
      import_batch_id = v_batch,
      bulk_unit_number = v_unit
    where id = v_invoice_id and organization_id = v_org;
  end loop;

  for v_record in select value from jsonb_array_elements(coalesce(p_payload->'records', '[]'::jsonb))
  loop
    if coalesce((v_record->>'exclude')::boolean, false) then continue; end if;
    v_invoice_id := nullif(v_record->>'invoice_id', '')::uuid;
    select * into v_invoice
    from maintenance_invoices
    where id = v_invoice_id and organization_id = v_org
    for update;
    if not found then raise exception 'Invoice not found for history record.'; end if;

    select coalesce(array_agg(distinct btrim(value)), '{}'::text[])
      into v_parts
    from jsonb_array_elements_text(coalesce(v_record->'parts_used', '[]'::jsonb))
    where btrim(value) <> '';
    v_mileage := nullif(v_record->>'mileage', '')::numeric;

    insert into maintenance_records (
      organization_id, vehicle_id, invoice_id, service_type,
      performed_date, mileage, cost, shop_name, part_name, parts_used, notes,
      source, created_by, category, planned, status,
      parts_cost, labor_cost, shop_fees, tax_cost, towing_cost,
      road_service_cost, hotel_travel_cost, other_cost, warranty_recovery,
      total_cost, vendor, invoice_hash, import_batch_id
    )
    select
      v_org, v_vehicle, v_invoice_id, v_record->>'service_type',
      nullif(v_record->>'performed_date', '')::date, v_mileage,
      coalesce(nullif(v_record->>'total_cost', '')::numeric, nullif(v_record->>'cost', '')::numeric, 0),
      nullif(coalesce(v_record->>'shop_name', v_invoice.shop_name), ''),
      nullif(v_record->>'part_name', ''),
      coalesce(v_parts, '{}'::text[]),
      nullif(v_record->>'notes', ''),
      'bulk_invoice', v_user,
      coalesce(nullif(v_record->>'category', ''), 'other'),
      coalesce((v_record->>'planned')::boolean, false),
      coalesce(nullif(v_record->>'status', ''), 'completed'),
      coalesce(nullif(v_record->>'parts_cost', '')::numeric, 0),
      coalesce(nullif(v_record->>'labor_cost', '')::numeric, 0),
      coalesce(nullif(v_record->>'shop_fees', '')::numeric, 0),
      coalesce(nullif(v_record->>'tax_cost', '')::numeric, 0),
      coalesce(nullif(v_record->>'towing_cost', '')::numeric, 0),
      coalesce(nullif(v_record->>'road_service_cost', '')::numeric, 0),
      coalesce(nullif(v_record->>'hotel_travel_cost', '')::numeric, 0),
      coalesce(nullif(v_record->>'other_cost', '')::numeric, 0),
      coalesce(abs(nullif(v_record->>'warranty_recovery', '')::numeric), 0),
      coalesce(nullif(v_record->>'total_cost', '')::numeric, nullif(v_record->>'cost', '')::numeric, 0),
      nullif(coalesce(v_record->>'vendor', v_invoice.shop_name), ''),
      v_invoice.file_hash,
      v_batch
    where not exists (
      select 1 from maintenance_records
      where organization_id = v_org
        and invoice_id = v_invoice_id
        and vehicle_id = v_vehicle
        and maintenance_service_key(service_type) = maintenance_service_key(v_record->>'service_type')
        and coalesce(mileage, -1) = coalesce(v_mileage, -1)
        and coalesce(performed_date, date '1900-01-01') = coalesce(nullif(v_record->>'performed_date', '')::date, date '1900-01-01')
    );
    get diagnostics v_inserted = row_count;
    v_history_count := v_history_count + v_inserted;

    if v_mileage is not null then
      insert into vehicle_mileage_logs (organization_id, vehicle_id, mileage, source, import_batch_id, invoice_id, effective_date)
      values (v_org, v_vehicle, v_mileage, 'bulk_invoice', v_batch, v_invoice_id, nullif(v_record->>'performed_date', '')::date)
      on conflict do nothing;
      get diagnostics v_inserted = row_count;
      v_logs_created := v_logs_created + v_inserted;
    end if;
  end loop;

  for v_baseline in select value from jsonb_array_elements(coalesce(p_payload->'baselines', '[]'::jsonb))
  loop
    select id into v_rule
    from maintenance_rules
    where organization_id = v_org and vehicle_id = v_vehicle and active = true
      and maintenance_service_key(service_type) = maintenance_service_key(v_baseline->>'service_type')
    limit 1
    for update;
    if v_rule is null then
      continue;
    end if;
    update maintenance_rules set
      last_done_date = nullif(v_baseline->>'last_done_date', '')::date,
      last_done_mileage = nullif(v_baseline->>'last_done_mileage', '')::numeric,
      last_done_engine_hours = coalesce(nullif(v_baseline->>'last_done_engine_hours', '')::numeric, last_done_engine_hours),
      updated_by_invoice_id = nullif(v_baseline->>'invoice_id', '')::uuid,
      bulk_import_batch_id = v_batch
    where id = v_rule
      and organization_id = v_org
      and (
        last_done_date is null
        or (
          nullif(v_baseline->>'last_done_date', '')::date is not null
          and nullif(v_baseline->>'last_done_date', '')::date >= last_done_date
          and coalesce(nullif(v_baseline->>'last_done_mileage', '')::numeric, coalesce(last_done_mileage, 0)) >= coalesce(last_done_mileage, 0)
        )
        or (
          nullif(v_baseline->>'last_done_date', '') is null
          and last_done_date is null
          and coalesce(nullif(v_baseline->>'last_done_mileage', '')::numeric, 0) >= coalesce(last_done_mileage, 0)
        )
      );
    get diagnostics v_inserted = row_count;
    v_baseline_count := v_baseline_count + v_inserted;
  end loop;

  if v_target_mileage > v_existing_mileage then
    perform set_vehicle_mileage(v_vehicle, v_target_mileage, 'bulk_invoice', v_org);
    update vehicle_mileage_logs
    set import_batch_id = v_batch
    where organization_id = v_org and vehicle_id = v_vehicle and mileage = v_target_mileage and source = 'bulk_invoice';
  end if;

  update maintenance_invoices set
    status = 'completed',
    completed_by = v_user,
    completed_at = now(),
    import_batch_id = v_batch,
    vehicle_id = v_vehicle,
    parsed_data = jsonb_set(coalesce(parsed_data, '{}'::jsonb), '{bulk_final_review}', p_payload, true)
  where organization_id = v_org and id in (
    select value::text::uuid from jsonb_array_elements_text(coalesce(p_payload->'invoice_ids', '[]'::jsonb))
  );

  update maintenance_invoice_batches set
    status = 'completed',
    completed_by = v_user,
    completed_at = now(),
    summary = jsonb_build_object(
      'vehicle_id', v_vehicle,
      'unit_number', v_unit,
      'vehicle_created', v_vehicle_created,
      'history_records_created', v_history_count,
      'rules_created', v_rules_created,
      'baselines_updated', v_baseline_count,
      'mileage_advanced_to', v_target_mileage
    )
  where organization_id = v_org and id = v_batch;

  return jsonb_build_object(
    'batch_id', v_batch,
    'vehicle_id', v_vehicle,
    'unit_number', v_unit,
    'vehicle_created', v_vehicle_created,
    'history_records_created', v_history_count,
    'rules_created', v_rules_created,
    'baselines_updated', v_baseline_count,
    'mileage_advanced_to', v_target_mileage
  );
end;
$$;

revoke execute on function finalize_bulk_maintenance_invoice_unit(jsonb) from public, anon;
grant execute on function finalize_bulk_maintenance_invoice_unit(jsonb) to authenticated;

create or replace function undo_bulk_maintenance_invoice_batch(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := (select current_org_id());
  v_user uuid := auth.uid();
  v_deleted_records integer := 0;
  v_deleted_logs integer := 0;
  v_disabled_rules integer := 0;
  v_deleted_vehicles integer := 0;
begin
  if v_org is null or not (select is_org_writer()) then
    raise exception 'Write permission required.';
  end if;

  delete from maintenance_records
  where organization_id = v_org and import_batch_id = p_batch_id;
  get diagnostics v_deleted_records = row_count;

  delete from vehicle_mileage_logs
  where organization_id = v_org and import_batch_id = p_batch_id;
  get diagnostics v_deleted_logs = row_count;

  update maintenance_rules
  set active = false
  where organization_id = v_org and bulk_import_batch_id = p_batch_id
    and not exists (
      select 1 from maintenance_records r
      where r.organization_id = maintenance_rules.organization_id
        and r.rule_id = maintenance_rules.id
        and r.import_batch_id is distinct from p_batch_id
    );
  get diagnostics v_disabled_rules = row_count;

  update maintenance_invoices
  set status = 'cancelled',
      undone_by = v_user,
      undone_at = now()
  where organization_id = v_org and import_batch_id = p_batch_id;

  delete from vehicles v
  where v.organization_id = v_org
    and v.bulk_import_batch_id = p_batch_id
    and v.bulk_import_created = true
    and not exists (select 1 from maintenance_records r where r.organization_id = v.organization_id and r.vehicle_id = v.id)
    and not exists (select 1 from loads l where l.organization_id = v.organization_id and l.vehicle_id = v.id)
    and not exists (select 1 from expenses e where e.organization_id = v.organization_id and e.vehicle_id = v.id);
  get diagnostics v_deleted_vehicles = row_count;

  update maintenance_invoice_batches
  set status = 'cancelled', undone_by = v_user, undone_at = now()
  where organization_id = v_org and id = p_batch_id;

  return jsonb_build_object(
    'records_deleted', v_deleted_records,
    'mileage_logs_deleted', v_deleted_logs,
    'rules_disabled', v_disabled_rules,
    'vehicles_deleted', v_deleted_vehicles
  );
end;
$$;

revoke execute on function undo_bulk_maintenance_invoice_batch(uuid) from public, anon;
grant execute on function undo_bulk_maintenance_invoice_batch(uuid) to authenticated;
