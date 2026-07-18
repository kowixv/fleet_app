-- Amazon statement candidates.
-- Versioned, reviewable calculation packages that select canonical Amazon source
-- records and projected loads/expenses without consuming settlement links.

set search_path = public, extensions;

create table if not exists public.amazon_statement_candidates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  batch_id uuid not null,
  statement_type text not null
    check (statement_type in ('company_driver','box_truck_driver','owner_operator','managed_investor')),
  status text not null default 'draft'
    check (status in ('draft','needs_review','ready','stale','converted','archived')),
  period_start date not null,
  period_end date not null,
  payee_type text not null
    check (payee_type in ('driver','owner','investor')),
  payee_id uuid,
  vehicle_id uuid,
  team_split_rule_id uuid,
  calculation_rule_version text not null,
  template_version text not null,
  source_revision text not null,
  preview_revision text not null,
  configuration_snapshot jsonb not null default '{}'::jsonb,
  source_snapshot jsonb not null default '{}'::jsonb,
  calculation_snapshot jsonb not null default '{}'::jsonb,
  gross_amount numeric not null default 0,
  percentage_deductions_amount numeric not null default 0,
  fixed_deductions_amount numeric not null default 0,
  fuel_deductions_amount numeric not null default 0,
  other_deductions_amount numeric not null default 0,
  total_deductions_amount numeric not null default 0,
  net_amount numeric not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_by uuid,
  approved_at timestamptz,
  converted_settlement_id uuid,
  converted_at timestamptz,
  last_error jsonb,
  constraint amazon_statement_candidates_org_id_id_key unique (organization_id, id),
  constraint amazon_statement_candidates_org_batch_id_id_key unique (organization_id, batch_id, id),
  constraint amazon_statement_candidates_batch_same_org_fk
    foreign key (organization_id, batch_id)
    references public.amazon_import_batches (organization_id, id) on delete cascade,
  constraint amazon_statement_candidates_payee_same_org_fk
    foreign key (organization_id, payee_id)
    references public.people (organization_id, id) on delete restrict,
  constraint amazon_statement_candidates_vehicle_same_org_fk
    foreign key (organization_id, vehicle_id)
    references public.vehicles (organization_id, id) on delete restrict,
  constraint amazon_statement_candidates_team_split_same_org_fk
    foreign key (organization_id, team_split_rule_id)
    references public.amazon_team_split_rules (organization_id, id) on delete restrict,
  constraint amazon_statement_candidates_created_by_same_org_fk
    foreign key (organization_id, created_by)
    references public.profiles (organization_id, id) on delete set null (created_by),
  constraint amazon_statement_candidates_approved_by_same_org_fk
    foreign key (organization_id, approved_by)
    references public.profiles (organization_id, id) on delete set null (approved_by),
  constraint amazon_statement_candidates_settlement_same_org_fk
    foreign key (organization_id, converted_settlement_id)
    references public.settlements (organization_id, id) on delete set null (converted_settlement_id),
  constraint amazon_statement_candidates_period_check check (period_end >= period_start),
  constraint amazon_statement_candidates_source_revision_check check (btrim(source_revision) <> ''),
  constraint amazon_statement_candidates_preview_revision_check check (btrim(preview_revision) <> ''),
  constraint amazon_statement_candidates_amounts_finite_check check (
    gross_amount = gross_amount
    and percentage_deductions_amount = percentage_deductions_amount
    and fixed_deductions_amount = fixed_deductions_amount
    and fuel_deductions_amount = fuel_deductions_amount
    and other_deductions_amount = other_deductions_amount
    and total_deductions_amount = total_deductions_amount
    and net_amount = net_amount
  )
);

create index if not exists amazon_statement_candidates_batch_status_idx
  on public.amazon_statement_candidates (organization_id, batch_id, status, period_start);

create unique index if not exists amazon_statement_candidates_converted_settlement_key
  on public.amazon_statement_candidates (organization_id, converted_settlement_id)
  where converted_settlement_id is not null;

create table if not exists public.amazon_statement_candidate_revenue (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  candidate_id uuid not null,
  revenue_item_id uuid not null,
  load_id uuid not null,
  allocated_gross_amount numeric not null,
  allocation_basis_points integer,
  source_revision text not null,
  source_snapshot jsonb not null default '{}'::jsonb,
  display_order integer not null default 0,
  period_override_approved boolean not null default false,
  created_at timestamptz not null default now(),
  constraint amazon_statement_candidate_revenue_org_id_id_key unique (organization_id, id),
  constraint amazon_statement_candidate_revenue_candidate_same_org_fk
    foreign key (organization_id, candidate_id)
    references public.amazon_statement_candidates (organization_id, id) on delete cascade,
  constraint amazon_statement_candidate_revenue_item_same_org_fk
    foreign key (organization_id, revenue_item_id)
    references public.amazon_revenue_items (organization_id, id) on delete restrict,
  constraint amazon_statement_candidate_revenue_load_same_org_fk
    foreign key (organization_id, load_id)
    references public.loads (organization_id, id) on delete restrict,
  constraint amazon_statement_candidate_revenue_basis_points_check
    check (allocation_basis_points is null or allocation_basis_points between 0 and 10000),
  constraint amazon_statement_candidate_revenue_source_revision_check check (btrim(source_revision) <> '')
);

create unique index if not exists amazon_statement_candidate_revenue_source_key
  on public.amazon_statement_candidate_revenue (organization_id, candidate_id, revenue_item_id);

create unique index if not exists amazon_statement_candidate_revenue_load_key
  on public.amazon_statement_candidate_revenue (organization_id, candidate_id, load_id);

create unique index if not exists amazon_statement_candidate_revenue_order_key
  on public.amazon_statement_candidate_revenue (organization_id, candidate_id, display_order);

create table if not exists public.amazon_statement_candidate_fuel_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  candidate_id uuid not null,
  transaction_line_id uuid not null,
  expense_id uuid not null,
  allocated_amount numeric not null,
  allocation_basis_points integer,
  source_revision text not null,
  source_snapshot jsonb not null default '{}'::jsonb,
  display_order integer not null default 0,
  period_override_approved boolean not null default false,
  created_at timestamptz not null default now(),
  constraint amazon_statement_candidate_fuel_lines_org_id_id_key unique (organization_id, id),
  constraint amazon_statement_candidate_fuel_lines_candidate_same_org_fk
    foreign key (organization_id, candidate_id)
    references public.amazon_statement_candidates (organization_id, id) on delete cascade,
  constraint amazon_statement_candidate_fuel_lines_line_same_org_fk
    foreign key (organization_id, transaction_line_id)
    references public.fuel_import_transaction_lines (organization_id, id) on delete restrict,
  constraint amazon_statement_candidate_fuel_lines_expense_same_org_fk
    foreign key (organization_id, expense_id)
    references public.expenses (organization_id, id) on delete restrict,
  constraint amazon_statement_candidate_fuel_lines_basis_points_check
    check (allocation_basis_points is null or allocation_basis_points between 0 and 10000),
  constraint amazon_statement_candidate_fuel_lines_source_revision_check check (btrim(source_revision) <> '')
);

create unique index if not exists amazon_statement_candidate_fuel_lines_source_key
  on public.amazon_statement_candidate_fuel_lines (organization_id, candidate_id, transaction_line_id);

create unique index if not exists amazon_statement_candidate_fuel_lines_expense_key
  on public.amazon_statement_candidate_fuel_lines (organization_id, candidate_id, expense_id);

create unique index if not exists amazon_statement_candidate_fuel_lines_order_key
  on public.amazon_statement_candidate_fuel_lines (organization_id, candidate_id, display_order);

create table if not exists public.amazon_statement_candidate_adjustments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  candidate_id uuid not null,
  adjustment_type text not null
    check (adjustment_type in ('driver_percentage','company_percentage','insurance','eld_safety','fuel','toll','parking','load_save','maintenance','miscellaneous','carryover')),
  label text not null,
  calculation_basis text not null
    check (calculation_basis in ('gross_percentage','fixed_amount','selected_source_lines')),
  rate_basis_points integer,
  fixed_amount numeric,
  calculated_amount numeric not null,
  deduction_lane text not null
    check (deduction_lane in ('driver','owner','investor','none')),
  display_order integer not null default 0,
  configuration_source text not null,
  source_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint amazon_statement_candidate_adjustments_org_id_id_key unique (organization_id, id),
  constraint amazon_statement_candidate_adjustments_candidate_same_org_fk
    foreign key (organization_id, candidate_id)
    references public.amazon_statement_candidates (organization_id, id) on delete cascade,
  constraint amazon_statement_candidate_adjustments_rate_check
    check (rate_basis_points is null or rate_basis_points between 0 and 10000),
  constraint amazon_statement_candidate_adjustments_basis_check check (
    (calculation_basis = 'gross_percentage' and rate_basis_points is not null and fixed_amount is null)
    or (calculation_basis = 'fixed_amount' and fixed_amount is not null and rate_basis_points is null)
    or (calculation_basis = 'selected_source_lines' and rate_basis_points is null)
  ),
  constraint amazon_statement_candidate_adjustments_label_check check (btrim(label) <> ''),
  constraint amazon_statement_candidate_adjustments_source_check check (btrim(configuration_source) <> '')
);

create unique index if not exists amazon_statement_candidate_adjustments_order_key
  on public.amazon_statement_candidate_adjustments (organization_id, candidate_id, display_order);

create or replace function public.guard_amazon_statement_candidate()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if old.status = 'converted' then
      raise exception 'Converted Amazon statement candidates are immutable.';
    end if;
    if new.organization_id is distinct from old.organization_id then
      raise exception 'Amazon statement candidate organization cannot be changed.';
    end if;
    if new.converted_settlement_id is not null and new.status <> 'converted' then
      raise exception 'Converted settlement lineage requires converted status.';
    end if;
  end if;
  if tg_op = 'DELETE' and old.status = 'converted' then
    raise exception 'Converted Amazon statement candidates are immutable.';
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function public.guard_amazon_statement_candidate_revenue_identity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.organization_id is distinct from old.organization_id
    or new.candidate_id is distinct from old.candidate_id
    or new.revenue_item_id is distinct from old.revenue_item_id
    or new.load_id is distinct from old.load_id then
    raise exception 'Amazon statement candidate revenue identity cannot be changed.';
  end if;
  return new;
end;
$$;

create or replace function public.guard_amazon_statement_candidate_fuel_identity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.organization_id is distinct from old.organization_id
    or new.candidate_id is distinct from old.candidate_id
    or new.transaction_line_id is distinct from old.transaction_line_id
    or new.expense_id is distinct from old.expense_id then
    raise exception 'Amazon statement candidate fuel identity cannot be changed.';
  end if;
  return new;
end;
$$;

drop trigger if exists amazon_statement_candidates_guard on public.amazon_statement_candidates;
create trigger amazon_statement_candidates_guard
  before update or delete on public.amazon_statement_candidates
  for each row execute function public.guard_amazon_statement_candidate();

drop trigger if exists amazon_statement_candidate_revenue_identity_guard on public.amazon_statement_candidate_revenue;
create trigger amazon_statement_candidate_revenue_identity_guard
  before update on public.amazon_statement_candidate_revenue
  for each row execute function public.guard_amazon_statement_candidate_revenue_identity();

drop trigger if exists amazon_statement_candidate_fuel_identity_guard on public.amazon_statement_candidate_fuel_lines;
create trigger amazon_statement_candidate_fuel_identity_guard
  before update on public.amazon_statement_candidate_fuel_lines
  for each row execute function public.guard_amazon_statement_candidate_fuel_identity();

drop trigger if exists amazon_statement_candidates_updated_at on public.amazon_statement_candidates;
create trigger amazon_statement_candidates_updated_at
  before update on public.amazon_statement_candidates
  for each row execute function public.touch_amazon_import_updated_at();

do $$
declare t text;
begin
  foreach t in array array[
    'amazon_statement_candidates',
    'amazon_statement_candidate_revenue',
    'amazon_statement_candidate_fuel_lines',
    'amazon_statement_candidate_adjustments'
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
  end loop;
end $$;

create policy amazon_statement_candidates_insert on public.amazon_statement_candidates
  for insert to authenticated
  with check (organization_id = (select public.current_org_id()) and (select public.is_org_writer()));

create policy amazon_statement_candidates_update on public.amazon_statement_candidates
  for update to authenticated
  using (organization_id = (select public.current_org_id()) and (select public.is_org_writer()) and status <> 'converted')
  with check (organization_id = (select public.current_org_id()) and (select public.is_org_writer()) and status <> 'converted');

create policy amazon_statement_candidates_delete on public.amazon_statement_candidates
  for delete to authenticated
  using (organization_id = (select public.current_org_id()) and (select public.is_org_writer()) and status <> 'converted');

create policy amazon_statement_candidate_revenue_insert on public.amazon_statement_candidate_revenue
  for insert to authenticated
  with check (
    organization_id = (select public.current_org_id())
    and (select public.is_org_writer())
    and exists (
      select 1 from public.amazon_statement_candidates c
      where c.organization_id = amazon_statement_candidate_revenue.organization_id
        and c.id = amazon_statement_candidate_revenue.candidate_id
        and c.status in ('draft','needs_review','ready','stale')
    )
  );

create policy amazon_statement_candidate_revenue_update on public.amazon_statement_candidate_revenue
  for update to authenticated
  using (organization_id = (select public.current_org_id()) and (select public.is_org_writer()))
  with check (
    organization_id = (select public.current_org_id())
    and (select public.is_org_writer())
    and exists (
      select 1 from public.amazon_statement_candidates c
      where c.organization_id = amazon_statement_candidate_revenue.organization_id
        and c.id = amazon_statement_candidate_revenue.candidate_id
        and c.status in ('draft','needs_review','ready','stale')
    )
  );

create policy amazon_statement_candidate_revenue_delete on public.amazon_statement_candidate_revenue
  for delete to authenticated
  using (
    organization_id = (select public.current_org_id())
    and (select public.is_org_writer())
    and exists (
      select 1 from public.amazon_statement_candidates c
      where c.organization_id = amazon_statement_candidate_revenue.organization_id
        and c.id = amazon_statement_candidate_revenue.candidate_id
        and c.status in ('draft','needs_review','ready','stale')
    )
  );

create policy amazon_statement_candidate_fuel_lines_insert on public.amazon_statement_candidate_fuel_lines
  for insert to authenticated
  with check (
    organization_id = (select public.current_org_id())
    and (select public.is_org_writer())
    and exists (
      select 1 from public.amazon_statement_candidates c
      where c.organization_id = amazon_statement_candidate_fuel_lines.organization_id
        and c.id = amazon_statement_candidate_fuel_lines.candidate_id
        and c.status in ('draft','needs_review','ready','stale')
    )
  );

create policy amazon_statement_candidate_fuel_lines_update on public.amazon_statement_candidate_fuel_lines
  for update to authenticated
  using (organization_id = (select public.current_org_id()) and (select public.is_org_writer()))
  with check (
    organization_id = (select public.current_org_id())
    and (select public.is_org_writer())
    and exists (
      select 1 from public.amazon_statement_candidates c
      where c.organization_id = amazon_statement_candidate_fuel_lines.organization_id
        and c.id = amazon_statement_candidate_fuel_lines.candidate_id
        and c.status in ('draft','needs_review','ready','stale')
    )
  );

create policy amazon_statement_candidate_fuel_lines_delete on public.amazon_statement_candidate_fuel_lines
  for delete to authenticated
  using (
    organization_id = (select public.current_org_id())
    and (select public.is_org_writer())
    and exists (
      select 1 from public.amazon_statement_candidates c
      where c.organization_id = amazon_statement_candidate_fuel_lines.organization_id
        and c.id = amazon_statement_candidate_fuel_lines.candidate_id
        and c.status in ('draft','needs_review','ready','stale')
    )
  );

create policy amazon_statement_candidate_adjustments_insert on public.amazon_statement_candidate_adjustments
  for insert to authenticated
  with check (
    organization_id = (select public.current_org_id())
    and (select public.is_org_writer())
    and exists (
      select 1 from public.amazon_statement_candidates c
      where c.organization_id = amazon_statement_candidate_adjustments.organization_id
        and c.id = amazon_statement_candidate_adjustments.candidate_id
        and c.status in ('draft','needs_review','ready','stale')
    )
  );

create policy amazon_statement_candidate_adjustments_update on public.amazon_statement_candidate_adjustments
  for update to authenticated
  using (organization_id = (select public.current_org_id()) and (select public.is_org_writer()))
  with check (
    organization_id = (select public.current_org_id())
    and (select public.is_org_writer())
    and exists (
      select 1 from public.amazon_statement_candidates c
      where c.organization_id = amazon_statement_candidate_adjustments.organization_id
        and c.id = amazon_statement_candidate_adjustments.candidate_id
        and c.status in ('draft','needs_review','ready','stale')
    )
  );

create policy amazon_statement_candidate_adjustments_delete on public.amazon_statement_candidate_adjustments
  for delete to authenticated
  using (
    organization_id = (select public.current_org_id())
    and (select public.is_org_writer())
    and exists (
      select 1 from public.amazon_statement_candidates c
      where c.organization_id = amazon_statement_candidate_adjustments.organization_id
        and c.id = amazon_statement_candidate_adjustments.candidate_id
        and c.status in ('draft','needs_review','ready','stale')
    )
  );

grant select, insert, update, delete on table
  public.amazon_statement_candidates,
  public.amazon_statement_candidate_revenue,
  public.amazon_statement_candidate_fuel_lines,
  public.amazon_statement_candidate_adjustments
to authenticated, service_role;

revoke execute on function public.guard_amazon_statement_candidate() from public, anon;
revoke execute on function public.guard_amazon_statement_candidate_revenue_identity() from public, anon;
revoke execute on function public.guard_amazon_statement_candidate_fuel_identity() from public, anon;
