-- Amazon controlled projection links.
-- This migration adds authoritative lineage from canonical Amazon source records
-- into the existing public.loads and public.expenses tables. It does not create
-- settlement candidates, settlements, PDFs, or competing operational tables.

set search_path = public, extensions;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'loads_org_id_id_key') then
    alter table public.loads
      add constraint loads_org_id_id_key unique (organization_id, id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'expenses_org_id_id_key') then
    alter table public.expenses
      add constraint expenses_org_id_id_key unique (organization_id, id);
  end if;
end $$;

create table if not exists public.amazon_revenue_load_projections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  batch_id uuid not null,
  revenue_item_id uuid not null,
  load_id uuid not null,
  source_revision text not null,
  source_fingerprint text not null,
  projection_status text not null
    check (projection_status in ('projected','conflict','superseded','archived')),
  projection_snapshot jsonb not null default '{}'::jsonb,
  projected_by uuid,
  projected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_error jsonb,
  constraint amazon_revenue_load_projections_org_id_id_key unique (organization_id, id),
  constraint amazon_revenue_load_projections_revenue_item_same_org_fk
    foreign key (organization_id, batch_id, revenue_item_id)
    references public.amazon_revenue_items (organization_id, batch_id, id) on delete cascade,
  constraint amazon_revenue_load_projections_load_same_org_fk
    foreign key (organization_id, load_id)
    references public.loads (organization_id, id) on delete restrict,
  constraint amazon_revenue_load_projections_projected_by_same_org_fk
    foreign key (organization_id, projected_by)
    references public.profiles (organization_id, id) on delete set null (projected_by),
  constraint amazon_revenue_load_projections_source_fingerprint_check
    check (source_fingerprint ~ '^[a-f0-9]{64}$'),
  constraint amazon_revenue_load_projections_source_revision_check
    check (btrim(source_revision) <> '')
);

create unique index if not exists amazon_revenue_load_projections_active_revenue_item_key
  on public.amazon_revenue_load_projections (organization_id, revenue_item_id)
  where projection_status = 'projected';

create unique index if not exists amazon_revenue_load_projections_active_load_key
  on public.amazon_revenue_load_projections (organization_id, load_id)
  where projection_status = 'projected';

create unique index if not exists amazon_revenue_load_projections_active_fingerprint_key
  on public.amazon_revenue_load_projections (organization_id, batch_id, source_fingerprint)
  where projection_status = 'projected';

create table if not exists public.amazon_fuel_expense_projections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  batch_id uuid not null,
  transaction_line_id uuid not null,
  expense_id uuid not null,
  source_revision text not null,
  source_fingerprint text not null,
  projection_status text not null
    check (projection_status in ('projected','conflict','superseded','archived')),
  projection_snapshot jsonb not null default '{}'::jsonb,
  projected_by uuid,
  projected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_error jsonb,
  constraint amazon_fuel_expense_projections_org_id_id_key unique (organization_id, id),
  constraint amazon_fuel_expense_projections_transaction_line_same_org_fk
    foreign key (organization_id, transaction_line_id)
    references public.fuel_import_transaction_lines (organization_id, id) on delete cascade,
  constraint amazon_fuel_expense_projections_expense_same_org_fk
    foreign key (organization_id, expense_id)
    references public.expenses (organization_id, id) on delete restrict,
  constraint amazon_fuel_expense_projections_projected_by_same_org_fk
    foreign key (organization_id, projected_by)
    references public.profiles (organization_id, id) on delete set null (projected_by),
  constraint amazon_fuel_expense_projections_source_fingerprint_check
    check (source_fingerprint ~ '^[a-f0-9]{64}$'),
  constraint amazon_fuel_expense_projections_source_revision_check
    check (btrim(source_revision) <> '')
);

create unique index if not exists amazon_fuel_expense_projections_active_line_key
  on public.amazon_fuel_expense_projections (organization_id, transaction_line_id)
  where projection_status = 'projected';

create unique index if not exists amazon_fuel_expense_projections_active_expense_key
  on public.amazon_fuel_expense_projections (organization_id, expense_id)
  where projection_status = 'projected';

create unique index if not exists amazon_fuel_expense_projections_active_fingerprint_key
  on public.amazon_fuel_expense_projections (organization_id, batch_id, source_fingerprint)
  where projection_status = 'projected';

create or replace function public.guard_amazon_revenue_load_projection_identity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.organization_id is distinct from old.organization_id
    or new.batch_id is distinct from old.batch_id
    or new.revenue_item_id is distinct from old.revenue_item_id
    or new.load_id is distinct from old.load_id
    or new.source_fingerprint is distinct from old.source_fingerprint then
    raise exception 'Amazon revenue load projection identity cannot be changed.';
  end if;
  return new;
end;
$$;

create or replace function public.guard_amazon_fuel_expense_projection_identity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.organization_id is distinct from old.organization_id
    or new.batch_id is distinct from old.batch_id
    or new.transaction_line_id is distinct from old.transaction_line_id
    or new.expense_id is distinct from old.expense_id
    or new.source_fingerprint is distinct from old.source_fingerprint then
    raise exception 'Amazon fuel expense projection identity cannot be changed.';
  end if;
  return new;
end;
$$;

drop trigger if exists amazon_revenue_load_projections_identity_guard on public.amazon_revenue_load_projections;
create trigger amazon_revenue_load_projections_identity_guard
  before update on public.amazon_revenue_load_projections
  for each row execute function public.guard_amazon_revenue_load_projection_identity();

drop trigger if exists amazon_fuel_expense_projections_identity_guard on public.amazon_fuel_expense_projections;
create trigger amazon_fuel_expense_projections_identity_guard
  before update on public.amazon_fuel_expense_projections
  for each row execute function public.guard_amazon_fuel_expense_projection_identity();

do $$
declare t text;
begin
  foreach t in array array[
    'amazon_revenue_load_projections',
    'amazon_fuel_expense_projections'
  ] loop
    execute format('drop trigger if exists %I_updated_at on public.%I;', t, t);
    execute format(
      'create trigger %I_updated_at before update on public.%I for each row execute function public.touch_amazon_import_updated_at();',
      t, t
    );
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I_select on public.%I;', t, t);
    execute format('drop policy if exists %I_insert on public.%I;', t, t);
    execute format('drop policy if exists %I_update on public.%I;', t, t);
    execute format('drop policy if exists %I_delete on public.%I;', t, t);
    execute format(
      'create policy %I_select on public.%I for select to authenticated using (organization_id = (select public.current_org_id()));',
      t, t
    );
  end loop;
end $$;

grant select on table
  public.amazon_revenue_load_projections,
  public.amazon_fuel_expense_projections
to authenticated, service_role;

grant insert, update, delete on table
  public.amazon_revenue_load_projections,
  public.amazon_fuel_expense_projections
to service_role;

create or replace function public.apply_amazon_revenue_load_projections(
  p_organization_id uuid,
  p_batch_id uuid,
  p_preview_revision text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := coalesce(p_organization_id, (select public.current_org_id()));
  v_user uuid := auth.uid();
  v_preview_revision text;
  v_created int := 0;
  v_unchanged int := 0;
  v_conflicts int := 0;
  v_item jsonb;
  v_existing public.amazon_revenue_load_projections%rowtype;
  v_revenue public.amazon_revenue_items%rowtype;
  v_load_id uuid;
begin
  if v_org is null or not (select public.is_org_writer()) then
    raise exception 'Writer role is required.';
  end if;
  if p_batch_id is null then raise exception 'Batch is required.'; end if;
  if p_preview_revision is null or btrim(p_preview_revision) = '' then raise exception 'Preview revision is required.'; end if;

  perform pg_advisory_xact_lock(hashtext(v_org::text || ':amazon-revenue-projection:' || p_batch_id::text));

  select encode(digest(coalesce(p_items::text, '[]'), 'sha256'), 'hex') into v_preview_revision;
  if v_preview_revision <> p_preview_revision then
    raise exception 'projection_preview_stale';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    select * into v_revenue
    from public.amazon_revenue_items
    where organization_id = v_org
      and batch_id = p_batch_id
      and id = (v_item->>'revenueItemId')::uuid
    for update;
    if not found then raise exception 'Revenue item not found.'; end if;
    if v_revenue.source_revision <> v_item->>'sourceRevision' then
      raise exception 'revenue_projection_revision_conflict';
    end if;

    select * into v_existing
    from public.amazon_revenue_load_projections
    where organization_id = v_org
      and revenue_item_id = (v_item->>'revenueItemId')::uuid
      and projection_status = 'projected'
    for update;

    if found then
      if exists (
        select 1
        from public.settlement_load_links l
        join public.settlements s on s.organization_id = l.organization_id and s.id = l.settlement_id
        where l.organization_id = v_org
          and l.load_id = v_existing.load_id
          and l.released_at is null
          and s.status in ('finalized','paid')
      ) then
        v_conflicts := v_conflicts + 1;
        continue;
      end if;
      if v_existing.source_revision = v_item->>'sourceRevision'
        and v_existing.source_fingerprint = v_item->>'sourceFingerprint' then
        v_unchanged := v_unchanged + 1;
      else
        v_conflicts := v_conflicts + 1;
      end if;
    else
      insert into public.loads (
        organization_id, load_number, load_source, vehicle_id, driver_id,
        pickup_date, delivery_date, pickup_location, delivery_location, route,
        gross_amount, fuel_surcharge, total_miles, status, notes
      ) values (
        v_org,
        nullif(v_item #>> '{load,load_number}', ''),
        'amazon_relay',
        nullif(v_item #>> '{load,vehicle_id}', '')::uuid,
        nullif(v_item #>> '{load,driver_id}', '')::uuid,
        v_revenue.start_date,
        v_revenue.end_date,
        null,
        null,
        null,
        coalesce(v_revenue.gross_amount, 0),
        coalesce(v_revenue.fuel_surcharge_amount, 0),
        coalesce(v_revenue.distance, 0),
        'pending',
        nullif(v_item #>> '{load,notes}', '')
      ) returning id into v_load_id;

      insert into public.amazon_revenue_load_projections (
        organization_id, batch_id, revenue_item_id, load_id, source_revision,
        source_fingerprint, projection_status, projection_snapshot, projected_by
      ) values (
        v_org,
        p_batch_id,
        (v_item->>'revenueItemId')::uuid,
        v_load_id,
        v_item->>'sourceRevision',
        v_item->>'sourceFingerprint',
        'projected',
        v_item,
        v_user
      );
      v_created := v_created + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'created', v_created,
    'unchanged', v_unchanged,
    'skipped', 0,
    'conflicts', v_conflicts
  );
end;
$$;

create or replace function public.apply_amazon_fuel_expense_projections(
  p_organization_id uuid,
  p_batch_id uuid,
  p_preview_revision text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := coalesce(p_organization_id, (select public.current_org_id()));
  v_user uuid := auth.uid();
  v_preview_revision text;
  v_created int := 0;
  v_unchanged int := 0;
  v_conflicts int := 0;
  v_item jsonb;
  v_existing public.amazon_fuel_expense_projections%rowtype;
  v_line public.fuel_import_transaction_lines%rowtype;
  v_transaction public.fuel_import_transactions%rowtype;
  v_expense_id uuid;
begin
  if v_org is null or not (select public.is_org_writer()) then
    raise exception 'Writer role is required.';
  end if;
  if p_batch_id is null then raise exception 'Batch is required.'; end if;
  if p_preview_revision is null or btrim(p_preview_revision) = '' then raise exception 'Preview revision is required.'; end if;

  perform pg_advisory_xact_lock(hashtext(v_org::text || ':amazon-fuel-projection:' || p_batch_id::text));

  select encode(digest(coalesce(p_items::text, '[]'), 'sha256'), 'hex') into v_preview_revision;
  if v_preview_revision <> p_preview_revision then
    raise exception 'projection_preview_stale';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    select * into v_line
    from public.fuel_import_transaction_lines
    where organization_id = v_org
      and id = (v_item->>'transactionLineId')::uuid
    for update;
    if not found then raise exception 'Fuel transaction line not found.'; end if;

    select * into v_transaction
    from public.fuel_import_transactions
    where organization_id = v_org
      and id = v_line.transaction_id
    for update;
    if not found then raise exception 'Fuel transaction not found.'; end if;

    select * into v_existing
    from public.amazon_fuel_expense_projections
    where organization_id = v_org
      and transaction_line_id = (v_item->>'transactionLineId')::uuid
      and projection_status = 'projected'
    for update;

    if found then
      if exists (
        select 1
        from public.settlement_expense_links l
        join public.settlements s on s.organization_id = l.organization_id and s.id = l.settlement_id
        where l.organization_id = v_org
          and l.expense_id = v_existing.expense_id
          and l.released_at is null
          and s.status in ('finalized','paid')
      ) then
        v_conflicts := v_conflicts + 1;
        continue;
      end if;
      if v_existing.source_revision = v_item->>'sourceRevision'
        and v_existing.source_fingerprint = v_item->>'sourceFingerprint' then
        v_unchanged := v_unchanged + 1;
      else
        v_conflicts := v_conflicts + 1;
      end if;
    else
      insert into public.expenses (
        organization_id, date, vehicle_id, driver_id, owner_id, category, amount,
        deduct_from_settlement, deduct_from_driver, deduct_from_owner, deduct_from_investor, notes
      ) values (
        v_org,
        coalesce(v_transaction.transaction_at::date, current_date),
        nullif(v_item #>> '{expense,vehicle_id}', '')::uuid,
        nullif(v_item #>> '{expense,driver_id}', '')::uuid,
        null,
        case
          when v_line.product_type_normalized = 'DEF' then 'def'
          when v_line.product_type_normalized = 'FEE' then 'fees'
          when v_line.product_type_normalized = 'OTHER' then 'other'
          else 'fuel'
        end,
        coalesce(v_line.charged_amount, 0),
        false,
        false,
        false,
        false,
        nullif(v_item #>> '{expense,notes}', '')
      ) returning id into v_expense_id;

      insert into public.amazon_fuel_expense_projections (
        organization_id, batch_id, transaction_line_id, expense_id, source_revision,
        source_fingerprint, projection_status, projection_snapshot, projected_by
      ) values (
        v_org,
        p_batch_id,
        (v_item->>'transactionLineId')::uuid,
        v_expense_id,
        v_item->>'sourceRevision',
        v_item->>'sourceFingerprint',
        'projected',
        v_item,
        v_user
      );
      v_created := v_created + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'created', v_created,
    'unchanged', v_unchanged,
    'skipped', 0,
    'conflicts', v_conflicts
  );
end;
$$;

revoke execute on function public.apply_amazon_revenue_load_projections(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.apply_amazon_revenue_load_projections(uuid, uuid, text, jsonb) to authenticated, service_role;

revoke execute on function public.apply_amazon_fuel_expense_projections(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.apply_amazon_fuel_expense_projections(uuid, uuid, text, jsonb) to authenticated, service_role;
