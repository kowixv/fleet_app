-- Amazon server workflow hardening.
-- Adds database-enforced concurrency boundaries for candidate conversion,
-- per-file source persistence, and batch status transitions. This migration is
-- intentionally additive and does not run migrations, create UI, or weaken the
-- existing settlement workflow.

set search_path = public, extensions;

create unique index if not exists amazon_statement_candidates_one_conversion_key
  on public.amazon_statement_candidates (organization_id, id, converted_settlement_id)
  where converted_settlement_id is not null;

alter table public.amazon_statement_candidates
  add column if not exists conversion_idempotency_key text;

create unique index if not exists amazon_statement_candidates_conversion_idempotency_key
  on public.amazon_statement_candidates (organization_id, conversion_idempotency_key)
  where conversion_idempotency_key is not null;

create or replace function public.transition_amazon_import_batch_atomic(
  p_batch_id uuid,
  p_expected_status text,
  p_next_status text,
  p_operation text,
  p_expected_updated_at timestamptz default null,
  p_has_blocking_issues boolean default false,
  p_financial_reconciled boolean default false
)
returns table (
  id uuid,
  organization_id uuid,
  status text,
  parser_bundle_version text,
  period_start date,
  period_end date,
  updated_at timestamptz
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_org uuid := (select public.current_org_id());
  v_batch public.amazon_import_batches%rowtype;
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
  if v_batch.status is distinct from p_expected_status then
    raise exception 'Stale Amazon import batch status.';
  end if;
  if p_expected_updated_at is not null and v_batch.updated_at is distinct from p_expected_updated_at then
    raise exception 'Stale Amazon import batch revision.';
  end if;
  if not (
    (v_batch.status = 'uploaded' and p_next_status = 'parsing' and p_operation = 'parse_files')
    or (v_batch.status = 'parsing' and p_next_status = 'parsed' and p_operation = 'persist_normalized_sources')
    or (v_batch.status = 'parsed' and p_next_status = 'needs_review' and p_operation in ('resolve_references','persist_normalized_sources'))
    or (v_batch.status = 'parsed' and p_next_status = 'reconciled' and p_operation = 'reconcile_payment')
    or (v_batch.status = 'needs_review' and p_next_status = 'reconciled' and p_operation = 'resolve_references')
    or (v_batch.status = 'reconciled' and p_next_status = 'ready' and p_operation = 'compile_candidates')
    or (v_batch.status in ('uploaded','parsing') and p_next_status = 'failed' and p_operation = 'parse_files')
    or (v_batch.status = 'parsed' and p_next_status = 'failed' and p_operation = 'persist_normalized_sources')
    or (v_batch.status in ('needs_review','reconciled','ready') and p_next_status = 'archived' and p_operation = 'archive_batch')
    or (v_batch.status = 'failed' and p_next_status = 'uploaded' and p_operation = 'retry_failed')
  ) then
    raise exception 'Invalid Amazon import batch transition.';
  end if;
  if p_next_status = 'ready' and (not p_financial_reconciled or p_has_blocking_issues) then
    raise exception 'Amazon import batch is not ready.';
  end if;

  update public.amazon_import_batches b
     set status = p_next_status,
         updated_at = now()
   where b.organization_id = v_org
     and b.id = p_batch_id
  returning b.* into v_batch;

  return query
    select v_batch.id,
           v_batch.organization_id,
           v_batch.status,
           v_batch.parser_bundle_version,
           v_batch.period_start,
           v_batch.period_end,
           v_batch.updated_at;
end;
$$;

revoke execute on function public.transition_amazon_import_batch_atomic(uuid, text, text, text, timestamptz, boolean, boolean) from public, anon;
grant execute on function public.transition_amazon_import_batch_atomic(uuid, text, text, text, timestamptz, boolean, boolean) to authenticated;

create or replace function public.persist_amazon_source_atomic(
  p_organization_id uuid,
  p_batch_id uuid,
  p_file_id uuid,
  p_source_type text,
  p_parser_name text,
  p_parser_version text,
  p_schema_signature text,
  p_raw_rows jsonb,
  p_issues jsonb,
  p_reconciliations jsonb,
  p_normalized jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_org uuid := (select public.current_org_id());
  v_file public.amazon_import_files%rowtype;
  v_invoice_id uuid;
  v_report_id uuid;
  v_raw_count int := coalesce(jsonb_array_length(coalesce(p_raw_rows, '[]'::jsonb)), 0);
  v_issue_count int := coalesce(jsonb_array_length(coalesce(p_issues, '[]'::jsonb)), 0);
  v_reconciliation_count int := coalesce(jsonb_array_length(coalesce(p_reconciliations, '[]'::jsonb)), 0);
  v_record_count int := 0;
begin
  if v_org is null or not (select public.is_org_writer()) then
    raise exception 'Writer role is required.';
  end if;
  if p_organization_id is distinct from v_org then
    raise exception 'Wrong organization.';
  end if;

  select *
    into v_file
  from public.amazon_import_files f
  where f.organization_id = p_organization_id
    and f.batch_id = p_batch_id
    and f.id = p_file_id
  for update;

  if not found then
    raise exception 'Amazon import file not found.';
  end if;
  if v_file.source_type is distinct from p_source_type then
    raise exception 'Amazon import file source type changed.';
  end if;
  if v_file.status = 'archived' then
    raise exception 'Archived Amazon import files are immutable.';
  end if;
  if v_file.status = 'parsed'
    and (
      v_file.parser_version is distinct from p_parser_version
      or v_file.schema_signature is distinct from p_schema_signature
    ) then
    raise exception 'Parser version or schema signature changed; create a controlled source revision.';
  end if;

  update public.amazon_import_files f
     set status = 'parsing',
         parser_name = p_parser_name,
         parser_version = p_parser_version,
         schema_signature = p_schema_signature
   where f.organization_id = p_organization_id
     and f.id = p_file_id;

  insert into public.amazon_import_raw_rows (
    organization_id, batch_id, file_id, source_sheet, source_page, source_group,
    source_row_number, raw_data, normalized_data, parse_status, parse_warning
  )
  select p_organization_id,
         p_batch_id,
         p_file_id,
         r.source_sheet,
         r.source_page,
         r.source_group,
         r.source_row_number,
         coalesce(r.raw_data, '{}'::jsonb),
         coalesce(r.normalized_data, '{}'::jsonb),
         coalesce(r.parse_status, 'parsed'),
         r.parse_warning
  from jsonb_to_recordset(coalesce(p_raw_rows, '[]'::jsonb)) as r(
    source_sheet text,
    source_page int,
    source_group text,
    source_row_number int,
    raw_data jsonb,
    normalized_data jsonb,
    parse_status text,
    parse_warning text
  )
  on conflict (
    organization_id,
    batch_id,
    file_id,
    (coalesce(source_sheet, '__NULL_SOURCE_SHEET__')),
    (coalesce(source_page, -2147483648)),
    (coalesce(source_group, '__NULL_SOURCE_GROUP__')),
    (coalesce(source_row_number, -2147483648))
  )
  do update set
    raw_data = excluded.raw_data,
    normalized_data = excluded.normalized_data,
    parse_status = excluded.parse_status,
    parse_warning = excluded.parse_warning;

  insert into public.amazon_import_issues (
    organization_id, batch_id, file_id, raw_row_id, issue_code, severity, message, details, status
  )
  select p_organization_id,
         p_batch_id,
         p_file_id,
         null,
         i.issue_code,
         i.severity,
         i.message,
         coalesce(i.details, '{}'::jsonb),
         'open'
  from jsonb_to_recordset(coalesce(p_issues, '[]'::jsonb)) as i(
    issue_code text,
    severity text,
    message text,
    details jsonb
  )
  where not exists (
    select 1
    from public.amazon_import_issues existing
    where existing.organization_id = p_organization_id
      and existing.batch_id = p_batch_id
      and existing.file_id = p_file_id
      and existing.status = 'open'
      and existing.details->>'issueKey' = i.details->>'issueKey'
  );

  delete from public.amazon_import_reconciliations r
  where r.organization_id = p_organization_id
    and r.batch_id = p_batch_id
    and r.details->>'fileId' = p_file_id::text;

  insert into public.amazon_import_reconciliations (
    organization_id, batch_id, reconciliation_type, expected_amount, actual_amount,
    difference_amount, expected_count, actual_count, status, details
  )
  select p_organization_id,
         p_batch_id,
         r.reconciliation_type,
         r.expected_amount,
         r.actual_amount,
         case
           when r.expected_amount is null or r.actual_amount is null then null
           else round(r.expected_amount - r.actual_amount, 2)
         end,
         r.expected_count,
         r.actual_count,
         coalesce(r.status, 'passed'),
         coalesce(r.details, '{}'::jsonb) || jsonb_build_object('fileId', p_file_id::text)
  from jsonb_to_recordset(coalesce(p_reconciliations, '[]'::jsonb)) as r(
    reconciliation_type text,
    expected_amount numeric,
    actual_amount numeric,
    expected_count int,
    actual_count int,
    status text,
    details jsonb
  );

  if p_source_type = 'amazon_payment' then
    insert into public.amazon_payment_invoices (
      organization_id, batch_id, file_id, invoice_number, invoice_date, period_start,
      period_end, payment_date, payment_status, carrier_identifier, summary_total,
      parser_version, schema_signature, source_snapshot
    )
    values (
      p_organization_id,
      p_batch_id,
      p_file_id,
      p_normalized->'invoice'->>'invoice_number',
      nullif(p_normalized->'invoice'->>'invoice_date', '')::date,
      nullif(p_normalized->'invoice'->>'period_start', '')::date,
      nullif(p_normalized->'invoice'->>'period_end', '')::date,
      nullif(p_normalized->'invoice'->>'payment_date', '')::date,
      p_normalized->'invoice'->>'payment_status',
      p_normalized->'invoice'->>'carrier_identifier',
      nullif(p_normalized->'invoice'->>'summary_total', '')::numeric,
      p_parser_version,
      p_schema_signature,
      coalesce(p_normalized->'invoice'->'source_snapshot', '{}'::jsonb)
    )
    on conflict (organization_id, file_id, invoice_number)
    do update set
      invoice_date = excluded.invoice_date,
      period_start = excluded.period_start,
      period_end = excluded.period_end,
      payment_date = excluded.payment_date,
      payment_status = excluded.payment_status,
      carrier_identifier = excluded.carrier_identifier,
      summary_total = excluded.summary_total,
      parser_version = excluded.parser_version,
      schema_signature = excluded.schema_signature,
      source_snapshot = excluded.source_snapshot
    returning id into v_invoice_id;

    insert into public.amazon_payment_rows (
      organization_id, batch_id, file_id, raw_row_id, invoice_id, source_row_number,
      source_fingerprint, row_classification, trip_id, load_id, start_date, end_date,
      route_raw, distance, base_amount, fuel_surcharge_amount, toll_amount,
      detention_amount, tonu_amount, other_amount, gross_amount, item_type, status,
      parse_status, source_snapshot
    )
    select p_organization_id,
           p_batch_id,
           p_file_id,
           (
             select rr.id
             from public.amazon_import_raw_rows rr
             where rr.organization_id = p_organization_id
               and rr.batch_id = p_batch_id
               and rr.file_id = p_file_id
               and coalesce(rr.source_sheet, '') = coalesce(r.source_sheet, '')
               and coalesce(rr.source_page, -2147483648) = coalesce(r.source_page, -2147483648)
               and coalesce(rr.source_group, '') = coalesce(r.source_group, '')
               and coalesce(rr.source_row_number, -2147483648) = coalesce(r.source_row_number, -2147483648)
             limit 1
           ),
           v_invoice_id,
           r.source_row_number,
           r.source_fingerprint,
           r.row_classification,
           r.trip_id,
           r.load_id,
           r.start_date,
           r.end_date,
           r.route_raw,
           r.distance,
           r.base_amount,
           r.fuel_surcharge_amount,
           r.toll_amount,
           r.detention_amount,
           r.tonu_amount,
           r.other_amount,
           r.gross_amount,
           r.item_type,
           r.status,
           coalesce(r.parse_status, 'parsed'),
           coalesce(r.source_snapshot, '{}'::jsonb)
    from jsonb_to_recordset(coalesce(p_normalized->'payment_rows', '[]'::jsonb)) as r(
      source_sheet text,
      source_page int,
      source_group text,
      source_row_number int,
      source_fingerprint text,
      row_classification text,
      trip_id text,
      load_id text,
      start_date date,
      end_date date,
      route_raw text,
      distance numeric,
      base_amount numeric,
      fuel_surcharge_amount numeric,
      toll_amount numeric,
      detention_amount numeric,
      tonu_amount numeric,
      other_amount numeric,
      gross_amount numeric,
      item_type text,
      status text,
      parse_status text,
      source_snapshot jsonb
    )
    on conflict (organization_id, file_id, source_fingerprint)
    do update set
      raw_row_id = excluded.raw_row_id,
      invoice_id = excluded.invoice_id,
      row_classification = excluded.row_classification,
      trip_id = excluded.trip_id,
      load_id = excluded.load_id,
      start_date = excluded.start_date,
      end_date = excluded.end_date,
      route_raw = excluded.route_raw,
      distance = excluded.distance,
      base_amount = excluded.base_amount,
      fuel_surcharge_amount = excluded.fuel_surcharge_amount,
      toll_amount = excluded.toll_amount,
      detention_amount = excluded.detention_amount,
      tonu_amount = excluded.tonu_amount,
      other_amount = excluded.other_amount,
      gross_amount = excluded.gross_amount,
      item_type = excluded.item_type,
      status = excluded.status,
      parse_status = excluded.parse_status,
      source_snapshot = excluded.source_snapshot;

    v_record_count := 1 + coalesce(jsonb_array_length(coalesce(p_normalized->'payment_rows', '[]'::jsonb)), 0);
  elsif p_source_type = 'amazon_trips' then
    insert into public.amazon_trip_rows (
      organization_id, batch_id, file_id, raw_row_id, source_row_number, source_fingerprint,
      trip_id, load_id, raw_driver_text, tractor_external_id, operator_type,
      equipment_type, trip_status, load_status, estimated_distance, facility_sequence,
      stops, source_snapshot
    )
    select p_organization_id,
           p_batch_id,
           p_file_id,
           (
             select rr.id
             from public.amazon_import_raw_rows rr
             where rr.organization_id = p_organization_id
               and rr.batch_id = p_batch_id
               and rr.file_id = p_file_id
               and coalesce(rr.source_sheet, '') = coalesce(r.source_sheet, '')
               and coalesce(rr.source_page, -2147483648) = coalesce(r.source_page, -2147483648)
               and coalesce(rr.source_group, '') = coalesce(r.source_group, '')
               and coalesce(rr.source_row_number, -2147483648) = coalesce(r.source_row_number, -2147483648)
             limit 1
           ),
           r.source_row_number,
           r.source_fingerprint,
           r.trip_id,
           r.load_id,
           r.raw_driver_text,
           r.tractor_external_id,
           r.operator_type,
           r.equipment_type,
           r.trip_status,
           r.load_status,
           r.estimated_distance,
           coalesce(r.facility_sequence, '[]'::jsonb),
           coalesce(r.stops, '[]'::jsonb),
           coalesce(r.source_snapshot, '{}'::jsonb)
    from jsonb_to_recordset(coalesce(p_normalized->'trip_rows', '[]'::jsonb)) as r(
      source_sheet text,
      source_page int,
      source_group text,
      source_row_number int,
      source_fingerprint text,
      trip_id text,
      load_id text,
      raw_driver_text text,
      tractor_external_id text,
      operator_type text,
      equipment_type text,
      trip_status text,
      load_status text,
      estimated_distance numeric,
      facility_sequence jsonb,
      stops jsonb,
      source_snapshot jsonb
    )
    on conflict (organization_id, file_id, source_fingerprint)
    do update set
      raw_row_id = excluded.raw_row_id,
      source_row_number = excluded.source_row_number,
      trip_id = excluded.trip_id,
      load_id = excluded.load_id,
      raw_driver_text = excluded.raw_driver_text,
      tractor_external_id = excluded.tractor_external_id,
      operator_type = excluded.operator_type,
      equipment_type = excluded.equipment_type,
      trip_status = excluded.trip_status,
      load_status = excluded.load_status,
      estimated_distance = excluded.estimated_distance,
      facility_sequence = excluded.facility_sequence,
      stops = excluded.stops,
      source_snapshot = excluded.source_snapshot;

    delete from public.amazon_trip_driver_tokens t
    using public.amazon_trip_rows tr
    where t.organization_id = p_organization_id
      and tr.organization_id = t.organization_id
      and tr.id = t.trip_row_id
      and tr.file_id = p_file_id;

    insert into public.amazon_trip_driver_tokens (
      organization_id, trip_row_id, token_order, raw_name, normalized_name,
      is_team_assignment, requires_split_rule
    )
    select p_organization_id,
           tr.id,
           d.token_order,
           d.raw_name,
           d.normalized_name,
           coalesce(d.is_team_assignment, false),
           coalesce(d.requires_split_rule, false)
    from jsonb_to_recordset(coalesce(p_normalized->'driver_tokens', '[]'::jsonb)) as d(
      source_fingerprint text,
      token_order int,
      raw_name text,
      normalized_name text,
      is_team_assignment boolean,
      requires_split_rule boolean
    )
    join public.amazon_trip_rows tr
      on tr.organization_id = p_organization_id
     and tr.file_id = p_file_id
     and tr.source_fingerprint = d.source_fingerprint;

    v_record_count :=
      coalesce(jsonb_array_length(coalesce(p_normalized->'trip_rows', '[]'::jsonb)), 0)
      + coalesce(jsonb_array_length(coalesce(p_normalized->'driver_tokens', '[]'::jsonb)), 0);
  elsif p_source_type = 'fuel_card' then
    insert into public.fuel_import_reports (
      organization_id, batch_id, file_id, provider, carrier_identifier, period_start,
      period_end, generated_at, reported_transaction_count, reported_total_amount,
      reported_total_quantity, reported_discount_amount, parser_name, parser_version,
      schema_signature, source_snapshot
    )
    values (
      p_organization_id,
      p_batch_id,
      p_file_id,
      p_normalized->'report'->>'provider',
      p_normalized->'report'->>'carrier_identifier',
      nullif(p_normalized->'report'->>'period_start', '')::date,
      nullif(p_normalized->'report'->>'period_end', '')::date,
      nullif(p_normalized->'report'->>'generated_at', '')::timestamptz,
      nullif(p_normalized->'report'->>'reported_transaction_count', '')::int,
      nullif(p_normalized->'report'->>'reported_total_amount', '')::numeric,
      nullif(p_normalized->'report'->>'reported_total_quantity', '')::numeric,
      nullif(p_normalized->'report'->>'reported_discount_amount', '')::numeric,
      p_parser_name,
      p_parser_version,
      p_schema_signature,
      coalesce(p_normalized->'report'->'source_snapshot', '{}'::jsonb)
    )
    on conflict (organization_id, file_id)
    do update set
      carrier_identifier = excluded.carrier_identifier,
      period_start = excluded.period_start,
      period_end = excluded.period_end,
      generated_at = excluded.generated_at,
      reported_transaction_count = excluded.reported_transaction_count,
      reported_total_amount = excluded.reported_total_amount,
      reported_total_quantity = excluded.reported_total_quantity,
      reported_discount_amount = excluded.reported_discount_amount,
      parser_name = excluded.parser_name,
      parser_version = excluded.parser_version,
      schema_signature = excluded.schema_signature,
      source_snapshot = excluded.source_snapshot
    returning id into v_report_id;

    insert into public.fuel_import_card_groups (
      organization_id, report_id, source_group_number, card_external_id, card_last_four,
      driver_label_raw, driver_label_normalized, unit_label_raw, unit_label_normalized,
      reported_transaction_count, reported_total_amount, reported_total_quantity,
      reported_discount_amount, is_placeholder_group, source_page_start, source_page_end,
      source_snapshot
    )
    select p_organization_id,
           v_report_id,
           g.source_group_number,
           g.card_external_id,
           g.card_last_four,
           g.driver_label_raw,
           g.driver_label_normalized,
           g.unit_label_raw,
           g.unit_label_normalized,
           g.reported_transaction_count,
           g.reported_total_amount,
           g.reported_total_quantity,
           g.reported_discount_amount,
           coalesce(g.is_placeholder_group, false),
           g.source_page_start,
           g.source_page_end,
           coalesce(g.source_snapshot, '{}'::jsonb)
    from jsonb_to_recordset(coalesce(p_normalized->'card_groups', '[]'::jsonb)) as g(
      source_group_number int,
      card_external_id text,
      card_last_four text,
      driver_label_raw text,
      driver_label_normalized text,
      unit_label_raw text,
      unit_label_normalized text,
      reported_transaction_count int,
      reported_total_amount numeric,
      reported_total_quantity numeric,
      reported_discount_amount numeric,
      is_placeholder_group boolean,
      source_page_start int,
      source_page_end int,
      source_snapshot jsonb
    )
    on conflict (organization_id, report_id, source_group_number)
    do update set
      card_external_id = excluded.card_external_id,
      card_last_four = excluded.card_last_four,
      driver_label_raw = excluded.driver_label_raw,
      driver_label_normalized = excluded.driver_label_normalized,
      unit_label_raw = excluded.unit_label_raw,
      unit_label_normalized = excluded.unit_label_normalized,
      reported_transaction_count = excluded.reported_transaction_count,
      reported_total_amount = excluded.reported_total_amount,
      reported_total_quantity = excluded.reported_total_quantity,
      reported_discount_amount = excluded.reported_discount_amount,
      is_placeholder_group = excluded.is_placeholder_group,
      source_page_start = excluded.source_page_start,
      source_page_end = excluded.source_page_end,
      source_snapshot = excluded.source_snapshot;

    insert into public.fuel_import_transactions (
      organization_id, report_id, card_group_id, source_transaction_fingerprint,
      transaction_at, invoice_number, merchant_raw, city_raw, state_raw,
      odometer_raw, fees_amount, source_page, source_row_number, source_snapshot
    )
    select p_organization_id,
           v_report_id,
           cg.id,
           t.source_transaction_fingerprint,
           t.transaction_at,
           t.invoice_number,
           t.merchant_raw,
           t.city_raw,
           t.state_raw,
           t.odometer_raw,
           t.fees_amount,
           t.source_page,
           t.source_row_number,
           coalesce(t.source_snapshot, '{}'::jsonb)
    from jsonb_to_recordset(coalesce(p_normalized->'transactions', '[]'::jsonb)) as t(
      source_group_number int,
      source_transaction_fingerprint text,
      transaction_at timestamptz,
      invoice_number text,
      merchant_raw text,
      city_raw text,
      state_raw text,
      odometer_raw text,
      fees_amount numeric,
      source_page int,
      source_row_number int,
      source_snapshot jsonb
    )
    join public.fuel_import_card_groups cg
      on cg.organization_id = p_organization_id
     and cg.report_id = v_report_id
     and cg.source_group_number = t.source_group_number
    on conflict (organization_id, report_id, source_transaction_fingerprint)
    do update set
      card_group_id = excluded.card_group_id,
      transaction_at = excluded.transaction_at,
      invoice_number = excluded.invoice_number,
      merchant_raw = excluded.merchant_raw,
      city_raw = excluded.city_raw,
      state_raw = excluded.state_raw,
      odometer_raw = excluded.odometer_raw,
      fees_amount = excluded.fees_amount,
      source_page = excluded.source_page,
      source_row_number = excluded.source_row_number,
      source_snapshot = excluded.source_snapshot;

    insert into public.fuel_import_transaction_lines (
      organization_id, transaction_id, source_line_order, product_type_raw,
      product_type_normalized, quantity, retail_unit_price, charged_unit_price,
      discount_per_unit, discount_amount, deal_type, charged_amount, source_snapshot
    )
    select p_organization_id,
           tx.id,
           l.source_line_order,
           l.product_type_raw,
           l.product_type_normalized,
           l.quantity,
           l.retail_unit_price,
           l.charged_unit_price,
           l.discount_per_unit,
           l.discount_amount,
           l.deal_type,
           l.charged_amount,
           coalesce(l.source_snapshot, '{}'::jsonb)
    from jsonb_to_recordset(coalesce(p_normalized->'product_lines', '[]'::jsonb)) as l(
      source_transaction_fingerprint text,
      source_line_order int,
      product_type_raw text,
      product_type_normalized text,
      quantity numeric,
      retail_unit_price numeric,
      charged_unit_price numeric,
      discount_per_unit numeric,
      discount_amount numeric,
      deal_type text,
      charged_amount numeric,
      source_snapshot jsonb
    )
    join public.fuel_import_transactions tx
      on tx.organization_id = p_organization_id
     and tx.report_id = v_report_id
     and tx.source_transaction_fingerprint = l.source_transaction_fingerprint
    on conflict (organization_id, transaction_id, source_line_order)
    do update set
      product_type_raw = excluded.product_type_raw,
      product_type_normalized = excluded.product_type_normalized,
      quantity = excluded.quantity,
      retail_unit_price = excluded.retail_unit_price,
      charged_unit_price = excluded.charged_unit_price,
      discount_per_unit = excluded.discount_per_unit,
      discount_amount = excluded.discount_amount,
      deal_type = excluded.deal_type,
      charged_amount = excluded.charged_amount,
      source_snapshot = excluded.source_snapshot;

    v_record_count :=
      1
      + coalesce(jsonb_array_length(coalesce(p_normalized->'card_groups', '[]'::jsonb)), 0)
      + coalesce(jsonb_array_length(coalesce(p_normalized->'transactions', '[]'::jsonb)), 0)
      + coalesce(jsonb_array_length(coalesce(p_normalized->'product_lines', '[]'::jsonb)), 0);
  elsif p_source_type = 'statement_reference' then
    v_record_count := 0;
  else
    raise exception 'Unsupported Amazon source type.';
  end if;

  update public.amazon_import_files f
     set status = 'parsed',
         parser_name = p_parser_name,
         parser_version = p_parser_version,
         schema_signature = p_schema_signature
   where f.organization_id = p_organization_id
     and f.id = p_file_id;

  return jsonb_build_object(
    'normalizedKind', p_source_type,
    'recordCount', v_record_count,
    'rawRowCount', v_raw_count,
    'issueCount', v_issue_count,
    'reconciliationCount', v_reconciliation_count
  );
end;
$$;

revoke execute on function public.persist_amazon_source_atomic(uuid, uuid, uuid, text, text, text, text, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.persist_amazon_source_atomic(uuid, uuid, uuid, text, text, text, text, jsonb, jsonb, jsonb, jsonb) to authenticated;

create or replace function public.convert_amazon_candidate_atomic(
  p_candidate_id uuid,
  p_expected_preview_revision text,
  p_expected_source_revision text,
  p_expected_configuration_revision text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := (select public.current_org_id());
  v_user uuid := auth.uid();
  v_candidate public.amazon_statement_candidates%rowtype;
  v_config_revision text;
  v_line_items jsonb;
  v_load_ids uuid[];
  v_expense_ids uuid[];
  v_settlement_id uuid;
  v_driver_id uuid;
  v_owner_id uuid;
  v_usage_group text;
  v_idempotency_key text;
begin
  if v_org is null or v_user is null or not (select public.is_org_writer()) then
    raise exception 'Writer role is required.';
  end if;

  select *
    into v_candidate
  from public.amazon_statement_candidates c
  where c.organization_id = v_org
    and c.id = p_candidate_id
  for update;

  if not found then
    raise exception 'Amazon statement candidate not found.';
  end if;

  if v_candidate.status = 'converted' then
    if v_candidate.converted_settlement_id is null then
      raise exception 'Converted candidate is missing settlement lineage.';
    end if;
    return jsonb_build_object(
      'status', 'already_converted',
      'settlementId', v_candidate.converted_settlement_id
    );
  end if;

  if v_candidate.status <> 'ready' then
    raise exception 'Amazon statement candidate is not ready.';
  end if;
  if v_candidate.preview_revision is distinct from p_expected_preview_revision then
    raise exception 'Stale Amazon statement candidate preview revision.';
  end if;
  if v_candidate.source_revision is distinct from p_expected_source_revision then
    raise exception 'Stale Amazon statement candidate source revision.';
  end if;

  v_config_revision := md5(v_candidate.configuration_snapshot::text);
  if p_expected_configuration_revision is not null and v_config_revision is distinct from p_expected_configuration_revision then
    raise exception 'Stale Amazon statement candidate configuration revision.';
  end if;

  v_usage_group := public.settlement_usage_group(v_candidate.statement_type);
  if v_usage_group is null then
    raise exception 'Unsupported Amazon statement candidate settlement type.';
  end if;

  select coalesce(array_agg(r.load_id order by r.display_order), '{}'::uuid[])
    into v_load_ids
  from public.amazon_statement_candidate_revenue r
  where r.organization_id = v_org
    and r.candidate_id = p_candidate_id;

  select coalesce(array_agg(f.expense_id order by f.display_order), '{}'::uuid[])
    into v_expense_ids
  from public.amazon_statement_candidate_fuel_lines f
  where f.organization_id = v_org
    and f.candidate_id = p_candidate_id;

  if coalesce(array_length(v_load_ids, 1), 0) = 0 then
    raise exception 'Amazon statement candidate has no selected revenue loads.';
  end if;

  perform 1
  from public.settlement_load_links l
  where l.organization_id = v_org
    and l.load_id = any(v_load_ids)
    and l.released_at is null
    and (
      case when l.usage_group in ('owner','investor') then 'asset_owner' else l.usage_group end
    ) = (
      case when v_usage_group in ('owner','investor') then 'asset_owner' else v_usage_group end
    )
  for update;
  if found then
    raise exception 'One or more selected Amazon loads are already linked to a settlement lane.';
  end if;

  if coalesce(array_length(v_expense_ids, 1), 0) > 0 then
    perform 1
    from public.settlement_expense_links e
    where e.organization_id = v_org
      and e.expense_id = any(v_expense_ids)
      and e.released_at is null
      and (
        case when e.usage_group in ('owner','investor') then 'asset_owner' else e.usage_group end
      ) = (
        case when v_usage_group in ('owner','investor') then 'asset_owner' else v_usage_group end
      )
    for update;
    if found then
      raise exception 'One or more selected Amazon expenses are already linked to a settlement lane.';
    end if;
  end if;

  v_line_items := (
    select coalesce(jsonb_agg(jsonb_build_object(
      'key', li.value->>'key',
      'label_en', coalesce(li.value->>'labelEn', li.value->>'label_en', li.value->>'key'),
      'label_tr', coalesce(li.value->>'labelTr', li.value->>'label_tr', li.value->>'labelEn', li.value->>'key'),
      'amount', coalesce(nullif(li.value->>'amount', '')::numeric, 0),
      'is_our_revenue', coalesce((li.value->>'isOurRevenue')::boolean, (li.value->>'is_our_revenue')::boolean, false),
      'sort_order', li.ordinality - 1
    ) order by li.ordinality), '[]'::jsonb)
    from jsonb_array_elements(coalesce(v_candidate.calculation_snapshot->'lineItems', '[]'::jsonb)) with ordinality li(value, ordinality)
  );

  v_driver_id := case when v_usage_group = 'driver' then v_candidate.payee_id else null end;
  v_owner_id := case when v_usage_group in ('owner','investor') then v_candidate.payee_id else null end;
  v_idempotency_key := 'amazon-candidate:' || p_candidate_id::text || ':' || p_expected_preview_revision;

  v_settlement_id := public.create_settlement_with_links_atomic(
    v_org,
    v_user,
    v_candidate.statement_type,
    v_usage_group,
    null,
    null,
    v_candidate.vehicle_id,
    v_driver_id,
    v_owner_id,
    v_candidate.period_start,
    v_candidate.period_end,
    v_candidate.configuration_snapshot || jsonb_build_object(
      'amazon_statement_candidate_id', v_candidate.id,
      'amazon_statement_candidate_preview_revision', v_candidate.preview_revision,
      'amazon_statement_candidate_source_revision', v_candidate.source_revision
    ),
    v_candidate.gross_amount,
    v_candidate.total_deductions_amount,
    0,
    v_candidate.net_amount,
    null,
    v_line_items,
    v_load_ids,
    v_expense_ids
  );

  update public.amazon_statement_candidates c
     set status = 'converted',
         converted_settlement_id = v_settlement_id,
         converted_at = now(),
         conversion_idempotency_key = v_idempotency_key
   where c.organization_id = v_org
     and c.id = p_candidate_id
     and c.status = 'ready'
     and c.preview_revision = p_expected_preview_revision
     and c.source_revision = p_expected_source_revision;

  if not found then
    raise exception 'Amazon statement candidate conversion state changed before completion.';
  end if;

  return jsonb_build_object(
    'status', 'converted',
    'settlementId', v_settlement_id,
    'idempotencyKey', v_idempotency_key
  );
end;
$$;

revoke execute on function public.convert_amazon_candidate_atomic(uuid, text, text, text) from public, anon;
grant execute on function public.convert_amazon_candidate_atomic(uuid, text, text, text) to authenticated;
