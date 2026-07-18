-- Amazon statements post-migration verification. Read-only.

with required_tables(table_name) as (
  values
    ('amazon_import_batches'),
    ('amazon_import_files'),
    ('amazon_import_raw_rows'),
    ('amazon_import_issues'),
    ('amazon_import_reconciliations'),
    ('amazon_payment_invoices'),
    ('amazon_payment_rows'),
    ('amazon_trip_rows'),
    ('amazon_import_matches'),
    ('amazon_revenue_items'),
    ('amazon_revenue_item_sources'),
    ('fuel_import_reports'),
    ('fuel_import_card_groups'),
    ('fuel_import_transactions'),
    ('fuel_import_transaction_lines'),
    ('fuel_cards'),
    ('fuel_card_assignments'),
    ('fuel_import_matches'),
    ('amazon_facility_locations'),
    ('amazon_external_driver_identifiers'),
    ('amazon_team_split_rules'),
    ('amazon_team_split_rule_members'),
    ('amazon_revenue_load_projections'),
    ('amazon_fuel_expense_projections'),
    ('amazon_statement_candidates'),
    ('amazon_statement_candidate_revenue'),
    ('amazon_statement_candidate_fuel_lines'),
    ('amazon_statement_candidate_adjustments')
)
select 'required_table' as check_name, r.table_name, to_regclass('public.' || r.table_name) is not null as present
from required_tables r
order by r.table_name;

select 'rls_enabled' as check_name, c.relname, c.relrowsecurity as enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and (c.relname like 'amazon_%' or c.relname like 'fuel_import_%' or c.relname in ('fuel_cards','fuel_card_assignments'))
  and c.relkind = 'r'
order by c.relname;

select 'required_rpc' as check_name, p.proname, p.prosecdef as security_definer, p.proconfig::text like '%search_path=public%' as fixed_search_path
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'persist_amazon_payment_import_atomic',
    'persist_amazon_trips_import_atomic',
    'persist_amazon_fuel_import_atomic',
    'apply_amazon_revenue_load_projections',
    'apply_amazon_fuel_expense_projections',
    'transition_amazon_import_batch_atomic',
    'convert_amazon_candidate_atomic',
    'create_settlement_with_links_atomic'
  )
order by p.proname;

select 'public_execute_grants_on_sensitive_functions' as check_name, n.nspname || '.' || p.proname as function_name
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join information_schema.routine_privileges rp
  on rp.specific_schema = n.nspname
 and rp.routine_name = p.proname
where n.nspname = 'public'
  and p.proname like '%amazon%'
  and rp.grantee = 'PUBLIC'
  and rp.privilege_type = 'EXECUTE';

select 'broad_for_all_policies' as check_name, schemaname, tablename, policyname
from pg_policies
where schemaname = 'public'
  and (tablename like 'amazon_%' or tablename like 'fuel_import_%' or tablename in ('fuel_cards','fuel_card_assignments'))
  and cmd = 'ALL';

select 'same_org_fk_constraints' as check_name, conrelid::regclass::text as table_name, conname
from pg_constraint
where contype = 'f'
  and conrelid::regclass::text like 'public.amazon_%'
  and conname like '%same_org%';

select 'unique_active_projection_indexes' as check_name, indexname
from pg_indexes
where schemaname = 'public'
  and indexname in (
    'amazon_revenue_load_projections_active_revenue_item_key',
    'amazon_revenue_load_projections_active_load_key',
    'amazon_fuel_expense_projections_active_line_key',
    'amazon_fuel_expense_projections_active_expense_key',
    'amazon_statement_candidates_converted_settlement_key'
  );

select 'orphan_revenue_item_sources' as check_name, count(*) as count
from public.amazon_revenue_item_sources s
left join public.amazon_revenue_items r
  on r.organization_id = s.organization_id and r.id = s.revenue_item_id
where r.id is null;

select 'duplicate_active_revenue_projections' as check_name, organization_id, revenue_item_id, count(*) as count
from public.amazon_revenue_load_projections
where projection_status = 'projected'
group by organization_id, revenue_item_id
having count(*) > 1;

select 'duplicate_active_fuel_projections' as check_name, organization_id, transaction_line_id, count(*) as count
from public.amazon_fuel_expense_projections
where projection_status = 'projected'
group by organization_id, transaction_line_id
having count(*) > 1;

select 'duplicate_candidate_revenue_links' as check_name, organization_id, candidate_id, revenue_item_id, count(*) as count
from public.amazon_statement_candidate_revenue
group by organization_id, candidate_id, revenue_item_id
having count(*) > 1;

select 'duplicate_candidate_fuel_links' as check_name, organization_id, candidate_id, transaction_line_id, count(*) as count
from public.amazon_statement_candidate_fuel_lines
group by organization_id, candidate_id, transaction_line_id
having count(*) > 1;

select 'converted_candidate_without_settlement' as check_name, count(*) as count
from public.amazon_statement_candidates
where status = 'converted'
  and converted_settlement_id is null;

select 'settlement_linked_to_multiple_candidates' as check_name, organization_id, converted_settlement_id, count(*) as count
from public.amazon_statement_candidates
where converted_settlement_id is not null
group by organization_id, converted_settlement_id
having count(*) > 1;
