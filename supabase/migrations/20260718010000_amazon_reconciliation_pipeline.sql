-- Amazon payment/trip reconciliation pipeline.
-- Adds the missing server-authoritative transaction that persists matching,
-- canonical revenue, source links, issues, and the current amazon_revenue
-- reconciliation from already-normalized Amazon source rows.

set search_path = public, extensions;

create unique index if not exists amazon_import_matches_batch_payment_type_key
  on public.amazon_import_matches (organization_id, batch_id, payment_row_id, match_type);

create or replace function public.reconcile_amazon_payment_atomic(
  p_batch_id uuid,
  p_invoice_id uuid,
  p_matches jsonb,
  p_revenue_items jsonb,
  p_revenue_sources jsonb,
  p_issues jsonb,
  p_reconciliation jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_org uuid := (select public.current_org_id());
  v_batch public.amazon_import_batches%rowtype;
  v_invoice public.amazon_payment_invoices%rowtype;
  v_expected_amount numeric;
  v_valid_payment_total numeric := 0;
  v_valid_payment_count int := 0;
  v_canonical_total numeric := 0;
  v_revenue_item_count int := 0;
  v_assigned_source_count int := 0;
  v_blocking_issue_count int := 0;
  v_status text := 'passed';
  v_next_status text := 'reconciled';
begin
  if v_org is null or not (select public.is_org_writer()) then
    raise exception 'Writer role is required.';
  end if;

  select *
    into v_batch
  from public.amazon_import_batches b
  where b.organization_id = v_org
    and b.id = p_batch_id
  for update;

  if not found then
    raise exception 'Amazon import batch not found.';
  end if;
  if v_batch.status = 'archived' then
    raise exception 'Archived Amazon import batches are immutable.';
  end if;
  if v_batch.status not in ('parsed', 'needs_review', 'reconciled') then
    raise exception 'Amazon import batch must be parsed before reconciliation.';
  end if;

  if p_invoice_id is not null then
    select *
      into v_invoice
    from public.amazon_payment_invoices i
    where i.organization_id = v_org
      and i.batch_id = p_batch_id
      and i.id = p_invoice_id
    for update;
    if not found then
      raise exception 'Amazon payment invoice not found for batch.';
    end if;
    v_expected_amount := v_invoice.summary_total;
  end if;

  create temporary table if not exists pg_temp.amazon_reconcile_matches (
    payment_row_id uuid,
    trip_row_id uuid,
    match_type text,
    match_method text,
    confidence_score numeric,
    status text,
    reasons jsonb
  ) on commit drop;
  truncate pg_temp.amazon_reconcile_matches;

  insert into pg_temp.amazon_reconcile_matches
  select m.payment_row_id,
         m.trip_row_id,
         m.match_type,
         m.match_method,
         m.confidence_score,
         m.status,
         coalesce(m.reasons, '[]'::jsonb)
  from jsonb_to_recordset(coalesce(p_matches, '[]'::jsonb)) as m(
    payment_row_id uuid,
    trip_row_id uuid,
    match_type text,
    match_method text,
    confidence_score numeric,
    status text,
    reasons jsonb
  );

  create temporary table if not exists pg_temp.amazon_reconcile_items (
    client_item_key text,
    invoice_id uuid,
    grouping_type text,
    grouping_key text,
    trip_id text,
    primary_load_id text,
    start_date date,
    end_date date,
    origin_facility_code text,
    destination_facility_code text,
    route_resolution_status text,
    distance numeric,
    base_amount numeric,
    fuel_surcharge_amount numeric,
    toll_amount numeric,
    detention_amount numeric,
    tonu_amount numeric,
    other_amount numeric,
    gross_amount numeric,
    match_status text,
    driver_assignment_status text,
    vehicle_assignment_status text,
    reconciliation_status text,
    source_revision text
  ) on commit drop;
  truncate pg_temp.amazon_reconcile_items;

  insert into pg_temp.amazon_reconcile_items
  select i.client_item_key,
         i.invoice_id,
         i.grouping_type,
         i.grouping_key,
         i.trip_id,
         i.primary_load_id,
         i.start_date,
         i.end_date,
         i.origin_facility_code,
         i.destination_facility_code,
         i.route_resolution_status,
         i.distance,
         i.base_amount,
         i.fuel_surcharge_amount,
         i.toll_amount,
         i.detention_amount,
         i.tonu_amount,
         i.other_amount,
         i.gross_amount,
         i.match_status,
         i.driver_assignment_status,
         i.vehicle_assignment_status,
         i.reconciliation_status,
         i.source_revision
  from jsonb_to_recordset(coalesce(p_revenue_items, '[]'::jsonb)) as i(
    client_item_key text,
    invoice_id uuid,
    grouping_type text,
    grouping_key text,
    trip_id text,
    primary_load_id text,
    start_date date,
    end_date date,
    origin_facility_code text,
    destination_facility_code text,
    route_resolution_status text,
    distance numeric,
    base_amount numeric,
    fuel_surcharge_amount numeric,
    toll_amount numeric,
    detention_amount numeric,
    tonu_amount numeric,
    other_amount numeric,
    gross_amount numeric,
    match_status text,
    driver_assignment_status text,
    vehicle_assignment_status text,
    reconciliation_status text,
    source_revision text
  );

  create temporary table if not exists pg_temp.amazon_reconcile_sources (
    client_item_key text,
    grouping_key text,
    payment_row_id uuid,
    contribution_type text
  ) on commit drop;
  truncate pg_temp.amazon_reconcile_sources;

  insert into pg_temp.amazon_reconcile_sources
  select s.client_item_key,
         s.grouping_key,
         s.payment_row_id,
         s.contribution_type
  from jsonb_to_recordset(coalesce(p_revenue_sources, '[]'::jsonb)) as s(
    client_item_key text,
    grouping_key text,
    payment_row_id uuid,
    contribution_type text
  );

  if exists (
    select 1
    from pg_temp.amazon_reconcile_matches m
    left join public.amazon_payment_rows p
      on p.organization_id = v_org
     and p.batch_id = p_batch_id
     and p.id = m.payment_row_id
    where p.id is null
  ) then
    raise exception 'Reconciliation match references a payment row outside the batch.';
  end if;

  if exists (
    select 1
    from pg_temp.amazon_reconcile_matches m
    left join public.amazon_trip_rows t
      on t.organization_id = v_org
     and t.batch_id = p_batch_id
     and t.id = m.trip_row_id
    where m.trip_row_id is not null
      and t.id is null
  ) then
    raise exception 'Reconciliation match references a trip row outside the batch.';
  end if;

  if exists (
    select 1
    from pg_temp.amazon_reconcile_items i
    where i.invoice_id is distinct from p_invoice_id
       or i.grouping_key is null
       or i.client_item_key is null
  ) then
    raise exception 'Canonical revenue item references the wrong invoice or is missing identity.';
  end if;

  if exists (
    select 1
    from pg_temp.amazon_reconcile_sources s
    left join pg_temp.amazon_reconcile_items i
      on i.client_item_key = s.client_item_key
     and i.grouping_key = s.grouping_key
    left join public.amazon_payment_rows p
      on p.organization_id = v_org
     and p.batch_id = p_batch_id
     and p.id = s.payment_row_id
    where i.client_item_key is null
       or p.id is null
       or p.row_classification not in ('trip_parent','load_child','standalone_load')
  ) then
    raise exception 'Canonical revenue source references an invalid payment row or item.';
  end if;

  if exists (
    select 1
    from pg_temp.amazon_reconcile_sources s
    group by s.payment_row_id
    having count(*) > 1
  ) then
    raise exception 'A financial payment row cannot contribute to canonical revenue more than once.';
  end if;

  select coalesce(round(sum(p.gross_amount), 2), 0), count(*)
    into v_valid_payment_total, v_valid_payment_count
  from public.amazon_payment_rows p
  where p.organization_id = v_org
    and p.batch_id = p_batch_id
    and p.row_classification in ('trip_parent','load_child','standalone_load')
    and p.parse_status in ('parsed','warning');

  delete from public.amazon_import_matches m
  where m.organization_id = v_org
    and m.batch_id = p_batch_id
    and m.match_type = 'payment_trip';

  insert into public.amazon_import_matches (
    organization_id, batch_id, payment_row_id, trip_row_id, match_type,
    match_method, confidence_score, status, reasons
  )
  select v_org,
         p_batch_id,
         m.payment_row_id,
         m.trip_row_id,
         m.match_type,
         m.match_method,
         m.confidence_score,
         m.status,
         m.reasons
  from pg_temp.amazon_reconcile_matches m
  on conflict (organization_id, batch_id, payment_row_id, match_type)
  do update set
    trip_row_id = excluded.trip_row_id,
    match_method = excluded.match_method,
    confidence_score = excluded.confidence_score,
    status = excluded.status,
    reasons = excluded.reasons,
    updated_at = now();

  insert into public.amazon_revenue_items (
    organization_id, batch_id, invoice_id, grouping_type, grouping_key, trip_id,
    primary_load_id, start_date, end_date, origin_facility_code,
    destination_facility_code, route_resolution_status, distance, base_amount,
    fuel_surcharge_amount, toll_amount, detention_amount, tonu_amount,
    other_amount, gross_amount, match_status, driver_assignment_status,
    vehicle_assignment_status, reconciliation_status, source_revision
  )
  select v_org,
         p_batch_id,
         i.invoice_id,
         i.grouping_type,
         i.grouping_key,
         i.trip_id,
         i.primary_load_id,
         i.start_date,
         i.end_date,
         i.origin_facility_code,
         i.destination_facility_code,
         coalesce(i.route_resolution_status, 'unresolved'),
         i.distance,
         coalesce(i.base_amount, 0),
         coalesce(i.fuel_surcharge_amount, 0),
         coalesce(i.toll_amount, 0),
         coalesce(i.detention_amount, 0),
         coalesce(i.tonu_amount, 0),
         coalesce(i.other_amount, 0),
         coalesce(i.gross_amount, 0),
         i.match_status,
         i.driver_assignment_status,
         i.vehicle_assignment_status,
         i.reconciliation_status,
         i.source_revision
  from pg_temp.amazon_reconcile_items i
  on conflict on constraint amazon_revenue_items_grouping_key
  do update set
    grouping_type = excluded.grouping_type,
    trip_id = excluded.trip_id,
    primary_load_id = excluded.primary_load_id,
    start_date = excluded.start_date,
    end_date = excluded.end_date,
    origin_facility_code = excluded.origin_facility_code,
    destination_facility_code = excluded.destination_facility_code,
    route_resolution_status = excluded.route_resolution_status,
    distance = excluded.distance,
    base_amount = excluded.base_amount,
    fuel_surcharge_amount = excluded.fuel_surcharge_amount,
    toll_amount = excluded.toll_amount,
    detention_amount = excluded.detention_amount,
    tonu_amount = excluded.tonu_amount,
    other_amount = excluded.other_amount,
    gross_amount = excluded.gross_amount,
    match_status = excluded.match_status,
    driver_assignment_status = excluded.driver_assignment_status,
    vehicle_assignment_status = excluded.vehicle_assignment_status,
    reconciliation_status = excluded.reconciliation_status,
    source_revision = excluded.source_revision,
    updated_at = now();

  delete from public.amazon_revenue_item_sources s
  using public.amazon_revenue_items i
  where s.organization_id = v_org
    and i.organization_id = v_org
    and i.batch_id = p_batch_id
    and s.revenue_item_id = i.id;

  insert into public.amazon_revenue_item_sources (
    organization_id, revenue_item_id, payment_row_id, contribution_type
  )
  select v_org,
         i.id,
         s.payment_row_id,
         s.contribution_type
  from pg_temp.amazon_reconcile_sources s
  join public.amazon_revenue_items i
    on i.organization_id = v_org
   and i.batch_id = p_batch_id
   and i.invoice_id = p_invoice_id
   and i.grouping_key = s.grouping_key
  on conflict (organization_id, revenue_item_id, payment_row_id)
  do update set contribution_type = excluded.contribution_type;

  delete from public.amazon_revenue_items i
  where i.organization_id = v_org
    and i.batch_id = p_batch_id
    and not exists (
      select 1
      from pg_temp.amazon_reconcile_items source
      where source.invoice_id = i.invoice_id
        and source.grouping_key = i.grouping_key
    );

  select coalesce(round(sum(i.gross_amount), 2), 0), count(*)
    into v_canonical_total, v_revenue_item_count
  from public.amazon_revenue_items i
  where i.organization_id = v_org
    and i.batch_id = p_batch_id;

  select count(*)
    into v_assigned_source_count
  from public.amazon_revenue_item_sources s
  join public.amazon_revenue_items i
    on i.organization_id = s.organization_id
   and i.id = s.revenue_item_id
  where i.organization_id = v_org
    and i.batch_id = p_batch_id;

  create temporary table if not exists pg_temp.amazon_reconcile_issues (
    issue_code text,
    severity text,
    message text,
    details jsonb
  ) on commit drop;
  truncate pg_temp.amazon_reconcile_issues;

  insert into pg_temp.amazon_reconcile_issues
  select i.issue_code,
         i.severity,
         i.message,
         coalesce(i.details, '{}'::jsonb)
  from jsonb_to_recordset(coalesce(p_issues, '[]'::jsonb)) as i(
    issue_code text,
    severity text,
    message text,
    details jsonb
  );

  update public.amazon_import_issues existing
     set status = 'resolved',
         resolved_at = now()
   where existing.organization_id = v_org
     and existing.batch_id = p_batch_id
     and existing.status = 'open'
     and existing.details->>'lifecycleStage' = 'reconcile_payment'
     and not exists (
       select 1
       from pg_temp.amazon_reconcile_issues current_issue
       where current_issue.details->>'issueKey' = existing.details->>'issueKey'
     );

  insert into public.amazon_import_issues (
    organization_id, batch_id, file_id, raw_row_id, issue_code, severity, message, details, status
  )
  select v_org,
         p_batch_id,
         null,
         null,
         i.issue_code,
         i.severity,
         i.message,
         i.details,
         'open'
  from pg_temp.amazon_reconcile_issues i
  where not exists (
    select 1
    from public.amazon_import_issues existing
    where existing.organization_id = v_org
      and existing.batch_id = p_batch_id
      and existing.status = 'open'
      and existing.details->>'issueKey' = i.details->>'issueKey'
  );

  select count(*)
    into v_blocking_issue_count
  from public.amazon_import_issues existing
  where existing.organization_id = v_org
    and existing.batch_id = p_batch_id
    and existing.status = 'open'
    and existing.severity = 'blocking'
    and (
      existing.details->>'lifecycleStage' = 'reconcile_payment'
      or existing.issue_code in ('ambiguous_load_match','unmatched_payment_row','source_row_missing_from_revenue','duplicate_revenue_contribution','financial_reconciliation_failed','missing_invoice','missing_required_source_rows')
    );

  if v_expected_amount is not null and abs(round(v_expected_amount - v_canonical_total, 2)) > 0.01 then
    v_status := 'failed';
  elsif v_valid_payment_count <> v_assigned_source_count then
    v_status := 'failed';
  elsif v_blocking_issue_count > 0 then
    v_status := 'failed';
  else
    v_status := 'passed';
  end if;
  v_next_status := case when v_status = 'passed' then 'reconciled' else 'needs_review' end;

  delete from public.amazon_import_reconciliations r
  where r.organization_id = v_org
    and r.batch_id = p_batch_id
    and r.reconciliation_type = 'amazon_revenue';

  insert into public.amazon_import_reconciliations (
    organization_id, batch_id, reconciliation_type, expected_amount, actual_amount,
    difference_amount, expected_count, actual_count, status, details
  )
  values (
    v_org,
    p_batch_id,
    'amazon_revenue',
    v_expected_amount,
    v_canonical_total,
    case when v_expected_amount is null then null else round(v_expected_amount - v_canonical_total, 2) end,
    v_valid_payment_count,
    v_assigned_source_count,
    v_status,
    coalesce(p_reconciliation->'details', '{}'::jsonb)
      || jsonb_build_object(
        'current', true,
        'summaryInvoiceTotal', v_expected_amount,
        'validPaymentRowGrossTotal', v_valid_payment_total,
        'canonicalRevenueTotal', v_canonical_total,
        'canonicalRevenueItemCount', v_revenue_item_count,
        'assignedFinancialRowCount', v_assigned_source_count,
        'validFinancialRowCount', v_valid_payment_count,
        'blockingIssueCount', v_blocking_issue_count
      )
  );

  update public.amazon_import_batches b
     set status = v_next_status,
         updated_at = now()
   where b.organization_id = v_org
     and b.id = p_batch_id;

  return jsonb_build_object(
    'batchId', p_batch_id,
    'status', v_next_status,
    'reconciliationStatus', v_status,
    'expectedAmount', v_expected_amount,
    'actualAmount', v_canonical_total,
    'validPaymentRowTotal', v_valid_payment_total,
    'validFinancialRowCount', v_valid_payment_count,
    'assignedFinancialRowCount', v_assigned_source_count,
    'canonicalRevenueItemCount', v_revenue_item_count,
    'blockingIssueCount', v_blocking_issue_count
  );
end;
$$;

revoke execute on function public.reconcile_amazon_payment_atomic(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.reconcile_amazon_payment_atomic(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;
