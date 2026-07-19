-- Fix projection preview revision validation and tighten organization scoping.

set search_path = public, extensions;

create or replace function public.amazon_projection_preview_revision(p_items jsonb)
returns text
language sql
immutable
set search_path = public
as $$
  with normalized as (
    select
      item->>'sourceFingerprint' as source_fingerprint,
      item->>'sourceRevision' as source_revision
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as item
  ), canonical as (
    select
      '[' || coalesce(string_agg(
        '{"sourceFingerprint":' || to_jsonb(source_fingerprint)::text
        || ',"sourceRevision":' || to_jsonb(source_revision)::text
        || '}',
        ',' order by source_fingerprint
      ), '') || ']' as payload
    from normalized
  )
  select encode(extensions.digest(payload, 'sha256'::text), 'hex')
  from canonical;
$$;

revoke all on function public.amazon_projection_preview_revision(jsonb) from public, anon, authenticated;

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
  v_current_org uuid := (select public.current_org_id());
  v_is_service_role boolean := coalesce(auth.role() = 'service_role', false);
  v_org uuid := coalesce(p_organization_id, v_current_org);
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
  if v_org is null then
    raise exception 'Organization is required.';
  end if;
  if not v_is_service_role and (
    v_current_org is null
    or v_org is distinct from v_current_org
    or not (select public.is_org_writer())
  ) then
    raise exception 'Writer role is required.';
  end if;
  if p_batch_id is null then raise exception 'Batch is required.'; end if;
  if p_preview_revision is null or btrim(p_preview_revision) = '' then raise exception 'Preview revision is required.'; end if;

  perform 1
  from public.amazon_import_batches
  where organization_id = v_org and id = p_batch_id
  for update;
  if not found then raise exception 'Batch is not available.'; end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as item
    where nullif(btrim(item->>'sourceFingerprint'), '') is null
       or nullif(btrim(item->>'sourceRevision'), '') is null
  ) then
    raise exception 'Projection item revision metadata is required.';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_org::text || ':amazon-revenue-projection:' || p_batch_id::text));

  select public.amazon_projection_preview_revision(p_items) into v_preview_revision;
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
  v_current_org uuid := (select public.current_org_id());
  v_is_service_role boolean := coalesce(auth.role() = 'service_role', false);
  v_org uuid := coalesce(p_organization_id, v_current_org);
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
  if v_org is null then
    raise exception 'Organization is required.';
  end if;
  if not v_is_service_role and (
    v_current_org is null
    or v_org is distinct from v_current_org
    or not (select public.is_org_writer())
  ) then
    raise exception 'Writer role is required.';
  end if;
  if p_batch_id is null then raise exception 'Batch is required.'; end if;
  if p_preview_revision is null or btrim(p_preview_revision) = '' then raise exception 'Preview revision is required.'; end if;

  perform 1
  from public.amazon_import_batches
  where organization_id = v_org and id = p_batch_id
  for update;
  if not found then raise exception 'Batch is not available.'; end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as item
    where nullif(btrim(item->>'sourceFingerprint'), '') is null
       or nullif(btrim(item->>'sourceRevision'), '') is null
  ) then
    raise exception 'Projection item revision metadata is required.';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_org::text || ':amazon-fuel-projection:' || p_batch_id::text));

  select public.amazon_projection_preview_revision(p_items) into v_preview_revision;
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
