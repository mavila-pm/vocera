-- =====================================================================
-- Vocera · 0100 · Núcleo: cuentas, roles, auditoría y notificaciones
--
-- Principios de seguridad de todo el esquema:
--   * RLS activado en TODAS las tablas de public.
--   * Las columnas de estado no tienen permiso UPDATE para "authenticated":
--     solo cambian dentro de funciones RPC (security definer) que validan
--     rol, propiedad y precondiciones, y que dejan rastro en audit_logs.
--   * Las funciones auxiliares viven en el esquema "private", que la API
--     REST no expone.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;

create schema if not exists private;
grant usage on schema private to authenticated, service_role;

-- ---------- Tipos ----------
create type public.app_role as enum ('creator', 'admin', 'brand');

-- Ciclo de la cuenta del creador (pasos 1–3 del flujo general)
create type public.profile_status as enum (
  'incomplete',     -- creador registrado, perfil sin completar
  'in_review',      -- perfil en revisión por Vocera
  'approved',       -- disponible para campañas
  'rejected',
  'suspended'
);

-- ---------- Perfil base (1 a 1 con auth.users) ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.app_role not null default 'creator',
  full_name text not null check (char_length(full_name) between 2 and 120),
  email extensions.citext not null,
  phone text check (phone is null or phone ~ '^\+[1-9][0-9]{6,14}$'),
  status public.profile_status not null default 'incomplete',
  status_reason text,
  terms_accepted_at timestamptz,
  terms_version text,
  welcome_seen_at timestamptz,
  onboarding_step smallint not null default 1 check (onboarding_step between 1 and 5),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_role_status_idx on public.profiles (role, status);

-- Marcas: preparado para una fase futura (portal de marca no implementado)
create table public.brands (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 160),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create table public.brand_members (
  brand_id uuid not null references public.brands(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (brand_id, user_id)
);

-- ---------- Auxiliares de autorización ----------
create or replace function private.current_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
$$;

create or replace function private.is_brand_member(p_brand uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.brand_members where brand_id = p_brand and user_id = auth.uid())
$$;

create or replace function private.require_admin() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'Acción reservada al equipo de Vocera.' using errcode = '42501';
  end if;
end $$;

create or replace function private.require_user() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v uuid := auth.uid();
begin
  if v is null then
    raise exception 'Necesitas iniciar sesión.' using errcode = '42501';
  end if;
  return v;
end $$;

grant execute on function private.current_role(), private.is_admin(), private.is_brand_member(uuid),
  private.require_admin(), private.require_user() to authenticated;

create or replace function private.touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_updated_at();

-- ---------- Auditoría ----------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid,
  actor_role public.app_role,
  action text not null,
  table_name text not null,
  record_id text,
  old_status text,
  new_status text,
  reason text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_record_idx on public.audit_logs (table_name, record_id);
create index audit_logs_created_idx on public.audit_logs (created_at desc);

create or replace function private.audit(
  p_action text, p_table text, p_record text,
  p_old text default null, p_new text default null,
  p_reason text default null, p_meta jsonb default '{}'::jsonb
) returns void language sql security definer set search_path = '' as $$
  insert into public.audit_logs (actor_id, actor_role, action, table_name, record_id, old_status, new_status, reason, meta)
  values (auth.uid(), private.current_role(), p_action, p_table, p_record, p_old, p_new, p_reason, coalesce(p_meta, '{}'::jsonb));
$$;

-- ---------- Notificaciones ----------
create type public.email_delivery as enum ('not_required', 'pending_provider', 'sent', 'failed');

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  link text,
  dedupe_key text not null,
  read_at timestamptz,
  email_status public.email_delivery not null default 'not_required',
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

-- Registra la notificación una sola vez (dedupe_key). El correo queda en
-- "pending_provider": no se envía nada hasta que exista un proveedor
-- configurado (ver docs/PORTAL.md).
create or replace function private.notify(
  p_user uuid, p_type text, p_title text, p_body text, p_link text,
  p_dedupe text, p_email boolean default true
) returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, type, title, body, link, dedupe_key, email_status)
  values (p_user, p_type, p_title, p_body, p_link, p_dedupe,
          case when p_email then 'pending_provider'::public.email_delivery else 'not_required' end)
  on conflict (user_id, dedupe_key) do nothing;
$$;

create or replace function private.notify_admins(
  p_type text, p_title text, p_body text, p_link text, p_dedupe text
) returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, type, title, body, link, dedupe_key)
  select id, p_type, p_title, p_body, p_link, p_dedupe from public.profiles where role = 'admin'
  on conflict (user_id, dedupe_key) do nothing;
$$;

-- ---------- Alta automática del perfil al registrarse ----------
-- El rol SIEMPRE nace como "creator": nunca se toma de los metadatos que
-- envía el navegador.
create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (id, full_name, email, phone, terms_accepted_at, terms_version)
  values (
    new.id,
    coalesce(nullif(trim(m ->> 'full_name'), ''), split_part(new.email, '@', 1)),
    new.email,
    nullif(m ->> 'phone', ''),
    case when (m ->> 'terms_accepted') = 'true' then now() end,
    nullif(m ->> 'terms_version', '')
  );
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------- RLS ----------
alter table public.profiles enable row level security;
alter table public.brands enable row level security;
alter table public.brand_members enable row level security;
alter table public.audit_logs enable row level security;
alter table public.notifications enable row level security;

revoke all on public.profiles, public.brands, public.brand_members, public.audit_logs, public.notifications from anon;
revoke insert, update, delete on public.profiles from authenticated;
-- El usuario solo edita sus datos de contacto; rol y estado, nunca.
grant update (full_name, phone) on public.profiles to authenticated;

create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or private.is_admin());
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy brands_select on public.brands for select to authenticated
  using (private.is_admin() or private.is_brand_member(id));
create policy brands_admin_write on public.brands for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

create policy brand_members_select on public.brand_members for select to authenticated
  using (private.is_admin() or user_id = auth.uid());
create policy brand_members_admin on public.brand_members for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

revoke insert, update, delete on public.audit_logs from authenticated;
create policy audit_admin_read on public.audit_logs for select to authenticated
  using (private.is_admin());

revoke insert, delete on public.notifications from authenticated;
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy notifications_own_read on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy notifications_own_mark on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- RPC de cuenta ----------
create or replace function public.mark_welcome_seen() returns void
language sql security definer set search_path = '' as $$
  update public.profiles set welcome_seen_at = coalesce(welcome_seen_at, now()) where id = auth.uid();
$$;

create or replace function public.mark_all_notifications_read() returns void
language sql security definer set search_path = '' as $$
  update public.notifications set read_at = now() where user_id = auth.uid() and read_at is null;
$$;

-- Promoción de rol: solo un admin, y queda auditada.
create or replace function public.admin_set_role(p_user uuid, p_role public.app_role, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_old public.app_role;
begin
  perform private.require_admin();
  if p_user = auth.uid() then
    raise exception 'No puedes cambiar tu propio rol.';
  end if;
  select role into v_old from public.profiles where id = p_user for update;
  if not found then raise exception 'Usuario no encontrado.'; end if;
  update public.profiles set role = p_role where id = p_user;
  perform private.audit('role_changed', 'profiles', p_user::text, v_old::text, p_role::text, p_reason);
end $$;

revoke execute on function public.admin_set_role(uuid, public.app_role, text) from anon;
revoke execute on function public.mark_welcome_seen(), public.mark_all_notifications_read() from anon;
