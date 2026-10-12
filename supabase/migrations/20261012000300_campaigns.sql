-- =====================================================================
-- Vocera · 0300 · Campañas, briefs y asignaciones creador–campaña
-- =====================================================================

create type public.campaign_status as enum ('draft', 'active', 'closed', 'cancelled');

-- Estados de la relación creador–campaña, en el ORDEN del flujo (los enum
-- de Postgres son ordenables: el motor de estados compara con < y >=).
-- Los cinco últimos son estados alternativos de cierre.
-- Nota de diseño: los códigos publicitarios (Spark Ads) se piden DESPUÉS de
-- la publicación porque la plataforma los genera sobre un post existente.
create type public.assignment_status as enum (
  'preselected',
  'pending_client_approval',
  'client_approved',
  'invited',
  'availability_confirmed',
  'contract_pending',
  'contract_signed',
  'product_pending',
  'product_received',
  'script_pending',
  'script_in_review',
  'script_approved',
  'in_production',
  'video_delivered',
  'video_in_review',
  'revisions_requested',
  'video_approved',
  'publication_scheduled',
  'publication_confirmed',
  'ad_codes_pending',
  'final_validation',
  'payment_pending_authorization',
  'payment_approved',
  'payment_sent',
  'payment_confirmed',
  'declined',
  'rejected',
  'cancelled',
  'expired',
  'suspended'
);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid references public.brands(id),
  brand_visible_to_creators boolean not null default false,
  name text not null check (char_length(name) between 2 and 140),
  objective text check (objective is null or char_length(objective) <= 500),
  description text check (description is null or char_length(description) <= 4000),
  status public.campaign_status not null default 'draft',
  platforms public.social_platform[] not null default '{}',
  starts_on date,
  ends_on date,
  default_fee numeric(12,2) check (default_fee is null or default_fee >= 0),
  currency char(3) not null default 'PEN' check (currency ~ '^[A-Z]{3}$'),
  payment_terms text,
  usage_rights text,
  ad_authorization_days integer check (ad_authorization_days is null or ad_authorization_days > 0),
  max_revision_rounds smallint not null default 2 check (max_revision_rounds between 0 and 10),
  -- Requisitos configurables del flujo (y de la liberación de pagos)
  requires_client_approval boolean not null default true,
  requires_contract boolean not null default true,
  requires_product boolean not null default false,
  requires_script boolean not null default true,
  requires_publication boolean not null default true,
  requires_ad_code boolean not null default false,
  invite_expires_days smallint not null default 5 check (invite_expires_days between 1 and 60),
  script_due_on date,
  video_due_on date,
  publish_on date,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
create index campaigns_status_idx on public.campaigns (status);

create table public.campaign_briefs (
  campaign_id uuid primary key references public.campaigns(id) on delete cascade,
  brief text,
  formats text,
  content_duration text,
  technical_requirements text,
  mandatory_messages text,
  forbidden_claims text,
  deliverables_summary text,
  updated_at timestamptz not null default now()
);

create table public.campaign_assignments (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  creator_id uuid not null references public.profiles(id) on delete restrict,
  status public.assignment_status not null default 'preselected',
  closed_status public.assignment_status
    check (closed_status is null or closed_status in ('declined', 'rejected', 'cancelled', 'expired', 'suspended')),
  closed_reason text,
  fee_amount numeric(12,2) not null check (fee_amount >= 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  client_approval_requested_at timestamptz,
  client_approved_at timestamptz,
  invited_at timestamptz,
  invite_expires_at timestamptz,
  accepted_at timestamptz,
  script_exception_reason text,
  script_exception_by uuid references public.profiles(id),
  final_validated_at timestamptz,
  final_validated_by uuid references public.profiles(id),
  script_due_on date,
  video_due_on date,
  publish_on date,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, creator_id)
);
create index assignments_creator_idx on public.campaign_assignments (creator_id, status);
create index assignments_campaign_idx on public.campaign_assignments (campaign_id);

-- Registro de la aprobación del cliente (evidencia de quién y cuándo)
create table public.campaign_approvals (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.campaign_assignments(id) on delete cascade,
  approved boolean not null,
  note text,
  recorded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create trigger campaigns_touch before update on public.campaigns
  for each row execute function private.touch_updated_at();
create trigger briefs_touch before update on public.campaign_briefs
  for each row execute function private.touch_updated_at();
create trigger assignments_touch before update on public.campaign_assignments
  for each row execute function private.touch_updated_at();

-- ¿El usuario actual participa en la campaña (ya invitado)?
create or replace function private.is_invited_to(p_campaign uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.campaign_assignments a
     where a.campaign_id = p_campaign and a.creator_id = auth.uid() and a.invited_at is not null
  )
$$;
create or replace function private.owns_assignment(p_assignment uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.campaign_assignments a
     where a.id = p_assignment and a.creator_id = auth.uid() and a.invited_at is not null
  )
$$;
grant execute on function private.is_invited_to(uuid), private.owns_assignment(uuid) to authenticated;

-- ---------- RLS ----------
alter table public.campaigns enable row level security;
alter table public.campaign_briefs enable row level security;
alter table public.campaign_assignments enable row level security;
alter table public.campaign_approvals enable row level security;
revoke all on public.campaigns, public.campaign_briefs, public.campaign_assignments, public.campaign_approvals from anon;

-- El admin edita el contenido de la campaña; el estado cambia por RPC.
revoke update on public.campaigns from authenticated;
grant update (brand_id, brand_visible_to_creators, name, objective, description, platforms, starts_on, ends_on,
  default_fee, currency, payment_terms, usage_rights, ad_authorization_days, max_revision_rounds,
  requires_client_approval, requires_contract, requires_product, requires_script, requires_publication,
  requires_ad_code, invite_expires_days, script_due_on, video_due_on, publish_on) on public.campaigns to authenticated;

create policy campaigns_select on public.campaigns for select to authenticated
  using (private.is_admin() or private.is_invited_to(id) or (brand_id is not null and private.is_brand_member(brand_id)));
create policy campaigns_admin_insert on public.campaigns for insert to authenticated
  with check (private.is_admin() and status = 'draft');
create policy campaigns_admin_update on public.campaigns for update to authenticated
  using (private.is_admin()) with check (private.is_admin());

create policy briefs_select on public.campaign_briefs for select to authenticated
  using (private.is_admin() or private.is_invited_to(campaign_id));
create policy briefs_admin on public.campaign_briefs for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

-- Asignaciones: lectura propia (desde la invitación) o admin; escritura solo por RPC.
revoke insert, update, delete on public.campaign_assignments from authenticated;
create policy assignments_select on public.campaign_assignments for select to authenticated
  using (private.is_admin() or (creator_id = auth.uid() and invited_at is not null));

revoke insert, update, delete on public.campaign_approvals from authenticated;
create policy approvals_admin on public.campaign_approvals for select to authenticated
  using (private.is_admin());

-- El nombre de la marca solo se muestra al creador si la campaña lo autoriza.
create policy brands_creator_visible on public.brands for select to authenticated
  using (exists (
    select 1 from public.campaigns c
     where c.brand_id = brands.id and c.brand_visible_to_creators and private.is_invited_to(c.id)
  ));
