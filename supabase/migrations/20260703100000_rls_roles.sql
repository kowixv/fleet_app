-- Role-aware RLS.
-- Before this migration every org member (including 'viewer') had full CRUD on
-- every table through PostgREST with the public anon key: a viewer could set
-- their own profiles.role to 'owner' or delete the organizations row (cascading
-- the whole tenant). App-layer requireWriteRole() had no DB-level counterpart.
--
-- After this migration:
--   * profiles        — SELECT only (rows are created by the SECURITY DEFINER
--                       handle_new_user trigger; no app code writes profiles).
--   * organizations   — SELECT for members; UPDATE only for owner/admin;
--                       no INSERT/DELETE policy (trigger + service role only).
--   * all other org tables — SELECT for members; INSERT/UPDATE/DELETE require
--                       role in (owner, admin, manager), matching requireWriteRole.
-- Service-role clients (webhook, cron, tracking) bypass RLS and are unaffected.

begin;

-- ---------- 1. Helpers (same pattern as current_org_id) ----------
create or replace function current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from profiles where id = auth.uid()
$$;

revoke execute on function current_user_role() from public, anon;
grant execute on function current_user_role() to authenticated, service_role;

create or replace function is_org_writer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role from profiles where id = auth.uid()) in ('owner','admin','manager'),
    false
  )
$$;

revoke execute on function is_org_writer() from public, anon;
grant execute on function is_org_writer() to authenticated, service_role;

-- ---------- 2. profiles: read-only for members ----------
drop policy if exists profiles_rw on profiles;
drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles
  for select to authenticated
  using (organization_id = (select current_org_id()));

-- ---------- 3. organizations: read for members, update for owner/admin ----------
drop policy if exists org_rw on organizations;
drop policy if exists org_select on organizations;
drop policy if exists org_update on organizations;
create policy org_select on organizations
  for select to authenticated
  using (id = (select current_org_id()));
create policy org_update on organizations
  for update to authenticated
  using (id = (select current_org_id()) and (select current_user_role()) in ('owner','admin'))
  with check (id = (select current_org_id()));

-- ---------- 4. All other org tables: select = member, write = writer role ----------
do $$
declare t text;
begin
  foreach t in array array[
    'companies','external_carriers','people','vehicles','loads','expenses',
    'settlements','settlement_items','telegram_groups','imported_loads',
    'maintenance_rules','maintenance_records','vehicle_mileage_logs','settings',
    'telegram_pairing_codes','bot_pending_commands',
    'unit_locations','load_tracking','tracking_events','tablet_tokens'
  ] loop
    execute format('drop policy if exists %I_rw on %I;', t, t);
    execute format('drop policy if exists %I_select on %I;', t, t);
    execute format('drop policy if exists %I_insert on %I;', t, t);
    execute format('drop policy if exists %I_update on %I;', t, t);
    execute format('drop policy if exists %I_delete on %I;', t, t);

    execute format(
      'create policy %I_select on %I for select to authenticated
         using (organization_id = (select current_org_id()));', t, t);
    execute format(
      'create policy %I_insert on %I for insert to authenticated
         with check (organization_id = (select current_org_id()) and (select is_org_writer()));', t, t);
    execute format(
      'create policy %I_update on %I for update to authenticated
         using (organization_id = (select current_org_id()) and (select is_org_writer()))
         with check (organization_id = (select current_org_id()) and (select is_org_writer()));', t, t);
    execute format(
      'create policy %I_delete on %I for delete to authenticated
         using (organization_id = (select current_org_id()) and (select is_org_writer()));', t, t);
  end loop;
end $$;

commit;
