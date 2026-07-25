-- Maintenance PR 1: safety holds, inspection draft concurrency, and record parity.
-- Additive and safe for existing linked databases; existing rows are not rewritten.

alter table public.settings
  add column if not exists dispatch_hold_on_critical boolean not null default false;

create table if not exists public.vehicle_dispatch_holds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  vehicle_id uuid not null,
  source_type text not null,
  source_id uuid not null,
  reason text not null,
  severity text not null,
  status text not null default 'open',
  created_by uuid,
  created_at timestamptz not null default now(),
  cleared_by uuid,
  cleared_at timestamptz,
  clearance_notes text,
  updated_at timestamptz not null default now(),
  constraint vehicle_dispatch_holds_org_id_id_key unique (organization_id, id),
  constraint vehicle_dispatch_holds_vehicle_same_org_fk
    foreign key (organization_id, vehicle_id)
    references public.vehicles (organization_id, id) on delete restrict,
  constraint vehicle_dispatch_holds_created_by_same_org_fk
    foreign key (organization_id, created_by)
    references public.profiles (organization_id, id) on delete set null (created_by),
  constraint vehicle_dispatch_holds_cleared_by_same_org_fk
    foreign key (organization_id, cleared_by)
    references public.profiles (organization_id, id) on delete set null (cleared_by),
  constraint vehicle_dispatch_holds_source_type_chk
    check (source_type in ('inspection_finding', 'maintenance_finding', 'manual')),
  constraint vehicle_dispatch_holds_severity_chk
    check (severity in ('critical', 'do_not_dispatch')),
  constraint vehicle_dispatch_holds_status_chk
    check (status in ('open', 'cleared')),
  constraint vehicle_dispatch_holds_reason_chk
    check (length(btrim(reason)) > 0),
  constraint vehicle_dispatch_holds_clearance_chk
    check (
      (status = 'open' and cleared_by is null and cleared_at is null and clearance_notes is null)
      or
      (status = 'cleared' and cleared_by is not null and cleared_at is not null and length(btrim(clearance_notes)) >= 3)
    )
);

create index if not exists vehicle_dispatch_holds_org_vehicle_status_idx
  on public.vehicle_dispatch_holds (organization_id, vehicle_id, status, created_at desc);
create unique index if not exists vehicle_dispatch_holds_one_open_source_idx
  on public.vehicle_dispatch_holds (organization_id, source_type, source_id)
  where status = 'open';

alter table public.vehicle_dispatch_holds enable row level security;

drop policy if exists vehicle_dispatch_holds_select on public.vehicle_dispatch_holds;
drop policy if exists vehicle_dispatch_holds_insert on public.vehicle_dispatch_holds;
drop policy if exists vehicle_dispatch_holds_update on public.vehicle_dispatch_holds;
drop policy if exists vehicle_dispatch_holds_delete on public.vehicle_dispatch_holds;

create policy vehicle_dispatch_holds_select
  on public.vehicle_dispatch_holds for select to authenticated
  using (organization_id = (select public.current_org_id()));
create policy vehicle_dispatch_holds_insert
  on public.vehicle_dispatch_holds for insert to authenticated
  with check (
    organization_id = (select public.current_org_id())
    and (select public.is_org_writer())
  );
create policy vehicle_dispatch_holds_update
  on public.vehicle_dispatch_holds for update to authenticated
  using (
    organization_id = (select public.current_org_id())
    and (select public.is_org_writer())
  )
  with check (
    organization_id = (select public.current_org_id())
    and (select public.is_org_writer())
  );

grant select on table public.vehicle_dispatch_holds to authenticated;
revoke all on table public.vehicle_dispatch_holds from anon;
revoke insert, update, delete on table public.vehicle_dispatch_holds from authenticated;

drop trigger if exists vehicle_dispatch_holds_updated_at on public.vehicle_dispatch_holds;
create trigger vehicle_dispatch_holds_updated_at
  before update on public.vehicle_dispatch_holds
  for each row execute function public.touch_maintenance_updated_at();

create or replace function public.create_dispatch_hold_from_inspection_finding()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := (select public.current_org_id());
  v_hold_critical boolean := false;
begin
  if v_org is null or v_org <> new.organization_id or not (select public.is_org_writer()) then
    raise exception 'Write permission required.';
  end if;

  if new.status <> 'open' or new.severity not in ('critical', 'do_not_dispatch') then
    return new;
  end if;

  if new.severity = 'critical' then
    select coalesce(dispatch_hold_on_critical, false)
      into v_hold_critical
    from public.settings
    where organization_id = new.organization_id;
    if not coalesce(v_hold_critical, false) then return new; end if;
  end if;

  insert into public.vehicle_dispatch_holds (
    organization_id,
    vehicle_id,
    source_type,
    source_id,
    reason,
    severity,
    status,
    created_by
  )
  values (
    new.organization_id,
    new.vehicle_id,
    'inspection_finding',
    new.id,
    coalesce(nullif(btrim(new.label), ''), nullif(btrim(new.notes), ''), 'Kritik inspection bulgusu'),
    new.severity,
    'open',
    coalesce(new.created_by, auth.uid())
  )
  on conflict (organization_id, source_type, source_id) where status = 'open'
  do nothing;

  return new;
end;
$$;

revoke execute on function public.create_dispatch_hold_from_inspection_finding() from public, anon, authenticated;

drop trigger if exists inspection_findings_create_dispatch_hold on public.inspection_findings;
create trigger inspection_findings_create_dispatch_hold
  after insert on public.inspection_findings
  for each row execute function public.create_dispatch_hold_from_inspection_finding();

create or replace function public.enforce_vehicle_dispatch_hold()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.vehicle_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.vehicle_id is not distinct from old.vehicle_id then return new; end if;

  if exists (
    select 1
    from public.vehicle_dispatch_holds h
    where h.organization_id = new.organization_id
      and h.vehicle_id = new.vehicle_id
      and h.status = 'open'
  ) then
    raise exception 'Bu unit için açık SEVKE ÇIKMASIN kaydı var. Hold temizlenmeden yeni yük atanamaz.';
  end if;
  return new;
end;
$$;

revoke execute on function public.enforce_vehicle_dispatch_hold() from public, anon, authenticated;

drop trigger if exists loads_enforce_vehicle_dispatch_hold on public.loads;
create trigger loads_enforce_vehicle_dispatch_hold
  before insert or update of vehicle_id on public.loads
  for each row execute function public.enforce_vehicle_dispatch_hold();

create or replace function public.clear_vehicle_dispatch_hold(
  p_hold_id uuid,
  p_clearance_notes text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := (select public.current_org_id());
  v_notes text := nullif(btrim(p_clearance_notes), '');
begin
  if v_org is null or not (select public.is_org_writer()) then
    raise exception 'Write permission required.';
  end if;
  if p_hold_id is null then raise exception 'Dispatch hold is required.'; end if;
  if v_notes is null or length(v_notes) < 3 then
    raise exception 'Clearance notes are required.';
  end if;

  update public.vehicle_dispatch_holds
  set status = 'cleared',
      cleared_by = auth.uid(),
      cleared_at = now(),
      clearance_notes = v_notes,
      updated_at = now()
  where organization_id = v_org
    and id = p_hold_id
    and status = 'open';

  if not found then raise exception 'Open dispatch hold not found.'; end if;
  return p_hold_id;
end;
$$;

revoke execute on function public.clear_vehicle_dispatch_hold(uuid, text) from public, anon;
grant execute on function public.clear_vehicle_dispatch_hold(uuid, text) to authenticated;

-- Optimistic concurrency: stale autosave requests cannot replace a newer draft.
create or replace function public.save_vehicle_inspection_draft(
  p_inspection_id uuid,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := (select public.current_org_id());
  v_user uuid := auth.uid();
  v_inspection public.vehicle_inspections%rowtype;
  v_expected_updated_at timestamptz := nullif(p_payload->>'expected_updated_at', '')::timestamptz;
  v_result jsonb;
  v_item public.inspection_template_items%rowtype;
begin
  if v_org is null or not (select public.is_org_writer()) then raise exception 'Write permission required.'; end if;

  select * into v_inspection
  from public.vehicle_inspections
  where id = p_inspection_id and organization_id = v_org and status = 'draft'
  for update;
  if not found then raise exception 'Draft inspection not found.'; end if;
  if v_expected_updated_at is not null and v_inspection.updated_at <> v_expected_updated_at then
    raise exception 'Taslak daha yeni bir sürüm tarafından güncellendi. Yenileyip tekrar deneyin.';
  end if;

  update public.vehicle_inspections
  set
    inspection_date = coalesce(nullif(p_payload->>'inspection_date', '')::date, inspection_date),
    inspector = nullif(btrim(p_payload->>'inspector'), ''),
    shop = nullif(btrim(p_payload->>'shop'), ''),
    notes = nullif(btrim(p_payload->>'notes'), ''),
    mark_rule_serviced = coalesce((p_payload->>'mark_rule_serviced')::boolean, mark_rule_serviced),
    updated_by = v_user,
    updated_at = now()
  where id = p_inspection_id and organization_id = v_org and status = 'draft';

  if jsonb_typeof(coalesce(p_payload->'results', '[]'::jsonb)) = 'array' then
    delete from public.vehicle_inspection_results
    where organization_id = v_org and inspection_id = p_inspection_id;

    for v_result in select value from jsonb_array_elements(coalesce(p_payload->'results', '[]'::jsonb))
    loop
      select * into v_item
      from public.inspection_template_items
      where organization_id = v_org
        and template_id = v_inspection.template_id
        and id = nullif(v_result->>'template_item_id', '')::uuid
        and active = true;
      if not found then continue; end if;

      insert into public.vehicle_inspection_results (
        organization_id, inspection_id, template_item_id, template_version,
        section, label, input_type, unit_of_measure, axle_position,
        value_text, value_number, value_bool, passed, notes, photo_storage_path
      ) values (
        v_org, p_inspection_id, v_item.id,
        (select version from public.inspection_templates where organization_id = v_org and id = v_inspection.template_id),
        v_item.section, v_item.label, v_item.input_type, v_item.unit_of_measure, v_item.axle_position,
        nullif(v_result->>'value_text', ''),
        nullif(v_result->>'value_number', '')::numeric,
        nullif(v_result->>'value_bool', '')::boolean,
        nullif(v_result->>'passed', '')::boolean,
        nullif(v_result->>'notes', ''),
        nullif(v_result->>'photo_storage_path', '')
      );
    end loop;
  end if;

  return p_inspection_id;
end;
$$;

revoke execute on function public.save_vehicle_inspection_draft(uuid, jsonb) from public, anon;
grant execute on function public.save_vehicle_inspection_draft(uuid, jsonb) to authenticated;

create or replace function public.validate_maintenance_record_payload(p_payload jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_add_keys text[] := array[
    'parts_cost','labor_cost','diagnostic_cost','shop_fees','tax_cost','towing_cost',
    'road_service_cost','hotel_travel_cost','freight_shipping_cost','core_charge_cost',
    'environmental_fee_cost','machine_shop_cost','sublet_cost','other_cost'
  ];
  v_credit_keys text[] := array['warranty_recovery','refund_credit'];
  v_key text;
  v_value numeric;
  v_total numeric := nullif(v_payload->>'total_cost', '')::numeric;
  v_itemized numeric := 0;
  v_has_items boolean := false;
  v_start timestamptz := nullif(v_payload->>'downtime_start', '')::timestamptz;
  v_end timestamptz := nullif(v_payload->>'downtime_end', '')::timestamptz;
begin
  foreach v_key in array v_add_keys loop
    v_value := nullif(v_payload->>v_key, '')::numeric;
    if v_value is not null then
      if v_value < 0 then raise exception '% cannot be negative.', v_key; end if;
      v_has_items := v_has_items or v_value <> 0;
      v_itemized := v_itemized + v_value;
    end if;
  end loop;
  foreach v_key in array v_credit_keys loop
    v_value := nullif(v_payload->>v_key, '')::numeric;
    if v_value is not null then
      if v_value < 0 then raise exception '% cannot be negative.', v_key; end if;
      v_has_items := v_has_items or v_value <> 0;
      v_itemized := v_itemized - abs(v_value);
    end if;
  end loop;

  v_itemized := round(v_itemized, 2);
  if v_total is not null and v_total < 0 then raise exception 'Total cost cannot be negative.'; end if;
  if v_itemized < 0 then raise exception 'Refund and recovery cannot make total cost negative.'; end if;
  if v_total is not null and v_has_items and abs(v_total - v_itemized) > 0.01 then
    raise exception 'Total cost conflicts with itemized costs.';
  end if;
  if v_total is null and v_has_items then
    v_payload := v_payload || jsonb_build_object('total_cost', v_itemized, 'cost', v_itemized);
  end if;
  if v_start is not null and v_end is not null and v_end < v_start then
    raise exception 'Downtime end cannot be before downtime start.';
  end if;
  return v_payload;
end;
$$;

revoke execute on function public.validate_maintenance_record_payload(jsonb) from public, anon, authenticated;

create or replace function public.save_manual_maintenance_v2(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := (select public.current_org_id());
  v_payload jsonb;
  v_result jsonb;
  v_record_id uuid;
begin
  if v_org is null or not (select public.is_org_writer()) then
    raise exception 'Write permission required.';
  end if;
  v_payload := public.validate_maintenance_record_payload(p_payload);
  v_result := public.save_manual_maintenance(v_payload);
  if coalesce((v_result->>'idempotent')::boolean, false) then return v_result; end if;
  v_record_id := nullif(v_result->>'record_id', '')::uuid;

  update public.maintenance_records
  set
    cost = coalesce(nullif(v_payload->>'cost', '')::numeric, nullif(v_payload->>'total_cost', '')::numeric, 0),
    total_cost = nullif(v_payload->>'total_cost', '')::numeric,
    parts_cost = coalesce(nullif(v_payload->>'parts_cost', '')::numeric, 0),
    labor_cost = coalesce(nullif(v_payload->>'labor_cost', '')::numeric, 0),
    diagnostic_cost = coalesce(nullif(v_payload->>'diagnostic_cost', '')::numeric, 0),
    shop_fees = coalesce(nullif(v_payload->>'shop_fees', '')::numeric, 0),
    tax_cost = coalesce(nullif(v_payload->>'tax_cost', '')::numeric, 0),
    towing_cost = coalesce(nullif(v_payload->>'towing_cost', '')::numeric, 0),
    road_service_cost = coalesce(nullif(v_payload->>'road_service_cost', '')::numeric, 0),
    hotel_travel_cost = coalesce(nullif(v_payload->>'hotel_travel_cost', '')::numeric, 0),
    freight_shipping_cost = coalesce(nullif(v_payload->>'freight_shipping_cost', '')::numeric, 0),
    core_charge_cost = coalesce(nullif(v_payload->>'core_charge_cost', '')::numeric, 0),
    environmental_fee_cost = coalesce(nullif(v_payload->>'environmental_fee_cost', '')::numeric, 0),
    machine_shop_cost = coalesce(nullif(v_payload->>'machine_shop_cost', '')::numeric, 0),
    sublet_cost = coalesce(nullif(v_payload->>'sublet_cost', '')::numeric, 0),
    other_cost = coalesce(nullif(v_payload->>'other_cost', '')::numeric, 0),
    warranty_recovery = coalesce(nullif(v_payload->>'warranty_recovery', '')::numeric, 0),
    refund_credit = coalesce(nullif(v_payload->>'refund_credit', '')::numeric, 0),
    downtime_start = nullif(v_payload->>'downtime_start', '')::timestamptz,
    downtime_end = nullif(v_payload->>'downtime_end', '')::timestamptz,
    category = nullif(btrim(v_payload->>'category'), ''),
    cause = nullif(btrim(v_payload->>'cause'), ''),
    breakdown_occurred = coalesce((v_payload->>'breakdown_occurred')::boolean, false),
    planned = coalesce((v_payload->>'planned')::boolean, (v_payload->>'entry_kind') = 'periodic')
  where organization_id = v_org and id = v_record_id and source = 'manual_maintenance';

  return v_result;
end;
$$;

revoke execute on function public.save_manual_maintenance_v2(jsonb) from public, anon;
grant execute on function public.save_manual_maintenance_v2(jsonb) to authenticated;

create or replace function public.edit_manual_maintenance_record(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := (select public.current_org_id());
  v_payload jsonb;
  v_record_id uuid;
  v_record public.maintenance_records%rowtype;
  v_performed_date date;
  v_mileage numeric;
  v_current_mileage numeric := 0;
  v_kind text;
  v_service text;
  v_service_key text;
  v_parts text[] := '{}';
  v_part jsonb;
  v_old_rule uuid;
  v_new_rule uuid;
begin
  if v_org is null or not (select public.is_org_writer()) then
    raise exception 'Write permission required.';
  end if;

  v_payload := public.validate_maintenance_record_payload(p_payload);
  v_record_id := nullif(v_payload->>'record_id', '')::uuid;
  v_performed_date := nullif(v_payload->>'performed_date', '')::date;
  v_mileage := nullif(v_payload->>'mileage', '')::numeric;
  v_kind := nullif(btrim(v_payload->>'entry_kind'), '');
  v_service := nullif(btrim(v_payload->>'service_type'), '');

  if v_record_id is null then raise exception 'Record is required.'; end if;
  if v_kind not in ('periodic', 'repair') then raise exception 'Invalid maintenance type.'; end if;
  if v_service is null then raise exception 'Service type is required.'; end if;
  if v_performed_date is null then raise exception 'Performed date is required.'; end if;
  if v_mileage is null or v_mileage < 0 or v_mileage <> trunc(v_mileage) then
    raise exception 'Mileage must be a non-negative whole number.';
  end if;

  select * into v_record
  from public.maintenance_records
  where id = v_record_id
    and organization_id = v_org
    and source = 'manual_maintenance'
    and deleted_at is null
  for update;
  if not found then raise exception 'Manual maintenance record not found.'; end if;
  v_old_rule := v_record.rule_id;

  select current_mileage into v_current_mileage
  from public.vehicles
  where id = v_record.vehicle_id and organization_id = v_org
  for update;
  if not found then raise exception 'Vehicle not found.'; end if;

  if jsonb_typeof(coalesce(v_payload->'parts_used', '[]'::jsonb)) = 'array' then
    for v_part in select value from jsonb_array_elements(coalesce(v_payload->'parts_used', '[]'::jsonb))
    loop
      if nullif(btrim(v_part #>> '{}'), '') is not null then
        v_parts := array_append(v_parts, btrim(v_part #>> '{}'));
      end if;
    end loop;
  end if;

  if v_kind = 'periodic' then
    v_service_key := public.manual_maintenance_service_key(v_kind, v_service);
    select id into v_new_rule
    from public.maintenance_rules
    where organization_id = v_org
      and vehicle_id = v_record.vehicle_id
      and active = true
      and public.manual_maintenance_service_key(v_kind, service_type) = v_service_key
    limit 1
    for update;
  else
    v_new_rule := null;
  end if;

  update public.maintenance_records
  set
    performed_date = v_performed_date,
    mileage = v_mileage,
    service_type = v_service,
    rule_id = v_new_rule,
    planned = coalesce((v_payload->>'planned')::boolean, v_kind = 'periodic'),
    category = nullif(btrim(v_payload->>'category'), ''),
    cost = coalesce(nullif(v_payload->>'cost', '')::numeric, nullif(v_payload->>'total_cost', '')::numeric, 0),
    total_cost = nullif(v_payload->>'total_cost', '')::numeric,
    shop_name = nullif(btrim(v_payload->>'shop_name'), ''),
    vendor = nullif(btrim(coalesce(v_payload->>'vendor', v_payload->>'shop_name')), ''),
    parts_used = v_parts,
    invoice_number = nullif(btrim(v_payload->>'invoice_number'), ''),
    notes = nullif(btrim(v_payload->>'notes'), ''),
    parts_cost = coalesce(nullif(v_payload->>'parts_cost', '')::numeric, 0),
    labor_cost = coalesce(nullif(v_payload->>'labor_cost', '')::numeric, 0),
    diagnostic_cost = coalesce(nullif(v_payload->>'diagnostic_cost', '')::numeric, 0),
    shop_fees = coalesce(nullif(v_payload->>'shop_fees', '')::numeric, 0),
    tax_cost = coalesce(nullif(v_payload->>'tax_cost', '')::numeric, 0),
    towing_cost = coalesce(nullif(v_payload->>'towing_cost', '')::numeric, 0),
    road_service_cost = coalesce(nullif(v_payload->>'road_service_cost', '')::numeric, 0),
    hotel_travel_cost = coalesce(nullif(v_payload->>'hotel_travel_cost', '')::numeric, 0),
    freight_shipping_cost = coalesce(nullif(v_payload->>'freight_shipping_cost', '')::numeric, 0),
    core_charge_cost = coalesce(nullif(v_payload->>'core_charge_cost', '')::numeric, 0),
    environmental_fee_cost = coalesce(nullif(v_payload->>'environmental_fee_cost', '')::numeric, 0),
    machine_shop_cost = coalesce(nullif(v_payload->>'machine_shop_cost', '')::numeric, 0),
    sublet_cost = coalesce(nullif(v_payload->>'sublet_cost', '')::numeric, 0),
    other_cost = coalesce(nullif(v_payload->>'other_cost', '')::numeric, 0),
    warranty_recovery = coalesce(nullif(v_payload->>'warranty_recovery', '')::numeric, 0),
    refund_credit = coalesce(nullif(v_payload->>'refund_credit', '')::numeric, 0),
    downtime_start = nullif(v_payload->>'downtime_start', '')::timestamptz,
    downtime_end = nullif(v_payload->>'downtime_end', '')::timestamptz,
    cause = nullif(btrim(v_payload->>'cause'), ''),
    breakdown_occurred = coalesce((v_payload->>'breakdown_occurred')::boolean, false),
    edited_at = now(),
    edited_by = auth.uid()
  where id = v_record_id and organization_id = v_org;

  update public.vehicle_mileage_logs
  set mileage = v_mileage,
      effective_date = v_performed_date
  where organization_id = v_org
    and maintenance_record_id = v_record_id
    and source = 'manual_maintenance';

  if not found then
    insert into public.vehicle_mileage_logs (
      organization_id, vehicle_id, mileage, source, effective_date, maintenance_record_id
    )
    values (
      v_org, v_record.vehicle_id, v_mileage, 'manual_maintenance', v_performed_date, v_record_id
    );
  end if;

  if v_mileage > coalesce(v_current_mileage, 0) then
    update public.vehicles
    set current_mileage = v_mileage
    where id = v_record.vehicle_id
      and organization_id = v_org
      and coalesce(current_mileage, 0) < v_mileage;
  end if;

  if v_old_rule is not null and (v_new_rule is null or v_new_rule <> v_old_rule) then
    perform public.recalculate_maintenance_rule_baseline(v_old_rule);
  end if;
  if v_new_rule is not null then
    perform public.recalculate_maintenance_rule_baseline(v_new_rule);
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

revoke execute on function public.edit_manual_maintenance_record(jsonb) from public, anon;
grant execute on function public.edit_manual_maintenance_record(jsonb) to authenticated;

alter table public.maintenance_records
  drop constraint if exists maintenance_records_downtime_order_chk;
alter table public.maintenance_records
  add constraint maintenance_records_downtime_order_chk
  check (downtime_start is null or downtime_end is null or downtime_end >= downtime_start)
  not valid;

alter table public.maintenance_records
  drop constraint if exists maintenance_records_money_nonnegative_chk;
alter table public.maintenance_records
  add constraint maintenance_records_money_nonnegative_chk
  check (
    coalesce(cost, 0) >= 0
    and coalesce(total_cost, 0) >= 0
    and coalesce(parts_cost, 0) >= 0
    and coalesce(labor_cost, 0) >= 0
    and coalesce(diagnostic_cost, 0) >= 0
    and coalesce(shop_fees, 0) >= 0
    and coalesce(tax_cost, 0) >= 0
    and coalesce(towing_cost, 0) >= 0
    and coalesce(road_service_cost, 0) >= 0
    and coalesce(hotel_travel_cost, 0) >= 0
    and coalesce(freight_shipping_cost, 0) >= 0
    and coalesce(core_charge_cost, 0) >= 0
    and coalesce(environmental_fee_cost, 0) >= 0
    and coalesce(machine_shop_cost, 0) >= 0
    and coalesce(sublet_cost, 0) >= 0
    and coalesce(other_cost, 0) >= 0
    and coalesce(warranty_recovery, 0) >= 0
    and coalesce(refund_credit, 0) >= 0
  )
  not valid;
