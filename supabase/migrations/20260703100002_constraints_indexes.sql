-- Data-integrity belt and query index for the tracking/import flows.

begin;

-- One load per imported_loads row: DB-level guard against the Telegram
-- double-approve race (the webhook also claims the row atomically now).
create unique index if not exists imported_loads_created_load_key
  on imported_loads (created_load_id) where created_load_id is not null;

-- The tracking dashboard filters by org and orders by created_at desc limit 100;
-- the separate single-column indexes forced a sort.
create index if not exists tracking_events_org_created_idx
  on tracking_events (organization_id, created_at desc);

commit;
