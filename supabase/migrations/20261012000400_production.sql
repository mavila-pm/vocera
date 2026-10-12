-- =====================================================================
-- Vocera · 0400 · Producción: contratos, productos, guiones, entregables,
-- correcciones, autorizaciones publicitarias y publicaciones.
-- Toda escritura pasa por RPC (migración 0600); aquí solo tablas y lectura.
-- =====================================================================

-- ---------- Contratos ----------
create type public.contract_status as enum ('draft', 'sent', 'signed', 'void');
create type public.signature_method as enum ('esign_provider', 'signed_document_upload');

create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.campaign_assignments(id) on delete cascade,
  title text not null check (char_length(title) between 2 and 160),
  terms text,                         -- condiciones legibles en la plataforma
  document_path text,                 -- PDF del contrato (bucket documents)
  version smallint not null default 1,
  starts_on date,
  ends_on date,
  sign_by date,
  status public.contract_status not null default 'draft',
  provider text,                      -- p. ej. proveedor de firma electrónica
  provider_envelope_id text,
  sent_at timestamptz,
  signed_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (assignment_id, version)
);
-- Un contrato solo es "firmado" con evidencia registrada (ver contract_signatures).

create table public.contract_signatures (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null unique references public.contracts(id) on delete cascade,
  method public.signature_method not null,
  evidence_path text,                 -- documento firmado (subida)
  provider_event jsonb,               -- evento/certificado del proveedor
  signed_on date not null,
  recorded_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (
    (method = 'signed_document_upload' and evidence_path is not null) or
    (method = 'esign_provider' and provider_event is not null)
  )
);

-- Constancia de lectura: NO es una firma.
create table public.contract_acknowledgements (
  contract_id uuid not null references public.contracts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  acknowledged_at timestamptz not null default now(),
  user_agent text,
  primary key (contract_id, user_id)
);

-- ---------- Productos ----------
create type public.shipment_status as enum ('preparing', 'shipped', 'delivered', 'received', 'issue');

create table public.product_shipments (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.campaign_assignments(id) on delete cascade,
  product_name text not null,
  description text,
  quantity integer not null default 1 check (quantity > 0),
  declared_value numeric(12,2) check (declared_value is null or declared_value >= 0),
  currency char(3),
  sender_company text,
  carrier text,
  tracking_number text,
  status public.shipment_status not null default 'preparing',
  expected_on date,
  obligations text,                   -- obligaciones aceptadas al recibir
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.product_receipts (
  shipment_id uuid primary key references public.product_shipments(id) on delete cascade,
  received_on date not null,
  photo_path text,
  confirmed_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.shipment_issues (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.product_shipments(id) on delete cascade,
  reported_by uuid not null references public.profiles(id),
  description text not null check (char_length(description) between 5 and 1000),
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolution text,
  resolved_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- ---------- Guiones ----------
create type public.script_status as enum ('draft', 'submitted', 'in_review', 'changes_requested', 'approved', 'rejected');

create table public.scripts (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.campaign_assignments(id) on delete cascade,
  version smallint not null,
  body text check (body is null or char_length(body) <= 20000),
  file_path text,
  reference_links text[] not null default '{}',
  sample_path text,
  status public.script_status not null default 'draft',
  submitted_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id, version)
);

create table public.script_reviews (
  id uuid primary key default gen_random_uuid(),
  script_id uuid not null references public.scripts(id) on delete cascade,
  reviewer_id uuid not null references public.profiles(id),
  decision public.script_status not null check (decision in ('approved', 'changes_requested', 'rejected')),
  comments text,
  created_at timestamptz not null default now()
);

-- ---------- Entregables ----------
create type public.deliverable_kind as enum ('video', 'document', 'other');
create type public.deliverable_status as enum ('pending', 'submitted', 'in_review', 'revisions_requested', 'approved');

create table public.deliverables (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.campaign_assignments(id) on delete cascade,
  kind public.deliverable_kind not null default 'video',
  title text not null check (char_length(title) between 2 and 140),
  specs text,
  required boolean not null default true,
  status public.deliverable_status not null default 'pending',
  due_on date,
  current_version smallint not null default 0,
  first_submitted_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.deliverable_versions (
  id uuid primary key default gen_random_uuid(),
  deliverable_id uuid not null references public.deliverables(id) on delete cascade,
  version smallint not null,
  file_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  notes text,
  submitted_by uuid not null references public.profiles(id),
  submitted_at timestamptz not null default now(),
  unique (deliverable_id, version)
);

create table public.revision_requests (
  id uuid primary key default gen_random_uuid(),
  deliverable_id uuid not null references public.deliverables(id) on delete cascade,
  round smallint not null,
  max_rounds smallint not null,
  reason text not null check (char_length(reason) between 3 and 300),
  comments text,
  creator_fault boolean not null default true,  -- errores del creador: sin honorario adicional
  requested_by uuid not null references public.profiles(id),
  requested_at timestamptz not null default now(),
  resolved_version smallint,
  resolved_at timestamptz,
  unique (deliverable_id, round)
);

-- ---------- Autorizaciones publicitarias (Spark Ads, etc.) ----------
create type public.ad_auth_status as enum ('submitted', 'valid', 'invalid', 'expired');

create table public.advertising_authorizations (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.campaign_assignments(id) on delete cascade,
  platform public.social_platform not null,
  auth_code text not null check (char_length(auth_code) between 4 and 400),
  publication_id uuid,
  content_url text check (content_url is null or content_url ~* '^https?://'),
  issued_on date,
  expires_on date,
  status public.ad_auth_status not null default 'submitted',
  observations text,
  validated_by uuid references public.profiles(id),
  validated_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_on is null or issued_on is null or expires_on >= issued_on)
);

-- ---------- Publicaciones ----------
create type public.publication_status as enum ('scheduled', 'published', 'validated', 'issue');

create table public.publications (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.campaign_assignments(id) on delete cascade,
  deliverable_id uuid references public.deliverables(id),
  platform public.social_platform not null,
  scheduled_at timestamptz not null,
  instructions text,
  status public.publication_status not null default 'scheduled',
  public_url text check (public_url is null or public_url ~* '^https?://'),
  evidence_path text,
  published_at timestamptz,
  issue_note text,
  validated_by uuid references public.profiles(id),
  validated_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.advertising_authorizations
  add constraint ad_auth_publication_fk foreign key (publication_id) references public.publications(id) on delete set null;

create index contracts_assignment_idx on public.contracts (assignment_id);
create index shipments_assignment_idx on public.product_shipments (assignment_id);
create index scripts_assignment_idx on public.scripts (assignment_id, version desc);
create index deliverables_assignment_idx on public.deliverables (assignment_id);
create index versions_deliverable_idx on public.deliverable_versions (deliverable_id, version desc);
create index revisions_deliverable_idx on public.revision_requests (deliverable_id, round);
create index adauth_assignment_idx on public.advertising_authorizations (assignment_id);
create index publications_assignment_idx on public.publications (assignment_id, scheduled_at);

-- ---------- RLS: lectura propia (asignación invitada) o admin ----------
do $$
declare t text;
begin
  foreach t in array array['contracts','contract_signatures','contract_acknowledgements','product_shipments',
    'product_receipts','shipment_issues','scripts','script_reviews','deliverables','deliverable_versions',
    'revision_requests','advertising_authorizations','publications']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
  end loop;
end $$;

create policy contracts_read on public.contracts for select to authenticated
  using (private.is_admin() or (status <> 'draft' and private.owns_assignment(assignment_id)));
create policy signatures_read on public.contract_signatures for select to authenticated
  using (private.is_admin() or exists (select 1 from public.contracts c where c.id = contract_id and private.owns_assignment(c.assignment_id)));
create policy acks_read on public.contract_acknowledgements for select to authenticated
  using (private.is_admin() or user_id = auth.uid());
create policy shipments_read on public.product_shipments for select to authenticated
  using (private.is_admin() or private.owns_assignment(assignment_id));
create policy receipts_read on public.product_receipts for select to authenticated
  using (private.is_admin() or exists (select 1 from public.product_shipments s where s.id = shipment_id and private.owns_assignment(s.assignment_id)));
create policy issues_read on public.shipment_issues for select to authenticated
  using (private.is_admin() or reported_by = auth.uid());
create policy scripts_read on public.scripts for select to authenticated
  using (private.is_admin() or private.owns_assignment(assignment_id));
create policy script_reviews_read on public.script_reviews for select to authenticated
  using (private.is_admin() or exists (select 1 from public.scripts s where s.id = script_id and private.owns_assignment(s.assignment_id)));
create policy deliverables_read on public.deliverables for select to authenticated
  using (private.is_admin() or private.owns_assignment(assignment_id));
create policy versions_read on public.deliverable_versions for select to authenticated
  using (private.is_admin() or exists (select 1 from public.deliverables d where d.id = deliverable_id and private.owns_assignment(d.assignment_id)));
create policy revisions_read on public.revision_requests for select to authenticated
  using (private.is_admin() or exists (select 1 from public.deliverables d where d.id = deliverable_id and private.owns_assignment(d.assignment_id)));
-- Códigos publicitarios: información restringida (creador dueño y admin; nunca marcas).
create policy adauth_read on public.advertising_authorizations for select to authenticated
  using (private.is_admin() or private.owns_assignment(assignment_id));
create policy publications_read on public.publications for select to authenticated
  using (private.is_admin() or private.owns_assignment(assignment_id));
