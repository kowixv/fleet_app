-- Tablet tokens: store a SHA-256 hash instead of the plaintext secret.
-- A DB read (or leaked backup) no longer exposes live tablet credentials.
-- Existing paired tablets keep working: the device holds the raw token and the
-- backfilled hash of that raw token is what auth now looks up.
-- The raw token is generated app-side and returned exactly once at creation.

begin;

-- pgcrypto lives in the `extensions` schema on Supabase (and in `public` on a plain
-- Postgres where schema.sql created it), so digest() must be reachable from either.
set local search_path = public, extensions;

alter table tablet_tokens add column if not exists token_hash text;

update tablet_tokens
   set token_hash = encode(digest(token, 'sha256'), 'hex')
 where token_hash is null;

alter table tablet_tokens alter column token_hash set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tablet_tokens_token_hash_key') then
    alter table tablet_tokens add constraint tablet_tokens_token_hash_key unique (token_hash);
  end if;
end $$;

drop index if exists tablet_tokens_token_idx;
create index if not exists tablet_tokens_token_hash_idx
  on tablet_tokens (token_hash) where is_active = true;

alter table tablet_tokens drop column if exists token;

commit;
