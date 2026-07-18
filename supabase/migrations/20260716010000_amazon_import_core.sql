-- Amazon import core foundation only.
-- Parser-specific payment/trip/fuel tables come later; this migration must not
-- create settlements, project loads/expenses, or weaken settlement protections.

set search_path = public, extensions;

create extension if not exists "btree_gist" with schema extensions;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_org_id_id_key') then
    alter table public.profiles
      add constraint profiles_org_id_id_key unique (organization_id, id);
  end if;
end $$;

create table if not exists public.amazon_import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  period_start date,
  period_end date,
  status text not null default 'uploaded'
    check (status in ('uploaded','parsing','parsed','needs_review','reconciled','ready','failed','archived')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  parser_bundle_version text,
  notes text,
  constraint amazon_import_batches_org_id_id_key unique (organization_id, id),
  constraint amazon_import_batches_period_check
    check (period_start is null or period_end is null or period_end >= period_start),
  constraint amazon_import_batches_created_by_same_org_fk
    foreign key (organization_id, created_by)
    references public.profiles (organization_id, id) on delete set null (created_by)
);

create table if not exists public.amazon_import_files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  batch_id uuid not null,
  source_type text not null
    check (source_type in ('amazon_payment','amazon_trips','fuel_card','statement_reference')),
  original_filename text not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint not null check (size_bytes >= 0),
  sha256_hash text not null check (sha256_hash ~ '^[a-f0-9]{64}$'),
  parser_name text,
  parser_version text,
  schema_signature text,
  status text not null default 'uploaded'
    check (status in ('uploaded','parsing','parsed','failed','archived')),
  created_at timestamptz not null default now(),
  constraint amazon_import_files_org_id_id_key unique (organization_id, id),
  constraint amazon_import_files_org_batch_id_id_key unique (organization_id, batch_id, id),
  constraint amazon_import_files_batch_same_org_fk
    foreign key (organization_id, batch_id)
    references public.amazon_import_batches (organization_id, id) on delete cascade
);

create unique index if not exists amazon_import_files_active_hash_key
  on public.amazon_import_files (organization_id, source_type, sha256_hash)
  where status in ('uploaded','parsing','parsed');

create index if not exists amazon_import_files_batch_idx
  on public.amazon_import_files (organization_id, batch_id, created_at);

create table if not exists public.amazon_import_raw_rows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  batch_id uuid not null,
  file_id uuid not null,
  source_sheet text,
  source_page int,
  source_group text,
  source_row_number int,
  raw_data jsonb not null default '{}'::jsonb,
  normalized_data jsonb not null default '{}'::jsonb,
  parse_status text not null default 'pending'
    check (parse_status in ('pending','parsed','warning','failed','skipped')),
  parse_warning text,
  created_at timestamptz not null default now(),
  constraint amazon_import_raw_rows_org_id_id_key unique (organization_id, id),
  constraint amazon_import_raw_rows_org_batch_id_id_key unique (organization_id, batch_id, id),
  constraint amazon_import_raw_rows_batch_same_org_fk
    foreign key (organization_id, batch_id)
    references public.amazon_import_batches (organization_id, id) on delete cascade,
  constraint amazon_import_raw_rows_file_same_batch_fk
    foreign key (organization_id, batch_id, file_id)
    references public.amazon_import_files (organization_id, batch_id, id) on delete cascade,
  constraint amazon_import_raw_rows_source_sheet_sentinel_check
    check (source_sheet is null or source_sheet <> '__NULL_SOURCE_SHEET__'),
  constraint amazon_import_raw_rows_source_group_sentinel_check
    check (source_group is null or source_group <> '__NULL_SOURCE_GROUP__'),
  constraint amazon_import_raw_rows_source_page_check
    check (source_page is null or source_page >= 0),
  constraint amazon_import_raw_rows_source_row_number_check
    check (source_row_number is null or source_row_number > 0)
);

create unique index if not exists amazon_import_raw_rows_source_lineage_key
  on public.amazon_import_raw_rows (
    organization_id,
    batch_id,
    file_id,
    coalesce(source_sheet, '__NULL_SOURCE_SHEET__'),
    coalesce(source_page, -2147483648),
    coalesce(source_group, '__NULL_SOURCE_GROUP__'),
    coalesce(source_row_number, -2147483648)
  );

create index if not exists amazon_import_raw_rows_batch_idx
  on public.amazon_import_raw_rows (organization_id, batch_id, created_at);

create table if not exists public.amazon_import_issues (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  batch_id uuid not null,
  file_id uuid,
  raw_row_id uuid,
  issue_code text not null,
  severity text not null check (severity in ('info','warning','blocking')),
  message text not null,
  details jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open','resolved','dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid,
  constraint amazon_import_issues_org_id_id_key unique (organization_id, id),
  constraint amazon_import_issues_org_batch_id_id_key unique (organization_id, batch_id, id),
  constraint amazon_import_issues_batch_same_org_fk
    foreign key (organization_id, batch_id)
    references public.amazon_import_batches (organization_id, id) on delete cascade,
  constraint amazon_import_issues_file_same_batch_fk
    foreign key (organization_id, batch_id, file_id)
    references public.amazon_import_files (organization_id, batch_id, id) on delete set null (file_id),
  constraint amazon_import_issues_raw_row_same_org_fk
    foreign key (organization_id, batch_id, raw_row_id)
    references public.amazon_import_raw_rows (organization_id, batch_id, id) on delete set null (raw_row_id),
  constraint amazon_import_issues_resolved_by_same_org_fk
    foreign key (organization_id, resolved_by)
    references public.profiles (organization_id, id) on delete set null (resolved_by),
  constraint amazon_import_issues_resolution_check
    check ((status = 'resolved') = (resolved_at is not null))
);

create index if not exists amazon_import_issues_open_idx
  on public.amazon_import_issues (organization_id, batch_id, severity, created_at)
  where status = 'open';

create table if not exists public.amazon_import_reconciliations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  batch_id uuid not null,
  reconciliation_type text not null,
  expected_amount numeric,
  actual_amount numeric,
  difference_amount numeric,
  expected_count int,
  actual_count int,
  status text not null default 'pending'
    check (status in ('pending','passed','warning','failed')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint amazon_import_reconciliations_org_id_id_key unique (organization_id, id),
  constraint amazon_import_reconciliations_batch_same_org_fk
    foreign key (organization_id, batch_id)
    references public.amazon_import_batches (organization_id, id) on delete cascade,
  constraint amazon_import_reconciliations_counts_check
    check (
      (expected_count is null or expected_count >= 0)
      and (actual_count is null or actual_count >= 0)
    )
);

create index if not exists amazon_import_reconciliations_batch_idx
  on public.amazon_import_reconciliations (organization_id, batch_id, reconciliation_type, created_at);

create table if not exists public.amazon_import_review_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  batch_id uuid not null,
  issue_id uuid,
  decision_type text not null,
  previous_value jsonb,
  selected_value jsonb,
  reason text,
  decided_by uuid,
  decided_at timestamptz not null default now(),
  constraint amazon_import_review_decisions_org_id_id_key unique (organization_id, id),
  constraint amazon_import_review_decisions_batch_same_org_fk
    foreign key (organization_id, batch_id)
    references public.amazon_import_batches (organization_id, id) on delete cascade,
  constraint amazon_import_review_decisions_issue_same_org_fk
    foreign key (organization_id, batch_id, issue_id)
    references public.amazon_import_issues (organization_id, batch_id, id) on delete set null (issue_id),
  constraint amazon_import_review_decisions_decided_by_same_org_fk
    foreign key (organization_id, decided_by)
    references public.profiles (organization_id, id) on delete set null (decided_by)
);

create index if not exists amazon_import_review_decisions_batch_idx
  on public.amazon_import_review_decisions (organization_id, batch_id, decided_at);

create table if not exists public.amazon_external_vehicle_identifiers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  vehicle_id uuid not null,
  provider text not null check (provider in ('amazon','octane','manual')),
  identifier_type text not null check (identifier_type in ('tractor_vehicle_id','amazon_unit','fuel_unit','fuel_card')),
  external_value text not null,
  normalized_value text not null,
  effective_from date not null default current_date,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint amazon_external_vehicle_identifiers_org_id_id_key unique (organization_id, id),
  constraint amazon_external_vehicle_identifiers_vehicle_same_org_fk
    foreign key (organization_id, vehicle_id)
    references public.vehicles (organization_id, id) on delete cascade,
  constraint amazon_external_vehicle_identifiers_effective_range_check
    check (effective_to is null or effective_to > effective_from),
  constraint amazon_external_vehicle_identifiers_normalized_not_blank
    check (length(btrim(normalized_value)) > 0)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'amazon_external_vehicle_identifiers_no_overlap'
      and conrelid = 'public.amazon_external_vehicle_identifiers'::regclass
  ) then
    alter table public.amazon_external_vehicle_identifiers
      add constraint amazon_external_vehicle_identifiers_no_overlap
      exclude using gist (
        organization_id with =,
        provider with =,
        identifier_type with =,
        normalized_value with =,
        daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[)') with &&
      );
  end if;
end $$;

create index if not exists amazon_external_vehicle_identifiers_vehicle_idx
  on public.amazon_external_vehicle_identifiers (organization_id, vehicle_id, provider, identifier_type);

create or replace function public.touch_amazon_import_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.normalize_amazon_external_vehicle_identifier()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.normalized_value := upper(regexp_replace(btrim(coalesce(new.external_value, '')), '\s+', ' ', 'g'));
  if new.normalized_value = '' then
    raise exception 'External vehicle identifier cannot be blank.';
  end if;
  return new;
end;
$$;

create or replace function public.guard_amazon_import_organization_id()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'Amazon import organization_id cannot be changed.';
  end if;
  return new;
end;
$$;

create or replace function public.guard_amazon_import_file_lineage()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.amazon_import_raw_rows r
    where r.organization_id = old.organization_id
      and r.file_id = old.id
  ) and (
    new.batch_id is distinct from old.batch_id
    or new.source_type is distinct from old.source_type
    or new.original_filename is distinct from old.original_filename
    or new.storage_path is distinct from old.storage_path
    or new.mime_type is distinct from old.mime_type
    or new.size_bytes is distinct from old.size_bytes
    or new.sha256_hash is distinct from old.sha256_hash
  ) then
    raise exception 'Amazon import file source lineage cannot be changed after raw rows exist.';
  end if;
  return new;
end;
$$;

create or replace function public.guard_amazon_import_raw_row_lineage()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.normalized_data <> '{}'::jsonb and (
    new.batch_id is distinct from old.batch_id
    or new.file_id is distinct from old.file_id
    or new.source_sheet is distinct from old.source_sheet
    or new.source_page is distinct from old.source_page
    or new.source_group is distinct from old.source_group
    or new.source_row_number is distinct from old.source_row_number
    or new.raw_data is distinct from old.raw_data
  ) then
    raise exception 'Amazon import raw source lineage cannot be changed after normalized data exists.';
  end if;
  return new;
end;
$$;

create or replace function public.guard_amazon_import_review_decision_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Amazon import review decisions are append-only.';
end;
$$;

drop trigger if exists amazon_import_batches_updated_at on public.amazon_import_batches;
create trigger amazon_import_batches_updated_at
  before update on public.amazon_import_batches
  for each row execute function public.touch_amazon_import_updated_at();

drop trigger if exists amazon_external_vehicle_identifiers_updated_at on public.amazon_external_vehicle_identifiers;
create trigger amazon_external_vehicle_identifiers_updated_at
  before update on public.amazon_external_vehicle_identifiers
  for each row execute function public.touch_amazon_import_updated_at();

drop trigger if exists amazon_external_vehicle_identifiers_normalize on public.amazon_external_vehicle_identifiers;
create trigger amazon_external_vehicle_identifiers_normalize
  before insert or update on public.amazon_external_vehicle_identifiers
  for each row execute function public.normalize_amazon_external_vehicle_identifier();

do $$
declare t text;
begin
  foreach t in array array[
    'amazon_import_batches',
    'amazon_import_files',
    'amazon_import_raw_rows',
    'amazon_import_issues',
    'amazon_import_reconciliations',
    'amazon_import_review_decisions',
    'amazon_external_vehicle_identifiers'
  ] loop
    execute format('drop trigger if exists %I_org_guard on public.%I;', t, t);
    execute format(
      'create trigger %I_org_guard before update on public.%I for each row execute function public.guard_amazon_import_organization_id();',
      t, t
    );
  end loop;
end $$;

drop trigger if exists amazon_import_files_lineage_guard on public.amazon_import_files;
create trigger amazon_import_files_lineage_guard
  before update on public.amazon_import_files
  for each row execute function public.guard_amazon_import_file_lineage();

drop trigger if exists amazon_import_raw_rows_lineage_guard on public.amazon_import_raw_rows;
create trigger amazon_import_raw_rows_lineage_guard
  before update on public.amazon_import_raw_rows
  for each row execute function public.guard_amazon_import_raw_row_lineage();

drop trigger if exists amazon_import_review_decisions_update_guard on public.amazon_import_review_decisions;
create trigger amazon_import_review_decisions_update_guard
  before update on public.amazon_import_review_decisions
  for each row execute function public.guard_amazon_import_review_decision_immutable();

drop trigger if exists amazon_import_review_decisions_delete_guard on public.amazon_import_review_decisions;
create trigger amazon_import_review_decisions_delete_guard
  before delete on public.amazon_import_review_decisions
  for each row execute function public.guard_amazon_import_review_decision_immutable();

do $$
declare t text;
begin
  foreach t in array array[
    'amazon_import_batches',
    'amazon_import_files',
    'amazon_import_raw_rows',
    'amazon_import_issues',
    'amazon_import_reconciliations',
    'amazon_import_review_decisions',
    'amazon_external_vehicle_identifiers'
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
    if t <> 'amazon_import_review_decisions' then
      execute format(
        'create policy %I_update on public.%I for update to authenticated using (organization_id = (select public.current_org_id()) and (select public.is_org_writer())) with check (organization_id = (select public.current_org_id()) and (select public.is_org_writer()));',
        t, t
      );
      execute format(
        'create policy %I_delete on public.%I for delete to authenticated using (organization_id = (select public.current_org_id()) and (select public.is_org_writer()));',
        t, t
      );
    end if;
  end loop;
end $$;
