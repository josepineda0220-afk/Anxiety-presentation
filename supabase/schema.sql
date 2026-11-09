-- ============================================================================
-- Anxiety Presentation: End-to-End Encrypted Deck Storage & Password-Gated RPC
-- Run this script once in your Supabase SQL Editor.
-- ============================================================================

-- 1. Encrypted presentations table (stores only AES-256-GCM ciphertext, IV, salt)
create table if not exists public.presentations (
  id text primary key,
  ciphertext text not null,
  iv text not null,
  salt text not null,
  updated_at timestamptz not null default now()
);

-- 2. Private secrets table (stores SHA-256 hash of the team's PBKDF2 edit token)
create table if not exists public.presentation_secrets (
  id text primary key,
  token_sha256 text not null,
  created_at timestamptz not null default now()
);

-- 3. Row-Level Security (RLS)
alter table public.presentations enable row level security;
alter table public.presentation_secrets enable row level security;

-- Public viewers can read the encrypted deck envelope (decrypted in browser)
drop policy if exists "Public can read encrypted presentations" on public.presentations;
create policy "Public can read encrypted presentations"
  on public.presentations
  for select
  to anon, authenticated
  using (true);

-- Direct client writes to `presentations` and any access to `presentation_secrets`
-- are blocked by RLS. All writes must go through the verified RPC below.

-- 4. Password-verified upsert RPC
create or replace function public.save_presentation(
  p_id text,
  p_ciphertext text,
  p_iv text,
  p_salt text,
  p_edit_token text
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_incoming_hash text;
  v_stored_hash text;
  v_now timestamptz := now();
begin
  if p_edit_token is null or length(trim(p_edit_token)) < 32 then
    raise exception 'Missing or invalid edit token' using errcode = '42501';
  end if;

  v_incoming_hash := encode(sha256(convert_to(trim(p_edit_token), 'UTF8')), 'hex');

  select token_sha256 into v_stored_hash
  from public.presentation_secrets
  where id = p_id;

  -- First authenticated save locks in the team's password token hash for this deck ID
  if v_stored_hash is null then
    insert into public.presentation_secrets (id, token_sha256)
    values (p_id, v_incoming_hash);
  elsif v_stored_hash <> v_incoming_hash then
    raise exception 'Unauthorized: invalid edit password' using errcode = '42501';
  end if;

  insert into public.presentations (id, ciphertext, iv, salt, updated_at)
  values (p_id, p_ciphertext, p_iv, p_salt, v_now)
  on conflict (id) do update
    set ciphertext = excluded.ciphertext,
        iv = excluded.iv,
        salt = excluded.salt,
        updated_at = excluded.updated_at;

  return v_now;
end;
$$;

grant execute on function public.save_presentation(text, text, text, text, text) to anon, authenticated;

-- 5. Enable Realtime updates so teammates see live changes
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'presentations'
  ) then
    alter publication supabase_realtime add table public.presentations;
  end if;
end
$$;
