-- Web Maintenance Invoice Review Inbox.
-- File-only migration artifact; run manually in Supabase SQL Editor.

alter table maintenance_invoices add column if not exists status text not null default 'completed';
alter table maintenance_invoices add column if not exists parser_confidence numeric;
alter table maintenance_invoices add column if not exists parser_warnings text[] not null default '{}'::text[];
alter table maintenance_invoices add column if not exists total_amount numeric;
alter table maintenance_invoices add column if not exists completed_by uuid references profiles (id) on delete set null;
alter table maintenance_invoices add column if not exists completed_at timestamptz;
alter table maintenance_invoices add column if not exists cancelled_by uuid references profiles (id) on delete set null;
alter table maintenance_invoices add column if not exists cancelled_at timestamptz;
alter table maintenance_invoices add column if not exists undone_by uuid references profiles (id) on delete set null;
alter table maintenance_invoices add column if not exists undone_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'maintenance_invoices_status_chk') then
    alter table maintenance_invoices add constraint maintenance_invoices_status_chk
      check (status in ('pending_review','completed','duplicate','failed','cancelled'));
  end if;
end $$;

alter table maintenance_rules add column if not exists created_by_invoice_id uuid;
alter table maintenance_rules add column if not exists updated_by_invoice_id uuid;
alter table maintenance_records add column if not exists parts_used text[] not null default '{}'::text[];
alter table maintenance_records add column if not exists undone_at timestamptz;
alter table expenses add column if not exists maintenance_invoice_id uuid;
alter table expenses add column if not exists invoice_hash text;

alter table maintenance_rules
  drop constraint if exists maintenance_rules_created_by_invoice_fk;
alter table maintenance_rules
  add constraint maintenance_rules_created_by_invoice_fk
  foreign key (organization_id, created_by_invoice_id)
  references maintenance_invoices (organization_id, id) on delete set null not valid;
alter table maintenance_rules
  drop constraint if exists maintenance_rules_updated_by_invoice_fk;
alter table maintenance_rules
  add constraint maintenance_rules_updated_by_invoice_fk
  foreign key (organization_id, updated_by_invoice_id)
  references maintenance_invoices (organization_id, id) on delete set null not valid;
alter table expenses
  drop constraint if exists expenses_maintenance_invoice_fk;
alter table expenses
  add constraint expenses_maintenance_invoice_fk
  foreign key (organization_id, maintenance_invoice_id)
  references maintenance_invoices (organization_id, id) on delete set null not valid;

create unique index if not exists expenses_org_invoice_hash_key
  on expenses (organization_id, invoice_hash)
  where invoice_hash is not null;

create table if not exists maintenance_service_defaults (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  service_key text not null,
  service_type text not null,
  default_mode text not null default 'history' check (default_mode in ('plan','history','skip')),
  interval_type text check (interval_type in ('mileage','date')),
  interval_miles numeric,
  interval_days integer,
  updated_by uuid references profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint maintenance_service_defaults_shape_chk check (
    default_mode <> 'plan'
    or interval_type is null
    or (interval_type = 'mileage' and interval_miles is not null and interval_miles > 0 and interval_days is null)
    or (interval_type = 'date' and interval_days is not null and interval_days > 0 and interval_miles is null)
  ),
  unique (organization_id, service_key)
);

alter table maintenance_service_defaults enable row level security;
drop policy if exists maintenance_service_defaults_select on maintenance_service_defaults;
drop policy if exists maintenance_service_defaults_write on maintenance_service_defaults;
create policy maintenance_service_defaults_select on maintenance_service_defaults
  for select to authenticated
  using (organization_id = (select current_org_id()));
create policy maintenance_service_defaults_write on maintenance_service_defaults
  for all to authenticated
  using (organization_id = (select current_org_id()) and (select is_org_writer()))
  with check (organization_id = (select current_org_id()) and (select is_org_writer()));

create or replace function maintenance_service_key(p_service text)
returns text
language sql
immutable
as $$
  select btrim(regexp_replace(lower(regexp_replace(coalesce(p_service, ''), '&', ' and ', 'g')), '[^a-z0-9]+', ' ', 'g'))
$$;

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

  for v_record in select value from jsonb_array_elements(coalesce(p_payload->'records', '[]'::jsonb))
  loop
    if coalesce(v_record->>'resolution', 'history') = 'skip' then
      continue;
    end if;

    v_service_key := maintenance_service_key(v_record->>'service_type');
    v_next_mileage := nullif(v_record->>'next_due_mileage', '')::numeric;
    v_next_date := nullif(v_record->>'next_due_date', '')::date;
    v_mileage := nullif(v_record->>'mileage', '')::numeric;

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
      next_due_mileage, next_due_date, source, created_by
    ) values (
      v_org, v_vehicle, v_rule, p_invoice_id, v_record->>'service_type',
      nullif(v_record->>'performed_date', '')::date, v_mileage,
      coalesce(nullif(v_record->>'cost', '')::numeric, 0),
      nullif(btrim(coalesce(v_record->>'shop_name', p_payload->>'vendor')), ''),
      nullif(btrim(v_record->>'part_name'), ''),
      coalesce(v_parts, '{}'::text[]),
      nullif(btrim(v_record->>'notes'), ''),
      v_next_mileage, v_next_date, 'invoice', v_user
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
      v_org, v_vehicle, 'Maintenance', coalesce(v_invoice.total_amount, nullif(p_payload->>'total', '')::numeric, 0),
      coalesce(nullif(p_payload->>'invoice_date', '')::date, current_date),
      true, 'Maintenance invoice ' || coalesce(v_invoice.invoice_number, v_invoice.file_name),
      p_invoice_id, v_invoice.file_hash
    where not exists (
      select 1 from expenses where organization_id = v_org and invoice_hash = v_invoice.file_hash
    );
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

  update maintenance_invoices set
    vehicle_id = v_vehicle,
    shop_name = nullif(btrim(coalesce(p_payload->>'vendor', shop_name)), ''),
    invoice_date = coalesce(nullif(p_payload->>'invoice_date', '')::date, invoice_date),
    total_amount = nullif(p_payload->>'total', '')::numeric,
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

create or replace function undo_maintenance_invoice_import(p_invoice_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := (select current_org_id());
  v_user uuid := auth.uid();
  v_records integer;
  v_rules integer;
  v_expenses integer;
begin
  if v_org is null or not (select is_org_writer()) then
    raise exception 'Write permission required.';
  end if;

  if not exists (
    select 1 from maintenance_invoices
    where id = p_invoice_id and organization_id = v_org and status = 'completed'
    for update
  ) then
    raise exception 'Completed invoice not found.';
  end if;

  delete from expenses
  where organization_id = v_org and maintenance_invoice_id = p_invoice_id;
  get diagnostics v_expenses = row_count;

  delete from maintenance_records
  where organization_id = v_org and invoice_id = p_invoice_id;
  get diagnostics v_records = row_count;

  update maintenance_rules
  set active = false, updated_by_invoice_id = p_invoice_id
  where organization_id = v_org and created_by_invoice_id = p_invoice_id;
  get diagnostics v_rules = row_count;

  update maintenance_invoices set
    status = 'cancelled',
    undone_by = v_user,
    undone_at = now(),
    cancelled_by = v_user,
    cancelled_at = now()
  where id = p_invoice_id and organization_id = v_org;

  return jsonb_build_object('records_deleted', v_records, 'rules_deactivated', v_rules, 'expenses_deleted', v_expenses);
end;
$$;

revoke execute on function undo_maintenance_invoice_import(uuid) from public, anon;
grant execute on function undo_maintenance_invoice_import(uuid) to authenticated;
