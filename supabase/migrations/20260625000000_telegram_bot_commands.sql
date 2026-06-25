-- ============================================================================
-- Telegram AI management bot
--  (a) bot_pending_commands: AI commands awaiting confirmation / multi-step input
--  (b) create_settlement_atomic: add optional p_organization_id so the bot's
--      service-role client (no auth.uid()) can create settlements.
-- ============================================================================

-- ---------- (a) Pending bot commands ----------
create table if not exists bot_pending_commands (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  chat_id text not null,
  intent text not null,
  payload jsonb not null default '{}',
  step int not null default 0,          -- 0 = awaiting confirmation; >0 = multi-step wizard
  awaiting text,                        -- field name being collected (null = confirmation stage)
  created_at timestamptz not null default now()
);
alter table bot_pending_commands enable row level security;
drop policy if exists bot_pending_commands_rw on bot_pending_commands;
create policy bot_pending_commands_rw on bot_pending_commands
  for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));
create index if not exists idx_bot_pending_org_chat
  on bot_pending_commands (organization_id, chat_id);

-- ---------- (b) create_settlement_atomic + org override ----------
-- Adding a parameter changes the function signature, so drop the old 17-arg
-- version first to avoid an ambiguous overload, then recreate with the param.
drop function if exists create_settlement_atomic(
  text, uuid, uuid, uuid, uuid, uuid, date, date, jsonb, numeric, numeric,
  numeric, numeric, numeric, jsonb, uuid[], uuid[]
);

create or replace function create_settlement_atomic(
  p_settlement_type text,
  p_company_id uuid,
  p_external_carrier_id uuid,
  p_vehicle_id uuid,
  p_driver_id uuid,
  p_owner_id uuid,
  p_week_start date,
  p_week_end date,
  p_config jsonb,
  p_gross_revenue numeric,
  p_total_deductions numeric,
  p_our_commission_earned numeric,
  p_net_pay numeric,
  p_external_net_pay numeric,
  p_line_items jsonb,
  p_load_ids uuid[] default '{}'::uuid[],
  p_expense_ids uuid[] default '{}'::uuid[],
  -- Trusted service-role callers (Telegram bot) have no auth.uid(), so
  -- current_org_id() is null; they pass the org explicitly. Authenticated
  -- callers cannot override their own org (coalesce prefers current_org_id()).
  p_organization_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_org_id uuid := coalesce(current_org_id(), p_organization_id);
  v_settlement_id uuid;
  v_expected_loads int := coalesce(array_length(p_load_ids, 1), 0);
  v_expected_expenses int := coalesce(array_length(p_expense_ids, 1), 0);
  v_actual int;
begin
  if v_org_id is null then
    raise exception 'Organization context is required.';
  end if;

  if p_settlement_type not in (
    'company_driver',
    'box_truck_driver',
    'owner_operator',
    'managed_investor',
    'external_carrier_statement'
  ) then
    raise exception 'Invalid settlement type: %', p_settlement_type;
  end if;

  if p_week_start is not null and p_week_end is not null and p_week_end < p_week_start then
    raise exception 'Settlement week_end cannot be before week_start.';
  end if;

  if p_company_id is not null and not exists (
    select 1 from companies where organization_id = v_org_id and id = p_company_id
  ) then raise exception 'Company does not belong to this organization.'; end if;

  if p_external_carrier_id is not null and not exists (
    select 1 from external_carriers where organization_id = v_org_id and id = p_external_carrier_id
  ) then raise exception 'External carrier does not belong to this organization.'; end if;

  if p_vehicle_id is not null and not exists (
    select 1 from vehicles where organization_id = v_org_id and id = p_vehicle_id
  ) then raise exception 'Vehicle does not belong to this organization.'; end if;

  if p_driver_id is not null and not exists (
    select 1 from people where organization_id = v_org_id and id = p_driver_id
  ) then raise exception 'Driver does not belong to this organization.'; end if;

  if p_owner_id is not null and not exists (
    select 1 from people where organization_id = v_org_id and id = p_owner_id
  ) then raise exception 'Owner does not belong to this organization.'; end if;

  if v_expected_loads > 0 then
    perform 1
    from loads
    where organization_id = v_org_id
      and id = any(p_load_ids)
      and settlement_id is null
      and status in ('delivered', 'paid', 'booked')
      and (p_vehicle_id is null or vehicle_id = p_vehicle_id)
      and (p_week_start is null or delivery_date >= p_week_start)
      and (p_week_end is null or delivery_date <= p_week_end)
    order by id
    for update;
    get diagnostics v_actual = row_count;
    if v_actual <> v_expected_loads then
      raise exception 'One or more loads were already settled or no longer match this settlement.';
    end if;
  end if;

  if v_expected_expenses > 0 then
    perform 1
    from expenses
    where organization_id = v_org_id
      and id = any(p_expense_ids)
      and settlement_id is null
      and deduct_from_settlement = true
      and (p_vehicle_id is null or vehicle_id = p_vehicle_id)
      and (p_week_start is null or date >= p_week_start)
      and (p_week_end is null or date <= p_week_end)
    order by id
    for update;
    get diagnostics v_actual = row_count;
    if v_actual <> v_expected_expenses then
      raise exception 'One or more expenses were already settled or no longer match this settlement.';
    end if;
  end if;

  insert into settlements (
    organization_id,
    settlement_type,
    company_id,
    external_carrier_id,
    vehicle_id,
    driver_id,
    owner_id,
    week_start,
    week_end,
    config,
    gross_revenue,
    total_deductions,
    our_commission_earned,
    net_pay,
    external_net_pay,
    status
  ) values (
    v_org_id,
    p_settlement_type,
    p_company_id,
    p_external_carrier_id,
    p_vehicle_id,
    p_driver_id,
    p_owner_id,
    p_week_start,
    p_week_end,
    coalesce(p_config, '{}'::jsonb),
    coalesce(p_gross_revenue, 0),
    coalesce(p_total_deductions, 0),
    coalesce(p_our_commission_earned, 0),
    coalesce(p_net_pay, 0),
    p_external_net_pay,
    'draft'
  )
  returning id into v_settlement_id;

  insert into settlement_items (
    organization_id,
    settlement_id,
    key,
    label_en,
    label_tr,
    amount,
    is_our_revenue,
    sort_order
  )
  select
    v_org_id,
    v_settlement_id,
    item.key,
    item.label_en,
    item.label_tr,
    coalesce(item.amount, 0),
    coalesce(item.is_our_revenue, false),
    coalesce(item.sort_order, item.ord::int - 1)
  from jsonb_to_recordset(coalesce(p_line_items, '[]'::jsonb))
    with ordinality as item(
      key text,
      label_en text,
      label_tr text,
      amount numeric,
      is_our_revenue boolean,
      sort_order int,
      ord bigint
    );

  if v_expected_loads > 0 then
    update loads
    set settlement_id = v_settlement_id
    where organization_id = v_org_id and id = any(p_load_ids);
  end if;

  if v_expected_expenses > 0 then
    update expenses
    set settlement_id = v_settlement_id
    where organization_id = v_org_id and id = any(p_expense_ids);
  end if;

  return v_settlement_id;
end;
$$;

revoke execute on function create_settlement_atomic(
  text, uuid, uuid, uuid, uuid, uuid, date, date, jsonb, numeric, numeric,
  numeric, numeric, numeric, jsonb, uuid[], uuid[], uuid
) from public, anon;
grant execute on function create_settlement_atomic(
  text, uuid, uuid, uuid, uuid, uuid, date, date, jsonb, numeric, numeric,
  numeric, numeric, numeric, jsonb, uuid[], uuid[], uuid
) to authenticated, service_role;
