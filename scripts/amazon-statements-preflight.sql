-- Amazon statements preflight checks. Read-only.
-- Run before applying migrations 20260716010000 through 20260716070000.

with required_relations(name) as (
  values
    ('public.organizations'::regclass),
    ('public.profiles'::regclass),
    ('public.loads'::regclass),
    ('public.expenses'::regclass),
    ('public.settlements'::regclass),
    ('public.settlement_load_links'::regclass),
    ('public.settlement_expense_links'::regclass)
)
select 'required_relation_present' as check_name, name::text as object_name
from required_relations;

select 'settlement_hardening_function_present' as check_name, p.proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('create_settlement_with_links_atomic', 'settlement_usage_group', 'current_org_id', 'is_org_writer');

select 'extension_available' as check_name, name
from pg_available_extensions
where name in ('pgcrypto', 'btree_gist');

select 'conflicting_amazon_objects_before_migration' as check_name, c.relkind, n.nspname || '.' || c.relname as object_name
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and (
    c.relname like 'amazon_%'
    or c.relname like 'fuel_import_%'
    or c.relname in ('fuel_cards', 'fuel_card_assignments')
  )
order by object_name;

select 'required_columns' as check_name, table_name, column_name
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'loads' and column_name in ('organization_id','id','gross_amount','fuel_surcharge','status'))
    or (table_name = 'expenses' and column_name in ('organization_id','id','amount','deduct_from_settlement'))
    or (table_name = 'settlements' and column_name in ('organization_id','id','status'))
  )
order by table_name, column_name;

select 'current_rls_helpers' as check_name, n.nspname || '.' || p.proname as function_name
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('current_org_id', 'is_org_writer');

select 'migration_dependency_order_expected' as check_name, *
from (values
  ('20260716010000', 'amazon_import_core'),
  ('20260716020000', 'amazon_payment_trip_normalization'),
  ('20260716030000', 'amazon_fuel_normalization'),
  ('20260716040000', 'amazon_reference_resolution'),
  ('20260716050000', 'amazon_projection_links'),
  ('20260716060000', 'amazon_statement_candidates'),
  ('20260716070000', 'amazon_server_workflow_hardening')
) as expected(version, name);
