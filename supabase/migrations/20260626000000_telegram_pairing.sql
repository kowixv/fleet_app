-- ============================================================================
-- Telegram one-tap pairing: short-lived, single-use codes that bind a Telegram
-- chat (private or group) to an organization without manual chat-ID entry.
--   Web (authenticated) creates a code; the bot (service-role) consumes it.
-- ============================================================================
create table if not exists telegram_pairing_codes (
  code text primary key,
  organization_id uuid not null references organizations (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes',
  used_at timestamptz
);
alter table telegram_pairing_codes enable row level security;
drop policy if exists telegram_pairing_codes_rw on telegram_pairing_codes;
create policy telegram_pairing_codes_rw on telegram_pairing_codes
  for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));
