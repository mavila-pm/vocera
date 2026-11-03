// "Mis campañas" (listado) y detalle de una participación.
// La misma pantalla sirve al creador y al admin: cada pestaña muestra las
// acciones del rol. TODA regla se valida en el servidor (RPC); la interfaz
// solo evita ofrecer botones que el servidor rechazaría.
import { html, useState } from '../../vendor/preact.js';
import { rpc } from '../lib/sb.js';
import { href, query, navigate } from '../lib/router.js';
import { ASSIGNMENT_STATUS, CONTRACT_STATUS, SHIPMENT_STATUS, SCRIPT_STATUS, DELIVERABLE_STATUS, PUBLICATION_STATUS, AD_STATUS,
  PAYMENT_STATUS, PLATFORMS, ADMIN_TONE, ADMIN_LABEL, money, date, dateTime, relDays, mask, bytes, label } from '../lib/format.js';
import { Badge, Button, Empty, Loading, ErrorBox, Icon, Field, Input, Select, Textarea, FileDrop, FileLink, VideoPreview, Modal,
  Confirm, toast, useAction, ask } from '../ui/kit.js';
import { useLoad, CampaignRows } from './home.js';

export const ORDER = Object.keys(ASSIGNMENT_STATUS);
const idx = s => ORDER.indexOf(s);
const CLOSED = ['declined', 'rejected', 'cancelled', 'expired', 'suspended'];
const between = (s, a, b) => idx(s) >= idx(a) && idx(s) <= idx(b);

// ===================== Listado =====================
const GROUPS = [['invitations', 'Invitaciones'], ['active', 'Activas'], ['review', 'En revisión'], ['finished', 'Finalizadas'], ['history', 'Historial']];
export function CampaignList() {
  const { data, error, reload } = useLoad(() => rpc('my_campaigns'));
  const [tab, setTab] = useState(query().get('f') || 'active');
  if (error) return html`<${ErrorBox} message=${error} retry=${reload} />`;
  if (!data) return html`<${Loading} rows=${4} />`;
  const items = data.filter(c => c.group === tab);
  const EMPTY = {
    invitations: ['No tienes invitaciones pendientes', 'Cuando Vocera te proponga una campaña, podrás revisar el brief y responder desde aquí.'],
    active: ['No tienes campañas activas', 'Las campañas que aceptes aparecerán aquí con su próxima acción.'],
    review: ['Nada en revisión', 'Aquí verás lo que entregaste y está esperando la respuesta de Vocera.'],
    finished: ['Aún no completas campañas', 'Cuando una campaña termine, la verás aquí con el estado de su pago.'],
    history: ['Sin historial', 'Aquí quedan las invitaciones rechazadas, vencidas o canceladas.']
  };
  return html`<div>
    <div class="page-head"><div><h1>Mis campañas</h1><p>Invitaciones, campañas en curso y su historial.</p></div></div>
    <div class="tabs" role="tablist">${GROUPS.map(([k, l]) => {
      const n = data.filter(c => c.group === k).length;
      return html`<button role="tab" aria-selected=${tab === k} onClick=${() => setTab(k)}>${l}${n ? ` (${n})` : ''}${k === 'invitations' && n ? html`<span class="pip" aria-hidden="true"></span>` : ''}</button>`;
    })}</div>
    ${items.length ? html`<${CampaignRows} items=${items} />` : html`<div class="panel"><${Empty} title=${EMPTY[tab][0]}>${EMPTY[tab][1]}</${Empty}></div>`}
  </div>`;
}

// ===================== Detalle =====================
export function CampaignDetail({ id, admin, session }) {
  const { data: b, error, reload } = useLoad(() => rpc('get_assignment_bundle', { p_id: id }), [id]);
  const [tab, setTab] = useState(query().get('tab') || 'resumen');
  if (error) return html`<${ErrorBox} message=${error} retry=${reload} />`;
  if (!b) return html`<${Loading} rows=${5} />`;
  const a = b.assignment; const c = b.campaign;
  const ctx = { b, a, c, admin, reload, uid: session.session.user.id, creatorId: a.creator_id };
  const reached = s => idx(a.status) >= idx(s) && !CLOSED.includes(a.status);
  const tabs = [
    ['resumen', 'Resumen', true],
    ['contrato', 'Contrato', c.requires_contract && (admin || reached('availability_confirmed'))],
    ['producto', 'Producto', c.requires_product && (admin || reached('availability_confirmed'))],
    ['guion', 'Guion', c.requires_script && (admin || reached('script_pending'))],
    ['entregas', 'Entregas', admin || reached('in_production')],
    ['publicacion', 'Publicación', c.requires_publication && (admin || reached('video_approved'))],
    ['codigos', 'Códigos', c.requires_ad_code && (admin || reached('video_approved'))],
    ['pago', 'Pago', !!a.accepted_at],
    ['gestion', 'Gestión', admin]
  ].filter(t => t[2]);
  const current = tabs.find(t => t[0] === tab) ? tab : 'resumen';
  const actionTab = b.next_action?.kind === 'action' ? b.next_action.tab : null;

  return html`<div>
    <a class="small" href=${href(admin ? '/admin/campanas/' + c.id : '/campanas')} style="display:inline-flex;gap:6px;align-items:center;margin-bottom:12px"><${Icon} name="back" size="16" />${admin ? 'Volver a la campaña' : 'Mis campañas'}</a>
    <div class="page-head">
      <div><h1>${c.name}</h1>
        <p>${admin ? html`<strong>${b.creator.full_name}</strong> · ` : ''}${b.brand || 'Marca confidencial'} · Honorario ${money(a.fee_amount, a.currency)}</p></div>
      <${Badge} map=${ASSIGNMENT_STATUS} value=${a.status} toneOverride=${admin ? ADMIN_TONE[a.status] : undefined} text=${admin ? ADMIN_LABEL[a.status] : undefined} />
    </div>
    ${CLOSED.includes(a.status) && html`<div class="notice error" style="margin-bottom:20px"><div><strong>${label(ASSIGNMENT_STATUS, a.status)}</strong>${a.closed_reason || ''}</div></div>`}
    ${b.next_action && !admin && html`<div class=${'notice' + (b.next_action.kind === 'action' ? '' : ' ok')} style="margin-bottom:20px">
      <div><strong>${b.next_action.kind === 'action' ? 'Tu próxima acción: ' : 'Estado: '}${b.next_action.label}</strong>
      ${b.next_action.kind === 'action' && b.next_action.tab !== current && html`<button class="link-btn" onClick=${() => b.next_action.href ? navigate(b.next_action.href) : setTab(b.next_action.tab)}>Ir ahora</button>`}</div></div>`}

    <div class="cols">
      <div style="min-width:0">
        <div class="tabs" role="tablist">${tabs.map(([k, l]) => html`<button role="tab" aria-selected=${current === k} onClick=${() => setTab(k)}>${l}${!admin && actionTab === k ? html`<span class="pip" aria-label="Acción pendiente"></span>` : ''}</button>`)}</div>
        <div role="tabpanel">
          ${current === 'resumen' && html`<${Summary} ...${ctx} />`}
          ${current === 'contrato' && html`<${Contracts} ...${ctx} />`}
          ${current === 'producto' && html`<${Products} ...${ctx} />`}
          ${current === 'guion' && html`<${Scripts} ...${ctx} />`}
          ${current === 'entregas' && html`<${Deliverables} ...${ctx} />`}
          ${current === 'publicacion' && html`<${Publications} ...${ctx} />`}
          ${current === 'codigos' && html`<${AdCodes} ...${ctx} />`}
          ${current === 'pago' && html`<${Payment} ...${ctx} />`}
          ${current === 'gestion' && html`<${Manage} ...${ctx} />`}
        </div>
      </div>
      <aside class="stack">
        <div class="panel panel-pad"><h2 style="margin-bottom:14px">Avance</h2><${Flow} a=${a} c=${c} /></div>
        <div class="panel panel-pad"><h2 style="margin-bottom:12px">Fechas clave</h2>
          <dl class="dl">
            ${a.status === 'invited' && html`<dt>Responder antes de</dt><dd>${dateTime(a.invite_expires_at)}</dd>`}
            ${a.script_due_on && c.requires_script && html`<dt>Guion</dt><dd>${date(a.script_due_on)}</dd>`}
            ${a.video_due_on && html`<dt>Video</dt><dd>${date(a.video_due_on)}</dd>`}
            ${a.publish_on && c.requires_publication && html`<dt>Publicación</dt><dd>${date(a.publish_on)}</dd>`}
            <dt>Campaña</dt><dd>${date(c.starts_on)}${c.ends_on ? ' al ' + date(c.ends_on) : ''}</dd>
          </dl></div>
      </aside>
    </div>
  </div>`;
}

// Etapas aplicables a la campaña (no todos los estados se muestran a la vez)
function Flow({ a, c }) {
  const stages = [
    ['Invitación', 'invited', 'invited', true],
    ['Contrato', 'availability_confirmed', 'contract_signed', c.requires_contract],
    ['Producto', 'product_pending', 'product_received', c.requires_product],
    ['Guion', 'script_pending', 'script_approved', c.requires_script],
    ['Producción', 'in_production', 'video_delivered', true],
    ['Revisión del video', 'video_in_review', 'video_approved', true],
    ['Publicación', 'publication_scheduled', 'publication_confirmed', c.requires_publication],
    ['Códigos publicitarios', 'ad_codes_pending', 'ad_codes_pending', c.requires_ad_code],
    ['Validación final', 'final_validation', 'final_validation', true],
    ['Pago', 'payment_pending_authorization', 'payment_confirmed', true]
  ].filter(s => s[3]);
  const closed = CLOSED.includes(a.status);
  return html`<ol class="flow">${stages.map(([l, from, to]) => {
    const st = closed ? 'todo' : a.status === 'payment_confirmed' && to === 'payment_confirmed' ? 'done' : idx(a.status) > idx(to) ? 'done' : between(a.status, from, to) ? 'current' : 'todo';
    return html`<li data-state=${st}><span class="mk">${st === 'done' && html`<${Icon} name="check" />`}</span><span class="lb">${l}</span></li>`;
  })}</ol>`;
}

const Text = ({ v }) => v ? v : html`<span class="muted">-</span>`;

function Summary({ b, a, c, admin, reload }) {
  const br = b.brief || {};
  const [busy, run] = useAction();
  const [decline, setDecline] = useState(false);
  const [reason, setReason] = useState('');
  const respond = accept => run(async () => { await rpc('respond_invitation', { p_id: a.id, p_accept: accept, p_reason: accept ? null : reason || null }); setDecline(false); await reload(); },
    { success: accept ? '¡Listo! Confirmaste tu disponibilidad.' : 'Respondimos a Vocera que no participarás.' });
  return html`<div class="stack" style="--stack:20px">
    ${!admin && a.status === 'invited' && html`<div class="panel panel-pad">
      <h2>¿Tienes disponibilidad para esta campaña?</h2>
      <p class="muted" style="margin:6px 0 16px">Revisa el brief y las condiciones antes de responder. La invitación vence ${relDays(a.invite_expires_at)} (${dateTime(a.invite_expires_at)}).</p>
      <div class="row"><${Button} variant="primary" loading=${busy} onClick=${() => respond(true)}>Confirmar disponibilidad</${Button}><${Button} onClick=${() => setDecline(true)}>No puedo participar</${Button}></div>
    </div>`}
    <div class="panel"><div class="panel-head"><h2>Campaña</h2></div><div class="panel-pad"><dl class="dl">
      <dt>Objetivo</dt><dd><${Text} v=${c.objective} /></dd>
      <dt>Descripción</dt><dd><${Text} v=${c.description} /></dd>
      <dt>Plataformas</dt><dd>${(c.platforms || []).map(p => PLATFORMS[p]).join(', ') || '-'}</dd>
    </dl></div></div>
    <div class="panel"><div class="panel-head"><h2>Brief</h2></div><div class="panel-pad"><dl class="dl">
      <dt>Brief completo</dt><dd><${Text} v=${br.brief} /></dd>
      <dt>Formatos exigidos</dt><dd><${Text} v=${br.formats} /></dd>
      <dt>Duración del contenido</dt><dd><${Text} v=${br.content_duration} /></dd>
      <dt>Requisitos técnicos</dt><dd><${Text} v=${br.technical_requirements} /></dd>
      <dt>Mensajes obligatorios</dt><dd><${Text} v=${br.mandatory_messages} /></dd>
      <dt>Palabras o afirmaciones prohibidas</dt><dd><${Text} v=${br.forbidden_claims} /></dd>
      <dt>Entregables solicitados</dt><dd><${Text} v=${br.deliverables_summary} /></dd>
      <dt>Rondas de corrección</dt><dd>Hasta ${c.max_revision_rounds} por entregable</dd>
    </dl></div></div>
    <div class="panel"><div class="panel-head"><h2>Condiciones comerciales</h2></div><div class="panel-pad"><dl class="dl">
      <dt>Honorario acordado</dt><dd class="num"><strong>${money(a.fee_amount, a.currency)}</strong></dd>
      <dt>Condiciones de pago</dt><dd><${Text} v=${c.payment_terms} /></dd>
      <dt>Derechos de uso</dt><dd><${Text} v=${c.usage_rights} /></dd>
      <dt>Vigencia de autorizaciones publicitarias</dt><dd>${c.ad_authorization_days ? c.ad_authorization_days + ' días' : '-'}</dd>
      <dt>Requisitos de la campaña</dt><dd>${[c.requires_contract && 'Contrato', c.requires_product && 'Envío de producto', c.requires_script && 'Guion previo',
        c.requires_publication && 'Publicación en tus redes', c.requires_ad_code && 'Código publicitario'].filter(Boolean).join(' · ')}</dd>
    </dl></div></div>
    <${Modal} open=${decline} title="No puedo participar" onClose=${() => setDecline(false)} footer=${html`
      <${Button} onClick=${() => setDecline(false)}>Volver</${Button}><${Button} variant="dark" loading=${busy} onClick=${() => respond(false)}>Enviar respuesta</${Button}>`}>
      <${Field} label="¿Quieres contarnos el motivo?" optional hint="Nos ayuda a proponerte mejores campañas."><${Textarea} rows="3" value=${reason} onInput=${e => setReason(e.target.value)} /></${Field}>
    </${Modal}>
  </div>`;
}

// ---------- Contrato ----------
function Contracts({ b, a, admin, reload, creatorId }) {
  const [busy, run] = useAction();
  const [form, setForm] = useState(null);
  const [sign, setSign] = useState(null);
  const active = b.contracts.find(k => k.status === 'sent' || k.status === 'signed');
  const canCreate = admin && between(a.status, 'availability_confirmed', 'contract_pending') && !active;
  return html`<div class="stack" style="--stack:20px">
    ${!admin && html`<div class="notice"><div><strong>Cómo se firma</strong>Lee el contrato y descárgalo. Vocera te indicará el medio de firma; el contrato solo figura como firmado cuando Vocera registra la evidencia de la firma (documento firmado o constancia del proveedor de firma electrónica).</div></div>`}
    ${b.contracts.length === 0 && html`<div class="panel"><${Empty} title=${admin ? 'Sin contrato' : 'Vocera está preparando tu contrato'}>${admin ? 'Emite el contrato cuando el creador confirme su disponibilidad.' : 'Te avisaremos cuando esté listo para revisar.'}</${Empty}></div>`}
    ${b.contracts.map(k => html`<div class="panel">
      <div class="panel-head"><div><h2>${k.title}</h2><span class="small muted">Versión ${k.version}${k.sign_by ? ' · Firmar antes del ' + date(k.sign_by) : ''}</span></div><${Badge} map=${CONTRACT_STATUS} value=${k.status} /></div>
      <div class="panel-pad stack">
        <dl class="dl"><dt>Vigencia</dt><dd>${date(k.starts_on)} al ${date(k.ends_on)}</dd>
          ${k.terms && html`<dt>Condiciones</dt><dd>${k.terms}</dd>`}
          <dt>Leído por el creador</dt><dd>${k.acknowledged_at ? dateTime(k.acknowledged_at) : 'Aún no'}</dd>
          ${k.signature && html`<dt>Firma registrada</dt><dd>${date(k.signature.signed_on)} · ${k.signature.method === 'esign_provider' ? 'Proveedor de firma electrónica' : 'Documento firmado'}
            ${k.signature.evidence_path && html` · <${FileLink} bucket="documents" path=${k.signature.evidence_path} download>Descargar versión firmada</${FileLink}>`}</dd>`}
        </dl>
        <div class="row">
          ${k.document_path && html`<${FileLink} bucket="documents" path=${k.document_path} download>Descargar contrato (PDF)</${FileLink}>`}
          ${!admin && k.status === 'sent' && !k.acknowledged_at && html`<${Button} loading=${busy} onClick=${() => run(async () => { await rpc('acknowledge_contract', { p_contract: k.id, p_user_agent: navigator.userAgent }); await reload(); }, { success: 'Registramos que leíste el contrato.' })}>Confirmar que lo leí</${Button}>`}
          ${admin && k.status === 'sent' && html`<${Button} variant="primary" onClick=${() => setSign({ contract: k.id, method: 'signed_document_upload', signed_on: new Date().toISOString().slice(0, 10) })}>Registrar firma</${Button}>`}
          ${admin && k.status !== 'void' && html`<${Button} variant="danger" size="sm" onClick=${async () => { const r = await ask('Motivo de la anulación', { title: 'Anular contrato', confirmLabel: 'Anular contrato' }); if (r) run(async () => { await rpc('admin_void_contract', { p_contract: k.id, p_reason: r }); await reload(); }, { success: 'Contrato anulado.' }); }}>Anular</${Button}>`}
        </div>
      </div></div>`)}
    ${canCreate && (form ? html`<div class="panel panel-pad form">
        <h2>Emitir contrato</h2>
        <div class="form-grid">
          <${Field} full label="Título"><${Input} value=${form.title} onInput=${e => setForm({ ...form, title: e.target.value })} /></${Field}>
          <${Field} label="Inicio"><${Input} type="date" value=${form.starts} onInput=${e => setForm({ ...form, starts: e.target.value })} /></${Field}>
          <${Field} label="Fin"><${Input} type="date" value=${form.ends} onInput=${e => setForm({ ...form, ends: e.target.value })} /></${Field}>
          <${Field} label="Firmar antes del"><${Input} type="date" value=${form.sign_by} onInput=${e => setForm({ ...form, sign_by: e.target.value })} /></${Field}>
          <${Field} full label="Resumen de condiciones" hint="Texto legible en el portal. El documento PDF es la versión que se firma."><${Textarea} rows="5" value=${form.terms} onInput=${e => setForm({ ...form, terms: e.target.value })} /></${Field}>
          <div class="field full"><span class="label">Documento del contrato (PDF)</span>
            ${form.path ? html`<p class="small">Documento cargado.</p>` : html`<${FileDrop} kind="document" ownerId=${creatorId} folder="contratos" onUploaded=${f => setForm(x => ({ ...x, path: f.path }))} />`}</div>
        </div>
        <div class="row"><${Button} variant="primary" loading=${busy} onClick=${() => run(async () => {
          await rpc('admin_create_contract', { p_id: a.id, p_title: form.title, p_terms: form.terms || null, p_document_path: form.path || null, p_starts: form.starts || null, p_ends: form.ends || null, p_sign_by: form.sign_by || null });
          setForm(null); await reload(); }, { success: 'Contrato enviado al creador.' })}>Enviar contrato</${Button}><${Button} variant="ghost" onClick=${() => setForm(null)}>Cancelar</${Button}></div>
      </div>` : html`<div><${Button} variant="primary" onClick=${() => setForm({ title: 'Contrato de colaboración', terms: '', starts: '', ends: '', sign_by: '' })}><${Icon} name="plus" size="18" />Emitir contrato</${Button}></div>`)}
    <${Modal} open=${!!sign} title="Registrar firma del contrato" onClose=${() => setSign(null)} footer=${html`
      <${Button} onClick=${() => setSign(null)}>Cancelar</${Button}>
      <${Button} variant="primary" loading=${busy} onClick=${() => run(async () => {
        await rpc('admin_record_contract_signature', { p_contract: sign.contract, p_method: sign.method, p_evidence_path: sign.path || null,
          p_provider_event: sign.method === 'esign_provider' && sign.provider_ref ? { reference: sign.provider_ref, recorded_manually: true } : null, p_signed_on: sign.signed_on });
        setSign(null); await reload(); }, { success: 'Firma registrada con su evidencia.' })}>Registrar firma</${Button}>`}>
      ${sign && html`<div class="form">
        <div class="notice warn"><div>Solo registra la firma si tienes evidencia válida. El contrato quedará como firmado y se desbloqueará la siguiente etapa.</div></div>
        <${Field} label="Medio de firma"><${Select} value=${sign.method} onChange=${e => setSign({ ...sign, method: e.target.value })}
          options=${[['signed_document_upload', 'Documento firmado (subir copia)'], ['esign_provider', 'Proveedor de firma electrónica']]} /></${Field}>
        ${sign.method === 'signed_document_upload' ? (sign.path ? html`<p class="small">Evidencia cargada.</p>`
          : html`<${FileDrop} kind="document" ownerId=${creatorId} folder="contratos" label="Sube el contrato firmado" onUploaded=${f => setSign(x => ({ ...x, path: f.path }))} />`)
          : html`<${Field} label="Identificador de la constancia del proveedor" hint="El registro automático por integración con el proveedor está pendiente; este campo deja constancia manual."><${Input} value=${sign.provider_ref || ''} onInput=${e => setSign({ ...sign, provider_ref: e.target.value })} /></${Field}>`}
        <${Field} label="Fecha de firma"><${Input} type="date" value=${sign.signed_on} max=${new Date().toISOString().slice(0, 10)} onInput=${e => setSign({ ...sign, signed_on: e.target.value })} /></${Field}>
      </div>`}
    </${Modal}>
  </div>`;
}

// ---------- Producto ----------
function Products({ b, a, admin, reload, uid, creatorId }) {
  const [busy, run] = useAction();
  const [receipt, setReceipt] = useState(null);
  const [issue, setIssue] = useState(null);
  const [form, setForm] = useState(null);
  return html`<div class="stack" style="--stack:20px">
    ${b.shipments.length === 0 && html`<div class="panel"><${Empty} title=${admin ? 'Sin envíos registrados' : 'Vocera coordinará el envío'}>${admin ? 'Registra el envío del producto para que el creador confirme la recepción.' : 'Cuando el producto salga, verás aquí el seguimiento.'}</${Empty}></div>`}
    ${b.shipments.map(s => html`<div class="panel">
      <div class="panel-head"><h2>${s.product_name}</h2><${Badge} map=${SHIPMENT_STATUS} value=${s.status} /></div>
      <div class="panel-pad stack">
        <dl class="dl"><dt>Descripción</dt><dd><${Text} v=${s.description} /></dd><dt>Cantidad</dt><dd>${s.quantity}</dd>
          ${s.declared_value !== null && html`<dt>Valor declarado</dt><dd>${money(s.declared_value, s.currency || a.currency)}</dd>`}
          <dt>Empresa</dt><dd><${Text} v=${s.sender_company} /></dd><dt>Courier</dt><dd><${Text} v=${s.carrier} /></dd>
          <dt>Seguimiento</dt><dd class="mono"><${Text} v=${s.tracking_number} /></dd><dt>Entrega prevista</dt><dd>${date(s.expected_on)}</dd>
          ${s.receipt && html`<dt>Recibido el</dt><dd>${date(s.receipt.received_on)}${s.receipt.photo_path ? html` · <${FileLink} bucket="documents" path=${s.receipt.photo_path}>Ver foto</${FileLink}>` : ''}</dd>`}
          ${s.obligations && html`<dt>${s.receipt ? 'Obligaciones aceptadas' : 'Obligaciones al recibir'}</dt><dd>${s.obligations}</dd>`}
        </dl>
        ${s.issues.length > 0 && html`<div><strong class="small">Incidencias</strong>${s.issues.map(i => html`<div class="notice ${i.status === 'open' ? 'warn' : 'ok'}" style="margin-top:8px"><div>
          <strong>${i.status === 'open' ? 'Abierta' : 'Resuelta'} · ${dateTime(i.created_at)}</strong>${i.description}${i.resolution ? html`<br/><em>Resolución: ${i.resolution}</em>` : ''}
          ${admin && i.status === 'open' && html`<div style="margin-top:8px"><${Button} size="sm" onClick=${async () => { const r = await ask('Resolución'); if (r) run(async () => { await rpc('admin_resolve_shipment_issue', { p_issue: i.id, p_resolution: r }); await reload(); }, { success: 'Incidencia resuelta.' }); }}>Marcar resuelta</${Button}></div>`}
        </div></div>`)}</div>`}
        <div class="row">
          ${!admin && s.status !== 'received' && html`<${Button} variant="primary" onClick=${() => setReceipt({ shipment: s.id, date: new Date().toISOString().slice(0, 10) })}>Confirmar recepción</${Button}>`}
          ${!admin && html`<${Button} onClick=${() => setIssue({ shipment: s.id, text: '' })}>Reportar un problema</${Button}>`}
          ${admin && s.status !== 'received' && html`<${Button} size="sm" onClick=${async () => { const t = await ask('Número de seguimiento', { type: 'text', optional: true, defaultValue: s.tracking_number || '', title: 'Actualizar envío' }); if (t !== null) run(async () => {
            await rpc('admin_update_shipment', { p_shipment: s.id, p_status: t ? 'shipped' : s.status, p_carrier: s.carrier, p_tracking: t || null, p_expected: s.expected_on }); await reload(); }, { success: 'Envío actualizado.' }); }}>Actualizar seguimiento</${Button}>`}
        </div>
      </div></div>`)}
    ${admin && between(a.status, 'availability_confirmed', 'product_pending') && (form ? html`<div class="panel panel-pad form"><h2>Registrar envío</h2>
      <div class="form-grid">
        <${Field} label="Producto"><${Input} value=${form.product} onInput=${e => setForm({ ...form, product: e.target.value })} /></${Field}>
        <${Field} label="Cantidad"><${Input} type="number" min="1" value=${form.qty} onInput=${e => setForm({ ...form, qty: e.target.value })} /></${Field}>
        <${Field} full label="Descripción" optional><${Input} value=${form.desc} onInput=${e => setForm({ ...form, desc: e.target.value })} /></${Field}>
        <${Field} label="Valor declarado" optional><${Input} type="number" min="0" step="0.01" value=${form.value} onInput=${e => setForm({ ...form, value: e.target.value })} /></${Field}>
        <${Field} label="Empresa que envía" optional><${Input} value=${form.company} onInput=${e => setForm({ ...form, company: e.target.value })} /></${Field}>
        <${Field} label="Courier" optional><${Input} value=${form.carrier} onInput=${e => setForm({ ...form, carrier: e.target.value })} /></${Field}>
        <${Field} label="N.º de seguimiento" optional><${Input} value=${form.tracking} onInput=${e => setForm({ ...form, tracking: e.target.value })} /></${Field}>
        <${Field} label="Entrega prevista" optional><${Input} type="date" value=${form.expected} onInput=${e => setForm({ ...form, expected: e.target.value })} /></${Field}>
        <${Field} full label="Obligaciones al recibir" hint="Según el contrato (por ejemplo, si el producto se devuelve o queda con el creador)."><${Textarea} rows="3" value=${form.obligations} onInput=${e => setForm({ ...form, obligations: e.target.value })} /></${Field}>
      </div>
      <div class="row"><${Button} variant="primary" loading=${busy} onClick=${() => run(async () => {
        await rpc('admin_create_shipment', { p_id: a.id, p_product: form.product, p_description: form.desc || null, p_quantity: Number(form.qty || 1), p_value: form.value ? Number(form.value) : null,
          p_currency: a.currency, p_company: form.company || null, p_carrier: form.carrier || null, p_tracking: form.tracking || null, p_expected: form.expected || null, p_obligations: form.obligations || null });
        setForm(null); await reload(); }, { success: 'Envío registrado.' })}>Registrar envío</${Button}><${Button} variant="ghost" onClick=${() => setForm(null)}>Cancelar</${Button}></div></div>`
      : html`<div><${Button} variant="primary" onClick=${() => setForm({ product: '', qty: 1, desc: '', value: '', company: b.brand || '', carrier: '', tracking: '', expected: '', obligations: '' })}><${Icon} name="plus" size="18" />Registrar envío</${Button}></div>`)}
    <${Modal} open=${!!receipt} title="Confirmar recepción" onClose=${() => setReceipt(null)} footer=${html`<${Button} onClick=${() => setReceipt(null)}>Cancelar</${Button}>
      <${Button} variant="primary" loading=${busy} onClick=${() => run(async () => { await rpc('confirm_product_receipt', { p_shipment: receipt.shipment, p_received_on: receipt.date, p_photo_path: receipt.photo || null }); setReceipt(null); await reload(); }, { success: 'Gracias, registramos la recepción.' })}>Confirmar</${Button}>`}>
      ${receipt && html`<div class="form">
        <${Field} label="¿Qué día lo recibiste?"><${Input} type="date" max=${new Date().toISOString().slice(0, 10)} value=${receipt.date} onInput=${e => setReceipt({ ...receipt, date: e.target.value })} /></${Field}>
        ${receipt.photo ? html`<p class="small">Foto cargada.</p>` : html`<${FileDrop} kind="image" ownerId=${uid} folder="productos" label="Foto del producto recibido (opcional)" onUploaded=${f => setReceipt(x => ({ ...x, photo: f.path }))} />`}
        <p class="small muted">Al confirmar, aceptas las obligaciones indicadas para este producto. Vocera no cobra el producto de forma automática.</p>
      </div>`}
    </${Modal}>
    <${Modal} open=${!!issue} title="Reportar un problema con el producto" onClose=${() => setIssue(null)} footer=${html`<${Button} onClick=${() => setIssue(null)}>Cancelar</${Button}>
      <${Button} variant="primary" loading=${busy} onClick=${() => run(async () => { await rpc('report_shipment_issue', { p_shipment: issue.shipment, p_description: issue.text }); setIssue(null); await reload(); }, { success: 'Reportamos el problema a Vocera.' })}>Enviar reporte</${Button}>`}>
      ${issue && html`<${Field} label="¿Qué pasó?" hint="Por ejemplo: llegó dañado, incompleto o no llegó."><${Textarea} rows="4" value=${issue.text} onInput=${e => setIssue({ ...issue, text: e.target.value })} /></${Field}>`}
    </${Modal}>
  </div>`;
}

// ---------- Guion ----------
function Scripts({ b, a, admin, reload, uid }) {
  const latest = b.scripts[0];
  const editable = !admin && a.status === 'script_pending';
  const draft = latest && latest.status === 'draft' ? latest : null;
  const [f, setF] = useState({ body: draft?.body || '', file: draft?.file_path || null, refs: (draft?.reference_links || []).join('\n'), sample: draft?.sample_path || null });
  const [busy, run] = useAction();
  const [review, setReview] = useState(null);
  const save = submit => run(async () => {
    const refs = f.refs.split(/\s+/).map(s => s.trim()).filter(Boolean);
    if (refs.some(r => !/^https?:\/\//i.test(r))) throw new Error('Las referencias deben ser enlaces que empiecen con https://');
    const sid = await rpc('save_script_draft', { p_id: a.id, p_body: f.body || null, p_file_path: f.file, p_references: refs, p_sample_path: f.sample });
    if (submit) await rpc('submit_script', { p_script: sid });
    await reload();
  }, { success: submit ? 'Enviamos tu guion a revisión.' : 'Borrador guardado.' });
  return html`<div class="stack" style="--stack:20px">
    ${a.script_exception_reason && html`<div class="notice warn"><div><strong>Producción autorizada sin guion aprobado</strong>${a.script_exception_reason}</div></div>`}
    ${editable && html`<div class="panel panel-pad form">
      <div><h2>${latest && latest.status === 'changes_requested' ? 'Ajusta tu guion' : 'Tu propuesta de guion'}</h2>
        <p class="muted small" style="margin-top:4px">Escríbelo aquí o sube un archivo. Guarda el borrador cuantas veces quieras; envíalo cuando esté listo.</p></div>
      ${latest && latest.status === 'changes_requested' && latest.reviews[0] && html`<div class="notice warn"><div><strong>Comentarios de Vocera</strong>${latest.reviews[0].comments}</div></div>`}
      <${Field} label="Guion"><${Textarea} rows="10" value=${f.body} onInput=${e => setF({ ...f, body: e.target.value })} maxlength="20000" placeholder="Escena por escena: qué dices, qué se ve y cuánto dura." /></${Field}>
      <div class="field"><span class="label">Archivo del guion <span class="opt">(opcional, PDF o DOCX)</span></span>
        ${f.file ? html`<p class="small">Archivo adjunto · <${FileLink} bucket="documents" path=${f.file} /> · <button class="link-btn" onClick=${() => setF({ ...f, file: null })}>Quitar</button></p>`
          : html`<${FileDrop} kind="document" ownerId=${uid} folder=${'guiones/' + a.id} onUploaded=${x => setF(s => ({ ...s, file: x.path }))} />`}</div>
      <${Field} label="Referencias" optional hint="Enlaces de inspiración, uno por línea."><${Textarea} rows="3" value=${f.refs} onInput=${e => setF({ ...f, refs: e.target.value })} /></${Field}>
      <div class="field"><span class="label">Muestra preliminar <span class="opt">(solo si Vocera la pidió)</span></span>
        ${f.sample ? html`<p class="small">Muestra cargada.</p>` : html`<${FileDrop} kind="video" ownerId=${uid} folder=${'muestras/' + a.id} onUploaded=${x => setF(s => ({ ...s, sample: x.path }))} />`}</div>
      <div class="row"><${Button} loading=${busy} onClick=${() => save(false)}>Guardar borrador</${Button}><${Button} variant="primary" loading=${busy} onClick=${() => save(true)}>Enviar a revisión</${Button}></div>
    </div>`}
    ${b.scripts.filter(s => s.status !== 'draft' || admin).length === 0 && !editable && html`<div class="panel"><${Empty} title="Aún no hay guiones">${admin ? 'El creador todavía no envía su propuesta.' : 'Podrás enviar tu guion cuando el contrato esté firmado.'}</${Empty}></div>`}
    ${b.scripts.filter(s => s.status !== 'draft' || admin).map(s => html`<div class="panel">
      <div class="panel-head"><div><h2>Versión ${s.version}</h2><span class="small muted">${s.submitted_at ? 'Enviada ' + dateTime(s.submitted_at) : 'Borrador'}</span></div><${Badge} map=${SCRIPT_STATUS} value=${s.status} /></div>
      <div class="panel-pad stack">
        ${s.body && html`<p style="white-space:pre-line">${s.body}</p>`}
        <div class="row">${s.file_path && html`<${FileLink} bucket="documents" path=${s.file_path} download>Descargar archivo</${FileLink}>`}
          ${(s.reference_links || []).map(r => html`<a href=${r} target="_blank" rel="noopener noreferrer" class="small">${r.replace(/^https?:\/\//, '').slice(0, 40)}</a>`)}</div>
        ${s.sample_path && html`<${VideoPreview} path=${s.sample_path} />`}
        ${s.reviews.map(r => html`<div class=${'notice ' + (r.decision === 'approved' ? 'ok' : 'warn')}><div><strong>${label(SCRIPT_STATUS, r.decision)} · ${dateTime(r.created_at)}</strong>${r.comments || ''}</div></div>`)}
        ${admin && ['submitted', 'in_review'].includes(s.status) && html`<div class="row">
          ${s.status === 'submitted' && html`<${Button} size="sm" onClick=${() => run(async () => { await rpc('admin_review_script', { p_script: s.id, p_decision: 'in_review' }); await reload(); })}>Marcar en revisión</${Button}>`}
          <${Button} variant="primary" onClick=${() => setReview({ id: s.id, decision: 'approved', comments: '' })}>Aprobar</${Button}>
          <${Button} onClick=${() => setReview({ id: s.id, decision: 'changes_requested', comments: '' })}>Solicitar cambios</${Button}>
          <${Button} variant="danger" onClick=${() => setReview({ id: s.id, decision: 'rejected', comments: '' })}>Rechazar</${Button}></div>`}
      </div></div>`)}
    ${admin && between(a.status, 'script_pending', 'script_in_review') && !a.script_exception_reason && html`<div><${Button} size="sm" variant="ghost" onClick=${async () => {
      const r = await ask('Motivo documentado', { minLength: 10, title: 'Producción sin guion aprobado', hint: 'Queda registrado en la auditoría.', confirmLabel: 'Autorizar excepción' });
      if (r) run(async () => { await rpc('admin_authorize_production_exception', { p_id: a.id, p_reason: r }); await reload(); }, { success: 'Excepción registrada.' }); }}>Autorizar producción sin guion (excepción)</${Button}></div>`}
    <${Modal} open=${!!review} title=${review && label(SCRIPT_STATUS, review.decision)} onClose=${() => setReview(null)} footer=${html`<${Button} onClick=${() => setReview(null)}>Cancelar</${Button}>
      <${Button} variant="primary" loading=${busy} onClick=${() => run(async () => { await rpc('admin_review_script', { p_script: review.id, p_decision: review.decision, p_comments: review.comments || null }); setReview(null); await reload(); }, { success: 'Revisión registrada.' })}>Confirmar</${Button}>`}>
      ${review && html`<${Field} label="Comentarios para el creador" optional=${review.decision === 'approved'} hint=${review.decision === 'approved' ? '' : 'Sé específico: qué cambiar y por qué.'}>
        <${Textarea} rows="5" value=${review.comments} onInput=${e => setReview({ ...review, comments: e.target.value })} /></${Field}>`}
    </${Modal}>
  </div>`;
}

// ---------- Entregas y correcciones ----------
function Deliverables({ b, a, c, admin, reload, uid }) {
  const [busy, run] = useAction();
  const [review, setReview] = useState(null);
  const [form, setForm] = useState(null);
  const [preview, setPreview] = useState(null);
  const canUpload = !admin && between(a.status, 'in_production', 'video_approved');
  return html`<div class="stack" style="--stack:20px">
    ${b.deliverables.length === 0 && html`<div class="panel"><${Empty} title="Sin entregables definidos">${admin ? 'Define qué debe entregar el creador.' : 'Vocera definirá los entregables de esta campaña.'}</${Empty}></div>`}
    ${b.deliverables.map(d => {
      const rounds = d.revisions.length; const open = d.revisions.find(r => !r.resolved_at);
      return html`<div class="panel">
      <div class="panel-head"><div><h2>${d.title}</h2><span class="small muted">${d.kind === 'video' ? 'Video' : 'Documento'}${d.due_on ? ' · Entrega ' + date(d.due_on) + ' (' + relDays(d.due_on) + ')' : ''} · Correcciones ${rounds}/${c.max_revision_rounds}</span></div>
        <${Badge} map=${DELIVERABLE_STATUS} value=${d.status} /></div>
      <div class="panel-pad stack">
        ${d.specs && html`<p class="muted small" style="white-space:pre-line">${d.specs}</p>`}
        ${open && html`<div class="notice warn"><div><strong>Corrección ${open.round} de ${open.max_rounds}: ${open.reason}</strong>${open.comments || ''}<br/><span class="small">Solicitada ${dateTime(open.requested_at)}${open.creator_fault ? '' : ' · Ajuste solicitado por el cliente'}</span></div></div>`}
        ${canUpload && ['pending', 'revisions_requested'].includes(d.status) && html`<${FileDrop} kind=${d.kind === 'document' ? 'document' : 'video'} ownerId=${uid} folder=${'entregas/' + a.id + '/' + d.id}
          label=${d.status === 'revisions_requested' ? 'Sube la versión corregida' : 'Arrastra tu ' + (d.kind === 'document' ? 'documento' : 'video') + ' aquí o selecciónalo'}
          onUploaded=${f => run(async () => { await rpc('submit_deliverable_version', { p_deliverable: d.id, p_file_path: f.path, p_file_name: f.name, p_mime: f.mime, p_size: f.size }); await reload(); }, { success: 'Entrega registrada. Vocera la revisará.' })} />`}
        ${d.versions.length > 0 && html`<div class="table-wrap"><table class="table stackable"><thead><tr><th>Versión</th><th>Archivo</th><th>Entregada</th><th></th></tr></thead><tbody>
          ${d.versions.map(v => html`<tr><td data-l="Versión">v${v.version}</td><td data-l="Archivo">${v.file_name}<br/><span class="small muted">${bytes(v.size_bytes)}</span></td>
            <td data-l="Entregada">${dateTime(v.submitted_at)}</td>
            <td class="r">${v.mime_type.startsWith('video/') ? html`<${Button} size="sm" onClick=${() => setPreview(v.file_path)}><${Icon} name="eye" size="16" />Ver</${Button}>`
              : html`<${FileLink} bucket="documents" path=${v.file_path} download>Descargar</${FileLink}>`}</td></tr>`)}
        </tbody></table></div>`}
        ${d.revisions.length > 0 && html`<details><summary class="small" style="cursor:pointer">Historial de correcciones (${d.revisions.length})</summary>
          <ul class="checklist" style="margin-top:8px">${d.revisions.map(r => html`<li><span class="mk ${r.resolved_at ? 'ok' : 'no'}">${r.resolved_at && html`<${Icon} name="check" />`}</span>
            <span><strong>Ronda ${r.round}/${r.max_rounds} · ${r.reason}</strong><br/><span class="small muted">${dateTime(r.requested_at)}${r.resolved_version ? ' · resuelta con v' + r.resolved_version : ''}${r.creator_fault ? '' : ' · ajuste del cliente'}</span>${r.comments ? html`<br/>${r.comments}` : ''}</span></li>`)}</ul></details>`}
        ${admin && ['submitted', 'in_review'].includes(d.status) && html`<div class="row">
          ${d.status === 'submitted' && html`<${Button} size="sm" onClick=${() => run(async () => { await rpc('admin_start_deliverable_review', { p_deliverable: d.id }); await reload(); })}>Marcar en revisión</${Button}>`}
          <${Button} variant="primary" loading=${busy} onClick=${() => run(async () => { await rpc('admin_review_deliverable', { p_deliverable: d.id, p_approve: true }); await reload(); }, { success: 'Entregable aprobado.' })}>Aprobar</${Button}>
          <${Button} onClick=${() => setReview({ id: d.id, reason: '', comments: '', fault: true, round: rounds + 1 })}>Solicitar corrección</${Button}></div>`}
      </div></div>`;
    })}
    ${admin && between(a.status, 'availability_confirmed', 'video_approved') && (form ? html`<div class="panel panel-pad form"><h2>Nuevo entregable</h2>
      <div class="form-grid">
        <${Field} label="Título"><${Input} value=${form.title} onInput=${e => setForm({ ...form, title: e.target.value })} placeholder="Video vertical 30 s" /></${Field}>
        <${Field} label="Tipo"><${Select} value=${form.kind} onChange=${e => setForm({ ...form, kind: e.target.value })} options=${[['video', 'Video'], ['document', 'Documento']]} /></${Field}>
        <${Field} label="Fecha de entrega" optional><${Input} type="date" value=${form.due} onInput=${e => setForm({ ...form, due: e.target.value })} /></${Field}>
        <${Field} full label="Especificaciones" optional><${Textarea} rows="3" value=${form.specs} onInput=${e => setForm({ ...form, specs: e.target.value })} placeholder="Formato 9:16, 1080p, subtítulos…" /></${Field}>
      </div>
      <div class="row"><${Button} variant="primary" loading=${busy} onClick=${() => run(async () => { await rpc('admin_create_deliverable', { p_id: a.id, p_kind: form.kind, p_title: form.title, p_specs: form.specs || null, p_required: true, p_due: form.due || null }); setForm(null); await reload(); }, { success: 'Entregable creado.' })}>Crear</${Button}>
        <${Button} variant="ghost" onClick=${() => setForm(null)}>Cancelar</${Button}></div></div>`
      : html`<div><${Button} onClick=${() => setForm({ title: '', kind: 'video', due: a.video_due_on || '', specs: '' })}><${Icon} name="plus" size="18" />Agregar entregable</${Button}></div>`)}
    <${Modal} open=${!!preview} title="Vista previa" onClose=${() => setPreview(null)} footer=${preview && html`<${FileLink} bucket="deliverables" path=${preview} download>Descargar</${FileLink}>`}>
      ${preview && html`<${VideoPreview} path=${preview} />`}
    </${Modal}>
    <${Modal} open=${!!review} title="Solicitar corrección" onClose=${() => setReview(null)} footer=${html`<${Button} onClick=${() => setReview(null)}>Cancelar</${Button}>
      <${Button} variant="primary" loading=${busy} onClick=${() => run(async () => { await rpc('admin_review_deliverable', { p_deliverable: review.id, p_approve: false, p_reason: review.reason, p_comments: review.comments || null, p_creator_fault: review.fault }); setReview(null); await reload(); }, { success: 'Corrección solicitada.' })}>Enviar</${Button}>`}>
      ${review && html`<div class="form">
        <p class="small muted">Ronda ${review.round} de ${c.max_revision_rounds} acordadas en el brief.</p>
        <${Field} label="Motivo"><${Input} value=${review.reason} onInput=${e => setReview({ ...review, reason: e.target.value })} placeholder="Ej. audio bajo en los primeros segundos" maxlength="300" /></${Field}>
        <${Field} label="Comentarios" optional><${Textarea} rows="4" value=${review.comments} onInput=${e => setReview({ ...review, comments: e.target.value })} /></${Field}>
        <label class="check"><input type="checkbox" checked=${!review.fault} onChange=${e => setReview({ ...review, fault: !e.target.checked })} />
          <span>Es un ajuste pedido por el cliente (no es un error del creador). No cuenta para el máximo de rondas y puede generar honorario adicional según contrato.</span></label>
      </div>`}
    </${Modal}>
  </div>`;
}

// ---------- Publicaciones ----------
function Publications({ b, a, admin, reload, uid }) {
  const [busy, run] = useAction();
  const [done, setDone] = useState(null);
  const [form, setForm] = useState(null);
  return html`<div class="stack" style="--stack:20px">
    ${b.publications.length === 0 && html`<div class="panel"><${Empty} title="Sin publicaciones programadas">${admin ? 'Programa la publicación cuando el video esté aprobado.' : 'Vocera te indicará la fecha, la hora y las instrucciones.'}</${Empty}></div>`}
    ${b.publications.map(p => html`<div class="panel">
      <div class="panel-head"><div><h2>${PLATFORMS[p.platform]}</h2><span class="small muted">${dateTime(p.scheduled_at)}</span></div><${Badge} map=${PUBLICATION_STATUS} value=${p.status} /></div>
      <div class="panel-pad stack">
        <dl class="dl"><dt>Instrucciones</dt><dd><${Text} v=${p.instructions} /></dd>
          ${p.public_url && html`<dt>Enlace público</dt><dd><a href=${p.public_url} target="_blank" rel="noopener noreferrer">${p.public_url}</a></dd>`}
          ${p.published_at && html`<dt>Publicada</dt><dd>${dateTime(p.published_at)}</dd>`}
          ${p.evidence_path && html`<dt>Evidencia</dt><dd><${FileLink} bucket="documents" path=${p.evidence_path} /></dd>`}
          ${p.issue_note && html`<dt>Observación</dt><dd class="err">${p.issue_note}</dd>`}</dl>
        <div class="row">
          ${!admin && ['scheduled', 'issue'].includes(p.status) && html`<${Button} variant="primary" onClick=${() => setDone({ id: p.id, url: '', evidence: null })}>Marcar como publicada</${Button}>
            <${Button} onClick=${async () => { const n = await ask('Describe el problema'); if (n) run(async () => { await rpc('report_publication_issue', { p_publication: p.id, p_note: n }); await reload(); }, { success: 'Reportamos el problema a Vocera.' }); }}>Reportar un problema</${Button}>`}
          ${admin && p.status === 'published' && html`<${Button} variant="primary" loading=${busy} onClick=${() => run(async () => { await rpc('admin_validate_publication', { p_publication: p.id, p_valid: true }); await reload(); }, { success: 'Publicación validada.' })}>Validar</${Button}>
            <${Button} onClick=${async () => { const n = await ask('¿Qué no cumple lo pactado?'); if (n) run(async () => { await rpc('admin_validate_publication', { p_publication: p.id, p_valid: false, p_note: n }); await reload(); }); }}>Observar</${Button}>`}
        </div></div></div>`)}
    ${admin && between(a.status, 'video_approved', 'publication_confirmed') && (form ? html`<div class="panel panel-pad form"><h2>Programar publicación</h2>
      <div class="form-grid">
        <${Field} label="Plataforma"><${Select} value=${form.platform} onChange=${e => setForm({ ...form, platform: e.target.value })} options=${(b.campaign.platforms.length ? b.campaign.platforms : Object.keys(PLATFORMS)).map(p => [p, PLATFORMS[p]])} /></${Field}>
        <${Field} label="Fecha y hora"><${Input} type="datetime-local" value=${form.at} onInput=${e => setForm({ ...form, at: e.target.value })} /></${Field}>
        <${Field} full label="Instrucciones"><${Textarea} rows="3" value=${form.instructions} onInput=${e => setForm({ ...form, instructions: e.target.value })} placeholder="Texto del post, hashtags, etiquetas, marca de publicidad…" /></${Field}>
      </div>
      <div class="row"><${Button} variant="primary" loading=${busy} onClick=${() => run(async () => { await rpc('admin_schedule_publication', { p_id: a.id, p_platform: form.platform, p_scheduled_at: new Date(form.at).toISOString(), p_instructions: form.instructions || null }); setForm(null); await reload(); }, { success: 'Publicación programada.' })}>Programar</${Button}>
        <${Button} variant="ghost" onClick=${() => setForm(null)}>Cancelar</${Button}></div></div>`
      : html`<div><${Button} onClick=${() => setForm({ platform: b.campaign.platforms[0] || 'tiktok', at: '', instructions: '' })}><${Icon} name="plus" size="18" />Programar publicación</${Button}></div>`)}
    <${Modal} open=${!!done} title="Registrar publicación" onClose=${() => setDone(null)} footer=${html`<${Button} onClick=${() => setDone(null)}>Cancelar</${Button}>
      <${Button} variant="primary" loading=${busy} onClick=${() => run(async () => { await rpc('mark_publication_done', { p_publication: done.id, p_url: done.url.trim(), p_evidence_path: done.evidence }); setDone(null); await reload(); }, { success: 'Publicación registrada. Vocera la validará.' })}>Confirmar</${Button}>`}>
      ${done && html`<div class="form">
        <${Field} label="Enlace público de la publicación"><${Input} type="url" value=${done.url} onInput=${e => setDone({ ...done, url: e.target.value })} placeholder="https://" /></${Field}>
        ${done.evidence ? html`<p class="small">Evidencia cargada.</p>` : html`<${FileDrop} kind="image" ownerId=${uid} folder="publicaciones" label="Captura como evidencia (opcional)" onUploaded=${f => setDone(x => ({ ...x, evidence: f.path }))} />`}
      </div>`}
    </${Modal}>
  </div>`;
}

// ---------- Códigos publicitarios (información restringida) ----------
function AdCodes({ b, a, c, admin, reload }) {
  const [busy, run] = useAction();
  const [form, setForm] = useState(null);
  const [shown, setShown] = useState({});
  const can = !admin && between(a.status, 'video_approved', 'payment_pending_authorization');
  return html`<div class="stack" style="--stack:20px">
    <div class="notice"><div><strong>Información restringida</strong>Los códigos solo los ven tú y el equipo de Vocera. ${c.ad_authorization_days ? `La autorización acordada es por ${c.ad_authorization_days} días.` : ''}${c.requires_ad_code ? ' El pago se libera cuando Vocera valida el código.' : ''}</div></div>
    ${b.ad_authorizations.length === 0 && !form && html`<div class="panel"><${Empty} title="Sin códigos registrados">${admin ? 'El creador aún no registra códigos.' : 'Cuando publiques, genera el código de autorización en la plataforma y regístralo aquí.'}</${Empty}></div>`}
    ${b.ad_authorizations.map(x => html`<div class="panel">
      <div class="panel-head"><h2>${PLATFORMS[x.platform]}</h2><${Badge} map=${AD_STATUS} value=${x.status} /></div>
      <div class="panel-pad stack"><dl class="dl">
        <dt>Código</dt><dd><span class="code-mask">${shown[x.id] ? x.auth_code : mask(x.auth_code)}</span> <button class="link-btn" onClick=${() => setShown({ ...shown, [x.id]: !shown[x.id] })}>${shown[x.id] ? 'Ocultar' : 'Mostrar'}</button></dd>
        ${x.content_url && html`<dt>Contenido</dt><dd><a href=${x.content_url} target="_blank" rel="noopener noreferrer">${x.content_url}</a></dd>`}
        <dt>Emisión</dt><dd>${date(x.issued_on)}</dd><dt>Vencimiento</dt><dd>${date(x.expires_on)}</dd>
        ${x.observations && html`<dt>Observaciones</dt><dd>${x.observations}</dd>`}</dl>
        <div class="row">
          ${can && html`<${Button} size="sm" onClick=${() => setForm({ ...x, code: x.auth_code })}>Actualizar</${Button}>`}
          ${admin && x.status === 'submitted' && html`<${Button} variant="primary" loading=${busy} onClick=${() => run(async () => { await rpc('admin_validate_ad_authorization', { p_id: x.id, p_valid: true }); await reload(); }, { success: 'Código validado.' })}>Validar</${Button}>
            <${Button} onClick=${async () => { const o = await ask('¿Por qué no es válido?'); if (o) run(async () => { await rpc('admin_validate_ad_authorization', { p_id: x.id, p_valid: false, p_observations: o }); await reload(); }); }}>No es válido</${Button}>`}
        </div></div></div>`)}
    ${can && !form && html`<div><${Button} variant="primary" onClick=${() => setForm({ id: null, platform: c.platforms[0] || 'tiktok', code: '', content_url: '', publication_id: b.publications[0]?.id || '', issued_on: new Date().toISOString().slice(0, 10), expires_on: '' })}><${Icon} name="plus" size="18" />Registrar código</${Button}></div>`}
    ${form && html`<div class="panel panel-pad form"><h2>${form.id ? 'Actualizar código' : 'Registrar código'}</h2>
      <div class="form-grid">
        <${Field} label="Plataforma"><${Select} value=${form.platform} onChange=${e => setForm({ ...form, platform: e.target.value })} options=${Object.entries(PLATFORMS)} /></${Field}>
        <${Field} label="Publicación relacionada" optional><${Select} placeholder="Ninguna" value=${form.publication_id || ''} onChange=${e => setForm({ ...form, publication_id: e.target.value })} options=${b.publications.map(p => [p.id, PLATFORMS[p.platform] + ' · ' + date(p.scheduled_at)])} /></${Field}>
        <${Field} full label="Código de autorización"><${Input} value=${form.code} onInput=${e => setForm({ ...form, code: e.target.value })} autocomplete="off" spellcheck="false" /></${Field}>
        <${Field} full label="URL del contenido" optional><${Input} type="url" value=${form.content_url || ''} onInput=${e => setForm({ ...form, content_url: e.target.value })} placeholder="https://" /></${Field}>
        <${Field} label="Fecha de emisión"><${Input} type="date" value=${form.issued_on || ''} onInput=${e => setForm({ ...form, issued_on: e.target.value })} /></${Field}>
        <${Field} label="Fecha de vencimiento" optional><${Input} type="date" value=${form.expires_on || ''} onInput=${e => setForm({ ...form, expires_on: e.target.value })} /></${Field}>
      </div>
      <div class="row"><${Button} variant="primary" loading=${busy} onClick=${() => run(async () => {
        await rpc('upsert_ad_authorization', { p_id: form.id, p_assignment: a.id, p_platform: form.platform, p_code: form.code, p_content_url: form.content_url || null,
          p_publication: form.publication_id || null, p_issued: form.issued_on || null, p_expires: form.expires_on || null, p_observations: null });
        setForm(null); await reload(); }, { success: 'Código enviado a validación.' })}>Guardar</${Button}><${Button} variant="ghost" onClick=${() => setForm(null)}>Cancelar</${Button}></div></div>`}
  </div>`;
}

// ---------- Pago ----------
export function Checklist({ checklist }) {
  if (!checklist) return null;
  return html`<ul class="checklist">${checklist.items.map(i => html`<li>
    <span class=${'mk ' + (!i.required ? 'na' : i.met ? 'ok' : 'no')}>${i.required && i.met && html`<${Icon} name="check" />`}</span>
    <span><span style=${{ color: i.required ? 'inherit' : 'var(--texto-3)' }}>${i.label}</span>${!i.required && html` <span class="small muted">(no aplica)</span>`}
      ${i.detail && html`<br/><span class="small muted">${i.detail}</span>`}</span></li>`)}</ul>`;
}

function Payment({ b, a, admin, reload, creatorId }) {
  const [busy, run] = useAction();
  const [auth, setAuth] = useState(null);
  const [transfer, setTransfer] = useState(null);
  const [reveal, setReveal] = useState(null);
  const fee = b.payments.find(p => p.concept === 'fee');
  const ready = b.checklist?.ready;
  return html`<div class="stack" style="--stack:20px">
    <div class="panel"><div class="panel-head"><h2>Condiciones para liberar el pago</h2>${ready ? html`<span class="badge tone-ok">Todo listo</span>` : html`<span class="badge tone-wait">Pendiente</span>`}</div>
      <div class="panel-pad"><${Checklist} checklist=${b.checklist} />
      <p class="small muted" style="margin-top:12px">El sistema verifica las condiciones; la autorización final la da una persona autorizada de Vocera.</p></div></div>
    <div class="panel"><div class="panel-head"><h2>Pagos de esta campaña</h2></div>
      <div class="table-wrap" style="border:0"><table class="table stackable"><thead><tr><th>Concepto</th><th class="r">Importe</th><th>Estado</th><th>Transferencia</th><th></th></tr></thead><tbody>
        ${b.payments.map(p => html`<tr><td data-l="Concepto">${p.concept === 'fee' ? 'Honorario' : 'Bonificación'}</td><td data-l="Importe" class="r num">${money(p.amount, p.currency)}</td>
          <td data-l="Estado"><${Badge} map=${PAYMENT_STATUS} value=${p.status} /></td>
          <td data-l="Transferencia">${p.transferred_at ? date(p.transferred_at) + (p.transfer_reference ? ' · Op. ' + p.transfer_reference : '') : p.scheduled_for ? 'Programado ' + date(p.scheduled_for) : '-'}</td>
          <td class="r">${p.receipt_path && html`<${FileLink} bucket="documents" path=${p.receipt_path} download>Comprobante</${FileLink}>`}
            ${!admin && p.status === 'transferred' && html` <${Button} size="sm" variant="primary" loading=${busy} onClick=${() => run(async () => { await rpc('confirm_payment_received', { p_payment: p.id }); await reload(); }, { success: '¡Gracias! Pago confirmado.' })}>Confirmar recepción</${Button}>`}
            ${!admin && ['transferred', 'scheduled', 'approved'].includes(p.status) && html` <button class="link-btn small" onClick=${async () => { const n = await ask('Describe la incidencia'); if (n) run(async () => { await rpc('report_payment_incident', { p_payment: p.id, p_note: n }); await reload(); }, { success: 'Reportamos la incidencia.' }); }}>Reportar incidencia</button>`}
            ${admin && ['approved', 'scheduled'].includes(p.status) && html`<${Button} size="sm" variant="primary" onClick=${() => setTransfer({ id: p.id, at: new Date().toISOString().slice(0, 16), ref: '', receipt: null })}>Registrar transferencia</${Button}>`}
          </td></tr>`)}
      </tbody></table></div></div>
    ${!admin && html`<p class="small muted">¿Tus datos de cobro? <a href=${href('/pagos/datos')}>Revísalos aquí</a>.</p>`}
    ${admin && html`<div class="panel panel-pad stack">
      <h2>Acciones de Vocera</h2>
      ${b.payout_method ? html`<p class="small">Cobro: ${b.payout_method.holder_name} · ${b.payout_method.bank_name} · cuenta terminada en <span class="mono">${b.payout_method.account_last4}</span> (${b.payout_method.currency})
        <button class="link-btn" onClick=${() => setReveal({ id: b.payout_method.id, reason: '', data: null })}>Ver datos completos</button></p>` : html`<p class="small err">El creador no registró datos de cobro.</p>`}
      <div class="row">
        ${a.status === 'final_validation' && html`<${Button} variant="primary" loading=${busy} onClick=${() => run(async () => { await rpc('admin_final_validate', { p_id: a.id }); await reload(); }, { success: 'Validación final registrada.' })}>Registrar validación final</${Button}>`}
        ${fee && ['requirements_pending', 'in_review', 'incident'].includes(fee.status) && html`<${Button} variant="primary" disabled=${!ready} onClick=${() => setAuth({ breach: false, note: '' })}>Autorizar pago</${Button}>`}
        ${fee && ['approved', 'scheduled'].includes(fee.status) && html`<${Button} onClick=${async () => { const d = await ask('Fecha programada del pago', { type: 'date', defaultValue: new Date().toISOString().slice(0, 10), title: 'Programar pago' }); if (d) run(async () => { await rpc('admin_schedule_payment', { p_payment: fee.id, p_date: d }); await reload(); }, { success: 'Pago programado.' }); }}>Programar</${Button}>`}
        ${b.checklist && b.checklist.items.find(i => i.key === 'on_time' && !i.met) && html`<${Button} size="sm" onClick=${async () => { const r = await ask('Motivo para aceptar la entrega fuera de plazo'); if (r) run(async () => { await rpc('admin_set_on_time_override', { p_id: a.id, p_reason: r }); await reload(); }); }}>Aceptar entrega fuera de plazo</${Button}>`}
        ${a.accepted_at && html`<${Button} size="sm" onClick=${async () => { const amt = await ask('Monto de la bonificación', { type: 'number', title: 'Proponer bonificación' }); const r = amt && await ask('Motivo de la bonificación', { title: 'Proponer bonificación', hint: 'El creador verá este motivo si la bonificación se aprueba.' }); if (amt && r) run(async () => { await rpc('admin_propose_bonus', { p_id: a.id, p_amount: Number(amt), p_reason: r }); await reload(); }, { success: 'Bonificación propuesta.' }); }}>Proponer bonificación</${Button}>`}
      </div>
      ${b.bonuses.filter(x => x.status === 'proposed').map(x => html`<div class="notice"><div><strong>Bonificación propuesta: ${money(x.amount, x.currency)}</strong>${x.reason}
        <div class="row" style="margin-top:8px"><${Button} size="sm" variant="primary" onClick=${() => run(async () => { await rpc('admin_decide_bonus', { p_bonus: x.id, p_approve: true }); await reload(); }, { success: 'Bonificación aprobada.' })}>Aprobar</${Button}>
          <${Button} size="sm" onClick=${() => run(async () => { await rpc('admin_decide_bonus', { p_bonus: x.id, p_approve: false }); await reload(); })}>Rechazar</${Button}></div></div></div>`)}
    </div>`}
    <${Modal} open=${!!auth} title="Autorizar pago" onClose=${() => setAuth(null)} footer=${html`<${Button} onClick=${() => setAuth(null)}>Cancelar</${Button}>
      <${Button} variant="primary" loading=${busy} disabled=${!auth?.breach} onClick=${() => run(async () => { await rpc('admin_authorize_payment', { p_id: a.id, p_no_breach_confirmed: auth.breach, p_note: auth.note || null }); setAuth(null); await reload(); }, { success: 'Pago autorizado.' })}>Autorizar ${fee && money(fee.amount, fee.currency)}</${Button}>`}>
      ${auth && html`<div class="form">
        <p>Autorizas el honorario de <strong>${b.creator.full_name}</strong> por <strong>${fee && money(fee.amount, fee.currency)}</strong>. Esto NO ejecuta la transferencia: la registrarás después con su comprobante.</p>
        <label class="check"><input type="checkbox" checked=${auth.breach} onChange=${e => setAuth({ ...auth, breach: e.target.checked })} />
          <span>Confirmo que no existen incumplimientos contractuales que impidan el pago.</span></label>
        <${Field} label="Nota interna" optional><${Textarea} rows="2" value=${auth.note} onInput=${e => setAuth({ ...auth, note: e.target.value })} /></${Field}>
      </div>`}
    </${Modal}>
    <${Modal} open=${!!transfer} title="Registrar transferencia" onClose=${() => setTransfer(null)} footer=${html`<${Button} onClick=${() => setTransfer(null)}>Cancelar</${Button}>
      <${Button} variant="primary" loading=${busy} onClick=${() => run(async () => { await rpc('admin_register_transfer', { p_payment: transfer.id, p_transferred_at: new Date(transfer.at).toISOString(), p_reference: transfer.ref, p_receipt_path: transfer.receipt }); setTransfer(null); await reload(); }, { success: 'Transferencia registrada.' })}>Registrar</${Button}>`}>
      ${transfer && html`<div class="form">
        <div class="notice warn"><div>Registra solo transferencias ya realizadas desde la banca de Vocera. Este portal no mueve dinero.</div></div>
        <${Field} label="Fecha y hora de la transferencia"><${Input} type="datetime-local" value=${transfer.at} onInput=${e => setTransfer({ ...transfer, at: e.target.value })} /></${Field}>
        <${Field} label="Número de operación"><${Input} value=${transfer.ref} onInput=${e => setTransfer({ ...transfer, ref: e.target.value })} /></${Field}>
        ${transfer.receipt ? html`<p class="small">Comprobante cargado.</p>` : html`<${FileDrop} kind="image" ownerId=${creatorId} folder="pagos" label="Sube el comprobante (PDF o imagen)" onUploaded=${f => setTransfer(x => ({ ...x, receipt: f.path }))} />`}
      </div>`}
    </${Modal}>
    <${Modal} open=${!!reveal} title="Datos de cobro completos" onClose=${() => setReveal(null)} footer=${reveal && !reveal.data && html`<${Button} onClick=${() => setReveal(null)}>Cancelar</${Button}>
      <${Button} variant="primary" loading=${busy} onClick=${() => run(async () => { const d = await rpc('admin_reveal_payout_method', { p_id: reveal.id, p_reason: reveal.reason }); setReveal(r => ({ ...r, data: d })); })}>Mostrar</${Button}>`}>
      ${reveal && (reveal.data ? html`<dl class="dl"><dt>Titular</dt><dd>${reveal.data.holder_name}</dd><dt>Banco</dt><dd>${reveal.data.bank_name}</dd><dt>Cuenta</dt><dd class="mono">${reveal.data.account_number}</dd>
          ${reveal.data.bank_identifier && html`<dt>Identificador bancario</dt><dd class="mono">${reveal.data.bank_identifier}</dd>`}<dt>Moneda</dt><dd>${reveal.data.currency}</dd></dl>
          <p class="small muted" style="margin-top:12px">Esta consulta quedó registrada en la auditoría.</p>`
        : html`<${Field} label="¿Para qué necesitas ver el número completo?" hint="Queda registrado en la auditoría."><${Input} value=${reveal.reason} onInput=${e => setReveal({ ...reveal, reason: e.target.value })} placeholder="Preparar la transferencia" /></${Field}>`)}
    </${Modal}>
  </div>`;
}

// ---------- Gestión (admin) ----------
function Manage({ b, a, c, reload }) {
  const [busy, run] = useAction();
  const [close, setClose] = useState(null);
  const [terms, setTerms] = useState(null);
  return html`<div class="stack" style="--stack:20px">
    <div class="panel panel-pad stack">
      <h2>Etapa actual: ${label(ASSIGNMENT_STATUS, a.status)}</h2>
      <div class="row">
        ${a.status === 'preselected' && c.requires_client_approval && html`<${Button} loading=${busy} onClick=${() => run(async () => { await rpc('admin_request_client_approval', { p_id: a.id }); await reload(); }, { success: 'Marcado como pendiente del cliente.' })}>Enviar a aprobación del cliente</${Button}>`}
        ${['preselected', 'pending_client_approval'].includes(a.status) && c.requires_client_approval && html`
          <${Button} variant="primary" onClick=${async () => { const n = await ask('¿Cómo aprobó el cliente?', { optional: true, title: 'Aprobación del cliente', hint: 'Por ejemplo: correo del 12/10 de la gerente de marca.', confirmLabel: 'Registrar aprobación' }); if (n !== null) run(async () => { await rpc('admin_record_client_approval', { p_id: a.id, p_approved: true, p_note: n || null }); await reload(); }, { success: 'Aprobación del cliente registrada.' }); }}>Registrar aprobación del cliente</${Button}>
          <${Button} onClick=${async () => { const n = await ask('Motivo del rechazo del cliente'); if (n) run(async () => { await rpc('admin_record_client_approval', { p_id: a.id, p_approved: false, p_note: n }); await reload(); }); }}>El cliente no lo aprobó</${Button}>`}
        ${(a.status === 'client_approved' || (a.status === 'preselected' && !c.requires_client_approval)) && html`<${Button} variant="primary" loading=${busy} onClick=${() => run(async () => { await rpc('admin_send_invitation', { p_id: a.id }); await reload(); }, { success: 'Invitación enviada.' })}>Enviar invitación</${Button}>`}
        ${!CLOSED.includes(a.status) && a.status !== 'payment_confirmed' && html`<${Button} size="sm" onClick=${() => setTerms({ fee: a.fee_amount, script: a.script_due_on || '', video: a.video_due_on || '', publish: a.publish_on || '' })}>Editar honorario y fechas</${Button}>
          <${Button} size="sm" variant="danger" onClick=${() => setClose({ status: 'cancelled', reason: '' })}>Cerrar participación</${Button}>`}
        ${['suspended', 'expired'].includes(a.status) && html`<${Button} size="sm" onClick=${async () => { const r = await ask('Motivo para reabrir'); if (r) run(async () => { await rpc('admin_reopen_assignment', { p_id: a.id, p_reason: r }); await reload(); }); }}>Reabrir</${Button}>`}
      </div>
      ${b.client_approvals.length > 0 && html`<div><strong class="small">Aprobaciones del cliente</strong>${b.client_approvals.map(x => html`<p class="small muted">${dateTime(x.created_at)} · ${x.approved ? 'Aprobado' : 'No aprobado'}${x.note ? ' · ' + x.note : ''}</p>`)}</div>`}
    </div>
    <div class="panel"><div class="panel-head"><h2>Trazabilidad</h2></div>
      ${b.audit.length ? html`<div class="table-wrap" style="border:0"><table class="table stackable"><thead><tr><th>Fecha</th><th>Acción</th><th>Cambio</th><th>Quién</th><th>Motivo</th></tr></thead><tbody>
        ${b.audit.map(l => html`<tr><td data-l="Fecha" class="nowrap">${dateTime(l.at)}</td><td data-l="Acción">${l.action.replace(/_/g, ' ')}</td>
          <td data-l="Cambio">${l.old || l.new ? html`${l.old ? label(ASSIGNMENT_STATUS, l.old) : '-'} → ${l.new ? label(ASSIGNMENT_STATUS, l.new) : '-'}` : ''}</td>
          <td data-l="Quién">${l.actor || 'Sistema'}</td><td data-l="Motivo">${l.reason || ''}</td></tr>`)}</tbody></table></div>` : html`<${Empty} title="Sin movimientos" />`}
    </div>
    <${Modal} open=${!!close} title="Cerrar participación" onClose=${() => setClose(null)} footer=${html`<${Button} onClick=${() => setClose(null)}>Cancelar</${Button}>
      <${Button} variant="dark" loading=${busy} onClick=${() => run(async () => { await rpc('admin_close_assignment', { p_id: a.id, p_status: close.status, p_reason: close.reason }); setClose(null); await reload(); }, { success: 'Participación cerrada.' })}>Cerrar</${Button}>`}>
      ${close && html`<div class="form">
        <${Field} label="Tipo de cierre"><${Select} value=${close.status} onChange=${e => setClose({ ...close, status: e.target.value })} options=${[['cancelled', 'Cancelada'], ['suspended', 'Suspendida'], ['rejected', 'Rechazada'], ['expired', 'Vencida']]} /></${Field}>
        <${Field} label="Motivo" hint="El creador verá este motivo."><${Textarea} rows="3" value=${close.reason} onInput=${e => setClose({ ...close, reason: e.target.value })} /></${Field}>
      </div>`}
    </${Modal}>
    <${Modal} open=${!!terms} title="Honorario y fechas" onClose=${() => setTerms(null)} footer=${html`<${Button} onClick=${() => setTerms(null)}>Cancelar</${Button}>
      <${Button} variant="primary" loading=${busy} onClick=${() => run(async () => { await rpc('admin_update_assignment_terms', { p_id: a.id, p_fee: Number(terms.fee), p_script_due: terms.script || null, p_video_due: terms.video || null, p_publish_on: terms.publish || null }); setTerms(null); await reload(); }, { success: 'Datos actualizados.' })}>Guardar</${Button}>`}>
      ${terms && html`<div class="form-grid">
        <${Field} full label=${'Honorario (' + a.currency + ')'} hint=${a.accepted_at ? 'Ya aceptado por el creador: solo cambia con una adenda.' : ''}><${Input} type="number" min="0" step="0.01" value=${terms.fee} disabled=${!!a.accepted_at} onInput=${e => setTerms({ ...terms, fee: e.target.value })} /></${Field}>
        <${Field} label="Entrega de guion"><${Input} type="date" value=${terms.script} onInput=${e => setTerms({ ...terms, script: e.target.value })} /></${Field}>
        <${Field} label="Entrega de video"><${Input} type="date" value=${terms.video} onInput=${e => setTerms({ ...terms, video: e.target.value })} /></${Field}>
        <${Field} label="Publicación"><${Input} type="date" value=${terms.publish} onInput=${e => setTerms({ ...terms, publish: e.target.value })} /></${Field}>
      </div>`}
    </${Modal}>
  </div>`;
}
