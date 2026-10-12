-- =====================================================================
-- SOLO DESARROLLO LOCAL. NO es una migración y NO se aplica en Supabase.
-- Recrea los objetos mínimos que Supabase ya trae (roles, auth, storage,
-- vault) con los mismos nombres, para que las migraciones de
-- supabase/migrations corran sin cambios en un Postgres local y para que
-- las políticas RLS se prueben de verdad.
-- =====================================================================

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;

create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;
create extension if not exists pgcrypto with schema extensions;

-- ---------- auth ----------
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key default extensions.gen_random_uuid(),
  aud text default 'authenticated',
  role text default 'authenticated',
  email text unique,
  encrypted_password text,
  email_confirmed_at timestamptz,
  phone text,
  raw_app_meta_data jsonb default '{}'::jsonb,
  raw_user_meta_data jsonb default '{}'::jsonb,
  last_sign_in_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Tokens de correo del emulador local (en Supabase los gestiona GoTrue).
create table if not exists auth.local_email_tokens (
  token text primary key,
  user_id uuid references auth.users(id) on delete cascade,
  kind text not null,               -- signup | recovery
  redirect_to text,
  used_at timestamptz,
  created_at timestamptz default now()
);
create table if not exists auth.local_refresh_tokens (
  token text primary key,
  user_id uuid references auth.users(id) on delete cascade,
  revoked boolean default false,
  created_at timestamptz default now()
);

create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select auth.jwt() ->> 'role'
$$;
grant execute on function auth.jwt(), auth.uid(), auth.role() to anon, authenticated, service_role;

-- ---------- storage ----------
create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;

create table if not exists storage.buckets (
  id text primary key,
  name text not null unique,
  owner uuid,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create table if not exists storage.objects (
  id uuid primary key default extensions.gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text not null,
  owner uuid,
  owner_id text,
  metadata jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_accessed_at timestamptz default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;
grant select, insert, update, delete on storage.objects to authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;
create policy "buckets visibles" on storage.buckets for select using (true);

create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
create or replace function storage.filename(name text) returns text language sql immutable as $$
  select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)]
$$;
grant execute on function storage.foldername(text), storage.filename(text) to anon, authenticated, service_role;

-- ---------- vault ----------
create schema if not exists vault;
create table if not exists vault.secrets (
  id uuid primary key default extensions.gen_random_uuid(),
  name text unique,
  secret text not null,
  created_at timestamptz default now()
);
create or replace view vault.decrypted_secrets as
  select id, name, secret as decrypted_secret from vault.secrets;
create or replace function vault.create_secret(new_secret text, new_name text default null, new_description text default '')
returns uuid language sql as $$
  insert into vault.secrets(name, secret) values (new_name, new_secret)
  on conflict (name) do update set secret = excluded.secret
  returning id
$$;
revoke all on schema vault from anon, authenticated;

-- Privilegios por defecto equivalentes a los de Supabase para el esquema public
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
