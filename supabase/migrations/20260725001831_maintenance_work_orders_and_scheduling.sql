-- Maintenance PR 2: production work orders, assignments, approvals, parts, and scheduling.
-- This migration is additive and preserves legacy inspection finding draft flags.

alter table public.settings
  add column if not exists maintenance_work_order_approval_threshold numeric not null default 2500;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'settings_maintenance_work_order_approval_threshold_chk'
      and conrelid = 'public.settings'::regclass
  ) then
    alter table public.settings
      add constraint settings_maintenance_work_order_approval_threshold_chk
      check (maintenance_work_order_approval_threshold >= 0)
      not valid;
  end if;
end $$;

create table if not exists public.maintenance_work_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  vehicle_id uuid not null,
  source_type text not null default 'manual',
  source_id uuid,
  dispatch_hold_id uuid,
  title text not null,
  complaint text,
  diagnosis text,
  recommended_action text,
  priority text not null default 'normal',
  status text not null default 'reported',
  status_changed_at timestamptz not null default now(),
  assigned_user_id uuid,
  shop_vendor text,
  shop_contact text,
  appointment_start timestamptz,
  estimated_completion timestamptz,
  actual_start timestamptz,
  actual_completion timestamptz,
  estimate_requested_at timestamptz,
  estimate_requested_by uuid,
  estimated_cost numeric,
  approved_cost_limit numeric,
  final_cost numeric,
  downtime_start timestamptz,
  downtime_end timestamptz,
  odometer numeric,
  engine_hours numeric,
  approval_state text not null default 'not_required',
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  closed_by uuid,
  closed_at timestamptz,
  cancelled_by uuid,
  cancelled_at timestamptz,
  version integer not null default 1,
  constraint maintenance_work_orders_org_id_id_key unique (organization_id, id),
  constraint maintenance_work_orders_vehicle_same_org_fk
    foreign key (organization_id, vehicle_id)
    references public.vehicles (organization_id, id) on delete restrict,
  constraint maintenance_work_orders_dispatch_hold_same_org_fk
    foreign key (organization_id, dispatch_hold_id)
    references public.vehicle_dispatch_holds (organization_id, id) on delete set null (dispatch_hold_id),
  constraint maintenance_work_orders_assigned_user_same_org_fk
    foreign key (organization_id, assigned_user_id)
    references public.profiles (organization_id, id) on delete set null (assigned_user_id),
  constraint maintenance_work_orders_estimate_requested_by_same_org_fk
    foreign key (organization_id, estimate_requested_by)
    references public.profiles (organization_id, id) on delete set null (estimate_requested_by),
  constraint maintenance_work_orders_created_by_same_org_fk
    foreign key (organization_id, created_by)
    references public.profiles (organization_id, id) on delete set null (created_by),
  constraint maintenance_work_orders_updated_by_same_org_fk
    foreign key (organization_id, updated_by)
    references public.profiles (organization_id, id) on delete set null (updated_by),
  constraint maintenance_work_orders_closed_by_same_org_fk
    foreign key (organization_id, closed_by)
    references public.profiles (organization_id, id) on delete set null (closed_by),
  constraint maintenance_work_orders_cancelled_by_same_org_fk
    foreign key (organization_id, cancelled_by)
    references public.profiles (organization_id, id) on delete set null (cancelled_by),
  constraint maintenance_work_orders_source_type_chk
    check (source_type in ('inspection_finding', 'maintenance_reminder', 'manual', 'breakdown', 'invoice_review')),
  constraint maintenance_work_orders_priority_chk
    check (priority in ('low', 'normal', 'high', 'critical')),
  constraint maintenance_work_orders_status_chk
    check (status in (
      'reported', 'triage', 'awaiting_estimate', 'awaiting_approval', 'approved',
      'parts_ordered', 'scheduled', 'in_repair', 'quality_check', 'completed',
      'invoiced', 'closed', 'cancelled'
    )),
  constraint maintenance_work_orders_approval_state_chk
    check (approval_state in ('not_required', 'pending', 'approved', 'rejected')),
  constraint maintenance_work_orders_title_chk
    check (length(btrim(title)) >= 3),
  constraint maintenance_work_orders_money_chk
    check (
      coalesce(estimated_cost, 0) >= 0
      and coalesce(approved_cost_limit, 0) >= 0
      and coalesce(final_cost, 0) >= 0
    ),
  constraint maintenance_work_orders_meter_chk
    check (coalesce(odometer, 0) >= 0 and coalesce(engine_hours, 0) >= 0),
  constraint maintenance_work_orders_schedule_order_chk
    check (
      appointment_start is null
      or estimated_completion is null
      or estimated_completion >= appointment_start
    ),
  constraint maintenance_work_orders_downtime_order_chk
    check (downtime_start is null or downtime_end is null or downtime_end >= downtime_start),
  constraint maintenance_work_orders_completion_order_chk
    check (actual_start is null or actual_completion is null or actual_completion >= actual_start),
  constraint maintenance_work_orders_closed_shape_chk
    check (
      (status = 'closed' and closed_by is not null and closed_at is not null)
      or (status <> 'closed' and closed_at is null)
    ),
  constraint maintenance_work_orders_cancelled_shape_chk
    check (
      (status = 'cancelled' and cancelled_by is not null and cancelled_at is not null)
      or (status <> 'cancelled' and cancelled_at is null)
    )
);

create table if not exists public.maintenance_work_order_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  work_order_id uuid not null,
  title text not null,
  notes text,
  status text not null default 'pending',
  priority text not null default 'normal',
  assigned_user_id uuid,
  due_date date,
  sort_order integer not null default 0,
  completed_by uuid,
  completed_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint maintenance_work_order_tasks_org_id_id_key unique (organization_id, id),
  constraint maintenance_work_order_tasks_work_order_same_org_fk
    foreign key (organization_id, work_order_id)
    references public.maintenance_work_orders (organization_id, id) on delete cascade,
  constraint maintenance_work_order_tasks_assigned_user_same_org_fk
    foreign key (organization_id, assigned_user_id)
    references public.profiles (organization_id, id) on delete set null (assigned_user_id),
  constraint maintenance_work_order_tasks_completed_by_same_org_fk
    foreign key (organization_id, completed_by)
    references public.profiles (organization_id, id) on delete set null (completed_by),
  constraint maintenance_work_order_tasks_created_by_same_org_fk
    foreign key (organization_id, created_by)
    references public.profiles (organization_id, id) on delete set null (created_by),
  constraint maintenance_work_order_tasks_title_chk check (length(btrim(title)) >= 2),
  constraint maintenance_work_order_tasks_status_chk
    check (status in ('pending', 'in_progress', 'completed', 'cancelled')),
  constraint maintenance_work_order_tasks_priority_chk
    check (priority in ('low', 'normal', 'high', 'critical')),
  constraint maintenance_work_order_tasks_completion_chk
    check (
      (status = 'completed' and completed_by is not null and completed_at is not null)
      or (status <> 'completed' and completed_at is null)
    )
);

create table if not exists public.maintenance_work_order_parts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  work_order_id uuid not null,
  part_name text not null,
  part_number text,
  quantity numeric not null default 1,
  vendor text,
  status text not null default 'needed',
  ordered_date date,
  expected_date date,
  received_date date,
  unit_cost numeric,
  core_charge numeric,
  core_returned boolean not null default false,
  core_returned_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint maintenance_work_order_parts_org_id_id_key unique (organization_id, id),
  constraint maintenance_work_order_parts_work_order_same_org_fk
    foreign key (organization_id, work_order_id)
    references public.maintenance_work_orders (organization_id, id) on delete cascade,
  constraint maintenance_work_order_parts_created_by_same_org_fk
    foreign key (organization_id, created_by)
    references public.profiles (organization_id, id) on delete set null (created_by),
  constraint maintenance_work_order_parts_name_chk check (length(btrim(part_name)) >= 2),
  constraint maintenance_work_order_parts_quantity_chk check (quantity > 0),
  constraint maintenance_work_order_parts_money_chk
    check (coalesce(unit_cost, 0) >= 0 and coalesce(core_charge, 0) >= 0),
  constraint maintenance_work_order_parts_status_chk
    check (status in ('needed', 'ordered', 'received', 'installed', 'cancelled')),
  constraint maintenance_work_order_parts_date_order_chk
    check (ordered_date is null or received_date is null or received_date >= ordered_date),
  constraint maintenance_work_order_parts_core_return_chk
    check (
      (core_returned and core_returned_at is not null)
      or (not core_returned and core_returned_at is null)
    )
);

create table if not exists public.maintenance_work_order_status_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  work_order_id uuid not null,
  event_type text not null default 'status_transition',
  from_status text,
  to_status text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint maintenance_work_order_status_events_org_id_id_key unique (organization_id, id),
  constraint maintenance_work_order_status_events_work_order_same_org_fk
    foreign key (organization_id, work_order_id)
    references public.maintenance_work_orders (organization_id, id) on delete cascade,
  constraint maintenance_work_order_status_events_created_by_same_org_fk
    foreign key (organization_id, created_by)
    references public.profiles (organization_id, id) on delete set null (created_by),
  constraint maintenance_work_order_status_events_type_chk
    check (event_type in ('created', 'status_transition', 'estimate_submitted', 'approval_decision')),
  constraint maintenance_work_order_status_events_from_chk
    check (
      from_status is null or from_status in (
        'reported', 'triage', 'awaiting_estimate', 'awaiting_approval', 'approved',
        'parts_ordered', 'scheduled', 'in_repair', 'quality_check', 'completed',
        'invoiced', 'closed', 'cancelled'
      )
    ),
  constraint maintenance_work_order_status_events_to_chk
    check (
      to_status is null or to_status in (
        'reported', 'triage', 'awaiting_estimate', 'awaiting_approval', 'approved',
        'parts_ordered', 'scheduled', 'in_repair', 'quality_check', 'completed',
        'invoiced', 'closed', 'cancelled'
      )
    )
);

create table if not exists public.maintenance_work_order_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  work_order_id uuid not null,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  file_size_bytes bigint,
  uploaded_by uuid,
  uploaded_at timestamptz not null default now(),
  constraint maintenance_work_order_attachments_org_id_id_key unique (organization_id, id),
  constraint maintenance_work_order_attachments_work_order_same_org_fk
    foreign key (organization_id, work_order_id)
    references public.maintenance_work_orders (organization_id, id) on delete cascade,
  constraint maintenance_work_order_attachments_uploaded_by_same_org_fk
    foreign key (organization_id, uploaded_by)
    references public.profiles (organization_id, id) on delete set null (uploaded_by),
  constraint maintenance_work_order_attachments_path_chk check (length(btrim(storage_path)) > 0),
  constraint maintenance_work_order_attachments_name_chk check (length(btrim(file_name)) > 0),
  constraint maintenance_work_order_attachments_size_chk
    check (file_size_bytes is null or file_size_bytes between 0 and 20971520)
);

create table if not exists public.maintenance_work_order_approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  work_order_id uuid not null,
  state text not null,
  estimate_amount numeric,
  approved_amount numeric,
  approval_notes text,
  rejection_reason text,
  requested_by uuid,
  requested_at timestamptz,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  constraint maintenance_work_order_approvals_org_id_id_key unique (organization_id, id),
  constraint maintenance_work_order_approvals_work_order_same_org_fk
    foreign key (organization_id, work_order_id)
    references public.maintenance_work_orders (organization_id, id) on delete cascade,
  constraint maintenance_work_order_approvals_requested_by_same_org_fk
    foreign key (organization_id, requested_by)
    references public.profiles (organization_id, id) on delete set null (requested_by),
  constraint maintenance_work_order_approvals_decided_by_same_org_fk
    foreign key (organization_id, decided_by)
    references public.profiles (organization_id, id) on delete set null (decided_by),
  constraint maintenance_work_order_approvals_state_chk
    check (state in ('requested', 'approved', 'rejected')),
  constraint maintenance_work_order_approvals_money_chk
    check (coalesce(estimate_amount, 0) >= 0 and coalesce(approved_amount, 0) >= 0),
  constraint maintenance_work_order_approvals_decision_chk
    check (
      (state = 'requested' and requested_by is not null and requested_at is not null and decided_at is null)
      or
      (state = 'approved' and decided_by is not null and decided_at is not null and approved_amount is not null)
      or
      (state = 'rejected' and decided_by is not null and decided_at is not null and length(btrim(rejection_reason)) >= 3)
    )
);

alter table public.inspection_findings
  add column if not exists work_order_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'inspection_findings_work_order_same_org_fk'
      and conrelid = 'public.inspection_findings'::regclass
  ) then
    alter table public.inspection_findings
      add constraint inspection_findings_work_order_same_org_fk
      foreign key (organization_id, work_order_id)
      references public.maintenance_work_orders (organization_id, id) on delete set null (work_order_id)
      not valid;
  end if;
end $$;

create unique index if not exists maintenance_work_orders_one_active_source_idx
  on public.maintenance_work_orders (organization_id, vehicle_id, source_type, source_id)
  where source_id is not null and status <> 'cancelled';
create index if not exists maintenance_work_orders_org_status_updated_idx
  on public.maintenance_work_orders (organization_id, status, updated_at desc);
create index if not exists maintenance_work_orders_org_vehicle_status_idx
  on public.maintenance_work_orders (organization_id, vehicle_id, status, updated_at desc);
create index if not exists maintenance_work_orders_org_assignee_status_idx
  on public.maintenance_work_orders (organization_id, assigned_user_id, status)
  where assigned_user_id is not null;
create index if not exists maintenance_work_orders_org_schedule_idx
  on public.maintenance_work_orders (organization_id, appointment_start)
  where appointment_start is not null and status not in ('closed', 'cancelled');
create index if not exists maintenance_work_orders_dispatch_hold_idx
  on public.maintenance_work_orders (organization_id, dispatch_hold_id)
  where dispatch_hold_id is not null;
create index if not exists maintenance_work_order_tasks_order_idx
  on public.maintenance_work_order_tasks (organization_id, work_order_id, status, sort_order);
create index if not exists maintenance_work_order_tasks_assignee_due_idx
  on public.maintenance_work_order_tasks (organization_id, assigned_user_id, due_date)
  where assigned_user_id is not null and status not in ('completed', 'cancelled');
create index if not exists maintenance_work_order_parts_order_idx
  on public.maintenance_work_order_parts (organization_id, work_order_id, status);
create index if not exists maintenance_work_order_parts_expected_idx
  on public.maintenance_work_order_parts (organization_id, expected_date)
  where status = 'ordered' and expected_date is not null;
create index if not exists maintenance_work_order_events_order_idx
  on public.maintenance_work_order_status_events (organization_id, work_order_id, created_at desc);
create index if not exists maintenance_work_order_attachments_order_idx
  on public.maintenance_work_order_attachments (organization_id, work_order_id, uploaded_at desc);
create index if not exists maintenance_work_order_approvals_order_idx
  on public.maintenance_work_order_approvals (organization_id, work_order_id, created_at desc);
create index if not exists inspection_findings_work_order_idx
  on public.inspection_findings (organization_id, work_order_id)
  where work_order_id is not null;

alter table public.maintenance_work_orders enable row level security;
alter table public.maintenance_work_order_tasks enable row level security;
alter table public.maintenance_work_order_parts enable row level security;
alter table public.maintenance_work_order_status_events enable row level security;
alter table public.maintenance_work_order_attachments enable row level security;
alter table public.maintenance_work_order_approvals enable row level security;

drop policy if exists maintenance_work_orders_select on public.maintenance_work_orders;
drop policy if exists maintenance_work_orders_update on public.maintenance_work_orders;
create policy maintenance_work_orders_select
  on public.maintenance_work_orders for select to authenticated
  using (organization_id = (select public.current_org_id()));
create policy maintenance_work_orders_update
  on public.maintenance_work_orders for update to authenticated
  using (
    organization_id = (select public.current_org_id())
    and (select public.is_org_writer())
  )
  with check (
    organization_id = (select public.current_org_id())
    and (select public.is_org_writer())
  );

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'maintenance_work_order_tasks',
    'maintenance_work_order_parts',
    'maintenance_work_order_attachments'
  ]
  loop
    execute format('drop policy if exists %I_select on public.%I', v_table, v_table);
    execute format('drop policy if exists %I_insert on public.%I', v_table, v_table);
    execute format('drop policy if exists %I_update on public.%I', v_table, v_table);
    execute format('drop policy if exists %I_delete on public.%I', v_table, v_table);
    execute format(
      'create policy %I_select on public.%I for select to authenticated using (organization_id = (select public.current_org_id()))',
      v_table, v_table
    );
    execute format(
      'create policy %I_insert on public.%I for insert to authenticated with check (organization_id = (select public.current_org_id()) and (select public.is_org_writer()))',
      v_table, v_table
    );
    execute format(
      'create policy %I_update on public.%I for update to authenticated using (organization_id = (select public.current_org_id()) and (select public.is_org_writer())) with check (organization_id = (select public.current_org_id()) and (select public.is_org_writer()))',
      v_table, v_table
    );
    execute format(
      'create policy %I_delete on public.%I for delete to authenticated using (organization_id = (select public.current_org_id()) and (select public.is_org_writer()))',
      v_table, v_table
    );
  end loop;
end $$;

drop policy if exists maintenance_work_order_status_events_select on public.maintenance_work_order_status_events;
create policy maintenance_work_order_status_events_select
  on public.maintenance_work_order_status_events for select to authenticated
  using (organization_id = (select public.current_org_id()));

drop policy if exists maintenance_work_order_approvals_select on public.maintenance_work_order_approvals;
create policy maintenance_work_order_approvals_select
  on public.maintenance_work_order_approvals for select to authenticated
  using (organization_id = (select public.current_org_id()));

revoke all on table public.maintenance_work_orders from anon, authenticated;
revoke all on table public.maintenance_work_order_tasks from anon, authenticated;
revoke all on table public.maintenance_work_order_parts from anon, authenticated;
revoke all on table public.maintenance_work_order_status_events from anon, authenticated;
revoke all on table public.maintenance_work_order_attachments from anon, authenticated;
revoke all on table public.maintenance_work_order_approvals from anon, authenticated;

grant select on table public.maintenance_work_orders to authenticated;
grant update (
  title, complaint, diagnosis, recommended_action, priority, assigned_user_id,
  shop_vendor, shop_contact, appointment_start, estimated_completion,
  final_cost, downtime_start, downtime_end,
  odometer, engine_hours, notes
) on table public.maintenance_work_orders to authenticated;
grant select, insert, update, delete on table public.maintenance_work_order_tasks to authenticated;
grant select, insert, update, delete on table public.maintenance_work_order_parts to authenticated;
grant select on table public.maintenance_work_order_status_events to authenticated;
grant select, insert, update, delete on table public.maintenance_work_order_attachments to authenticated;
grant select on table public.maintenance_work_order_approvals to authenticated;

create or replace function public.touch_maintenance_work_order()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), old.updated_by);
  new.version := old.version + 1;
  return new;
end;
$$;

revoke execute on function public.touch_maintenance_work_order() from public, anon, authenticated;

drop trigger if exists maintenance_work_orders_touch on public.maintenance_work_orders;
create trigger maintenance_work_orders_touch
  before update on public.maintenance_work_orders
  for each row execute function public.touch_maintenance_work_order();

drop trigger if exists maintenance_work_order_tasks_touch on public.maintenance_work_order_tasks;
create trigger maintenance_work_order_tasks_touch
  before update on public.maintenance_work_order_tasks
  for each row execute function public.touch_maintenance_updated_at();

drop trigger if exists maintenance_work_order_parts_touch on public.maintenance_work_order_parts;
create trigger maintenance_work_order_parts_touch
  before update on public.maintenance_work_order_parts
  for each row execute function public.touch_maintenance_updated_at();

create or replace function public.validate_maintenance_work_order_child_transition()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_table_name = 'maintenance_work_order_tasks' and new.status is distinct from old.status then
    if not (
      (old.status = 'pending' and new.status in ('in_progress', 'completed', 'cancelled'))
      or (old.status = 'in_progress' and new.status in ('pending', 'completed', 'cancelled'))
    ) then
      raise exception 'Invalid work-order task transition: % -> %', old.status, new.status;
    end if;
    if new.status = 'completed' then
      new.completed_by := auth.uid();
      new.completed_at := now();
    else
      new.completed_by := null;
      new.completed_at := null;
    end if;
  elsif tg_table_name = 'maintenance_work_order_parts' and new.status is distinct from old.status then
    if not (
      (old.status = 'needed' and new.status in ('ordered', 'cancelled'))
      or (old.status = 'ordered' and new.status in ('received', 'cancelled'))
      or (old.status = 'received' and new.status in ('installed', 'cancelled'))
    ) then
      raise exception 'Invalid work-order part transition: % -> %', old.status, new.status;
    end if;
    if new.status = 'ordered' then new.ordered_date := coalesce(new.ordered_date, current_date); end if;
    if new.status = 'received' then new.received_date := coalesce(new.received_date, current_date); end if;
  end if;
  if tg_table_name = 'maintenance_work_order_parts' then
    new.core_returned_at := case when new.core_returned then coalesce(new.core_returned_at, now()) else null end;
  end if;
  return new;
end;
$$;

revoke execute on function public.validate_maintenance_work_order_child_transition()
  from public, anon, authenticated;

drop trigger if exists maintenance_work_order_tasks_transition on public.maintenance_work_order_tasks;
create trigger maintenance_work_order_tasks_transition
  before update on public.maintenance_work_order_tasks
  for each row execute function public.validate_maintenance_work_order_child_transition();

drop trigger if exists maintenance_work_order_parts_transition on public.maintenance_work_order_parts;
create trigger maintenance_work_order_parts_transition
  before update on public.maintenance_work_order_parts
  for each row execute function public.validate_maintenance_work_order_child_transition();

create or replace function public.prevent_maintenance_work_order_audit_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Work-order audit records are immutable.';
end;
$$;

revoke execute on function public.prevent_maintenance_work_order_audit_mutation() from public, anon, authenticated;

drop trigger if exists maintenance_work_order_events_immutable on public.maintenance_work_order_status_events;
create trigger maintenance_work_order_events_immutable
  before update or delete on public.maintenance_work_order_status_events
  for each row execute function public.prevent_maintenance_work_order_audit_mutation();

drop trigger if exists maintenance_work_order_approvals_immutable on public.maintenance_work_order_approvals;
create trigger maintenance_work_order_approvals_immutable
  before update or delete on public.maintenance_work_order_approvals
  for each row execute function public.prevent_maintenance_work_order_audit_mutation();

create or replace function public.maintenance_work_order_transition_allowed(
  p_from text,
  p_to text
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case p_from
    when 'reported' then p_to in ('triage', 'cancelled')
    when 'triage' then p_to in ('awaiting_estimate', 'approved', 'scheduled', 'cancelled')
    when 'awaiting_estimate' then p_to in ('awaiting_approval', 'approved', 'cancelled')
    when 'awaiting_approval' then p_to in ('approved', 'awaiting_estimate', 'cancelled')
    when 'approved' then p_to in ('parts_ordered', 'scheduled', 'in_repair', 'cancelled')
    when 'parts_ordered' then p_to in ('scheduled', 'in_repair', 'cancelled')
    when 'scheduled' then p_to in ('in_repair', 'cancelled')
    when 'in_repair' then p_to in ('quality_check', 'completed', 'cancelled')
    when 'quality_check' then p_to in ('in_repair', 'completed', 'cancelled')
    when 'completed' then p_to in ('invoiced', 'closed')
    when 'invoiced' then p_to = 'closed'
    else false
  end
$$;

revoke execute on function public.maintenance_work_order_transition_allowed(text, text)
  from public, anon, authenticated;

create or replace function public.create_maintenance_work_order(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := (select public.current_org_id());
  v_user uuid := auth.uid();
  v_vehicle_id uuid := nullif(p_payload->>'vehicle_id', '')::uuid;
  v_source_type text := coalesce(nullif(btrim(p_payload->>'source_type'), ''), 'manual');
  v_source_id uuid := nullif(p_payload->>'source_id', '')::uuid;
  v_assigned_user_id uuid := nullif(p_payload->>'assigned_user_id', '')::uuid;
  v_title text := nullif(btrim(p_payload->>'title'), '');
  v_complaint text := nullif(btrim(p_payload->>'complaint'), '');
  v_recommended_action text := nullif(btrim(p_payload->>'recommended_action'), '');
  v_dispatch_hold_id uuid;
  v_existing uuid;
  v_work_order_id uuid;
  v_finding public.inspection_findings%rowtype;
begin
  if v_org is null or v_user is null or not (select public.is_org_writer()) then
    raise exception 'Write permission required.';
  end if;
  if v_vehicle_id is null or not exists (
    select 1 from public.vehicles
    where organization_id = v_org and id = v_vehicle_id
  ) then
    raise exception 'Vehicle not found.';
  end if;
  if v_source_type not in ('inspection_finding', 'maintenance_reminder', 'manual', 'breakdown', 'invoice_review') then
    raise exception 'Invalid work-order source.';
  end if;
  if v_source_type in ('inspection_finding', 'maintenance_reminder', 'invoice_review') and v_source_id is null then
    raise exception 'Source record is required.';
  end if;
  if v_assigned_user_id is not null and not exists (
    select 1 from public.profiles
    where organization_id = v_org and id = v_assigned_user_id
  ) then
    raise exception 'Assignee not found.';
  end if;

  if v_source_id is not null then
    select id into v_existing
    from public.maintenance_work_orders
    where organization_id = v_org
      and vehicle_id = v_vehicle_id
      and source_type = v_source_type
      and source_id = v_source_id
      and status <> 'cancelled'
    limit 1;
    if v_existing is not null then return v_existing; end if;
  end if;

  if v_source_type = 'inspection_finding' then
    select * into v_finding
    from public.inspection_findings
    where organization_id = v_org
      and id = v_source_id
      and vehicle_id = v_vehicle_id
      and status = 'open'
    for update;
    if not found then raise exception 'Inspection finding not found.'; end if;
    v_title := coalesce(v_title, nullif(btrim(v_finding.label), ''), 'Inspection repair');
    v_complaint := coalesce(v_complaint, nullif(btrim(v_finding.notes), ''));
    v_recommended_action := coalesce(
      v_recommended_action,
      nullif(btrim(v_finding.recommended_action), '')
    );
    select id into v_dispatch_hold_id
    from public.vehicle_dispatch_holds
    where organization_id = v_org
      and source_type = 'inspection_finding'
      and source_id = v_source_id
      and status = 'open'
    limit 1;
  elsif v_source_type = 'maintenance_reminder' then
    if not exists (
      select 1
      from public.maintenance_rules r
      join public.vehicles v
        on v.organization_id = r.organization_id
       and v.id = v_vehicle_id
      where r.organization_id = v_org
        and r.id = v_source_id
        and r.active = true
        and (r.vehicle_id = v_vehicle_id or (r.vehicle_id is null and r.vehicle_type = v.vehicle_type))
    ) then
      raise exception 'Maintenance reminder not found for vehicle.';
    end if;
    select coalesce(v_title, r.service_type || ' work order')
      into v_title
    from public.maintenance_rules r
    where r.organization_id = v_org and r.id = v_source_id;
  elsif v_source_type = 'invoice_review' then
    if not exists (
      select 1 from public.maintenance_invoices
      where organization_id = v_org
        and id = v_source_id
        and (vehicle_id is null or vehicle_id = v_vehicle_id)
    ) then
      raise exception 'Maintenance invoice not found for vehicle.';
    end if;
  end if;

  if v_title is null or length(v_title) < 3 then
    raise exception 'Work-order title is required.';
  end if;

  insert into public.maintenance_work_orders (
    organization_id, vehicle_id, source_type, source_id, dispatch_hold_id,
    title, complaint, diagnosis, recommended_action, priority,
    assigned_user_id, shop_vendor, shop_contact, appointment_start,
    estimated_completion, estimated_cost, approved_cost_limit,
    downtime_start, odometer, engine_hours, notes, created_by, updated_by
  )
  values (
    v_org, v_vehicle_id, v_source_type, v_source_id, v_dispatch_hold_id,
    v_title, v_complaint, nullif(btrim(p_payload->>'diagnosis'), ''),
    v_recommended_action,
    coalesce(nullif(p_payload->>'priority', ''), 'normal'),
    v_assigned_user_id, nullif(btrim(p_payload->>'shop_vendor'), ''),
    nullif(btrim(p_payload->>'shop_contact'), ''),
    nullif(p_payload->>'appointment_start', '')::timestamptz,
    nullif(p_payload->>'estimated_completion', '')::timestamptz,
    nullif(p_payload->>'estimated_cost', '')::numeric,
    nullif(p_payload->>'approved_cost_limit', '')::numeric,
    nullif(p_payload->>'downtime_start', '')::timestamptz,
    nullif(p_payload->>'odometer', '')::numeric,
    nullif(p_payload->>'engine_hours', '')::numeric,
    nullif(btrim(p_payload->>'notes'), ''), v_user, v_user
  )
  returning id into v_work_order_id;

  insert into public.maintenance_work_order_status_events (
    organization_id, work_order_id, event_type, to_status, notes, metadata, created_by
  )
  values (
    v_org, v_work_order_id, 'created', 'reported',
    nullif(btrim(p_payload->>'notes'), ''),
    jsonb_build_object('source_type', v_source_type, 'source_id', v_source_id),
    v_user
  );

  if v_source_type = 'inspection_finding' then
    update public.inspection_findings
    set work_order_id = v_work_order_id,
        work_order_status = 'created',
        work_order_notes = coalesce(nullif(btrim(p_payload->>'notes'), ''), work_order_notes),
        work_order_created_by = v_user,
        work_order_created_at = coalesce(work_order_created_at, now())
    where organization_id = v_org and id = v_source_id;
  end if;

  return v_work_order_id;
end;
$$;

revoke execute on function public.create_maintenance_work_order(jsonb) from public, anon;
grant execute on function public.create_maintenance_work_order(jsonb) to authenticated;

create or replace function public.transition_maintenance_work_order(
  p_work_order_id uuid,
  p_to_status text,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := (select public.current_org_id());
  v_user uuid := auth.uid();
  v_work_order public.maintenance_work_orders%rowtype;
  v_threshold numeric := 2500;
  v_now timestamptz := now();
begin
  if v_org is null or v_user is null or not (select public.is_org_writer()) then
    raise exception 'Write permission required.';
  end if;

  select * into v_work_order
  from public.maintenance_work_orders
  where organization_id = v_org and id = p_work_order_id
  for update;
  if not found then raise exception 'Work order not found.'; end if;
  if not public.maintenance_work_order_transition_allowed(v_work_order.status, p_to_status) then
    raise exception 'Invalid work-order transition: % -> %', v_work_order.status, p_to_status;
  end if;
  if p_to_status = 'scheduled' and v_work_order.appointment_start is null then
    raise exception 'Appointment start is required before scheduling.';
  end if;
  if p_to_status = 'awaiting_approval' and v_work_order.estimated_cost is null then
    raise exception 'Estimate amount is required before approval.';
  end if;
  if p_to_status in ('completed', 'closed') and exists (
    select 1 from public.maintenance_work_order_tasks
    where organization_id = v_org
      and work_order_id = p_work_order_id
      and status not in ('completed', 'cancelled')
  ) then
    raise exception 'All active tasks must be completed before closure.';
  end if;

  select coalesce(maintenance_work_order_approval_threshold, 2500)
    into v_threshold
  from public.settings
  where organization_id = v_org;

  if p_to_status in ('approved', 'scheduled', 'in_repair')
     and coalesce(v_work_order.estimated_cost, 0) > coalesce(v_threshold, 2500)
     and v_work_order.approval_state <> 'approved' then
    raise exception 'Approval is required for this estimate.';
  end if;

  update public.maintenance_work_orders
  set
    status = p_to_status,
    status_changed_at = v_now,
    approval_state = case
      when p_to_status = 'awaiting_approval' then 'pending'
      when p_to_status = 'approved'
        and coalesce(estimated_cost, 0) <= coalesce(v_threshold, 2500)
        then 'not_required'
      else approval_state
    end,
    estimate_requested_at = case
      when p_to_status = 'awaiting_estimate' then coalesce(estimate_requested_at, v_now)
      else estimate_requested_at
    end,
    estimate_requested_by = case
      when p_to_status = 'awaiting_estimate' then coalesce(estimate_requested_by, v_user)
      else estimate_requested_by
    end,
    actual_start = case
      when p_to_status = 'in_repair' then coalesce(actual_start, v_now)
      else actual_start
    end,
    downtime_start = case
      when p_to_status = 'in_repair' then coalesce(downtime_start, v_now)
      else downtime_start
    end,
    actual_completion = case
      when p_to_status = 'completed' then coalesce(actual_completion, v_now)
      else actual_completion
    end,
    downtime_end = case
      when p_to_status in ('completed', 'cancelled') and downtime_start is not null
        then coalesce(downtime_end, v_now)
      else downtime_end
    end,
    closed_by = case when p_to_status = 'closed' then v_user else null end,
    closed_at = case when p_to_status = 'closed' then v_now else null end,
    cancelled_by = case when p_to_status = 'cancelled' then v_user else null end,
    cancelled_at = case when p_to_status = 'cancelled' then v_now else null end
  where organization_id = v_org and id = p_work_order_id;

  insert into public.maintenance_work_order_status_events (
    organization_id, work_order_id, event_type, from_status, to_status, notes, created_by
  )
  values (
    v_org, p_work_order_id, 'status_transition',
    v_work_order.status, p_to_status, nullif(btrim(p_notes), ''), v_user
  );

  if p_to_status = 'awaiting_approval' then
    insert into public.maintenance_work_order_approvals (
      organization_id, work_order_id, state, estimate_amount,
      requested_by, requested_at
    )
    values (
      v_org, p_work_order_id, 'requested', v_work_order.estimated_cost,
      v_user, v_now
    );
  end if;

  return jsonb_build_object(
    'work_order_id', p_work_order_id,
    'from_status', v_work_order.status,
    'to_status', p_to_status
  );
end;
$$;

revoke execute on function public.transition_maintenance_work_order(uuid, text, text) from public, anon;
grant execute on function public.transition_maintenance_work_order(uuid, text, text) to authenticated;

create or replace function public.submit_maintenance_work_order_estimate(
  p_work_order_id uuid,
  p_estimated_cost numeric,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := (select public.current_org_id());
  v_user uuid := auth.uid();
  v_work_order public.maintenance_work_orders%rowtype;
  v_threshold numeric := 2500;
  v_to_status text;
  v_approval_state text;
  v_now timestamptz := now();
begin
  if v_org is null or v_user is null or not (select public.is_org_writer()) then
    raise exception 'Write permission required.';
  end if;
  if p_estimated_cost is null or p_estimated_cost < 0 then
    raise exception 'A non-negative estimate is required.';
  end if;

  select * into v_work_order
  from public.maintenance_work_orders
  where organization_id = v_org
    and id = p_work_order_id
    and status = 'awaiting_estimate'
  for update;
  if not found then raise exception 'Work order is not awaiting an estimate.'; end if;

  select coalesce(maintenance_work_order_approval_threshold, 2500)
    into v_threshold
  from public.settings
  where organization_id = v_org;

  if p_estimated_cost > coalesce(v_threshold, 2500) then
    v_to_status := 'awaiting_approval';
    v_approval_state := 'pending';
  else
    v_to_status := 'approved';
    v_approval_state := 'not_required';
  end if;

  update public.maintenance_work_orders
  set estimated_cost = p_estimated_cost,
      approval_state = v_approval_state,
      status = v_to_status,
      status_changed_at = v_now
  where organization_id = v_org and id = p_work_order_id;

  insert into public.maintenance_work_order_status_events (
    organization_id, work_order_id, event_type, from_status, to_status,
    notes, metadata, created_by
  )
  values (
    v_org, p_work_order_id, 'estimate_submitted', v_work_order.status, v_to_status,
    nullif(btrim(p_notes), ''),
    jsonb_build_object('estimate_amount', p_estimated_cost, 'approval_threshold', v_threshold),
    v_user
  );

  if v_to_status = 'awaiting_approval' then
    insert into public.maintenance_work_order_approvals (
      organization_id, work_order_id, state, estimate_amount,
      requested_by, requested_at
    )
    values (
      v_org, p_work_order_id, 'requested', p_estimated_cost,
      v_user, v_now
    );
  end if;

  return jsonb_build_object(
    'work_order_id', p_work_order_id,
    'status', v_to_status,
    'approval_required', v_to_status = 'awaiting_approval'
  );
end;
$$;

revoke execute on function public.submit_maintenance_work_order_estimate(uuid, numeric, text)
  from public, anon;
grant execute on function public.submit_maintenance_work_order_estimate(uuid, numeric, text)
  to authenticated;

create or replace function public.decide_maintenance_work_order_approval(
  p_work_order_id uuid,
  p_decision text,
  p_approved_amount numeric default null,
  p_notes text default null,
  p_rejection_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := (select public.current_org_id());
  v_user uuid := auth.uid();
  v_work_order public.maintenance_work_orders%rowtype;
  v_to_status text;
  v_now timestamptz := now();
begin
  if v_org is null or v_user is null or not (select public.is_org_writer()) then
    raise exception 'Write permission required.';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Approval decision must be approved or rejected.';
  end if;

  select * into v_work_order
  from public.maintenance_work_orders
  where organization_id = v_org
    and id = p_work_order_id
    and status = 'awaiting_approval'
    and approval_state = 'pending'
  for update;
  if not found then raise exception 'Pending work-order approval not found.'; end if;

  if p_decision = 'approved' then
    if coalesce(p_approved_amount, v_work_order.estimated_cost) is null
       or coalesce(p_approved_amount, v_work_order.estimated_cost) < 0 then
      raise exception 'Approved amount is required.';
    end if;
    v_to_status := 'approved';
  else
    if p_rejection_reason is null or length(btrim(p_rejection_reason)) < 3 then
      raise exception 'Rejection reason is required.';
    end if;
    v_to_status := 'awaiting_estimate';
  end if;

  insert into public.maintenance_work_order_approvals (
    organization_id, work_order_id, state, estimate_amount, approved_amount,
    approval_notes, rejection_reason, requested_by, requested_at,
    decided_by, decided_at
  )
  values (
    v_org, p_work_order_id, p_decision, v_work_order.estimated_cost,
    case when p_decision = 'approved' then coalesce(p_approved_amount, v_work_order.estimated_cost) else null end,
    nullif(btrim(p_notes), ''),
    case when p_decision = 'rejected' then btrim(p_rejection_reason) else null end,
    v_work_order.estimate_requested_by, v_work_order.estimate_requested_at,
    v_user, v_now
  );

  update public.maintenance_work_orders
  set approval_state = p_decision,
      approved_cost_limit = case
        when p_decision = 'approved' then coalesce(p_approved_amount, estimated_cost)
        else approved_cost_limit
      end,
      status = v_to_status,
      status_changed_at = v_now
  where organization_id = v_org and id = p_work_order_id;

  insert into public.maintenance_work_order_status_events (
    organization_id, work_order_id, event_type, from_status, to_status,
    notes, metadata, created_by
  )
  values (
    v_org, p_work_order_id, 'approval_decision',
    v_work_order.status, v_to_status, nullif(btrim(p_notes), ''),
    jsonb_build_object(
      'decision', p_decision,
      'approved_amount', case
        when p_decision = 'approved' then coalesce(p_approved_amount, v_work_order.estimated_cost)
        else null
      end,
      'rejection_reason', case when p_decision = 'rejected' then btrim(p_rejection_reason) else null end
    ),
    v_user
  );

  return jsonb_build_object(
    'work_order_id', p_work_order_id,
    'decision', p_decision,
    'status', v_to_status
  );
end;
$$;

revoke execute on function public.decide_maintenance_work_order_approval(uuid, text, numeric, text, text)
  from public, anon;
grant execute on function public.decide_maintenance_work_order_approval(uuid, text, numeric, text, text)
  to authenticated;

create or replace function public.create_inspection_work_order_draft(
  p_finding_id uuid,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := (select public.current_org_id());
  v_finding public.inspection_findings%rowtype;
begin
  if v_org is null or not (select public.is_org_writer()) then
    raise exception 'Write permission required.';
  end if;
  select * into v_finding
  from public.inspection_findings
  where organization_id = v_org and id = p_finding_id and status = 'open';
  if not found then raise exception 'Open finding not found.'; end if;

  return public.create_maintenance_work_order(jsonb_build_object(
    'vehicle_id', v_finding.vehicle_id,
    'source_type', 'inspection_finding',
    'source_id', v_finding.id,
    'title', coalesce(nullif(btrim(v_finding.label), ''), 'Inspection repair'),
    'complaint', v_finding.notes,
    'recommended_action', v_finding.recommended_action,
    'priority', case
      when v_finding.severity in ('critical', 'do_not_dispatch') then 'critical'
      else 'high'
    end,
    'notes', nullif(btrim(p_notes), '')
  ));
end;
$$;

revoke execute on function public.create_inspection_work_order_draft(uuid, text) from public, anon;
grant execute on function public.create_inspection_work_order_draft(uuid, text) to authenticated;

-- Preserve legacy "draft" finding flags by creating traceable reported work orders.
insert into public.maintenance_work_orders (
  organization_id, vehicle_id, source_type, source_id, title, complaint,
  recommended_action, priority, status, notes, created_by, created_at,
  updated_by, updated_at
)
select
  f.organization_id,
  f.vehicle_id,
  'inspection_finding',
  f.id,
  coalesce(nullif(btrim(f.label), ''), 'Inspection repair'),
  f.notes,
  f.recommended_action,
  case when f.severity in ('critical', 'do_not_dispatch') then 'critical' else 'high' end,
  'reported',
  f.work_order_notes,
  f.work_order_created_by,
  coalesce(f.work_order_created_at, f.created_at, now()),
  f.work_order_created_by,
  coalesce(f.work_order_created_at, f.created_at, now())
from public.inspection_findings f
where f.work_order_status = 'draft'
  and f.work_order_id is null
on conflict (organization_id, vehicle_id, source_type, source_id)
  where source_id is not null and status <> 'cancelled'
do nothing;

update public.inspection_findings f
set work_order_id = w.id,
    work_order_status = 'created'
from public.maintenance_work_orders w
where f.organization_id = w.organization_id
  and w.source_type = 'inspection_finding'
  and w.source_id = f.id
  and f.work_order_status = 'draft'
  and f.work_order_id is null;

insert into public.maintenance_work_order_status_events (
  organization_id, work_order_id, event_type, to_status, notes, metadata,
  created_by, created_at
)
select
  w.organization_id,
  w.id,
  'created',
  'reported',
  'Legacy inspection work-order draft migrated.',
  jsonb_build_object('source_type', w.source_type, 'source_id', w.source_id, 'migrated', true),
  w.created_by,
  w.created_at
from public.maintenance_work_orders w
where w.source_type = 'inspection_finding'
  and not exists (
    select 1 from public.maintenance_work_order_status_events e
    where e.organization_id = w.organization_id
      and e.work_order_id = w.id
      and e.event_type = 'created'
  );
