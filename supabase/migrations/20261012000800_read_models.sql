-- =====================================================================
-- Vocera · 0800 · Consultas de lectura para el portal y el panel
-- Todas validan el acceso dentro de la función (security definer).
-- =====================================================================

-- Grupo visible en "Mis campañas"
create or replace function private.assignment_group(s public.assignment_status) returns text
language sql immutable as $$
  select case
    when s = 'invited' then 'invitations'
    when s in ('declined', 'rejected', 'cancelled', 'expired', 'suspended') then 'history'
    when s >= 'payment_pending_authorization' then 'finished'
    when s in ('script_in_review', 'video_delivered', 'video_in_review', 'publication_confirmed', 'final_validation') then 'review'
    when s < 'invited' then 'hidden'
    else 'active'
  end
$$;

-- Próxima acción concreta para el creador (o qué está esperando)
create or replace function private.next_action(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare a public.campaign_assignments; v jsonb;
begin
  select * into a from public.campaign_assignments where id = p_id;
  v := case a.status
    when 'invited' then jsonb_build_object('kind', 'action', 'label', 'Revisar invitación', 'tab', 'resumen', 'priority', 1)
    when 'availability_confirmed' then jsonb_build_object('kind', 'wait', 'label', 'Vocera está preparando tu contrato', 'tab', 'contrato', 'priority', 9)
    when 'contract_pending' then jsonb_build_object('kind', 'action', 'label', 'Revisar y firmar contrato', 'tab', 'contrato', 'priority', 2)
    when 'product_pending' then
      case when exists (select 1 from public.product_shipments s where s.assignment_id = p_id and s.status <> 'received')
           then jsonb_build_object('kind', 'action', 'label', 'Confirmar recepción de producto', 'tab', 'producto', 'priority', 3)
           else jsonb_build_object('kind', 'wait', 'label', 'Vocera coordinará el envío del producto', 'tab', 'producto', 'priority', 9) end
    when 'script_pending' then jsonb_build_object('kind', 'action', 'label',
        case when exists (select 1 from public.scripts s where s.assignment_id = p_id and s.status = 'changes_requested') then 'Ajustar guion' else 'Enviar guion' end,
        'tab', 'guion', 'priority', 3)
    when 'script_in_review' then jsonb_build_object('kind', 'wait', 'label', 'Guion en revisión', 'tab', 'guion', 'priority', 9)
    when 'in_production' then
      case when exists (select 1 from public.deliverables d where d.assignment_id = p_id and d.status = 'pending')
           then jsonb_build_object('kind', 'action', 'label', 'Entregar video', 'tab', 'entregas', 'priority', 2)
           else jsonb_build_object('kind', 'wait', 'label', 'Vocera definirá los entregables', 'tab', 'entregas', 'priority', 9) end
    when 'revisions_requested' then jsonb_build_object('kind', 'action', 'label', 'Atender correcciones', 'tab', 'entregas', 'priority', 1)
    when 'video_delivered' then jsonb_build_object('kind', 'wait', 'label', 'Video entregado, pendiente de revisión', 'tab', 'entregas', 'priority', 9)
    when 'video_in_review' then jsonb_build_object('kind', 'wait', 'label', 'Video en revisión', 'tab', 'entregas', 'priority', 9)
    when 'video_approved' then jsonb_build_object('kind', 'wait', 'label', 'Vocera programará la publicación', 'tab', 'publicacion', 'priority', 9)
    when 'publication_scheduled' then jsonb_build_object('kind', 'action', 'label', 'Publicar contenido', 'tab', 'publicacion', 'priority', 2)
    when 'publication_confirmed' then jsonb_build_object('kind', 'wait', 'label', 'Publicación en validación', 'tab', 'publicacion', 'priority', 9)
    when 'ad_codes_pending' then jsonb_build_object('kind', 'action', 'label', 'Entregar código publicitario', 'tab', 'codigos', 'priority', 2)
    when 'final_validation' then jsonb_build_object('kind', 'wait', 'label', 'Validación final de Vocera', 'tab', 'pago', 'priority', 9)
    when 'payment_pending_authorization' then
      case when not exists (select 1 from public.payout_methods m where m.user_id = a.creator_id and m.is_active)
           then jsonb_build_object('kind', 'action', 'label', 'Completar datos de cobro', 'tab', 'pago', 'href', '/pagos/datos', 'priority', 2)
           else jsonb_build_object('kind', 'wait', 'label', 'Pago pendiente de autorización', 'tab', 'pago', 'priority', 9) end
    when 'payment_approved' then jsonb_build_object('kind', 'wait', 'label', 'Pago autorizado, transferencia en proceso', 'tab', 'pago', 'priority', 9)
    when 'payment_sent' then jsonb_build_object('kind', 'action', 'label', 'Confirmar que recibiste el pago', 'tab', 'pago', 'priority', 4)
    else null
  end;
  return v;
end $$;

create or replace function private.next_deadline(p_id uuid) returns date
language sql stable security definer set search_path = '' as $$
  select min(d) from (
    select a.invite_expires_at::date as d from public.campaign_assignments a where a.id = p_id and a.status = 'invited'
    union all select a.script_due_on from public.campaign_assignments a where a.id = p_id and a.status <= 'script_in_review' and a.status >= 'invited'
    union all select dl.due_on from public.deliverables dl where dl.assignment_id = p_id and dl.status in ('pending', 'revisions_requested')
    union all select k.sign_by from public.contracts k where k.assignment_id = p_id and k.status = 'sent'
    union all select p.scheduled_at::date from public.publications p where p.assignment_id = p_id and p.status in ('scheduled', 'issue')
  ) x where d is not null
$$;

-- ---------- Mis campañas ----------
create or replace function public.my_campaigns() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(row order by (row ->> 'updated_at') desc), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', a.id, 'campaign_id', c.id, 'name', c.name,
      'brand', case when c.brand_visible_to_creators then b.name end,
      'status', a.status, 'group', private.assignment_group(a.status),
      'fee', a.fee_amount, 'currency', a.currency,
      'deadline', private.next_deadline(a.id),
      'next_action', private.next_action(a.id),
      'platforms', c.platforms, 'updated_at', a.updated_at
    ) as row
    from public.campaign_assignments a
    join public.campaigns c on c.id = a.campaign_id
    left join public.brands b on b.id = c.brand_id
    where a.creator_id = auth.uid() and a.invited_at is not null
  ) t
$$;

-- ---------- Detalle completo de una participación ----------
create or replace function public.get_assignment_bundle(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  a public.campaign_assignments; c public.campaigns; v_admin boolean := private.is_admin(); out jsonb;
begin
  select * into a from public.campaign_assignments where id = p_id;
  if not found or (not v_admin and (a.creator_id is distinct from auth.uid() or a.invited_at is null)) then
    raise exception 'No tienes acceso a esta campaña.' using errcode = '42501';
  end if;
  select * into c from public.campaigns where id = a.campaign_id;

  out := jsonb_build_object(
    'assignment', to_jsonb(a) - case when v_admin then '' else 'closed_reason' end,
    'group', private.assignment_group(a.status),
    'next_action', private.next_action(p_id),
    'campaign', to_jsonb(c) - 'created_by',
    'brand', case when c.brand_visible_to_creators or v_admin then (select name from public.brands where id = c.brand_id) end,
    'brief', (select to_jsonb(b) from public.campaign_briefs b where b.campaign_id = c.id),
    'creator', (select jsonb_build_object('id', p.id, 'full_name', p.full_name, 'email', p.email, 'artistic_name', cp.artistic_name)
                  from public.profiles p left join public.creator_profiles cp on cp.user_id = p.id where p.id = a.creator_id),
    'contracts', coalesce((select jsonb_agg(to_jsonb(k) || jsonb_build_object(
        'signature', (select to_jsonb(s) - 'recorded_by' from public.contract_signatures s where s.contract_id = k.id),
        'acknowledged_at', (select ack.acknowledged_at from public.contract_acknowledgements ack where ack.contract_id = k.id and ack.user_id = a.creator_id))
        order by k.version desc)
      from public.contracts k where k.assignment_id = p_id and (v_admin or k.status <> 'draft')), '[]'),
    'shipments', coalesce((select jsonb_agg(to_jsonb(s) || jsonb_build_object(
        'receipt', (select to_jsonb(r) from public.product_receipts r where r.shipment_id = s.id),
        'issues', coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at desc) from public.shipment_issues i where i.shipment_id = s.id), '[]'))
        order by s.created_at)
      from public.product_shipments s where s.assignment_id = p_id), '[]'),
    'scripts', coalesce((select jsonb_agg(to_jsonb(s) || jsonb_build_object(
        'reviews', coalesce((select jsonb_agg(jsonb_build_object('decision', r.decision, 'comments', r.comments, 'created_at', r.created_at) order by r.created_at desc)
                              from public.script_reviews r where r.script_id = s.id), '[]'))
        order by s.version desc)
      from public.scripts s where s.assignment_id = p_id), '[]'),
    'deliverables', coalesce((select jsonb_agg(to_jsonb(d) || jsonb_build_object(
        'versions', coalesce((select jsonb_agg(to_jsonb(v) - 'submitted_by' order by v.version desc) from public.deliverable_versions v where v.deliverable_id = d.id), '[]'),
        'revisions', coalesce((select jsonb_agg(to_jsonb(r) - 'requested_by' order by r.round desc) from public.revision_requests r where r.deliverable_id = d.id), '[]'))
        order by d.created_at)
      from public.deliverables d where d.assignment_id = p_id), '[]'),
    'ad_authorizations', coalesce((select jsonb_agg(to_jsonb(x) - 'validated_by' - 'created_by' order by x.created_at desc)
      from public.advertising_authorizations x where x.assignment_id = p_id), '[]'),
    'publications', coalesce((select jsonb_agg(to_jsonb(p) - 'validated_by' order by p.scheduled_at)
      from public.publications p where p.assignment_id = p_id), '[]'),
    'payments', coalesce((select jsonb_agg((to_jsonb(p) - 'approved_by' - 'requirements_snapshot') order by p.created_at)
      from public.payments p where p.assignment_id = p_id), '[]'),
    'bonuses', coalesce((select jsonb_agg(to_jsonb(b) order by b.created_at)
      from public.bonuses b where b.assignment_id = p_id and (v_admin or b.status = 'approved')), '[]'),
    'checklist', case when a.accepted_at is not null then public.payment_checklist(p_id) end,
    'timeline', coalesce((select jsonb_agg(jsonb_build_object('status', l.new_status, 'at', l.created_at) order by l.created_at)
      from public.audit_logs l where l.table_name = 'campaign_assignments' and l.record_id = p_id::text and l.action = 'assignment_status'), '[]')
  );
  if v_admin then
    out := out || jsonb_build_object(
      'client_approvals', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.campaign_approvals x where x.assignment_id = p_id), '[]'),
      'overrides', coalesce((select jsonb_agg(to_jsonb(o)) from public.payment_requirement_overrides o where o.assignment_id = p_id), '[]'),
      'payout_method', (select jsonb_build_object('id', m.id, 'holder_name', m.holder_name, 'bank_name', m.bank_name, 'account_type', m.account_type,
          'currency', m.currency, 'account_last4', m.account_last4, 'country', m.country)
        from public.payout_methods m where m.user_id = a.creator_id and m.is_active),
      'audit', coalesce((select jsonb_agg(jsonb_build_object('action', l.action, 'table', l.table_name, 'old', l.old_status, 'new', l.new_status,
          'reason', l.reason, 'at', l.created_at, 'actor', (select full_name from public.profiles where id = l.actor_id)) order by l.created_at desc)
        from public.audit_logs l where (l.table_name = 'campaign_assignments' and l.record_id = p_id::text)
          or l.record_id in (select id::text from public.contracts where assignment_id = p_id
                     union all select id::text from public.scripts where assignment_id = p_id
                     union all select id::text from public.deliverables where assignment_id = p_id
                     union all select id::text from public.publications where assignment_id = p_id
                     union all select id::text from public.advertising_authorizations where assignment_id = p_id
                     union all select id::text from public.payments where assignment_id = p_id
                     union all select id::text from public.product_shipments where assignment_id = p_id)), '[]')
    );
  end if;
  return out;
end $$;

-- ---------- Dashboard del creador ----------
create or replace function public.creator_dashboard() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); p public.profiles; out jsonb;
begin
  select * into p from public.profiles where id = v_user;
  with mine as (
    select a.*, private.assignment_group(a.status) as grp
      from public.campaign_assignments a where a.creator_id = v_user and a.invited_at is not null
  ), actions as (
    select jsonb_build_object('assignment_id', m.id, 'campaign', c.name, 'deadline', private.next_deadline(m.id)) || private.next_action(m.id) as act
      from mine m join public.campaigns c on c.id = m.campaign_id
     where private.next_action(m.id) ->> 'kind' = 'action'
  )
  select jsonb_build_object(
    'profile', jsonb_build_object('full_name', p.full_name, 'status', p.status, 'status_reason', p.status_reason,
       'welcome_seen_at', p.welcome_seen_at, 'onboarding_step', p.onboarding_step,
       'artistic_name', (select artistic_name from public.creator_profiles where user_id = v_user),
       'avatar_path', (select avatar_path from public.creator_profiles where user_id = v_user)),
    'completion', public.creator_completion(v_user),
    'unread', (select count(*) from public.notifications n where n.user_id = v_user and n.read_at is null),
    'kpis', jsonb_build_object(
      'active', (select count(*) from mine where grp in ('active', 'review')),
      'invitations', (select count(*) from mine where grp = 'invitations'),
      'pending_deliverables', (select count(*) from public.deliverables d join mine m on m.id = d.assignment_id
                                where d.required and d.status in ('pending', 'revisions_requested') and m.closed_status is null and m.status >= 'in_production'),
      'completed', (select count(*) from mine where grp = 'finished')
    ),
    'money', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('currency', pay.currency,
          'to_collect', sum(pay.amount) filter (where pay.status in ('requirements_pending', 'in_review', 'approved', 'scheduled', 'incident')),
          'received', sum(pay.amount) filter (where pay.status in ('transferred', 'confirmed'))) as x
          from public.payments pay where pay.creator_id = v_user group by pay.currency) t), '[]'),
    'actions', coalesce((select jsonb_agg(act order by (act ->> 'priority')::int, act ->> 'deadline' nulls last) from actions), '[]'),
    'has_payout', exists (select 1 from public.payout_methods m where m.user_id = v_user and m.is_active)
  ) into out;
  return out;
end $$;

-- ---------- Calendario (creador o admin) ----------
create or replace function public.calendar_events(p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = '' as $$
  with scope as (
    select a.id, a.campaign_id, a.creator_id, a.status from public.campaign_assignments a
     where a.closed_status is null and a.invited_at is not null
       and (a.creator_id = auth.uid() or private.is_admin())
  ), ev as (
    select s.id, 'Vence la invitación' as label, a.invite_expires_at::date as day, 'invite' as kind from scope s join public.campaign_assignments a on a.id = s.id where s.status = 'invited'
    union all select s.id, 'Firma del contrato', k.sign_by, 'contract' from scope s join public.contracts k on k.assignment_id = s.id where k.status = 'sent'
    union all select s.id, 'Llega el producto', sh.expected_on, 'product' from scope s join public.product_shipments sh on sh.assignment_id = s.id where sh.status <> 'received'
    union all select s.id, 'Entrega del guion', a.script_due_on, 'script' from scope s join public.campaign_assignments a on a.id = s.id where s.status <= 'script_in_review'
    union all select s.id, 'Entrega: ' || d.title, d.due_on, 'deliverable' from scope s join public.deliverables d on d.assignment_id = s.id where d.status in ('pending', 'revisions_requested')
    union all select s.id, 'Publicación en ' || p.platform, p.scheduled_at::date, 'publication' from scope s join public.publications p on p.assignment_id = s.id where p.status in ('scheduled', 'issue')
    union all select s.id, 'Pago programado', pay.scheduled_for, 'payment' from scope s join public.payments pay on pay.assignment_id = s.id where pay.status = 'scheduled'
  )
  select coalesce(jsonb_agg(jsonb_build_object('assignment_id', ev.id, 'campaign', c.name, 'label', ev.label, 'day', ev.day, 'kind', ev.kind) order by ev.day), '[]'::jsonb)
    from ev join public.campaign_assignments a on a.id = ev.id join public.campaigns c on c.id = a.campaign_id
   where ev.day between p_from and p_to
$$;

-- ---------- Pagos del creador ----------
create or replace function public.my_payments() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'summary', coalesce((select jsonb_agg(x) from (
       select jsonb_build_object('currency', p.currency,
         'earned', coalesce(sum(p.amount) filter (where p.status in ('transferred', 'confirmed')), 0),
         'pending_validation', coalesce(sum(p.amount) filter (where p.status in ('requirements_pending', 'in_review', 'incident')), 0),
         'approved', coalesce(sum(p.amount) filter (where p.status = 'approved'), 0),
         'in_process', coalesce(sum(p.amount) filter (where p.status = 'scheduled'), 0),
         'received', coalesce(sum(p.amount) filter (where p.status in ('transferred', 'confirmed')), 0),
         'bonuses', coalesce(sum(p.amount) filter (where p.concept = 'bonus'), 0)) as x
       from public.payments p where p.creator_id = auth.uid() group by p.currency) t), '[]'),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'assignment_id', p.assignment_id, 'campaign', c.name, 'concept', p.concept,
        'amount', p.amount, 'currency', p.currency, 'status', p.status, 'created_at', p.created_at,
        'approved_at', p.approved_at, 'scheduled_for', p.scheduled_for, 'transferred_at', p.transferred_at,
        'transfer_reference', p.transfer_reference, 'has_receipt', p.receipt_path is not null, 'receipt_path', p.receipt_path,
        'incident_note', p.incident_note) order by p.created_at desc)
      from public.payments p join public.campaign_assignments a on a.id = p.assignment_id join public.campaigns c on c.id = a.campaign_id
      where p.creator_id = auth.uid()), '[]'),
    'payout_method', (select jsonb_build_object('id', m.id, 'holder_name', m.holder_name, 'bank_name', m.bank_name, 'account_type', m.account_type,
        'currency', m.currency, 'country', m.country, 'account_last4', m.account_last4, 'created_at', m.created_at)
      from public.payout_methods m where m.user_id = auth.uid() and m.is_active)
  )
$$;

-- ---------- Panel administrador ----------
create or replace function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'creators', (select count(*) from public.profiles where role = 'creator'),
    'profiles_in_review', (select count(*) from public.profiles where role = 'creator' and status = 'in_review'),
    'active_campaigns', (select count(*) from public.campaigns where status = 'active'),
    'pending_deliverables', (select count(*) from public.deliverables d join public.campaign_assignments a on a.id = d.assignment_id
                              where a.closed_status is null and d.status in ('submitted', 'in_review')),
    'pending_scripts', (select count(*) from public.scripts where status in ('submitted', 'in_review')),
    'contracts_to_sign', (select count(*) from public.contracts where status = 'sent'),
    'payments_to_authorize', (select count(*) from public.campaign_assignments where status = 'payment_pending_authorization'),
    'payments_to_transfer', (select count(*) from public.payments where status in ('approved', 'scheduled')),
    'incidents', (select count(*) from public.payments where status = 'incident')
                 + (select count(*) from public.shipment_issues where status = 'open')
                 + (select count(*) from public.publications where status = 'issue'),
    'upcoming', public.calendar_events(current_date, current_date + 14),
    'queue', coalesce((select jsonb_agg(jsonb_build_object('assignment_id', a.id, 'campaign', c.name, 'creator', p.full_name, 'status', a.status, 'updated_at', a.updated_at)
                       order by a.updated_at)
               from public.campaign_assignments a join public.campaigns c on c.id = a.campaign_id join public.profiles p on p.id = a.creator_id
              where a.status in ('script_in_review', 'video_delivered', 'video_in_review', 'publication_confirmed', 'final_validation', 'payment_pending_authorization')
                and a.closed_status is null), '[]')
  );
end $$;

create or replace function public.admin_campaigns() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'status', c.status, 'brand', b.name, 'starts_on', c.starts_on, 'ends_on', c.ends_on,
      'currency', c.currency, 'default_fee', c.default_fee,
      'creators', (select count(*) from public.campaign_assignments a where a.campaign_id = c.id),
      'in_progress', (select count(*) from public.campaign_assignments a where a.campaign_id = c.id and a.closed_status is null and a.status < 'payment_confirmed'),
      'created_at', c.created_at) order by c.created_at desc)
    from public.campaigns c left join public.brands b on b.id = c.brand_id), '[]');
end $$;

create or replace function public.admin_campaign_detail(p_campaign uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'campaign', (select to_jsonb(c) from public.campaigns c where c.id = p_campaign),
    'brief', (select to_jsonb(b) from public.campaign_briefs b where b.campaign_id = p_campaign),
    'brand', (select to_jsonb(b) from public.brands b join public.campaigns c on c.brand_id = b.id where c.id = p_campaign),
    'assignments', coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'creator_id', a.creator_id, 'creator', p.full_name, 'artistic_name', cp.artistic_name,
        'status', a.status, 'fee', a.fee_amount, 'currency', a.currency, 'updated_at', a.updated_at) order by a.created_at)
      from public.campaign_assignments a join public.profiles p on p.id = a.creator_id
      left join public.creator_profiles cp on cp.user_id = a.creator_id where a.campaign_id = p_campaign), '[]')
  );
end $$;

create or replace function public.admin_creator_detail(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'profile', (select to_jsonb(p) from public.profiles p where p.id = p_user and p.role = 'creator'),
    'creator', (select to_jsonb(c) from public.creator_profiles c where c.user_id = p_user),
    'social', coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at) from public.creator_social_accounts s where s.user_id = p_user), '[]'),
    'rates', coalesce((select jsonb_agg(to_jsonb(r)) from public.creator_rates r where r.user_id = p_user), '[]'),
    'private', (select to_jsonb(d) from public.creator_private_details d where d.user_id = p_user),
    'completion', public.creator_completion(p_user),
    'notes', coalesce((select jsonb_agg(jsonb_build_object('body', n.body, 'at', n.created_at, 'author', (select full_name from public.profiles where id = n.author_id)) order by n.created_at desc)
       from public.creator_notes n where n.creator_id = p_user), '[]'),
    'assignments', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'campaign', c.name, 'status', a.status, 'fee', a.fee_amount, 'currency', a.currency) order by a.created_at desc)
       from public.campaign_assignments a join public.campaigns c on c.id = a.campaign_id where a.creator_id = p_user), '[]'),
    'payout_method', (select jsonb_build_object('id', m.id, 'holder_name', m.holder_name, 'bank_name', m.bank_name, 'account_last4', m.account_last4, 'currency', m.currency)
       from public.payout_methods m where m.user_id = p_user and m.is_active)
  );
end $$;

create or replace function public.admin_payments() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'assignment_id', p.assignment_id, 'campaign', c.name, 'creator', pr.full_name, 'concept', p.concept,
      'amount', p.amount, 'currency', p.currency, 'status', p.status, 'assignment_status', a.status,
      'approved_at', p.approved_at, 'scheduled_for', p.scheduled_for, 'transferred_at', p.transferred_at,
      'transfer_reference', p.transfer_reference, 'receipt_path', p.receipt_path, 'incident_note', p.incident_note,
      'ready', case when p.concept = 'fee' and p.status in ('requirements_pending', 'in_review', 'incident')
                    then (public.payment_checklist(p.assignment_id) ->> 'ready')::boolean end) order by p.created_at desc)
    from public.payments p join public.campaign_assignments a on a.id = p.assignment_id
    join public.campaigns c on c.id = a.campaign_id join public.profiles pr on pr.id = p.creator_id), '[]');
end $$;

create or replace function public.admin_audit(p_limit integer default 200) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'actor', pr.full_name, 'actor_role', l.actor_role, 'action', l.action,
      'table', l.table_name, 'record_id', l.record_id, 'old', l.old_status, 'new', l.new_status, 'reason', l.reason, 'at', l.created_at) order by l.created_at desc)
    from (select * from public.audit_logs order by created_at desc limit least(p_limit, 1000)) l
    left join public.profiles pr on pr.id = l.actor_id), '[]');
end $$;

-- Exportación CSV de pagos (para conciliación)
create or replace function public.admin_export_payments_csv() returns text
language plpgsql stable security definer set search_path = '' as $$
declare v text;
begin
  perform private.require_admin();
  perform private.audit('payments_exported', 'payments', null);
  select 'campaña,creador,concepto,monto,moneda,estado,autorizado,transferido,operacion' || chr(10) ||
         coalesce(string_agg(concat_ws(',', '"' || replace(c.name, '"', '""') || '"', '"' || replace(pr.full_name, '"', '""') || '"', p.concept, p.amount, p.currency, p.status,
           to_char(p.approved_at, 'YYYY-MM-DD'), to_char(p.transferred_at, 'YYYY-MM-DD'), coalesce(p.transfer_reference, '')), chr(10) order by p.created_at), '')
    into v
    from public.payments p join public.campaign_assignments a on a.id = p.assignment_id
    join public.campaigns c on c.id = a.campaign_id join public.profiles pr on pr.id = p.creator_id;
  return v;
end $$;

-- ---------- Permisos de ejecución (de nuevo, para las funciones de este archivo) ----------
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
