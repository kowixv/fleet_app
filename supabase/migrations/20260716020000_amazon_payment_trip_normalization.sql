-- Amazon payment/trip normalization layer.
-- This migration adds normalized source tables only. It does not create loads, expenses,
-- settlement candidates, settlements, fuel tables, or PDF artifacts.

create table if not exists public.amazon_payment_invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  batch_id uuid not null,
  file_id uuid not null,
  invoice_number text not null,
  invoice_date date,
  period_start date,
  period_end date,
  payment_date date,
  payment_status text,
  carrier_identifier text,
  summary_total numeric,
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  parser_version text not null,
  schema_signature text not null,
  source_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint amazon_payment_invoices_org_id_id_key unique (organization_id, id),
  constraint amazon_payment_invoices_org_batch_id_id_key unique (organization_id, batch_id, id),
  constraint amazon_payment_invoices_file_invoice_key unique (organization_id, file_id, invoice_number),
  constraint amazon_payment_invoices_batch_same_org_fk
    foreign key (organization_id, batch_id)
    references public.amazon_import_batches (organization_id, id) on delete cascade,
  constraint amazon_payment_invoices_file_same_batch_fk
    foreign key (organization_id, batch_id, file_id)
    references public.amazon_import_files (organization_id, batch_id, id) on delete cascade,
  constraint amazon_payment_invoices_period_check
    check (period_start is null or period_end is null or period_end >= period_start)
);

create table if not exists public.amazon_payment_rows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  batch_id uuid not null,
  file_id uuid not null,
  raw_row_id uuid,
  invoice_id uuid not null,
  source_row_number int,
  source_fingerprint text not null,
  row_classification text not null
    check (row_classification in ('trip_parent','load_child','standalone_load','non_financial','invalid')),
  trip_id text,
  load_id text,
  start_date date,
  end_date date,
  route_raw text,
  facility_sequence jsonb not null default '[]'::jsonb,
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
  parse_status text not null default 'parsed'
    check (parse_status in ('pending','parsed','warning','failed','skipped')),
  source_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint amazon_payment_rows_org_id_id_key unique (organization_id, id),
  constraint amazon_payment_rows_org_batch_id_id_key unique (organization_id, batch_id, id),
  constraint amazon_payment_rows_source_fingerprint_key unique (organization_id, file_id, source_fingerprint),
  constraint amazon_payment_rows_batch_same_org_fk
    foreign key (organization_id, batch_id)
    references public.amazon_import_batches (organization_id, id) on delete cascade,
  constraint amazon_payment_rows_file_same_batch_fk
    foreign key (organization_id, batch_id, file_id)
    references public.amazon_import_files (organization_id, batch_id, id) on delete cascade,
  constraint amazon_payment_rows_raw_row_same_batch_fk
    foreign key (organization_id, batch_id, raw_row_id)
    references public.amazon_import_raw_rows (organization_id, batch_id, id) on delete set null (raw_row_id),
  constraint amazon_payment_rows_invoice_same_batch_fk
    foreign key (organization_id, batch_id, invoice_id)
    references public.amazon_payment_invoices (organization_id, batch_id, id) on delete cascade,
  constraint amazon_payment_rows_date_check
    check (start_date is null or end_date is null or end_date >= start_date)
);

create table if not exists public.amazon_trip_rows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  batch_id uuid not null,
  file_id uuid not null,
  raw_row_id uuid,
  source_row_number int,
  source_fingerprint text not null,
  trip_id text,
  load_id text,
  raw_driver_text text,
  tractor_external_id text,
  operator_type text,
  equipment_type text,
  trip_status text,
  load_status text,
  estimated_distance numeric,
  facility_sequence jsonb not null default '[]'::jsonb,
  stops jsonb not null default '[]'::jsonb,
  planned_first_arrival timestamptz,
  planned_final_departure timestamptz,
  actual_first_arrival timestamptz,
  actual_final_departure timestamptz,
  source_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint amazon_trip_rows_org_id_id_key unique (organization_id, id),
  constraint amazon_trip_rows_org_batch_id_id_key unique (organization_id, batch_id, id),
  constraint amazon_trip_rows_source_fingerprint_key unique (organization_id, file_id, source_fingerprint),
  constraint amazon_trip_rows_batch_same_org_fk
    foreign key (organization_id, batch_id)
    references public.amazon_import_batches (organization_id, id) on delete cascade,
  constraint amazon_trip_rows_file_same_batch_fk
    foreign key (organization_id, batch_id, file_id)
    references public.amazon_import_files (organization_id, batch_id, id) on delete cascade,
  constraint amazon_trip_rows_raw_row_same_batch_fk
    foreign key (organization_id, batch_id, raw_row_id)
    references public.amazon_import_raw_rows (organization_id, batch_id, id) on delete set null (raw_row_id)
);

create table if not exists public.amazon_trip_driver_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  trip_row_id uuid not null,
  token_order int not null check (token_order > 0),
  raw_name text not null,
  normalized_name text not null,
  is_team_assignment boolean not null default false,
  requires_split_rule boolean not null default false,
  created_at timestamptz not null default now(),
  constraint amazon_trip_driver_tokens_trip_row_order_key unique (organization_id, trip_row_id, token_order),
  constraint amazon_trip_driver_tokens_trip_row_same_org_fk
    foreign key (organization_id, trip_row_id)
    references public.amazon_trip_rows (organization_id, id) on delete cascade
);

create table if not exists public.amazon_import_matches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  batch_id uuid not null,
  payment_row_id uuid not null,
  trip_row_id uuid,
  match_type text not null,
  match_method text not null
    check (match_method in ('exact_load_id','exact_trip_id','vehicle_period_facility','manual')),
  confidence_score numeric not null check (confidence_score >= 0 and confidence_score <= 1),
  status text not null
    check (status in ('exact','inferred','ambiguous','unmatched','manually_approved','rejected')),
  reasons jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint amazon_import_matches_org_id_id_key unique (organization_id, id),
  constraint amazon_import_matches_batch_same_org_fk
    foreign key (organization_id, batch_id)
    references public.amazon_import_batches (organization_id, id) on delete cascade,
  constraint amazon_import_matches_payment_same_batch_fk
    foreign key (organization_id, batch_id, payment_row_id)
    references public.amazon_payment_rows (organization_id, batch_id, id) on delete cascade,
  constraint amazon_import_matches_trip_same_batch_fk
    foreign key (organization_id, batch_id, trip_row_id)
    references public.amazon_trip_rows (organization_id, batch_id, id) on delete set null (trip_row_id)
);

create unique index if not exists amazon_import_matches_one_active_approved_key
  on public.amazon_import_matches (organization_id, payment_row_id)
  where status in ('exact','inferred','manually_approved');

create table if not exists public.amazon_revenue_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  batch_id uuid not null,
  invoice_id uuid not null,
  grouping_type text not null check (grouping_type in ('trip','load')),
  grouping_key text not null,
  trip_id text,
  primary_load_id text,
  start_date date,
  end_date date,
  origin_facility_code text,
  destination_facility_code text,
  route_resolution_status text not null default 'unresolved'
    check (route_resolution_status in ('resolved','unresolved','not_applicable')),
  distance numeric,
  base_amount numeric not null default 0,
  fuel_surcharge_amount numeric not null default 0,
  toll_amount numeric not null default 0,
  detention_amount numeric not null default 0,
  tonu_amount numeric not null default 0,
  other_amount numeric not null default 0,
  gross_amount numeric not null default 0,
  match_status text not null,
  driver_assignment_status text not null,
  vehicle_assignment_status text not null,
  reconciliation_status text not null
    check (reconciliation_status in ('pending','passed','warning','failed')),
  source_revision text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint amazon_revenue_items_org_id_id_key unique (organization_id, id),
  constraint amazon_revenue_items_org_batch_id_id_key unique (organization_id, batch_id, id),
  constraint amazon_revenue_items_grouping_key unique (organization_id, invoice_id, grouping_key),
  constraint amazon_revenue_items_batch_same_org_fk
    foreign key (organization_id, batch_id)
    references public.amazon_import_batches (organization_id, id) on delete cascade,
  constraint amazon_revenue_items_invoice_same_batch_fk
    foreign key (organization_id, batch_id, invoice_id)
    references public.amazon_payment_invoices (organization_id, batch_id, id) on delete cascade,
  constraint amazon_revenue_items_date_check
    check (start_date is null or end_date is null or end_date >= start_date)
);

create table if not exists public.amazon_revenue_item_sources (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  revenue_item_id uuid not null,
  payment_row_id uuid not null,
  contribution_type text not null
    check (contribution_type in ('parent_base','child_accessorial','standalone','other')),
  created_at timestamptz not null default now(),
  primary key (organization_id, revenue_item_id, payment_row_id),
  constraint amazon_revenue_item_sources_revenue_item_same_org_fk
    foreign key (organization_id, revenue_item_id)
    references public.amazon_revenue_items (organization_id, id) on delete cascade,
  constraint amazon_revenue_item_sources_payment_row_same_batch_fk
    foreign key (organization_id, payment_row_id)
    references public.amazon_payment_rows (organization_id, id) on delete cascade
);

create unique index if not exists amazon_revenue_item_sources_one_active_contribution_key
  on public.amazon_revenue_item_sources (organization_id, payment_row_id);

create or replace function public.guard_amazon_payment_invoice_source()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.amazon_revenue_items ri
    where ri.organization_id = old.organization_id
      and ri.invoice_id = old.id
  ) and (
    new.batch_id is distinct from old.batch_id
    or new.file_id is distinct from old.file_id
    or new.invoice_number is distinct from old.invoice_number
    or new.summary_total is distinct from old.summary_total
    or new.parser_version is distinct from old.parser_version
    or new.schema_signature is distinct from old.schema_signature
    or new.source_snapshot is distinct from old.source_snapshot
  ) then
    raise exception 'Amazon payment invoice source facts cannot be changed after revenue items depend on them.';
  end if;
  return new;
end;
$$;

create or replace function public.guard_amazon_payment_row_source()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.amazon_revenue_item_sources ris
    where ris.organization_id = old.organization_id
      and ris.payment_row_id = old.id
  ) and (
    new.batch_id is distinct from old.batch_id
    or new.file_id is distinct from old.file_id
    or new.raw_row_id is distinct from old.raw_row_id
    or new.invoice_id is distinct from old.invoice_id
    or new.source_row_number is distinct from old.source_row_number
    or new.source_fingerprint is distinct from old.source_fingerprint
    or new.row_classification is distinct from old.row_classification
    or new.trip_id is distinct from old.trip_id
    or new.load_id is distinct from old.load_id
    or new.base_amount is distinct from old.base_amount
    or new.fuel_surcharge_amount is distinct from old.fuel_surcharge_amount
    or new.toll_amount is distinct from old.toll_amount
    or new.detention_amount is distinct from old.detention_amount
    or new.tonu_amount is distinct from old.tonu_amount
    or new.other_amount is distinct from old.other_amount
    or new.gross_amount is distinct from old.gross_amount
    or new.source_snapshot is distinct from old.source_snapshot
  ) then
    raise exception 'Amazon payment row source facts cannot be changed after revenue items depend on them.';
  end if;
  return new;
end;
$$;

drop trigger if exists amazon_payment_invoices_updated_at on public.amazon_payment_invoices;
create trigger amazon_payment_invoices_updated_at
  before update on public.amazon_payment_invoices
  for each row execute function public.touch_amazon_import_updated_at();

drop trigger if exists amazon_import_matches_updated_at on public.amazon_import_matches;
create trigger amazon_import_matches_updated_at
  before update on public.amazon_import_matches
  for each row execute function public.touch_amazon_import_updated_at();

drop trigger if exists amazon_revenue_items_updated_at on public.amazon_revenue_items;
create trigger amazon_revenue_items_updated_at
  before update on public.amazon_revenue_items
  for each row execute function public.touch_amazon_import_updated_at();

drop trigger if exists amazon_payment_invoices_source_guard on public.amazon_payment_invoices;
create trigger amazon_payment_invoices_source_guard
  before update on public.amazon_payment_invoices
  for each row execute function public.guard_amazon_payment_invoice_source();

drop trigger if exists amazon_payment_rows_source_guard on public.amazon_payment_rows;
create trigger amazon_payment_rows_source_guard
  before update on public.amazon_payment_rows
  for each row execute function public.guard_amazon_payment_row_source();

do $$
declare t text;
begin
  foreach t in array array[
    'amazon_payment_invoices',
    'amazon_payment_rows',
    'amazon_trip_rows',
    'amazon_trip_driver_tokens',
    'amazon_import_matches',
    'amazon_revenue_items',
    'amazon_revenue_item_sources'
  ] loop
    execute format('drop trigger if exists %I_org_guard on public.%I;', t, t);
    execute format(
      'create trigger %I_org_guard before update on public.%I for each row execute function public.guard_amazon_import_organization_id();',
      t, t
    );
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'amazon_payment_invoices',
    'amazon_payment_rows',
    'amazon_trip_rows',
    'amazon_trip_driver_tokens',
    'amazon_import_matches',
    'amazon_revenue_items',
    'amazon_revenue_item_sources'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I_select on public.%I;', t, t);
    execute format('drop policy if exists %I_insert on public.%I;', t, t);
    execute format('drop policy if exists %I_update on public.%I;', t, t);
    execute format('drop policy if exists %I_delete on public.%I;', t, t);
    execute format(
      'create policy %I_select on public.%I for select to authenticated using (organization_id = (select public.current_org_id()));',
      t, t
    );
    execute format(
      'create policy %I_insert on public.%I for insert to authenticated with check (organization_id = (select public.current_org_id()) and (select public.is_org_writer()));',
      t, t
    );
    execute format(
      'create policy %I_update on public.%I for update to authenticated using (organization_id = (select public.current_org_id()) and (select public.is_org_writer())) with check (organization_id = (select public.current_org_id()) and (select public.is_org_writer()));',
      t, t
    );
    execute format(
      'create policy %I_delete on public.%I for delete to authenticated using (organization_id = (select public.current_org_id()) and (select public.is_org_writer()));',
      t, t
    );
  end loop;
end $$;
