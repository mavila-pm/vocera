-- =====================================================================
-- Vocera · 0600 · Motor de flujo y acciones (RPC)
--
-- El estado de una asignación NO se escribe a mano: se DERIVA de los hechos
-- registrados (aprobación del cliente, invitación aceptada, contrato con
-- evidencia de firma, recepción del producto, guion aprobado, entregables
-- aprobados, publicación validada, códigos válidos, validación final, pago).
-- Así no pueden existir estados inconsistentes, y ninguna etapa obligatoria
-- se salta: cada acción exige que el estado derivado haya llegado a su etapa.
-- =====================================================================

-- ---------- Derivación del estado ----------
create or replace function private.derive_assignment_status(p_id uuid)
returns public.assignment_status language plpgsql stable security definer set search_path = '' as $$
declare
  a public.campaign_assignments;
  c public.campaigns;
  v_script public.script_status;
  v_req int; v_any_rev boolean; v_any_review boolean; v_any_sub boolean; v_any_pending boolean;
  v_pub_total int; v_pub_sched boolean; v_pub_published boolean;
  v_pay public.payment_status;
begin
  select * into a from public.campaign_assignments where id = p_id;
  select * into c from public.campaigns where id = a.campaign_id;

  if a.closed_status is not null then return a.closed_status; end if;

  if c.requires_client_approval and a.client_approved_at is null then
    return case when a.client_approval_requested_at is not null then 'pending_client_approval' else 'preselected' end;
  end if;
  if a.invited_at is null then
    return case when c.requires_client_approval then 'client_approved' else 'preselected' end;
  end if;
  if a.accepted_at is null then return 'invited'; end if;

  if c.requires_contract then
    if not exists (select 1 from public.contracts k where k.assignment_id = p_id and k.status in ('sent', 'signed')) then
      return 'availability_confirmed';
    end if;
    if not exists (select 1 from public.contracts k where k.assignment_id = p_id and k.status = 'signed') then
      return 'contract_pending';
    end if;
  end if;

  if c.requires_product then
    if not exists (select 1 from public.product_shipments s where s.assignment_id = p_id)
       or exists (select 1 from public.product_shipments s where s.assignment_id = p_id
                    and not exists (select 1 from public.product_receipts r where r.shipment_id = s.id)) then
      return 'product_pending';
    end if;
  end if;

  if c.requires_script and a.script_exception_reason is null then
    select s.status into v_script from public.scripts s
     where s.assignment_id = p_id and s.status <> 'draft'
     order by s.version desc limit 1;
    if v_script is null or v_script in ('changes_requested', 'rejected') then return 'script_pending'; end if;
    if v_script in ('submitted', 'in_review') then return 'script_in_review'; end if;
  end if;

  select count(*) filter (where d.required),
         bool_or(d.required and d.status = 'revisions_requested'),
         bool_or(d.required and d.status = 'in_review'),
         bool_or(d.required and d.status = 'submitted'),
         bool_or(d.required and d.status = 'pending')
    into v_req, v_any_rev, v_any_review, v_any_sub, v_any_pending
    from public.deliverables d where d.assignment_id = p_id;
  if coalesce(v_req, 0) = 0 or coalesce(v_any_pending, false) and not coalesce(v_any_sub or v_any_review or v_any_rev, false) then
    return 'in_production';
  end if;
  if v_any_rev then return 'revisions_requested'; end if;
  if v_any_review then return 'video_in_review'; end if;
  if v_any_sub then return 'video_delivered'; end if;
  if v_any_pending then return 'in_production'; end if;

  if c.requires_publication then
    select count(*), bool_or(p.status in ('scheduled', 'issue')), bool_or(p.status = 'published')
      into v_pub_total, v_pub_sched, v_pub_published
      from public.publications p where p.assignment_id = p_id;
    if v_pub_total = 0 then return 'video_approved'; end if;
    if v_pub_sched then return 'publication_scheduled'; end if;
    if v_pub_published then return 'publication_confirmed'; end if;
  end if;

  if c.requires_ad_code and not exists (
       select 1 from public.advertising_authorizations x
        where x.assignment_id = p_id and x.status = 'valid' and (x.expires_on is null or x.expires_on >= current_date)) then
    return 'ad_codes_pending';
  end if;

  if a.final_validated_at is null then return 'final_validation'; end if;

  select p.status into v_pay from public.payments p where p.assignment_id = p_id and p.concept = 'fee';
  return case
    when v_pay in ('approved', 'scheduled') then 'payment_approved'
    when v_pay = 'transferred' then 'payment_sent'
    when v_pay = 'confirmed' then 'payment_confirmed'
    else 'payment_pending_authorization'
  end;
end $$;

-- Textos de notificación al creador por cada nuevo estado relevante
create or replace function private.status_notice(s public.assignment_status)
returns table (title text, body text) language sql immutable as $$
  select v.title, v.body from (values
    ('invited'::public.assignment_status, 'Tienes una nueva invitación', 'Revisa el brief y confirma si tienes disponibilidad.'),
    ('contract_pending', 'Tienes un contrato pendiente', 'Lee las condiciones y fírmalo para continuar.'),
    ('product_pending', 'Producto en camino', 'Cuando lo recibas, confírmalo en la campaña.'),
    ('script_pending', 'Es momento de enviar tu guion', 'Escribe o sube tu propuesta antes de grabar.'),
    ('in_production', 'Puedes empezar la producción', 'Tu guion está aprobado. Sube el video cuando esté listo.'),
    ('revisions_requested', 'Debes realizar correcciones', 'Revisa los comentarios y sube una nueva versión.'),
    ('video_approved', 'Tu video fue aprobado', 'Pronto recibirás la fecha de publicación.'),
    ('publication_scheduled', 'Publicación programada', 'Revisa la fecha, la hora y las instrucciones.'),
    ('ad_codes_pending', 'Debes entregar un código', 'Registra el código de autorización publicitaria de tu publicación.'),
    ('payment_approved', 'Tu pago fue autorizado', 'Vocera registrará la transferencia en los próximos días.'),
    ('payment_sent', 'Tu transferencia fue registrada', 'Confirma cuando veas el dinero en tu cuenta.')
  ) v(status, title, body) where v.status = s
$$;

create or replace function private.sync_assignment(p_id uuid, p_reason text default null)
returns public.assignment_status language plpgsql security definer set search_path = '' as $$
declare
  v_old public.assignment_status;
  v_new public.assignment_status;
  v_creator uuid;
  n record;
begin
  select status, creator_id into v_old, v_creator from public.campaign_assignments where id = p_id for update;
  v_new := private.derive_assignment_status(p_id);
  if v_new is distinct from v_old then
    update public.campaign_assignments set status = v_new where id = p_id;
    perform private.audit('assignment_status', 'campaign_assignments', p_id::text, v_old::text, v_new::text, p_reason);
    for n in select * from private.status_notice(v_new) loop
      perform private.notify(v_creator, 'assignment_' || v_new, n.title, n.body, '/campanas/' || p_id,
        'assignment:' || p_id || ':' || v_new);
    end loop;
  end if;
  return v_new;
end $$;

-- Exige que la asignación esté abierta y en un rango de etapas.
create or replace function private.assert_stage(
  p_id uuid, p_min public.assignment_status, p_max public.assignment_status default 'payment_confirmed'
) returns public.campaign_assignments language plpgsql security definer set search_path = '' as $$
declare a public.campaign_assignments; v public.assignment_status;
begin
  select * into a from public.campaign_assignments where id = p_id;
  if not found then raise exception 'Campaña no encontrada.'; end if;
  if a.closed_status is not null then
    raise exception 'Esta participación está cerrada (%).', a.closed_status;
  end if;
  v := private.derive_assignment_status(p_id);
  if v < p_min or v > p_max then
    raise exception 'Esta acción no está disponible en la etapa actual (%).', v using errcode = 'P0001', hint = 'stage';
  end if;
  return a;
end $$;

-- El creador actúa solo sobre sus asignaciones (y tras ser invitado).
create or replace function private.own_assignment(p_id uuid) returns public.campaign_assignments
language plpgsql security definer set search_path = '' as $$
declare a public.campaign_assignments;
begin
  select * into a from public.campaign_assignments where id = p_id;
  if not found or a.creator_id is distinct from auth.uid() or a.invited_at is null then
    raise exception 'No tienes acceso a esta campaña.' using errcode = '42501';
  end if;
  return a;
end $$;

create or replace function private.campaign_of(p_assignment uuid) returns public.campaigns
language sql stable security definer set search_path = '' as $$
  select c.* from public.campaigns c join public.campaign_assignments a on a.campaign_id = c.id where a.id = p_assignment
$$;

-- Verifica que un archivo exista en Storage y pertenezca a la carpeta del creador.
create or replace function private.assert_file(p_bucket text, p_path text, p_owner uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if p_path is null then return; end if;
  if split_part(p_path, '/', 1) <> p_owner::text then
    raise exception 'El archivo no pertenece a esta cuenta.' using errcode = '42501';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = p_bucket and o.name = p_path) then
    raise exception 'No encontramos el archivo subido. Vuelve a intentarlo.';
  end if;
end $$;

-- =====================================================================
-- Campañas y asignación (admin)
-- =====================================================================
create or replace function public.admin_set_campaign_status(p_campaign uuid, p_status public.campaign_status, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.campaigns;
begin
  perform private.require_admin();
  select * into c from public.campaigns where id = p_campaign for update;
  if not found then raise exception 'Campaña no encontrada.'; end if;
  if p_status = 'active' and (c.default_fee is null or c.starts_on is null) then
    raise exception 'Para activar la campaña define el honorario base y la fecha de inicio.';
  end if;
  if p_status = 'active' and not exists (select 1 from public.campaign_briefs b where b.campaign_id = p_campaign and coalesce(b.brief, '') <> '') then
    raise exception 'Para activar la campaña completa el brief.';
  end if;
  update public.campaigns set status = p_status where id = p_campaign;
  perform private.audit('campaign_status', 'campaigns', p_campaign::text, c.status::text, p_status::text, p_reason);
end $$;

create or replace function public.admin_assign_creator(p_campaign uuid, p_creator uuid, p_fee numeric default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare c public.campaigns; v_id uuid; v_status public.profile_status;
begin
  perform private.require_admin();
  select * into c from public.campaigns where id = p_campaign;
  if not found then raise exception 'Campaña no encontrada.'; end if;
  if c.status in ('closed', 'cancelled') then raise exception 'La campaña está cerrada.'; end if;
  select status into v_status from public.profiles where id = p_creator and role = 'creator';
  if v_status is distinct from 'approved' then
    raise exception 'Solo se asignan creadores con perfil aprobado.';
  end if;
  if coalesce(p_fee, c.default_fee) is null then raise exception 'Define el honorario acordado.'; end if;
  insert into public.campaign_assignments (campaign_id, creator_id, fee_amount, currency, script_due_on, video_due_on, publish_on, created_by)
  values (p_campaign, p_creator, coalesce(p_fee, c.default_fee), c.currency, c.script_due_on, c.video_due_on, c.publish_on, auth.uid())
  returning id into v_id;
  perform private.audit('creator_assigned', 'campaign_assignments', v_id::text, null, 'preselected', null,
    jsonb_build_object('campaign', p_campaign, 'creator', p_creator, 'fee', coalesce(p_fee, c.default_fee)));
  perform private.sync_assignment(v_id);
  return v_id;
end $$;

create or replace function public.admin_update_assignment_terms(p_id uuid, p_fee numeric, p_script_due date, p_video_due date, p_publish_on date)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.campaign_assignments;
begin
  perform private.require_admin();
  select * into a from public.campaign_assignments where id = p_id for update;
  if a.accepted_at is not null and p_fee is distinct from a.fee_amount then
    raise exception 'El honorario ya fue aceptado por el creador; cámbialo mediante una adenda de contrato.';
  end if;
  update public.campaign_assignments
     set fee_amount = coalesce(p_fee, fee_amount), script_due_on = p_script_due, video_due_on = p_video_due, publish_on = p_publish_on
   where id = p_id;
  perform private.audit('assignment_terms', 'campaign_assignments', p_id::text, null, null, null,
    jsonb_build_object('fee', p_fee, 'script_due', p_script_due, 'video_due', p_video_due, 'publish_on', p_publish_on));
end $$;

create or replace function public.admin_request_client_approval(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  perform private.assert_stage(p_id, 'preselected', 'preselected');
  update public.campaign_assignments set client_approval_requested_at = now() where id = p_id;
  perform private.sync_assignment(p_id);
end $$;

create or replace function public.admin_record_client_approval(p_id uuid, p_approved boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  perform private.assert_stage(p_id, 'preselected', 'pending_client_approval');
  if not (private.campaign_of(p_id)).requires_client_approval then
    raise exception 'Esta campaña no requiere aprobación del cliente.';
  end if;
  insert into public.campaign_approvals (assignment_id, approved, note, recorded_by) values (p_id, p_approved, p_note, auth.uid());
  if p_approved then
    update public.campaign_assignments set client_approved_at = now(), client_approval_requested_at = coalesce(client_approval_requested_at, now()) where id = p_id;
  else
    update public.campaign_assignments set closed_status = 'rejected', closed_reason = coalesce(p_note, 'No aprobado por el cliente') where id = p_id;
  end if;
  perform private.sync_assignment(p_id, p_note);
end $$;

create or replace function public.admin_send_invitation(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.campaigns;
begin
  perform private.require_admin();
  c := private.campaign_of(p_id);
  if c.status <> 'active' then raise exception 'Activa la campaña antes de enviar invitaciones.'; end if;
  perform private.assert_stage(p_id, 'preselected', 'client_approved');
  if c.requires_client_approval and private.derive_assignment_status(p_id) <> 'client_approved' then
    raise exception 'Falta registrar la aprobación del cliente.';
  end if;
  update public.campaign_assignments
     set invited_at = now(), invite_expires_at = now() + make_interval(days => c.invite_expires_days)
   where id = p_id and invited_at is null;
  perform private.sync_assignment(p_id);
end $$;

create or replace function public.respond_invitation(p_id uuid, p_accept boolean, p_reason text default null)
returns public.assignment_status language plpgsql security definer set search_path = '' as $$
declare a public.campaign_assignments;
begin
  a := private.own_assignment(p_id);
  perform private.assert_stage(p_id, 'invited', 'invited');
  if a.invite_expires_at is not null and a.invite_expires_at < now() then
    update public.campaign_assignments set closed_status = 'expired', closed_reason = 'Invitación vencida' where id = p_id;
    perform private.sync_assignment(p_id, 'Invitación vencida');
    raise exception 'La invitación venció. Escríbenos si aún te interesa participar.';
  end if;
  if p_accept then
    update public.campaign_assignments set accepted_at = now() where id = p_id;
    insert into public.payments (assignment_id, creator_id, concept, amount, currency)
    values (p_id, a.creator_id, 'fee', a.fee_amount, a.currency) on conflict do nothing;
    perform private.notify_admins('invite_accepted', 'Invitación aceptada',
      (select full_name from public.profiles where id = a.creator_id), '/admin/campanas/' || a.campaign_id, 'invite_accepted:' || p_id);
  else
    update public.campaign_assignments set closed_status = 'declined', closed_reason = p_reason where id = p_id;
    perform private.notify_admins('invite_declined', 'Invitación rechazada',
      (select full_name from public.profiles where id = a.creator_id), '/admin/campanas/' || a.campaign_id, 'invite_declined:' || p_id);
  end if;
  return private.sync_assignment(p_id, p_reason);
end $$;

create or replace function public.admin_close_assignment(p_id uuid, p_status public.assignment_status, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_paid boolean;
begin
  perform private.require_admin();
  if p_status not in ('rejected', 'cancelled', 'expired', 'suspended') then
    raise exception 'Estado de cierre no válido.';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Indica el motivo.'; end if;
  select exists (select 1 from public.payments where assignment_id = p_id and status in ('transferred', 'confirmed')) into v_paid;
  if v_paid then raise exception 'No se puede cerrar: ya existe un pago transferido.'; end if;
  update public.campaign_assignments set closed_status = p_status, closed_reason = p_reason where id = p_id;
  perform private.sync_assignment(p_id, p_reason);
end $$;

create or replace function public.admin_reopen_assignment(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  if coalesce(trim(p_reason), '') = '' then raise exception 'Indica el motivo.'; end if;
  update public.campaign_assignments set closed_status = null, closed_reason = null where id = p_id and closed_status in ('suspended', 'expired');
  if not found then raise exception 'Solo se reabren participaciones suspendidas o vencidas.'; end if;
  perform private.sync_assignment(p_id, p_reason);
end $$;

-- =====================================================================
-- Contratos
-- =====================================================================
create or replace function public.admin_create_contract(
  p_id uuid, p_title text, p_terms text, p_document_path text, p_starts date, p_ends date, p_sign_by date
) returns uuid language plpgsql security definer set search_path = '' as $$
declare a public.campaign_assignments; v_id uuid; v_ver smallint;
begin
  perform private.require_admin();
  a := private.assert_stage(p_id, 'availability_confirmed', 'contract_pending');
  if not (private.campaign_of(p_id)).requires_contract then raise exception 'Esta campaña no requiere contrato.'; end if;
  if exists (select 1 from public.contracts where assignment_id = p_id and status in ('sent', 'signed')) then
    raise exception 'Ya hay un contrato vigente. Anúlalo antes de emitir otro.';
  end if;
  if coalesce(p_terms, '') = '' and p_document_path is null then
    raise exception 'Adjunta el documento del contrato o escribe sus condiciones.';
  end if;
  if p_document_path is not null then perform private.assert_file('documents', p_document_path, a.creator_id); end if;
  select coalesce(max(version), 0) + 1 into v_ver from public.contracts where assignment_id = p_id;
  insert into public.contracts (assignment_id, title, terms, document_path, version, starts_on, ends_on, sign_by, status, sent_at, created_by)
  values (p_id, p_title, p_terms, p_document_path, v_ver, p_starts, p_ends, p_sign_by, 'sent', now(), auth.uid())
  returning id into v_id;
  perform private.audit('contract_sent', 'contracts', v_id::text, null, 'sent');
  perform private.sync_assignment(p_id);
  return v_id;
end $$;

-- Constancia de lectura (no es firma)
create or replace function public.acknowledge_contract(p_contract uuid, p_user_agent text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare k public.contracts;
begin
  select * into k from public.contracts where id = p_contract;
  if not found or k.status = 'draft' then raise exception 'Contrato no encontrado.'; end if;
  perform private.own_assignment(k.assignment_id);
  insert into public.contract_acknowledgements (contract_id, user_id, user_agent)
  values (p_contract, auth.uid(), left(p_user_agent, 300)) on conflict do nothing;
  perform private.audit('contract_read', 'contracts', p_contract::text);
end $$;

-- Firma: solo con evidencia (documento firmado o evento del proveedor).
create or replace function public.admin_record_contract_signature(
  p_contract uuid, p_method public.signature_method, p_evidence_path text, p_provider_event jsonb, p_signed_on date
) returns void language plpgsql security definer set search_path = '' as $$
declare k public.contracts; a public.campaign_assignments;
begin
  perform private.require_admin();
  select * into k from public.contracts where id = p_contract for update;
  if not found or k.status <> 'sent' then raise exception 'Solo se registra la firma de contratos enviados.'; end if;
  select * into a from public.campaign_assignments where id = k.assignment_id;
  if p_signed_on is null or p_signed_on > current_date then raise exception 'Fecha de firma no válida.'; end if;
  if p_method = 'signed_document_upload' then
    if p_evidence_path is null then raise exception 'Adjunta el documento firmado como evidencia.'; end if;
    perform private.assert_file('documents', p_evidence_path, a.creator_id);
  elsif p_provider_event is null then
    raise exception 'Falta el comprobante del proveedor de firma electrónica.';
  end if;
  insert into public.contract_signatures (contract_id, method, evidence_path, provider_event, signed_on, recorded_by)
  values (p_contract, p_method, p_evidence_path, p_provider_event, p_signed_on, auth.uid());
  update public.contracts set status = 'signed', signed_at = now() where id = p_contract;
  perform private.audit('contract_signed', 'contracts', p_contract::text, 'sent', 'signed', null,
    jsonb_build_object('method', p_method, 'evidence', p_evidence_path));
  perform private.sync_assignment(k.assignment_id);
end $$;

create or replace function public.admin_void_contract(p_contract uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare k public.contracts;
begin
  perform private.require_admin();
  if coalesce(trim(p_reason), '') = '' then raise exception 'Indica el motivo.'; end if;
  select * into k from public.contracts where id = p_contract for update;
  if k.status = 'void' then return; end if;
  update public.contracts set status = 'void' where id = p_contract;
  perform private.audit('contract_void', 'contracts', p_contract::text, k.status::text, 'void', p_reason);
  perform private.sync_assignment(k.assignment_id, p_reason);
end $$;

-- =====================================================================
-- Productos
-- =====================================================================
create or replace function public.admin_create_shipment(
  p_id uuid, p_product text, p_description text, p_quantity integer, p_value numeric, p_currency char(3),
  p_company text, p_carrier text, p_tracking text, p_expected date, p_obligations text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  perform private.require_admin();
  perform private.assert_stage(p_id, 'availability_confirmed', 'product_pending');
  if not (private.campaign_of(p_id)).requires_product then raise exception 'Esta campaña no incluye producto.'; end if;
  insert into public.product_shipments (assignment_id, product_name, description, quantity, declared_value, currency,
    sender_company, carrier, tracking_number, expected_on, obligations, status, created_by)
  values (p_id, p_product, p_description, coalesce(p_quantity, 1), p_value, p_currency, p_company, p_carrier, p_tracking,
    p_expected, p_obligations, case when p_tracking is not null then 'shipped'::public.shipment_status else 'preparing' end, auth.uid())
  returning id into v;
  perform private.audit('shipment_created', 'product_shipments', v::text);
  perform private.sync_assignment(p_id);
  return v;
end $$;

create or replace function public.admin_update_shipment(p_shipment uuid, p_status public.shipment_status, p_carrier text, p_tracking text, p_expected date)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.product_shipments;
begin
  perform private.require_admin();
  if p_status = 'received' then raise exception 'La recepción la confirma el creador.'; end if;
  select * into s from public.product_shipments where id = p_shipment for update;
  if s.status = 'received' then raise exception 'El producto ya fue recibido.'; end if;
  update public.product_shipments set status = p_status, carrier = p_carrier, tracking_number = p_tracking, expected_on = p_expected
   where id = p_shipment;
  perform private.audit('shipment_updated', 'product_shipments', p_shipment::text, s.status::text, p_status::text);
end $$;

create or replace function public.confirm_product_receipt(p_shipment uuid, p_received_on date, p_photo_path text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.product_shipments; a public.campaign_assignments;
begin
  select * into s from public.product_shipments where id = p_shipment for update;
  if not found then raise exception 'Envío no encontrado.'; end if;
  a := private.own_assignment(s.assignment_id);
  if s.status = 'received' then raise exception 'Ya confirmaste la recepción de este producto.'; end if;
  if p_received_on is null or p_received_on > current_date then raise exception 'Indica una fecha de recepción válida.'; end if;
  perform private.assert_file('documents', p_photo_path, a.creator_id);
  insert into public.product_receipts (shipment_id, received_on, photo_path, confirmed_by) values (p_shipment, p_received_on, p_photo_path, auth.uid());
  update public.product_shipments set status = 'received' where id = p_shipment;
  perform private.audit('product_received', 'product_shipments', p_shipment::text, s.status::text, 'received');
  perform private.notify_admins('product_received', 'Producto recibido', s.product_name, '/admin/campanas/' || a.campaign_id, 'product_received:' || p_shipment);
  perform private.sync_assignment(s.assignment_id);
end $$;

create or replace function public.report_shipment_issue(p_shipment uuid, p_description text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare s public.product_shipments; a public.campaign_assignments; v uuid;
begin
  select * into s from public.product_shipments where id = p_shipment;
  if not found then raise exception 'Envío no encontrado.'; end if;
  a := private.own_assignment(s.assignment_id);
  insert into public.shipment_issues (shipment_id, reported_by, description) values (p_shipment, auth.uid(), p_description) returning id into v;
  if s.status <> 'received' then update public.product_shipments set status = 'issue' where id = p_shipment; end if;
  perform private.audit('shipment_issue', 'product_shipments', p_shipment::text, s.status::text, 'issue', p_description);
  perform private.notify_admins('shipment_issue', 'Incidencia con un producto', p_description, '/admin/campanas/' || a.campaign_id, 'shipment_issue:' || v);
  return v;
end $$;

create or replace function public.admin_resolve_shipment_issue(p_issue uuid, p_resolution text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  update public.shipment_issues set status = 'resolved', resolution = p_resolution, resolved_by = auth.uid(), resolved_at = now()
   where id = p_issue and status = 'open';
  if not found then raise exception 'Incidencia no encontrada o ya resuelta.'; end if;
  perform private.audit('shipment_issue_resolved', 'shipment_issues', p_issue::text, 'open', 'resolved', p_resolution);
end $$;

-- =====================================================================
-- Guiones
-- =====================================================================
create or replace function public.save_script_draft(
  p_id uuid, p_body text, p_file_path text default null, p_references text[] default '{}', p_sample_path text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare a public.campaign_assignments; s public.scripts; v uuid;
begin
  a := private.own_assignment(p_id);
  if not (private.campaign_of(p_id)).requires_script then raise exception 'Esta campaña no requiere guion.'; end if;
  perform private.assert_stage(p_id, 'script_pending', 'script_pending');
  perform private.assert_file('documents', p_file_path, a.creator_id);
  perform private.assert_file('deliverables', p_sample_path, a.creator_id);
  select * into s from public.scripts where assignment_id = p_id order by version desc limit 1 for update;
  if found and s.status = 'draft' then
    update public.scripts set body = p_body, file_path = p_file_path, reference_links = coalesce(p_references, '{}'),
           sample_path = p_sample_path, updated_at = now()
     where id = s.id returning id into v;
  else
    insert into public.scripts (assignment_id, version, body, file_path, reference_links, sample_path, created_by)
    values (p_id, coalesce(s.version, 0) + 1, p_body, p_file_path, coalesce(p_references, '{}'), p_sample_path, auth.uid())
    returning id into v;
  end if;
  return v;
end $$;

create or replace function public.submit_script(p_script uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.scripts; a public.campaign_assignments;
begin
  select * into s from public.scripts where id = p_script for update;
  if not found then raise exception 'Guion no encontrado.'; end if;
  a := private.own_assignment(s.assignment_id);
  if s.status <> 'draft' then raise exception 'Este guion ya fue enviado.'; end if;
  if coalesce(char_length(trim(s.body)), 0) < 20 and s.file_path is null then
    raise exception 'Escribe tu guion (mínimo 20 caracteres) o adjunta un archivo.';
  end if;
  update public.scripts set status = 'submitted', submitted_at = now() where id = p_script;
  perform private.audit('script_submitted', 'scripts', p_script::text, 'draft', 'submitted', null, jsonb_build_object('version', s.version));
  perform private.notify_admins('script_submitted', 'Nuevo guion para revisar', 'Versión ' || s.version,
    '/admin/campanas/' || a.campaign_id, 'script_submitted:' || p_script);
  perform private.sync_assignment(s.assignment_id);
end $$;

create or replace function public.admin_review_script(p_script uuid, p_decision public.script_status, p_comments text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.scripts; a public.campaign_assignments;
begin
  perform private.require_admin();
  if p_decision = 'in_review' then
    update public.scripts set status = 'in_review' where id = p_script and status = 'submitted';
    select * into s from public.scripts where id = p_script;
    perform private.sync_assignment(s.assignment_id);
    return;
  end if;
  if p_decision not in ('approved', 'changes_requested', 'rejected') then raise exception 'Decisión no válida.'; end if;
  select * into s from public.scripts where id = p_script for update;
  if not found or s.status not in ('submitted', 'in_review') then raise exception 'Este guion no está pendiente de revisión.'; end if;
  if p_decision <> 'approved' and coalesce(trim(p_comments), '') = '' then
    raise exception 'Explica qué debe cambiar o por qué se rechaza.';
  end if;
  select * into a from public.campaign_assignments where id = s.assignment_id;
  insert into public.script_reviews (script_id, reviewer_id, decision, comments) values (p_script, auth.uid(), p_decision, p_comments);
  update public.scripts set status = p_decision where id = p_script;
  perform private.audit('script_reviewed', 'scripts', p_script::text, s.status::text, p_decision::text, p_comments);
  perform private.notify(a.creator_id, 'script_' || p_decision,
    case p_decision when 'approved' then 'Tu guion fue aprobado' when 'changes_requested' then 'Tu guion necesita ajustes' else 'Tu guion no fue aprobado' end,
    coalesce(p_comments, 'Ya puedes empezar la producción.'), '/campanas/' || a.id, 'script_review:' || p_script || ':' || p_decision);
  perform private.sync_assignment(s.assignment_id);
end $$;

create or replace function public.admin_authorize_production_exception(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  if coalesce(char_length(trim(p_reason)), 0) < 10 then raise exception 'Documenta el motivo de la excepción (mínimo 10 caracteres).'; end if;
  perform private.assert_stage(p_id, 'script_pending', 'script_in_review');
  update public.campaign_assignments set script_exception_reason = p_reason, script_exception_by = auth.uid() where id = p_id;
  perform private.audit('production_exception', 'campaign_assignments', p_id::text, null, null, p_reason);
  perform private.sync_assignment(p_id, p_reason);
end $$;

-- =====================================================================
-- Entregables y correcciones
-- =====================================================================
create or replace function public.admin_create_deliverable(
  p_id uuid, p_kind public.deliverable_kind, p_title text, p_specs text, p_required boolean default true, p_due date default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  perform private.require_admin();
  perform private.assert_stage(p_id, 'availability_confirmed', 'video_approved');
  insert into public.deliverables (assignment_id, kind, title, specs, required, due_on)
  values (p_id, p_kind, p_title, p_specs, coalesce(p_required, true), coalesce(p_due, (select video_due_on from public.campaign_assignments where id = p_id)))
  returning id into v;
  perform private.audit('deliverable_created', 'deliverables', v::text);
  perform private.sync_assignment(p_id);
  return v;
end $$;

create or replace function private.allowed_mime(p_kind public.deliverable_kind, p_mime text) returns boolean
language sql immutable as $$
  select case p_kind
    when 'video' then p_mime in ('video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v')
    when 'document' then p_mime in ('application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    else p_mime in ('video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v', 'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png', 'image/webp')
  end
$$;

create or replace function public.submit_deliverable_version(
  p_deliverable uuid, p_file_path text, p_file_name text, p_mime text, p_size bigint, p_notes text default null
) returns smallint language plpgsql security definer set search_path = '' as $$
declare d public.deliverables; a public.campaign_assignments; v_ver smallint; v_bucket text;
begin
  select * into d from public.deliverables where id = p_deliverable for update;
  if not found then raise exception 'Entregable no encontrado.'; end if;
  a := private.own_assignment(d.assignment_id);
  perform private.assert_stage(d.assignment_id, 'in_production', 'video_approved');
  if d.status not in ('pending', 'revisions_requested') then
    raise exception 'Este entregable está en revisión o ya fue aprobado.';
  end if;
  if not private.allowed_mime(d.kind, p_mime) then raise exception 'Formato de archivo no permitido para este entregable.'; end if;
  v_bucket := case when d.kind = 'video' or p_mime like 'video/%' then 'deliverables' else 'documents' end;
  perform private.assert_file(v_bucket, p_file_path, a.creator_id);
  v_ver := d.current_version + 1;
  insert into public.deliverable_versions (deliverable_id, version, file_path, file_name, mime_type, size_bytes, notes, submitted_by)
  values (p_deliverable, v_ver, p_file_path, left(p_file_name, 200), p_mime, p_size, p_notes, auth.uid());
  update public.deliverables
     set current_version = v_ver, status = 'submitted', first_submitted_at = coalesce(first_submitted_at, now())
   where id = p_deliverable;
  update public.revision_requests set resolved_version = v_ver, resolved_at = now()
   where deliverable_id = p_deliverable and resolved_at is null;
  perform private.audit('deliverable_submitted', 'deliverables', p_deliverable::text, d.status::text, 'submitted', null,
    jsonb_build_object('version', v_ver, 'size', p_size, 'mime', p_mime));
  perform private.notify_admins('deliverable_submitted', 'Nuevo entregable para revisar', d.title || ' · v' || v_ver,
    '/admin/campanas/' || a.campaign_id, 'deliverable:' || p_deliverable || ':' || v_ver);
  perform private.sync_assignment(d.assignment_id);
  return v_ver;
end $$;

create or replace function public.admin_review_deliverable(
  p_deliverable uuid, p_approve boolean, p_reason text default null, p_comments text default null, p_creator_fault boolean default true
) returns void language plpgsql security definer set search_path = '' as $$
declare d public.deliverables; a public.campaign_assignments; c public.campaigns; v_round smallint;
begin
  perform private.require_admin();
  select * into d from public.deliverables where id = p_deliverable for update;
  if not found or d.status not in ('submitted', 'in_review') then raise exception 'Este entregable no está pendiente de revisión.'; end if;
  select * into a from public.campaign_assignments where id = d.assignment_id;
  c := private.campaign_of(d.assignment_id);
  if p_approve then
    update public.deliverables set status = 'approved', approved_at = now() where id = p_deliverable;
    perform private.audit('deliverable_approved', 'deliverables', p_deliverable::text, d.status::text, 'approved', p_comments);
  else
    if coalesce(trim(p_reason), '') = '' then raise exception 'Indica el motivo de la corrección.'; end if;
    select coalesce(max(round), 0) + 1 into v_round from public.revision_requests where deliverable_id = p_deliverable;
    -- Las rondas por error del creador respetan el máximo acordado en el brief.
    if coalesce(p_creator_fault, true) and v_round > c.max_revision_rounds then
      raise exception 'Se alcanzó el máximo de % rondas de corrección acordadas.', c.max_revision_rounds
        using hint = 'Si el cambio lo pide el cliente, márcalo como ajuste ajeno al creador.';
    end if;
    insert into public.revision_requests (deliverable_id, round, max_rounds, reason, comments, creator_fault, requested_by)
    values (p_deliverable, v_round, c.max_revision_rounds, p_reason, p_comments, coalesce(p_creator_fault, true), auth.uid());
    update public.deliverables set status = 'revisions_requested' where id = p_deliverable;
    perform private.audit('revision_requested', 'deliverables', p_deliverable::text, d.status::text, 'revisions_requested', p_reason,
      jsonb_build_object('round', v_round, 'max', c.max_revision_rounds, 'creator_fault', p_creator_fault));
    perform private.notify(a.creator_id, 'revision_requested', 'Debes realizar correcciones',
      'Ronda ' || v_round || ' de ' || c.max_revision_rounds || ': ' || p_reason, '/campanas/' || a.id,
      'revision:' || p_deliverable || ':' || v_round);
  end if;
  perform private.sync_assignment(d.assignment_id);
end $$;

create or replace function public.admin_start_deliverable_review(p_deliverable uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.deliverables;
begin
  perform private.require_admin();
  update public.deliverables set status = 'in_review' where id = p_deliverable and status = 'submitted' returning * into d;
  if found then perform private.sync_assignment(d.assignment_id); end if;
end $$;

-- =====================================================================
-- Publicaciones
-- =====================================================================
create or replace function public.admin_schedule_publication(
  p_id uuid, p_platform public.social_platform, p_scheduled_at timestamptz, p_instructions text, p_deliverable uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  perform private.require_admin();
  perform private.assert_stage(p_id, 'video_approved', 'publication_confirmed');
  if not (private.campaign_of(p_id)).requires_publication then raise exception 'Esta campaña no incluye publicación.'; end if;
  insert into public.publications (assignment_id, deliverable_id, platform, scheduled_at, instructions)
  values (p_id, p_deliverable, p_platform, p_scheduled_at, p_instructions) returning id into v;
  perform private.audit('publication_scheduled', 'publications', v::text, null, 'scheduled');
  perform private.sync_assignment(p_id);
  return v;
end $$;

create or replace function public.mark_publication_done(p_publication uuid, p_url text, p_evidence_path text default null, p_published_at timestamptz default null)
returns void language plpgsql security definer set search_path = '' as $$
declare p public.publications; a public.campaign_assignments;
begin
  select * into p from public.publications where id = p_publication for update;
  if not found then raise exception 'Publicación no encontrada.'; end if;
  a := private.own_assignment(p.assignment_id);
  if p.status not in ('scheduled', 'issue') then raise exception 'Esta publicación ya fue registrada.'; end if;
  if p_url is null or p_url !~* '^https?://' then raise exception 'Pega el enlace público de la publicación.'; end if;
  perform private.assert_file('documents', p_evidence_path, a.creator_id);
  update public.publications
     set status = 'published', public_url = p_url, evidence_path = p_evidence_path,
         published_at = coalesce(p_published_at, now()), issue_note = null
   where id = p_publication;
  perform private.audit('publication_done', 'publications', p_publication::text, p.status::text, 'published', null, jsonb_build_object('url', p_url));
  perform private.notify_admins('publication_done', 'Publicación registrada', p_url, '/admin/campanas/' || a.campaign_id, 'publication_done:' || p_publication);
  perform private.sync_assignment(p.assignment_id);
end $$;

create or replace function public.report_publication_issue(p_publication uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.publications; a public.campaign_assignments;
begin
  select * into p from public.publications where id = p_publication for update;
  if not found then raise exception 'Publicación no encontrada.'; end if;
  a := private.own_assignment(p.assignment_id);
  if coalesce(trim(p_note), '') = '' then raise exception 'Describe el problema.'; end if;
  update public.publications set status = 'issue', issue_note = p_note where id = p_publication and status in ('scheduled', 'issue');
  perform private.notify_admins('publication_issue', 'Problema con una publicación', p_note, '/admin/campanas/' || a.campaign_id,
    'publication_issue:' || p_publication || ':' || to_char(now(), 'YYYYMMDDHH24MISS'));
  perform private.audit('publication_issue', 'publications', p_publication::text, p.status::text, 'issue', p_note);
end $$;

create or replace function public.admin_validate_publication(p_publication uuid, p_valid boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare p public.publications; a public.campaign_assignments;
begin
  perform private.require_admin();
  select * into p from public.publications where id = p_publication for update;
  if not found or p.status <> 'published' then raise exception 'Solo se validan publicaciones registradas por el creador.'; end if;
  if not p_valid and coalesce(trim(p_note), '') = '' then raise exception 'Indica qué no cumple lo pactado.'; end if;
  select * into a from public.campaign_assignments where id = p.assignment_id;
  update public.publications
     set status = case when p_valid then 'validated'::public.publication_status else 'issue' end,
         issue_note = case when p_valid then null else p_note end,
         validated_by = auth.uid(), validated_at = now()
   where id = p_publication;
  perform private.audit('publication_validated', 'publications', p_publication::text, 'published',
    case when p_valid then 'validated' else 'issue' end, p_note);
  if not p_valid then
    perform private.notify(a.creator_id, 'publication_invalid', 'Revisa tu publicación', p_note, '/campanas/' || a.id,
      'publication_invalid:' || p_publication || ':' || to_char(now(), 'YYYYMMDDHH24MISS'));
  end if;
  perform private.sync_assignment(p.assignment_id);
end $$;

-- =====================================================================
-- Códigos publicitarios
-- =====================================================================
create or replace function public.upsert_ad_authorization(
  p_id uuid, p_assignment uuid, p_platform public.social_platform, p_code text, p_content_url text,
  p_publication uuid, p_issued date, p_expires date, p_observations text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare a public.campaign_assignments; x public.advertising_authorizations; v uuid;
begin
  a := private.own_assignment(p_assignment);
  if not (private.campaign_of(p_assignment)).requires_ad_code then raise exception 'Esta campaña no requiere códigos publicitarios.'; end if;
  perform private.assert_stage(p_assignment, 'video_approved', 'payment_pending_authorization');
  if p_expires is not null and p_expires < current_date then raise exception 'El código ya está vencido.'; end if;
  if p_publication is not null and not exists (select 1 from public.publications where id = p_publication and assignment_id = p_assignment) then
    raise exception 'La publicación no corresponde a esta campaña.';
  end if;
  if p_id is null then
    insert into public.advertising_authorizations (assignment_id, platform, auth_code, publication_id, content_url, issued_on, expires_on, observations, created_by)
    values (p_assignment, p_platform, trim(p_code), p_publication, p_content_url, p_issued, p_expires, p_observations, auth.uid())
    returning id into v;
  else
    select * into x from public.advertising_authorizations where id = p_id and assignment_id = p_assignment for update;
    if not found then raise exception 'Código no encontrado.'; end if;
    -- Cualquier cambio vuelve a requerir validación de Vocera.
    update public.advertising_authorizations
       set platform = p_platform, auth_code = trim(p_code), publication_id = p_publication, content_url = p_content_url,
           issued_on = p_issued, expires_on = p_expires, observations = p_observations,
           status = 'submitted', validated_by = null, validated_at = null, updated_at = now()
     where id = p_id returning id into v;
  end if;
  -- El código NO se guarda en la auditoría (información restringida).
  perform private.audit('ad_code_submitted', 'advertising_authorizations', v::text, x.status::text, 'submitted');
  perform private.notify_admins('ad_code_submitted', 'Código publicitario recibido', null, '/admin/campanas/' || a.campaign_id,
    'ad_code:' || v || ':' || to_char(now(), 'YYYYMMDDHH24MISS'));
  perform private.sync_assignment(p_assignment);
  return v;
end $$;

create or replace function public.admin_validate_ad_authorization(p_id uuid, p_valid boolean, p_observations text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare x public.advertising_authorizations; a public.campaign_assignments;
begin
  perform private.require_admin();
  select * into x from public.advertising_authorizations where id = p_id for update;
  if not found then raise exception 'Código no encontrado.'; end if;
  if p_valid and x.expires_on is not null and x.expires_on < current_date then
    raise exception 'El código está vencido; pide uno nuevo.';
  end if;
  if not p_valid and coalesce(trim(p_observations), '') = '' then raise exception 'Indica por qué el código no es válido.'; end if;
  select * into a from public.campaign_assignments where id = x.assignment_id;
  update public.advertising_authorizations
     set status = case when p_valid then 'valid'::public.ad_auth_status else 'invalid' end,
         observations = coalesce(p_observations, observations), validated_by = auth.uid(), validated_at = now()
   where id = p_id;
  perform private.audit('ad_code_validated', 'advertising_authorizations', p_id::text, x.status::text,
    case when p_valid then 'valid' else 'invalid' end, p_observations);
  if not p_valid then
    perform private.notify(a.creator_id, 'ad_code_invalid', 'Tu código necesita corrección', p_observations, '/campanas/' || a.id,
      'ad_code_invalid:' || p_id || ':' || to_char(now(), 'YYYYMMDDHH24MISS'));
  end if;
  perform private.sync_assignment(x.assignment_id);
end $$;

-- =====================================================================
-- Validación final, requisitos y pagos
-- =====================================================================
create or replace function public.admin_final_validate(p_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  perform private.assert_stage(p_id, 'final_validation', 'final_validation');
  update public.campaign_assignments set final_validated_at = now(), final_validated_by = auth.uid() where id = p_id;
  update public.payments set status = 'in_review' where assignment_id = p_id and concept = 'fee' and status = 'requirements_pending';
  perform private.audit('final_validated', 'campaign_assignments', p_id::text, null, null, p_note);
  perform private.sync_assignment(p_id, p_note);
end $$;

-- Lista de condiciones para liberar el pago (visible para el creador).
create or replace function public.payment_checklist(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  a public.campaign_assignments; c public.campaigns; out jsonb := '[]'::jsonb;
  v_late boolean; v_override text;
begin
  select * into a from public.campaign_assignments where id = p_id;
  if not found then raise exception 'Campaña no encontrada.'; end if;
  if not private.is_admin() and (a.creator_id is distinct from auth.uid() or a.invited_at is null) then
    raise exception 'No tienes acceso a esta campaña.' using errcode = '42501';
  end if;
  c := private.campaign_of(p_id);

  select bool_or(d.first_submitted_at::date > coalesce(d.due_on, a.video_due_on)) into v_late
    from public.deliverables d where d.assignment_id = p_id and d.required;
  select reason into v_override from public.payment_requirement_overrides where assignment_id = p_id and requirement = 'on_time';

  out := jsonb_build_array(
    jsonb_build_object('key', 'contract', 'label', 'Contrato firmado', 'required', c.requires_contract,
      'met', exists (select 1 from public.contracts k where k.assignment_id = p_id and k.status = 'signed')),
    jsonb_build_object('key', 'deliverables', 'label', 'Entregables completos', 'required', true,
      'met', exists (select 1 from public.deliverables d where d.assignment_id = p_id and d.required)
             and not exists (select 1 from public.deliverables d where d.assignment_id = p_id and d.required and d.current_version = 0)),
    jsonb_build_object('key', 'approved', 'label', 'Contenido aprobado', 'required', true,
      'met', exists (select 1 from public.deliverables d where d.assignment_id = p_id and d.required)
             and not exists (select 1 from public.deliverables d where d.assignment_id = p_id and d.required and d.status <> 'approved')),
    jsonb_build_object('key', 'on_time', 'label', 'Entrega dentro del plazo acordado', 'required', true,
      'met', not coalesce(v_late, false) or v_override is not null,
      'detail', case when v_override is not null then 'Excepción aprobada: ' || v_override end),
    jsonb_build_object('key', 'revisions', 'label', 'Correcciones resueltas', 'required', true,
      'met', not exists (select 1 from public.revision_requests r join public.deliverables d on d.id = r.deliverable_id
                          where d.assignment_id = p_id and r.resolved_at is null)),
    jsonb_build_object('key', 'ad_codes', 'label', 'Códigos publicitarios validados', 'required', c.requires_ad_code,
      'met', exists (select 1 from public.advertising_authorizations x where x.assignment_id = p_id and x.status = 'valid'
                      and (x.expires_on is null or x.expires_on >= current_date))),
    jsonb_build_object('key', 'publication', 'label', 'Publicación y evidencias validadas', 'required', c.requires_publication,
      'met', exists (select 1 from public.publications p where p.assignment_id = p_id)
             and not exists (select 1 from public.publications p where p.assignment_id = p_id and p.status <> 'validated')),
    jsonb_build_object('key', 'final', 'label', 'Validación final de Vocera', 'required', true,
      'met', a.final_validated_at is not null),
    jsonb_build_object('key', 'payout', 'label', 'Datos de cobro registrados', 'required', true,
      'met', exists (select 1 from public.payout_methods m where m.user_id = a.creator_id and m.is_active))
  );
  return jsonb_build_object(
    'items', out,
    'ready', not exists (select 1 from jsonb_array_elements(out) e where (e ->> 'required')::boolean and not (e ->> 'met')::boolean)
  );
end $$;

create or replace function public.admin_set_on_time_override(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  insert into public.payment_requirement_overrides (assignment_id, requirement, reason, created_by)
  values (p_id, 'on_time', p_reason, auth.uid())
  on conflict (assignment_id, requirement) do update set reason = excluded.reason, created_by = excluded.created_by, created_at = now();
  perform private.audit('payment_override', 'campaign_assignments', p_id::text, null, null, p_reason, '{"requirement":"on_time"}');
end $$;

-- Autorización final del pago: la decide un admin; el sistema solo la permite
-- si todas las condiciones se cumplen. Bloqueo de fila = sin dobles aprobaciones.
create or replace function public.admin_authorize_payment(p_id uuid, p_no_breach_confirmed boolean, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare p public.payments; chk jsonb; v_method uuid; a public.campaign_assignments;
begin
  perform private.require_admin();
  select * into p from public.payments where assignment_id = p_id and concept = 'fee' for update;
  if not found then raise exception 'No hay honorario registrado para esta participación.'; end if;
  if p.status not in ('requirements_pending', 'in_review', 'incident') then
    raise exception 'Este pago ya fue autorizado (estado: %).', p.status;
  end if;
  if not coalesce(p_no_breach_confirmed, false) then
    raise exception 'Confirma que no existen incumplimientos contractuales que impidan el pago.';
  end if;
  chk := public.payment_checklist(p_id);
  if not (chk ->> 'ready')::boolean then
    raise exception 'Hay condiciones pendientes para liberar el pago.' using detail = chk::text;
  end if;
  select * into a from public.campaign_assignments where id = p_id;
  select id into v_method from public.payout_methods where user_id = a.creator_id and is_active;
  update public.payments
     set status = 'approved', approved_by = auth.uid(), approved_at = now(), approval_note = p_note,
         requirements_snapshot = chk, payout_method_id = v_method, incident_note = null
   where id = p.id;
  perform private.audit('payment_authorized', 'payments', p.id::text, p.status::text, 'approved', p_note,
    jsonb_build_object('amount', p.amount, 'currency', p.currency));
  perform private.sync_assignment(p_id);
  return p.id;
end $$;

create or replace function public.admin_schedule_payment(p_payment uuid, p_date date) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.payments;
begin
  perform private.require_admin();
  select * into p from public.payments where id = p_payment for update;
  if p.status not in ('approved', 'scheduled') then raise exception 'Solo se programan pagos autorizados.'; end if;
  update public.payments set status = 'scheduled', scheduled_for = p_date where id = p_payment;
  perform private.audit('payment_scheduled', 'payments', p_payment::text, p.status::text, 'scheduled', null, jsonb_build_object('date', p_date));
end $$;

create unique index payments_transfer_ref_idx on public.payments (transfer_reference) where transfer_reference is not null;

-- Registro de una transferencia hecha FUERA del sistema (banca del negocio).
create or replace function public.admin_register_transfer(p_payment uuid, p_transferred_at timestamptz, p_reference text, p_receipt_path text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare p public.payments;
begin
  perform private.require_admin();
  select * into p from public.payments where id = p_payment for update;
  if not found then raise exception 'Pago no encontrado.'; end if;
  if p.status not in ('approved', 'scheduled') then
    raise exception 'Solo se registran transferencias de pagos autorizados (estado actual: %).', p.status;
  end if;
  if coalesce(char_length(trim(p_reference)), 0) < 4 then raise exception 'Indica el número de operación de la transferencia.'; end if;
  if p_transferred_at is null or p_transferred_at > now() + interval '1 day' then raise exception 'Fecha de transferencia no válida.'; end if;
  if p_receipt_path is not null and not exists (select 1 from storage.objects o where o.bucket_id = 'documents' and o.name = p_receipt_path) then
    raise exception 'No encontramos el comprobante subido.';
  end if;
  update public.payments
     set status = 'transferred', transferred_at = p_transferred_at, transfer_reference = trim(p_reference), receipt_path = p_receipt_path
   where id = p_payment;
  perform private.audit('payment_transferred', 'payments', p_payment::text, p.status::text, 'transferred', null,
    jsonb_build_object('reference', trim(p_reference)));
  if p.concept = 'fee' then
    perform private.sync_assignment(p.assignment_id);
  else
    perform private.notify(p.creator_id, 'bonus_transferred', 'Tu bonificación fue transferida', null, '/pagos', 'bonus_transferred:' || p.id);
  end if;
end $$;

create or replace function public.confirm_payment_received(p_payment uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.payments;
begin
  select * into p from public.payments where id = p_payment for update;
  if not found or p.creator_id is distinct from auth.uid() then raise exception 'Pago no encontrado.' using errcode = '42501'; end if;
  if p.status <> 'transferred' then raise exception 'Este pago aún no figura como transferido.'; end if;
  update public.payments set status = 'confirmed', confirmed_at = now() where id = p_payment;
  perform private.audit('payment_confirmed', 'payments', p_payment::text, 'transferred', 'confirmed');
  if p.concept = 'fee' then perform private.sync_assignment(p.assignment_id); end if;
end $$;

create or replace function public.report_payment_incident(p_payment uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.payments;
begin
  select * into p from public.payments where id = p_payment for update;
  if not found or (p.creator_id is distinct from auth.uid() and not private.is_admin()) then
    raise exception 'Pago no encontrado.' using errcode = '42501';
  end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Describe la incidencia.'; end if;
  if p.status in ('confirmed') then raise exception 'Este pago ya fue confirmado.'; end if;
  update public.payments set status = 'incident', incident_note = p_note where id = p_payment;
  perform private.audit('payment_incident', 'payments', p_payment::text, p.status::text, 'incident', p_note);
  perform private.notify_admins('payment_incident', 'Incidencia en un pago', p_note, '/admin/pagos',
    'payment_incident:' || p_payment || ':' || to_char(now(), 'YYYYMMDDHH24MISS'));
  if p.concept = 'fee' then perform private.sync_assignment(p.assignment_id); end if;
end $$;

-- Bonificaciones: concepto separado; solo se reconoce tras su aprobación.
create or replace function public.admin_propose_bonus(p_id uuid, p_amount numeric, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid; a public.campaign_assignments;
begin
  perform private.require_admin();
  select * into a from public.campaign_assignments where id = p_id;
  if not found or a.accepted_at is null then raise exception 'La participación no está activa.'; end if;
  insert into public.bonuses (assignment_id, amount, currency, reason, proposed_by) values (p_id, p_amount, a.currency, p_reason, auth.uid()) returning id into v;
  perform private.audit('bonus_proposed', 'bonuses', v::text, null, 'proposed', p_reason, jsonb_build_object('amount', p_amount));
  return v;
end $$;

create or replace function public.admin_decide_bonus(p_bonus uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.bonuses; a public.campaign_assignments;
begin
  perform private.require_admin();
  select * into b from public.bonuses where id = p_bonus for update;
  if not found or b.status <> 'proposed' then raise exception 'Esta bonificación ya fue decidida.'; end if;
  select * into a from public.campaign_assignments where id = b.assignment_id;
  update public.bonuses set status = case when p_approve then 'approved'::public.bonus_status else 'rejected' end,
         decided_by = auth.uid(), decided_at = now() where id = p_bonus;
  if p_approve then
    insert into public.payments (assignment_id, creator_id, concept, bonus_id, amount, currency, status, approved_by, approved_at, approval_note)
    values (b.assignment_id, a.creator_id, 'bonus', p_bonus, b.amount, b.currency, 'approved', auth.uid(), now(), p_note);
    perform private.notify(a.creator_id, 'bonus_approved', 'Tienes una bonificación aprobada', b.reason, '/pagos', 'bonus_approved:' || p_bonus);
  end if;
  perform private.audit('bonus_decided', 'bonuses', p_bonus::text, 'proposed', case when p_approve then 'approved' else 'rejected' end, p_note);
end $$;

-- ---------- Permisos de ejecución ----------
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
  loop
    execute format('revoke execute on function %s from anon, public', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
