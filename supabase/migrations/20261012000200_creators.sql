-- =====================================================================
-- Vocera · 0200 · Perfil profesional del creador (onboarding)
-- =====================================================================

create type public.social_platform as enum ('instagram', 'tiktok', 'youtube', 'facebook', 'x', 'linkedin', 'twitch', 'other');
create type public.rate_type as enum ('video', 'post', 'story', 'package');
create type public.availability_level as enum ('available', 'limited', 'unavailable');

create table public.creator_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  artistic_name text check (artistic_name is null or char_length(artistic_name) <= 80),
  avatar_path text,
  birth_date date check (birth_date is null or birth_date > date '1900-01-01'),
  country char(2) check (country is null or country ~ '^[A-Z]{2}$'),
  city text check (city is null or char_length(city) <= 80),
  bio text check (bio is null or char_length(bio) <= 600),
  main_category text check (main_category is null or char_length(main_category) <= 60),
  secondary_categories text[] not null default '{}' check (cardinality(secondary_categories) <= 6),
  availability public.availability_level,
  availability_note text check (availability_note is null or char_length(availability_note) <= 300),
  collaboration_modes text[] not null default '{}',
  portfolio_links text[] not null default '{}' check (cardinality(portfolio_links) <= 10),
  default_currency char(3) check (default_currency is null or default_currency ~ '^[A-Z]{3}$'),
  accepts_product_campaigns boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Redes: lo declarado por el creador y lo verificado por Vocera viven en
-- columnas separadas. El creador no puede escribir en las verificadas.
create table public.creator_social_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  platform public.social_platform not null,
  handle text not null check (char_length(handle) between 1 and 80),
  url text check (url is null or url ~* '^https?://'),
  followers_declared integer check (followers_declared is null or followers_declared >= 0),
  avg_views_declared integer check (avg_views_declared is null or avg_views_declared >= 0),
  engagement_declared numeric(5,2) check (engagement_declared is null or engagement_declared between 0 and 100),
  audience_notes text check (audience_notes is null or char_length(audience_notes) <= 500),
  evidence_path text,
  followers_verified integer check (followers_verified is null or followers_verified >= 0),
  avg_views_verified integer,
  engagement_verified numeric(5,2),
  verified_at timestamptz,
  verified_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (user_id, platform, handle)
);
create index social_user_idx on public.creator_social_accounts (user_id);

create table public.creator_rates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  rate_type public.rate_type not null,
  amount numeric(12,2) not null check (amount >= 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  notes text check (notes is null or char_length(notes) <= 300),
  unique (user_id, rate_type, currency)
);

-- Datos privados: solo se piden cuando hacen falta (envío de producto).
create table public.creator_private_details (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  shipping_recipient text,
  shipping_address text check (shipping_address is null or char_length(shipping_address) <= 300),
  shipping_city text,
  shipping_reference text,
  updated_at timestamptz not null default now()
);

-- Notas internas del equipo (el creador nunca las ve)
create table public.creator_notes (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create trigger creator_profiles_touch before update on public.creator_profiles
  for each row execute function private.touch_updated_at();
create trigger creator_private_touch before update on public.creator_private_details
  for each row execute function private.touch_updated_at();

-- ---------- RLS ----------
alter table public.creator_profiles enable row level security;
alter table public.creator_social_accounts enable row level security;
alter table public.creator_rates enable row level security;
alter table public.creator_private_details enable row level security;
alter table public.creator_notes enable row level security;

revoke all on public.creator_profiles, public.creator_social_accounts, public.creator_rates,
  public.creator_private_details, public.creator_notes from anon;

create policy cp_select on public.creator_profiles for select to authenticated
  using (user_id = auth.uid() or private.is_admin());
create policy cp_insert on public.creator_profiles for insert to authenticated
  with check (user_id = auth.uid());
create policy cp_update on public.creator_profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Columnas que el creador puede escribir en sus redes (las verificadas no)
revoke insert, update on public.creator_social_accounts from authenticated;
grant insert (user_id, platform, handle, url, followers_declared, avg_views_declared, engagement_declared, audience_notes, evidence_path)
  on public.creator_social_accounts to authenticated;
grant update (platform, handle, url, followers_declared, avg_views_declared, engagement_declared, audience_notes, evidence_path)
  on public.creator_social_accounts to authenticated;
create policy sa_select on public.creator_social_accounts for select to authenticated
  using (user_id = auth.uid() or private.is_admin());
create policy sa_insert on public.creator_social_accounts for insert to authenticated
  with check (user_id = auth.uid());
create policy sa_update on public.creator_social_accounts for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy sa_delete on public.creator_social_accounts for delete to authenticated
  using (user_id = auth.uid());

create policy rates_select on public.creator_rates for select to authenticated
  using (user_id = auth.uid() or private.is_admin());
create policy rates_write on public.creator_rates for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy private_select on public.creator_private_details for select to authenticated
  using (user_id = auth.uid() or private.is_admin());
create policy private_write on public.creator_private_details for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy notes_admin on public.creator_notes for all to authenticated
  using (private.is_admin()) with check (private.is_admin() and author_id = auth.uid());

-- ---------- Completitud del perfil ----------
-- Devuelve el porcentaje y la lista de requisitos pendientes. Los datos
-- bancarios y de envío NO cuentan: se piden cuando la operación los necesita.
create or replace function public.creator_completion(p_user uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid := coalesce(p_user, auth.uid());
  p public.profiles;
  c public.creator_profiles;
  checks jsonb := '[]'::jsonb;
  done int := 0;
  total int := 0;
  item record;
begin
  if v_user <> auth.uid() and not private.is_admin() then
    raise exception 'Sin permiso.' using errcode = '42501';
  end if;
  select * into p from public.profiles where id = v_user;
  select * into c from public.creator_profiles where user_id = v_user;

  for item in
    select * from (values
      ('photo',     1, 'Foto de perfil',                      c.avatar_path is not null),
      ('name',      1, 'Nombre completo',                     p.full_name is not null),
      ('artistic',  1, 'Nombre artístico',                    c.artistic_name is not null),
      ('location',  1, 'País y ciudad',                       c.country is not null and c.city is not null),
      ('phone',     1, 'Teléfono',                            p.phone is not null),
      ('bio',       1, 'Biografía',                           coalesce(char_length(c.bio), 0) >= 30),
      ('category',  1, 'Categoría principal',                 c.main_category is not null),
      ('social',    2, 'Al menos una red social',             exists (select 1 from public.creator_social_accounts s where s.user_id = v_user)),
      ('metrics',   2, 'Seguidores declarados',               exists (select 1 from public.creator_social_accounts s where s.user_id = v_user and s.followers_declared is not null)),
      ('rates',     3, 'Al menos una tarifa',                 exists (select 1 from public.creator_rates r where r.user_id = v_user)),
      ('avail',     3, 'Disponibilidad',                      c.availability is not null),
      ('portfolio', 3, 'Portafolio o trabajo anterior',       coalesce(cardinality(c.portfolio_links), 0) > 0)
    ) as t(key, step, label, ok)
  loop
    total := total + 1;
    if item.ok then done := done + 1; end if;
    checks := checks || jsonb_build_object('key', item.key, 'step', item.step, 'label', item.label, 'done', coalesce(item.ok, false));
  end loop;

  return jsonb_build_object(
    'percent', round(done * 100.0 / total),
    'done', done, 'total', total,
    'items', checks,
    'can_submit', done = total
  );
end $$;

-- Envío del perfil a revisión: valida en el servidor que esté completo.
create or replace function public.submit_profile_for_review() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := private.require_user();
  v_status public.profile_status;
  v_comp jsonb;
begin
  select status into v_status from public.profiles where id = v_user for update;
  if v_status not in ('incomplete', 'rejected') then
    raise exception 'Tu perfil ya fue enviado.';
  end if;
  v_comp := public.creator_completion(v_user);
  if not (v_comp ->> 'can_submit')::boolean then
    raise exception 'Faltan datos obligatorios para enviar tu perfil.' using detail = v_comp::text;
  end if;
  update public.profiles
     set status = 'in_review', submitted_at = now(), onboarding_step = 5, status_reason = null
   where id = v_user;
  perform private.audit('profile_submitted', 'profiles', v_user::text, v_status::text, 'in_review');
  perform private.notify(v_user, 'profile_received', 'Recibimos tu perfil',
    'El equipo de Vocera lo revisará y te avisaremos aquí cuando tengamos una respuesta.', '/perfil',
    'profile_received:' || to_char(now(), 'YYYYMMDDHH24MISS'));
  perform private.notify_admins('profile_to_review', 'Nuevo perfil para revisar',
    (select full_name from public.profiles where id = v_user), '/admin/creadores/' || v_user,
    'profile_to_review:' || v_user || ':' || to_char(now(), 'YYYYMMDDHH24MISS'));
  return v_comp;
end $$;

create or replace function public.save_onboarding_step(p_step smallint) returns void
language sql security definer set search_path = '' as $$
  update public.profiles set onboarding_step = greatest(onboarding_step, least(p_step, 4))
   where id = auth.uid() and status in ('incomplete', 'rejected');
$$;

-- Revisión de perfil por Vocera
create or replace function public.admin_review_profile(p_user uuid, p_approve boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_old public.profile_status; v_new public.profile_status;
begin
  perform private.require_admin();
  select status into v_old from public.profiles where id = p_user and role = 'creator' for update;
  if not found then raise exception 'Creador no encontrado.'; end if;
  if v_old <> 'in_review' then
    raise exception 'Solo se revisan perfiles en estado "en revisión" (actual: %).', v_old;
  end if;
  if not p_approve and coalesce(trim(p_reason), '') = '' then
    raise exception 'Indica el motivo del rechazo.';
  end if;
  v_new := case when p_approve then 'approved' else 'rejected' end;
  update public.profiles
     set status = v_new, status_reason = p_reason, reviewed_at = now(), reviewed_by = auth.uid()
   where id = p_user;
  perform private.audit('profile_reviewed', 'profiles', p_user::text, v_old::text, v_new::text, p_reason);
  if p_approve then
    perform private.notify(p_user, 'profile_approved', 'Tu perfil fue aprobado',
      'Ya puedes recibir invitaciones a campañas de Vocera.', '/', 'profile_approved:' || p_user);
  else
    perform private.notify(p_user, 'profile_rejected', 'Tu perfil necesita cambios',
      p_reason, '/perfil', 'profile_rejected:' || p_user || ':' || to_char(now(), 'YYYYMMDDHH24MISS'));
  end if;
end $$;

create or replace function public.admin_set_profile_status(p_user uuid, p_status public.profile_status, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_old public.profile_status;
begin
  perform private.require_admin();
  if p_status not in ('suspended', 'approved') then
    raise exception 'Usa la revisión de perfil para aprobar o rechazar.';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Indica el motivo.'; end if;
  select status into v_old from public.profiles where id = p_user for update;
  update public.profiles set status = p_status, status_reason = p_reason where id = p_user;
  perform private.audit('profile_status_changed', 'profiles', p_user::text, v_old::text, p_status::text, p_reason);
end $$;

create or replace function public.admin_verify_social(p_account uuid, p_followers integer, p_avg_views integer, p_engagement numeric)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  update public.creator_social_accounts
     set followers_verified = p_followers, avg_views_verified = p_avg_views,
         engagement_verified = p_engagement, verified_at = now(), verified_by = auth.uid()
   where id = p_account;
  if not found then raise exception 'Cuenta no encontrada.'; end if;
  perform private.audit('social_verified', 'creator_social_accounts', p_account::text, null, null, null,
    jsonb_build_object('followers', p_followers, 'avg_views', p_avg_views, 'engagement', p_engagement));
end $$;

-- Búsqueda de creadores para el panel (filtros del Módulo 12)
create or replace function public.admin_search_creators(
  p_query text default null, p_status public.profile_status default null,
  p_category text default null, p_country char(2) default null,
  p_min_followers integer default null, p_min_engagement numeric default null,
  p_max_rate numeric default null, p_availability public.availability_level default null
) returns table (
  user_id uuid, full_name text, artistic_name text, email text, status public.profile_status,
  country char(2), city text, main_category text, availability public.availability_level,
  total_followers bigint, followers_verified boolean, best_engagement numeric,
  min_rate numeric, rate_currency char(3), submitted_at timestamptz, created_at timestamptz
) language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return query
  with s as (
    select a.user_id,
           sum(coalesce(a.followers_verified, a.followers_declared, 0))::bigint as followers,
           bool_and(a.followers_verified is not null) as verified,
           max(coalesce(a.engagement_verified, a.engagement_declared)) as eng
      from public.creator_social_accounts a group by a.user_id
  ), r as (
    select distinct on (cr.user_id) cr.user_id, cr.amount, cr.currency
      from public.creator_rates cr order by cr.user_id, cr.amount
  )
  select p.id, p.full_name, c.artistic_name, p.email::text, p.status, c.country, c.city, c.main_category,
         c.availability, coalesce(s.followers, 0), coalesce(s.verified, false), s.eng, r.amount, r.currency,
         p.submitted_at, p.created_at
    from public.profiles p
    left join public.creator_profiles c on c.user_id = p.id
    left join s on s.user_id = p.id
    left join r on r.user_id = p.id
   where p.role = 'creator'
     and (p_status is null or p.status = p_status)
     and (p_query is null or p.full_name ilike '%' || p_query || '%' or c.artistic_name ilike '%' || p_query || '%' or p.email::text ilike '%' || p_query || '%')
     and (p_category is null or c.main_category = p_category or p_category = any (c.secondary_categories))
     and (p_country is null or c.country = p_country)
     and (p_min_followers is null or coalesce(s.followers, 0) >= p_min_followers)
     and (p_min_engagement is null or coalesce(s.eng, 0) >= p_min_engagement)
     and (p_max_rate is null or r.amount <= p_max_rate)
     and (p_availability is null or c.availability = p_availability)
   order by p.submitted_at desc nulls last, p.created_at desc
   limit 200;
end $$;

revoke execute on function public.creator_completion(uuid), public.submit_profile_for_review(),
  public.save_onboarding_step(smallint), public.admin_review_profile(uuid, boolean, text),
  public.admin_set_profile_status(uuid, public.profile_status, text),
  public.admin_verify_social(uuid, integer, integer, numeric),
  public.admin_search_creators(text, public.profile_status, text, char, integer, numeric, numeric, public.availability_level)
  from anon;
