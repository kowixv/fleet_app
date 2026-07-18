-- Amazon reference resolution foundation.
-- This migration stores approved internal mappings needed before projection. It
-- does not create loads, expenses, statement candidates, settlements, or PDFs.

set search_path = public, extensions;

create extension if not exists "btree_gist" with schema extensions;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'people_org_id_id_key') then
    alter table public.people
      add constraint people_org_id_id_key unique (organization_id, id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'vehicles_org_id_id_key') then
    alter table public.vehicles
      add constraint vehicles_org_id_id_key unique (organization_id, id);
  end if;
end $$;

create table if not exists public.amazon_facility_locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  provider text not null check (provider in ('amazon','octane','manual')),
  facility_code text not null,
  normalized_facility_code text not null,
  city text not null,
  state text not null,
  postal_code text,
  country_code text not null default 'US',
  timezone text,
  effective_from date not null,
  effective_to date,
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified','manually_verified','imported_verified','rejected')),
  source text not null check (source in ('manual','amazon','octane','imported','review_decision')),
  verified_by uuid,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint amazon_facility_locations_org_id_id_key unique (organization_id, id),
  constraint amazon_facility_locations_verified_by_same_org_fk
    foreign key (organization_id, verified_by)
    references public.profiles (organization_id, id) on delete set null (verified_by),
  constraint amazon_facility_locations_code_check
    check (btrim(facility_code) <> '' and btrim(normalized_facility_code) <> ''),
  constraint amazon_facility_locations_city_state_check
    check (btrim(city) <> '' and btrim(state) <> ''),
  constraint amazon_facility_locations_effective_range_check
    check (effective_to is null or effective_to > effective_from),
  constraint amazon_facility_locations_verified_metadata_check
    check (
      verification_status not in ('manually_verified','imported_verified')
      or verified_at is not null
    )
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'amazon_facility_locations_no_verified_overlap'
      and conrelid = 'public.amazon_facility_locations'::regclass
  ) then
    alter table public.amazon_facility_locations
      add constraint amazon_facility_locations_no_verified_overlap
      exclude using gist (
        organization_id with =,
        provider with =,
        normalized_facility_code with =,
        daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[)') with &&
      )
      where (verification_status in ('manually_verified','imported_verified'));
  end if;
end $$;

create table if not exists public.amazon_external_driver_identifiers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  provider text not null check (provider in ('amazon','octane','manual')),
  identifier_type text not null check (identifier_type in ('driver_display_name','driver_external_id','fuel_driver_label')),
  external_value text not null,
  normalized_value text not null,
  person_id uuid not null,
  effective_from date not null,
  effective_to date,
  status text not null default 'proposed' check (status in ('proposed','approved','rejected','archived')),
  confidence_score numeric check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 1)),
  assignment_source text not null check (assignment_source in ('imported','manual','review_decision')),
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint amazon_external_driver_identifiers_org_id_id_key unique (organization_id, id),
  constraint amazon_external_driver_identifiers_person_same_org_fk
    foreign key (organization_id, person_id)
    references public.people (organization_id, id) on delete cascade,
  constraint amazon_external_driver_identifiers_approved_by_same_org_fk
    foreign key (organization_id, approved_by)
    references public.profiles (organization_id, id) on delete set null (approved_by),
  constraint amazon_external_driver_identifiers_value_check
    check (btrim(external_value) <> '' and btrim(normalized_value) <> ''),
  constraint amazon_external_driver_identifiers_effective_range_check
    check (effective_to is null or effective_to > effective_from),
  constraint amazon_external_driver_identifiers_approval_metadata_check
    check (status <> 'approved' or approved_at is not null)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'amazon_external_driver_identifiers_no_approved_overlap'
      and conrelid = 'public.amazon_external_driver_identifiers'::regclass
  ) then
    alter table public.amazon_external_driver_identifiers
      add constraint amazon_external_driver_identifiers_no_approved_overlap
      exclude using gist (
        organization_id with =,
        provider with =,
        identifier_type with =,
        normalized_value with =,
        daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[)') with &&
      )
      where (status = 'approved');
  end if;
end $$;

create table if not exists public.amazon_team_split_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  provider text not null check (provider in ('amazon','manual')),
  team_key text not null,
  effective_from date not null,
  effective_to date,
  status text not null default 'proposed' check (status in ('proposed','approved','rejected','archived')),
  assignment_source text not null check (assignment_source in ('imported','manual','review_decision')),
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint amazon_team_split_rules_org_id_id_key unique (organization_id, id),
  constraint amazon_team_split_rules_approved_by_same_org_fk
    foreign key (organization_id, approved_by)
    references public.profiles (organization_id, id) on delete set null (approved_by),
  constraint amazon_team_split_rules_team_key_check
    check (team_key ~ '^team_[a-f0-9]{24}$'),
  constraint amazon_team_split_rules_effective_range_check
    check (effective_to is null or effective_to > effective_from),
  constraint amazon_team_split_rules_approval_metadata_check
    check (status <> 'approved' or approved_at is not null)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'amazon_team_split_rules_no_approved_overlap'
      and conrelid = 'public.amazon_team_split_rules'::regclass
  ) then
    alter table public.amazon_team_split_rules
      add constraint amazon_team_split_rules_no_approved_overlap
      exclude using gist (
        organization_id with =,
        provider with =,
        team_key with =,
        daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[)') with &&
      )
      where (status = 'approved');
  end if;
end $$;

create table if not exists public.amazon_team_split_rule_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  team_split_rule_id uuid not null,
  person_id uuid not null,
  member_order int not null check (member_order > 0),
  split_basis_points int not null check (split_basis_points > 0 and split_basis_points <= 10000),
  created_at timestamptz not null default now(),
  constraint amazon_team_split_rule_members_org_id_id_key unique (organization_id, id),
  constraint amazon_team_split_rule_members_rule_same_org_fk
    foreign key (organization_id, team_split_rule_id)
    references public.amazon_team_split_rules (organization_id, id) on delete cascade,
  constraint amazon_team_split_rule_members_person_same_org_fk
    foreign key (organization_id, person_id)
    references public.people (organization_id, id) on delete cascade,
  constraint amazon_team_split_rule_members_person_key unique (organization_id, team_split_rule_id, person_id),
  constraint amazon_team_split_rule_members_order_key unique (organization_id, team_split_rule_id, member_order)
);

create or replace function public.guard_amazon_team_split_rule_members_total()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_org uuid;
  v_rule uuid;
  v_status text;
  v_total int;
begin
  v_org := coalesce(new.organization_id, old.organization_id);
  v_rule := coalesce(new.team_split_rule_id, old.team_split_rule_id);

  select status into v_status
  from public.amazon_team_split_rules
  where organization_id = v_org
    and id = v_rule;

  if v_status = 'approved' then
    select coalesce(sum(split_basis_points), 0)::int into v_total
    from public.amazon_team_split_rule_members
    where organization_id = v_org
      and team_split_rule_id = v_rule;

    if v_total <> 10000 then
      raise exception 'Approved Amazon team split members must sum to 10000 basis points.';
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

create or replace function public.guard_amazon_team_split_rule_approval_total()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_total int;
begin
  if new.status = 'approved' then
    select coalesce(sum(split_basis_points), 0)::int into v_total
    from public.amazon_team_split_rule_members
    where organization_id = new.organization_id
      and team_split_rule_id = new.id;

    if v_total <> 10000 then
      raise exception 'Approved Amazon team split rules require members totaling 10000 basis points.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists amazon_team_split_rule_members_total_guard on public.amazon_team_split_rule_members;
create constraint trigger amazon_team_split_rule_members_total_guard
  after insert or update or delete on public.amazon_team_split_rule_members
  deferrable initially deferred
  for each row execute function public.guard_amazon_team_split_rule_members_total();

drop trigger if exists amazon_team_split_rules_total_guard on public.amazon_team_split_rules;
create constraint trigger amazon_team_split_rules_total_guard
  after insert or update of status on public.amazon_team_split_rules
  deferrable initially deferred
  for each row execute function public.guard_amazon_team_split_rule_approval_total();

do $$
declare t text;
begin
  foreach t in array array[
    'amazon_facility_locations',
    'amazon_external_driver_identifiers',
    'amazon_team_split_rules'
  ] loop
    execute format('drop trigger if exists %I_updated_at on public.%I;', t, t);
    execute format(
      'create trigger %I_updated_at before update on public.%I for each row execute function public.touch_amazon_import_updated_at();',
      t, t
    );
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'amazon_facility_locations',
    'amazon_external_driver_identifiers',
    'amazon_team_split_rules',
    'amazon_team_split_rule_members'
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

grant select, insert, update, delete on table
  public.amazon_facility_locations,
  public.amazon_external_driver_identifiers,
  public.amazon_team_split_rules,
  public.amazon_team_split_rule_members
to authenticated, service_role;
