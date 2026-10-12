-- =====================================================================
-- Vocera · 0500 · Finanzas: datos de cobro cifrados, pagos y bonificaciones
--
-- * Los números de cuenta se cifran en la base (pgcrypto, clave simétrica
--   guardada en Supabase Vault con el nombre "payout_encryption_key").
--   La clave NUNCA está en el repositorio.
-- * Las columnas cifradas no tienen permiso SELECT para la API: solo se ven
--   el titular, el banco y los 4 últimos dígitos.
-- * Este módulo NO ejecuta transferencias: registra decisiones y evidencias.
-- =====================================================================

create type public.payment_status as enum (
  'requirements_pending', 'in_review', 'approved', 'scheduled', 'transferred', 'confirmed', 'incident'
);
create type public.payment_concept as enum ('fee', 'bonus');
create type public.bonus_status as enum ('proposed', 'approved', 'rejected');

create table public.payout_methods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  holder_name text not null check (char_length(holder_name) between 3 and 140),
  country char(2) not null check (country ~ '^[A-Z]{2}$'),
  bank_name text not null check (char_length(bank_name) between 2 and 120),
  account_type text not null check (account_type in ('savings', 'checking', 'interbank', 'iban', 'other')),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  account_last4 char(4) not null,
  account_ciphertext bytea not null,
  bank_identifier_ciphertext bytea,     -- CCI, SWIFT/BIC, routing, etc.
  extra_ciphertext bytea,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create unique index payout_one_active_idx on public.payout_methods (user_id) where is_active;

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.campaign_assignments(id) on delete restrict,
  creator_id uuid not null references public.profiles(id) on delete restrict,
  concept public.payment_concept not null default 'fee',
  bonus_id uuid,
  amount numeric(12,2) not null check (amount >= 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  status public.payment_status not null default 'requirements_pending',
  requirements_snapshot jsonb,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  approval_note text,
  scheduled_for date,
  transferred_at timestamptz,
  transfer_reference text,
  receipt_path text,
  payout_method_id uuid references public.payout_methods(id),
  confirmed_at timestamptz,
  incident_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Un único honorario por asignación: evita pagos duplicados.
create unique index payments_one_fee_idx on public.payments (assignment_id) where concept = 'fee';
create unique index payments_one_per_bonus_idx on public.payments (bonus_id) where bonus_id is not null;
create index payments_creator_idx on public.payments (creator_id, status);

create table public.bonuses (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.campaign_assignments(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  currency char(3) not null,
  reason text not null check (char_length(reason) between 3 and 500),
  status public.bonus_status not null default 'proposed',
  proposed_by uuid not null references public.profiles(id),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.payments add constraint payments_bonus_fk foreign key (bonus_id) references public.bonuses(id);

-- Excepciones documentadas a un requisito de pago (p. ej. entrega tardía aceptada)
create table public.payment_requirement_overrides (
  assignment_id uuid not null references public.campaign_assignments(id) on delete cascade,
  requirement text not null check (requirement in ('on_time')),
  reason text not null check (char_length(reason) >= 5),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (assignment_id, requirement)
);

create trigger payments_touch before update on public.payments
  for each row execute function private.touch_updated_at();

-- ---------- Cifrado ----------
create or replace function private.payout_key() returns text
language plpgsql stable security definer set search_path = '' as $$
declare k text;
begin
  select decrypted_secret into k from vault.decrypted_secrets where name = 'payout_encryption_key' limit 1;
  if k is null or char_length(k) < 32 then
    raise exception 'El cifrado de datos bancarios no está configurado. Contacta a Vocera.'
      using hint = 'Crear el secreto payout_encryption_key en Supabase Vault (ver docs/PORTAL.md).';
  end if;
  return k;
end $$;
revoke all on function private.payout_key() from public, anon, authenticated;

create or replace function private.encrypt_text(p text) returns bytea
language sql stable security definer set search_path = '' as $$
  select case when p is null or p = '' then null
              else extensions.pgp_sym_encrypt(p, private.payout_key(), 'cipher-algo=aes256') end
$$;
create or replace function private.decrypt_text(p bytea) returns text
language sql stable security definer set search_path = '' as $$
  select case when p is null then null else extensions.pgp_sym_decrypt(p, private.payout_key()) end
$$;
revoke all on function private.encrypt_text(text), private.decrypt_text(bytea) from public, anon, authenticated;

-- ---------- RLS ----------
alter table public.payout_methods enable row level security;
alter table public.payments enable row level security;
alter table public.bonuses enable row level security;
alter table public.payment_requirement_overrides enable row level security;
revoke all on public.payout_methods, public.payments, public.bonuses, public.payment_requirement_overrides from anon;
revoke all on public.payout_methods from authenticated;
grant select (id, user_id, holder_name, country, bank_name, account_type, currency, account_last4, is_active, created_at)
  on public.payout_methods to authenticated;
revoke insert, update, delete on public.payments, public.bonuses, public.payment_requirement_overrides from authenticated;

create policy payout_read on public.payout_methods for select to authenticated
  using (user_id = auth.uid() or private.is_admin());
create policy payments_read on public.payments for select to authenticated
  using (creator_id = auth.uid() or private.is_admin());
create policy bonuses_read on public.bonuses for select to authenticated
  using (private.is_admin() or (status = 'approved' and private.owns_assignment(assignment_id)));
create policy overrides_read on public.payment_requirement_overrides for select to authenticated
  using (private.is_admin() or private.owns_assignment(assignment_id));

-- ---------- RPC de datos de cobro ----------
create or replace function public.set_payout_method(
  p_holder text, p_country char(2), p_bank text, p_account_type text, p_currency char(3),
  p_account_number text, p_bank_identifier text default null, p_extra text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := private.require_user();
  v_clean text := regexp_replace(coalesce(p_account_number, ''), '[\s-]', '', 'g');
  v_id uuid;
begin
  if char_length(v_clean) < 6 or char_length(v_clean) > 40 or v_clean !~ '^[A-Za-z0-9]+$' then
    raise exception 'Revisa el número de cuenta: solo letras y números, entre 6 y 40 caracteres.';
  end if;
  update public.payout_methods set is_active = false, archived_at = now()
   where user_id = v_user and is_active;
  insert into public.payout_methods (user_id, holder_name, country, bank_name, account_type, currency,
      account_last4, account_ciphertext, bank_identifier_ciphertext, extra_ciphertext)
  values (v_user, trim(p_holder), upper(p_country), trim(p_bank), p_account_type, upper(p_currency),
      right(v_clean, 4), private.encrypt_text(v_clean), private.encrypt_text(nullif(trim(p_bank_identifier), '')),
      private.encrypt_text(nullif(trim(p_extra), '')))
  returning id into v_id;
  -- La auditoría NO guarda el número: solo los 4 últimos dígitos.
  perform private.audit('payout_method_set', 'payout_methods', v_id::text, null, null, null,
    jsonb_build_object('last4', right(v_clean, 4), 'bank', p_bank));
  return v_id;
end $$;

-- Consulta del número completo: solo admin, con motivo, y queda auditada.
create or replace function public.admin_reveal_payout_method(p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.payout_methods;
begin
  perform private.require_admin();
  if coalesce(char_length(trim(p_reason)), 0) < 5 then
    raise exception 'Indica por qué necesitas ver los datos completos.';
  end if;
  select * into r from public.payout_methods where id = p_id;
  if not found then raise exception 'Método de cobro no encontrado.'; end if;
  perform private.audit('payout_method_revealed', 'payout_methods', p_id::text, null, null, p_reason);
  return jsonb_build_object(
    'holder_name', r.holder_name, 'bank_name', r.bank_name, 'account_type', r.account_type,
    'currency', r.currency, 'country', r.country,
    'account_number', private.decrypt_text(r.account_ciphertext),
    'bank_identifier', private.decrypt_text(r.bank_identifier_ciphertext),
    'extra', private.decrypt_text(r.extra_ciphertext)
  );
end $$;

revoke execute on function public.set_payout_method(text, char, text, text, char, text, text, text),
  public.admin_reveal_payout_method(uuid, text) from anon;
