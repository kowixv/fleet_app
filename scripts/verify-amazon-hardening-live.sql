-- Read-only/live verification checklist for Amazon server workflow hardening.
-- Do not run against production without an isolated test organization and test
-- rows. This script is intentionally diagnostic: it does not mutate data.

set search_path = public, extensions;

-- Functions exist with fixed search_path.
select p.proname, p.prosecdef as security_definer, pg_get_function_arguments(p.oid) as arguments
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'convert_amazon_candidate_atomic',
    'persist_amazon_source_atomic',
    'transition_amazon_import_batch_atomic'
  )
order by p.proname;

-- PUBLIC/anon execute should not be present.
select n.nspname, p.proname, r.rolname, has_function_privilege(r.rolname, p.oid, 'execute') as can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral (values ('anon'), ('authenticated'), ('service_role'), ('public')) as r(rolname)
where n.nspname = 'public'
  and p.proname in (
    'convert_amazon_candidate_atomic',
    'persist_amazon_source_atomic',
    'transition_amazon_import_batch_atomic'
  )
order by p.proname, r.rolname;

-- Candidate conversion idempotency/lineage indexes.
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'amazon_statement_candidates'
  and indexname in (
    'amazon_statement_candidates_one_conversion_key',
    'amazon_statement_candidates_conversion_idempotency_key',
    'amazon_statement_candidates_converted_settlement_key'
  )
order by indexname;

-- Manual concurrent-session verification to perform in an isolated test org:
-- 1. Session A: begin; select * from public.amazon_statement_candidates where id = '<ready-candidate>' for update;
-- 2. Session B: call public.convert_amazon_candidate_atomic('<same-candidate>', '<preview>', '<source>', null);
-- 3. Confirm B blocks until A commits/rolls back.
-- 4. Run two simultaneous conversion calls; confirm exactly one settlement row and one converted candidate.
-- 5. Force an invalid selected load/expense link and confirm candidate remains ready/unconverted.
-- 6. Force a bad candidate update predicate and confirm no settlement row is committed.
-- 7. Run two simultaneous transition_amazon_import_batch_atomic calls from uploaded to parsing; confirm exactly one succeeds.
-- 8. Force an exception inside persist_amazon_source_atomic with malformed normalized JSON and confirm no partial raw/normalized rows remain.
