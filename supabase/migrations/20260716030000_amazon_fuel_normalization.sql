-- Amazon fuel normalization layer.
-- This migration stores fuel source facts and matching decisions only. It does
-- not project deductions into expenses, create statement candidates, or create settlements.

set search_path = public, extensions;

create extension if not exists "btree_gist" with schema extensions;

create table if not exists public.fuel_import_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  batch_id uuid not null,
  file_id uuid not null,
  provider text not null check (provider in ('octane')),
  carrier_identifier text,
  period_start date,
  period_end date,
  generated_at timestamptz,
  reported_transaction_count int check (reported_transaction_count is null or reported_transaction_count >= 0),
  reported_total_amount numeric,
  reported_total_quantity numeric,
  reported_discount_amount numeric,
  parser_name text not null,
  parser_version text not null,
  schema_signature text not null,
  source_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fuel_import_reports_org_id_id_key unique (organization_id, id),
  constraint fuel_import_reports_org_batch_id_id_key unique (organization_id, batch_id, id),
  constraint fuel_import_reports_file_key unique (organization_id, file_id),
  constraint fuel_import_reports_batch_same_org_fk
    foreign key (organization_id, batch_id)
    references public.amazon_import_batches (organization_id, id) on delete cascade,
  constraint fuel_import_reports_file_same_batch_fk
    foreign key (organization_id, batch_id, file_id)
    references public.amazon_import_files (organization_id, batch_id, id) on delete cascade,
  constraint fuel_import_reports_period_check
    check (period_start is null or period_end is null or period_end >= period_start),
  constraint fuel_import_reports_source_type_check
    check (provider = 'octane')
);

create table if not exists public.fuel_import_card_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  report_id uuid not null,
  source_group_number int not null check (source_group_number > 0),
  card_external_id text,
  card_last_four text,
  driver_label_raw text,
  driver_label_normalized text,
  unit_label_raw text,
  unit_label_normalized text,
  reported_transaction_count int check (reported_transaction_count is null or reported_transaction_count >= 0),
  reported_total_amount numeric,
  reported_total_quantity numeric,
  reported_discount_amount numeric,
  is_placeholder_group boolean not null default false,
  source_page_start int check (source_page_start is null or source_page_start > 0),
  source_page_end int check (source_page_end is null or source_page_end > 0),
  source_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint fuel_import_card_groups_org_id_id_key unique (organization_id, id),
  constraint fuel_import_card_groups_report_group_key unique (organization_id, report_id, source_group_number),
  constraint fuel_import_card_groups_report_same_org_fk
    foreign key (organization_id, report_id)
    references public.fuel_import_reports (organization_id, id) on delete cascade,
  constraint fuel_import_card_groups_page_check
    check (source_page_start is null or source_page_end is null or source_page_end >= source_page_start)
);

create table if not exists public.fuel_import_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  report_id uuid not null,
  card_group_id uuid not null,
  source_transaction_fingerprint text not null check (source_transaction_fingerprint ~ '^[a-f0-9]{64}$'),
  transaction_at timestamptz,
  invoice_number text,
  merchant_raw text,
  city_raw text,
  state_raw text,
  odometer_raw text,
  fees_amount numeric,
  source_page int check (source_page is null or source_page > 0),
  source_row_number int check (source_row_number is null or source_row_number > 0),
  source_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint fuel_import_transactions_org_id_id_key unique (organization_id, id),
  constraint fuel_import_transactions_org_report_id_id_key unique (organization_id, report_id, id),
  constraint fuel_import_transactions_fingerprint_key unique (organization_id, report_id, source_transaction_fingerprint),
  constraint fuel_import_transactions_report_same_org_fk
    foreign key (organization_id, report_id)
    references public.fuel_import_reports (organization_id, id) on delete cascade,
  constraint fuel_import_transactions_group_same_report_fk
    foreign key (organization_id, card_group_id)
    references public.fuel_import_card_groups (organization_id, id) on delete cascade
);

create table if not exists public.fuel_import_transaction_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  transaction_id uuid not null,
  source_line_order int not null check (source_line_order > 0),
  product_type_raw text,
  product_type_normalized text not null check (product_type_normalized in ('ULSD','DEF','FUEL','FEE','OTHER')),
  quantity numeric,
  retail_unit_price numeric,
  charged_unit_price numeric,
  discount_per_unit numeric,
  discount_amount numeric,
  deal_type text,
  charged_amount numeric,
  source_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint fuel_import_transaction_lines_org_id_id_key unique (organization_id, id),
  constraint fuel_import_transaction_lines_transaction_order_key unique (organization_id, transaction_id, source_line_order),
  constraint fuel_import_transaction_lines_transaction_same_org_fk
    foreign key (organization_id, transaction_id)
    references public.fuel_import_transactions (organization_id, id) on delete cascade,
  constraint fuel_import_transaction_lines_finite_numeric_check
    check (
      (quantity is null or quantity = quantity)
      and (retail_unit_price is null or retail_unit_price = retail_unit_price)
      and (charged_unit_price is null or charged_unit_price = charged_unit_price)
      and (discount_per_unit is null or discount_per_unit = discount_per_unit)
      and (discount_amount is null or discount_amount = discount_amount)
      and (charged_amount is null or charged_amount = charged_amount)
    )
);

create table if not exists public.fuel_cards (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  provider text not null check (provider in ('octane','manual')),
  external_card_id text not null,
  card_last_four text,
  status text not null default 'active' check (status in ('active','inactive','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fuel_cards_org_id_id_key unique (organization_id, id),
  constraint fuel_cards_provider_external_key unique (organization_id, provider, external_card_id)
);

create table if not exists public.fuel_card_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  fuel_card_id uuid not null,
  vehicle_id uuid,
  driver_id uuid,
  effective_from date not null,
  effective_to date,
  assignment_source text not null check (assignment_source in ('imported_unresolved','manual','effective_card_assignment')),
  status text not null default 'draft' check (status in ('draft','approved','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fuel_card_assignments_org_id_id_key unique (organization_id, id),
  constraint fuel_card_assignments_card_same_org_fk
    foreign key (organization_id, fuel_card_id)
    references public.fuel_cards (organization_id, id) on delete cascade,
  constraint fuel_card_assignments_vehicle_same_org_fk
    foreign key (organization_id, vehicle_id)
    references public.vehicles (organization_id, id) on delete set null (vehicle_id),
  constraint fuel_card_assignments_driver_same_org_fk
    foreign key (organization_id, driver_id)
    references public.people (organization_id, id) on delete set null (driver_id),
  constraint fuel_card_assignments_effective_range_check
    check (effective_to is null or effective_to > effective_from),
  constraint fuel_card_assignments_approved_target_check
    check (status <> 'approved' or vehicle_id is not null or driver_id is not null)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'fuel_card_assignments_no_approved_overlap'
      and conrelid = 'public.fuel_card_assignments'::regclass
  ) then
    alter table public.fuel_card_assignments
      add constraint fuel_card_assignments_no_approved_overlap
      exclude using gist (
        organization_id with =,
        fuel_card_id with =,
        daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[)') with &&
      )
      where (status = 'approved');
  end if;
end $$;

create table if not exists public.fuel_import_matches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  batch_id uuid not null,
  card_group_id uuid not null,
  transaction_id uuid,
  fuel_card_id uuid,
  vehicle_id uuid,
  driver_id uuid,
  match_method text not null
    check (match_method in ('effective_card_assignment','exact_card_id','exact_unit_alias','exact_driver_label','manual')),
  confidence_score numeric not null check (confidence_score >= 0 and confidence_score <= 1),
  status text not null
    check (status in ('exact','inferred','ambiguous','unmatched','manually_approved','rejected')),
  reasons jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fuel_import_matches_org_id_id_key unique (organization_id, id),
  constraint fuel_import_matches_batch_same_org_fk
    foreign key (organization_id, batch_id)
    references public.amazon_import_batches (organization_id, id) on delete cascade,
  constraint fuel_import_matches_group_same_org_fk
    foreign key (organization_id, card_group_id)
    references public.fuel_import_card_groups (organization_id, id) on delete cascade,
  constraint fuel_import_matches_transaction_same_org_fk
    foreign key (organization_id, transaction_id)
    references public.fuel_import_transactions (organization_id, id) on delete set null (transaction_id),
  constraint fuel_import_matches_card_same_org_fk
    foreign key (organization_id, fuel_card_id)
    references public.fuel_cards (organization_id, id) on delete set null (fuel_card_id),
  constraint fuel_import_matches_vehicle_same_org_fk
    foreign key (organization_id, vehicle_id)
    references public.vehicles (organization_id, id) on delete set null (vehicle_id),
  constraint fuel_import_matches_driver_same_org_fk
    foreign key (organization_id, driver_id)
    references public.people (organization_id, id) on delete set null (driver_id)
);

create unique index if not exists fuel_import_matches_one_active_group_key
  on public.fuel_import_matches (organization_id, card_group_id)
  where transaction_id is null and status in ('exact','inferred','manually_approved');

create unique index if not exists fuel_import_matches_one_active_transaction_key
  on public.fuel_import_matches (organization_id, card_group_id, transaction_id)
  where transaction_id is not null and status in ('exact','inferred','manually_approved');

create or replace function public.guard_fuel_import_report_source()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.fuel_import_transactions t
    where t.organization_id = old.organization_id
      and t.report_id = old.id
  ) and (
    new.batch_id is distinct from old.batch_id
    or new.file_id is distinct from old.file_id
    or new.provider is distinct from old.provider
    or new.carrier_identifier is distinct from old.carrier_identifier
    or new.period_start is distinct from old.period_start
    or new.period_end is distinct from old.period_end
    or new.reported_transaction_count is distinct from old.reported_transaction_count
    or new.reported_total_amount is distinct from old.reported_total_amount
    or new.reported_total_quantity is distinct from old.reported_total_quantity
    or new.reported_discount_amount is distinct from old.reported_discount_amount
    or new.parser_name is distinct from old.parser_name
    or new.parser_version is distinct from old.parser_version
    or new.schema_signature is distinct from old.schema_signature
    or new.source_snapshot is distinct from old.source_snapshot
  ) then
    raise exception 'Fuel import report source facts cannot be changed after transactions exist.';
  end if;
  return new;
end;
$$;

create or replace function public.guard_fuel_import_transaction_source()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.fuel_import_transaction_lines l
    where l.organization_id = old.organization_id
      and l.transaction_id = old.id
  ) or exists (
    select 1
    from public.fuel_import_matches m
    where m.organization_id = old.organization_id
      and m.transaction_id = old.id
  ) then
    if new.report_id is distinct from old.report_id
      or new.card_group_id is distinct from old.card_group_id
      or new.source_transaction_fingerprint is distinct from old.source_transaction_fingerprint
      or new.transaction_at is distinct from old.transaction_at
      or new.invoice_number is distinct from old.invoice_number
      or new.fees_amount is distinct from old.fees_amount
      or new.source_page is distinct from old.source_page
      or new.source_row_number is distinct from old.source_row_number
      or new.source_snapshot is distinct from old.source_snapshot then
      raise exception 'Fuel import transaction source facts cannot be changed after lines or matches exist.';
    end if;
  end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'fuel_import_reports',
    'fuel_cards',
    'fuel_card_assignments',
    'fuel_import_matches'
  ] loop
    execute format('drop trigger if exists %I_updated_at on public.%I;', t, t);
    execute format(
      'create trigger %I_updated_at before update on public.%I for each row execute function public.touch_amazon_import_updated_at();',
      t, t
    );
  end loop;
end $$;

drop trigger if exists fuel_import_reports_source_guard on public.fuel_import_reports;
create trigger fuel_import_reports_source_guard
  before update on public.fuel_import_reports
  for each row execute function public.guard_fuel_import_report_source();

drop trigger if exists fuel_import_transactions_source_guard on public.fuel_import_transactions;
create trigger fuel_import_transactions_source_guard
  before update on public.fuel_import_transactions
  for each row execute function public.guard_fuel_import_transaction_source();

do $$
declare t text;
begin
  foreach t in array array[
    'fuel_import_reports',
    'fuel_import_card_groups',
    'fuel_import_transactions',
    'fuel_import_transaction_lines',
    'fuel_cards',
    'fuel_card_assignments',
    'fuel_import_matches'
  ] loop
    execute format('drop trigger if exists %I_org_guard on public.%I;', t, t);
    execute format(
      'create trigger %I_org_guard before update on public.%I for each row execute function public.guard_amazon_import_organization_id();',
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
