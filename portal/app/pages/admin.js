// Panel Vocera (rol admin). Todas las RPC admin_* validan el rol en el servidor.
import { html, useState } from '../../vendor/preact.js';
import { supabase, rpc, q, config } from '../lib/sb.js';
import { href, navigate } from '../lib/router.js';
import { ASSIGNMENT_STATUS, ADMIN_TONE, ADMIN_LABEL, PROFILE_STATUS, CAMPAIGN_STATUS, PAYMENT_STATUS, PLATFORMS, RATE_TYPES, AVAILABILITY,
  CATEGORIES, COUNTRIES, CURRENCIES, money, date, dateTime, compact, label } from '../lib/format.js';
import { Badge, Button, Empty, Loading, ErrorBox, Field, Input, Select, Textarea, ChipSelect, Avatar, Icon, FileLink, Modal, Progress, useAction, toast, ask } from '../ui/kit.js';
import { useLoad, Calendar } from './home.js';

// ===================== Resumen ejecutivo =====================
export function AdminHome() {
  const { data, error, reload } = useLoad(() => rpc('admin_overview'));
  if (error) return html`<${ErrorBox} message=${error} retry=${reload} />`;
  if (!data) return html`<${Loading} rows=${4} />`;
  const K = (v, l, to, attn) => html`<a class=${'kpi' + (attn && v > 0 ? ' attn' : '')} role="listitem" href=${href(to)}><span class="v">${v}</span><span class="l">${l}</span></a>`;
  const toDecide = data.profiles_in_review + data.pending_deliverables + data.pending_scripts + data.payments_to_authorize + data.incidents;
  return html`<div>
    <div class="page-head"><div><h1>Resumen</h1><p>${toDecide ? `Hay ${toDecide} decisiones esperando al equipo.` : 'No hay decisiones pendientes del equipo.'}</p></div>
      <a class="btn btn-primary" href=${href('/admin/campanas/nueva')}><${Icon} name="plus" size="18" />Nueva campaña</a></div>
    <p class="kpis-label">Por decidir</p>
    <div class="kpis cols-4" role="list" style="margin-bottom:20px">
      ${K(data.profiles_in_review, 'Perfiles por revisar', '/admin/creadores?status=in_review', true)}
      ${K(data.pending_deliverables + data.pending_scripts, 'Guiones y videos por revisar', '/admin', true)}
      ${K(data.payments_to_authorize, 'Pagos por autorizar', '/admin/pagos', true)}
      ${K(data.incidents, 'Incidencias abiertas', '/admin/pagos', true)}
    </div>
    <p class="kpis-label">Panorama</p>
    <div class="kpis cols-4" role="list">
      ${K(data.creators, 'Creadores registrados', '/admin/creadores')}
      ${K(data.active_campaigns, 'Campañas activas', '/admin/campanas')}
      ${K(data.contracts_to_sign, 'Contratos por firmar', '/admin/campanas')}
      ${K(data.payments_to_transfer, 'Transferencias pendientes', '/admin/pagos')}
    </div>
    <div class="cols section">
      <div><div class="section-head"><h2>Cola de trabajo</h2></div>
        ${data.queue.length ? html`<div class="list">${data.queue.map(x => html`<a class="list-row campaign-row" href=${href('/admin/asignaciones/' + x.assignment_id)}>
          <span><span class="t">${x.creator}</span><span class="s" style="display:block">${x.campaign}</span></span>
          <span><${Badge} map=${ASSIGNMENT_STATUS} value=${x.status} toneOverride=${ADMIN_TONE[x.status]} text=${ADMIN_LABEL[x.status]} /></span>
          <span class="c3 small muted">${dateTime(x.updated_at)}</span><span class="c3"></span></a>`)}</div>`
        : html`<div class="panel"><${Empty} title="Nada pendiente de revisión">Guiones, videos, publicaciones y pagos por decidir aparecerán aquí.</${Empty}></div>`}</div>
      <div><div class="section-head"><h2>Vencimientos (14 días)</h2></div><${Calendar} admin /></div>
    </div>
  </div>`;
}

// ===================== Creadores =====================
export function AdminCreators() {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const [f, setF] = useState({ query: '', status: params.get('status') || '', category: '', country: '', min_followers: '', min_engagement: '', max_rate: '', availability: '' });
  const [applied, setApplied] = useState(f);
  const { data, error, reload } = useLoad(() => rpc('admin_search_creators', {
    p_query: applied.query || null, p_status: applied.status || null, p_category: applied.category || null, p_country: applied.country || null,
    p_min_followers: applied.min_followers ? Number(applied.min_followers) : null, p_min_engagement: applied.min_engagement ? Number(applied.min_engagement) : null,
    p_max_rate: applied.max_rate ? Number(applied.max_rate) : null, p_availability: applied.availability || null }), [JSON.stringify(applied)]);
  const set = k => e => setF({ ...f, [k]: e.target.value });
  return html`<div>
    <div class="page-head"><div><h1>Creadores</h1><p>Busca, filtra y revisa perfiles.</p></div></div>
    <form class="panel panel-pad" style="margin-bottom:16px" onSubmit=${e => { e.preventDefault(); setApplied(f); }}>
      <div class="form-grid" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">
        <${Field} label="Buscar"><${Input} type="search" value=${f.query} onInput=${set('query')} placeholder="Nombre o correo" /></${Field}>
        <${Field} label="Estado"><${Select} placeholder="Todos" value=${f.status} onChange=${set('status')} options=${Object.entries(PROFILE_STATUS).map(([k, v]) => [k, v[0]])} /></${Field}>
        <${Field} label="Categoría"><${Select} placeholder="Todas" value=${f.category} onChange=${set('category')} options=${CATEGORIES} /></${Field}>
        <${Field} label="País"><${Select} placeholder="Todos" value=${f.country} onChange=${set('country')} options=${COUNTRIES.map(c => [c[0], c[1]])} /></${Field}>
        <${Field} label="Seguidores mín."><${Input} type="number" min="0" value=${f.min_followers} onInput=${set('min_followers')} /></${Field}>
        <${Field} label="Interacción mín. (%)"><${Input} type="number" min="0" step="0.1" value=${f.min_engagement} onInput=${set('min_engagement')} /></${Field}>
        <${Field} label="Tarifa máx."><${Input} type="number" min="0" value=${f.max_rate} onInput=${set('max_rate')} /></${Field}>
        <${Field} label="Disponibilidad"><${Select} placeholder="Cualquiera" value=${f.availability} onChange=${set('availability')} options=${Object.entries(AVAILABILITY)} /></${Field}>
      </div>
      <div class="row" style="margin-top:14px"><${Button} type="submit" variant="dark"><${Icon} name="search" size="18" />Filtrar</${Button}>
        <${Button} variant="ghost" onClick=${() => { const e = { query: '', status: '', category: '', country: '', min_followers: '', min_engagement: '', max_rate: '', availability: '' }; setF(e); setApplied(e); }}>Limpiar</${Button}></div>
    </form>
    ${error ? html`<${ErrorBox} message=${error} retry=${reload} />` : !data ? html`<${Loading} />` : data.length ? html`<div class="table-wrap"><table class="table stackable">
      <thead><tr><th>Creador</th><th>Categoría</th><th>Ubicación</th><th class="r">Seguidores</th><th class="r">Interacción</th><th class="r">Tarifa desde</th><th>Estado</th></tr></thead>
      <tbody>${data.map(c => html`<tr style="cursor:pointer" onClick=${() => navigate('/admin/creadores/' + c.user_id)}>
        <td data-l="Creador"><a href=${href('/admin/creadores/' + c.user_id)}><strong>${c.full_name}</strong></a>${c.artistic_name && html`<br/><span class="small muted">${c.artistic_name}</span>`}</td>
        <td data-l="Categoría">${c.main_category || '-'}</td><td data-l="Ubicación">${[c.city, c.country].filter(Boolean).join(', ') || '-'}</td>
        <td data-l="Seguidores" class="r num">${compact(c.total_followers)}${c.followers_verified ? html` <span class="small" title="Verificado" style="color:var(--ok)">✓</span>` : ''}</td>
        <td data-l="Interacción" class="r num">${c.best_engagement ? c.best_engagement + ' %' : '-'}</td>
        <td data-l="Tarifa desde" class="r num">${c.min_rate !== null ? money(c.min_rate, c.rate_currency) : '-'}</td>
        <td data-l="Estado"><${Badge} map=${PROFILE_STATUS} value=${c.status} toneOverride=${c.status === 'in_review' ? 'action' : undefined} /></td></tr>`)}</tbody></table></div>`
      : html`<div class="panel"><${Empty} title="No hay creadores con estos filtros">${applied.query || applied.status ? 'Prueba quitando algún filtro.' : 'Cuando los creadores se registren, aparecerán aquí.'}</${Empty}></div>`}
  </div>`;
}

export function AdminCreatorDetail({ id }) {
  const { data, error, reload } = useLoad(() => rpc('admin_creator_detail', { p_user: id }), [id]);
  const [busy, run] = useAction();
  const [note, setNote] = useState('');
  const [reject, setReject] = useState(null);
  const [verify, setVerify] = useState(null);
  if (error) return html`<${ErrorBox} message=${error} retry=${reload} />`;
  if (!data) return html`<${Loading} rows=${5} />`;
  if (!data.profile) return html`<${Empty} title="Creador no encontrado" />`;
  const p = data.profile; const c = data.creator || {};
  return html`<div>
    <a class="small" href=${href('/admin/creadores')} style="display:inline-flex;gap:6px;align-items:center;margin-bottom:12px"><${Icon} name="back" size="16" />Creadores</a>
    <div class="page-head"><div class="row" style="gap:16px"><${Avatar} lg name=${p.full_name} path=${c.avatar_path} />
      <div><h1>${p.full_name}</h1><p>${c.artistic_name || ''}${c.artistic_name ? ' · ' : ''}${p.email} · ${p.phone || 'sin teléfono'}</p></div></div>
      <${Badge} map=${PROFILE_STATUS} value=${p.status} /></div>
    ${p.status === 'in_review' && html`<div class="notice" style="margin-bottom:20px"><div style="width:100%"><strong>Perfil enviado a revisión el ${dateTime(p.submitted_at)}</strong>
      <div class="row" style="margin-top:10px"><${Button} variant="primary" loading=${busy} onClick=${() => run(async () => { await rpc('admin_review_profile', { p_user: id, p_approve: true }); await reload(); }, { success: 'Perfil aprobado. Le notificamos al creador.' })}>Aprobar perfil</${Button}>
        <${Button} onClick=${() => setReject('')}>Pedir cambios</${Button}></div></div></div>`}
    <div class="cols">
      <div class="stack" style="--stack:20px">
        <div class="panel"><div class="panel-head"><h2>Perfil</h2><span class="small muted">${data.completion.percent} % completo</span></div><div class="panel-pad"><dl class="dl">
          <dt>Ubicación</dt><dd>${[c.city, c.country].filter(Boolean).join(', ') || '-'}</dd>
          <dt>Fecha de nacimiento</dt><dd>${c.birth_date ? date(c.birth_date) : '-'}</dd>
          <dt>Biografía</dt><dd>${c.bio || '-'}</dd>
          <dt>Categorías</dt><dd>${[c.main_category, ...(c.secondary_categories || [])].filter(Boolean).join(', ') || '-'}</dd>
          <dt>Disponibilidad</dt><dd>${c.availability ? AVAILABILITY[c.availability] : '-'}${c.availability_note ? ' · ' + c.availability_note : ''}</dd>
          <dt>Modalidades</dt><dd>${(c.collaboration_modes || []).join(', ') || '-'}</dd>
          <dt>Portafolio</dt><dd>${(c.portfolio_links || []).length ? c.portfolio_links.map(l => html`<a href=${l} target="_blank" rel="noopener noreferrer" style="display:block">${l}</a>`) : '-'}</dd>
          <dt>Campañas con producto</dt><dd>${c.accepts_product_campaigns ? 'Acepta' : 'No acepta'}${data.private?.shipping_address ? ' · ' + data.private.shipping_address + ', ' + (data.private.shipping_city || '') : ''}</dd>
        </dl></div></div>
        <div class="panel"><div class="panel-head"><h2>Redes y métricas</h2></div>
          ${data.social.length ? html`<div class="table-wrap" style="border:0"><table class="table stackable"><thead><tr><th>Cuenta</th><th class="r">Seguidores</th><th class="r">Vistas prom.</th><th class="r">Interacción</th><th></th></tr></thead><tbody>
            ${data.social.map(s => html`<tr><td data-l="Cuenta">${PLATFORMS[s.platform]} · ${s.url ? html`<a href=${s.url} target="_blank" rel="noopener noreferrer">${s.handle}</a>` : s.handle}
              ${s.evidence_path && html`<br/><${FileLink} bucket="documents" path=${s.evidence_path}>Captura de métricas</${FileLink}>`}${s.audience_notes && html`<br/><span class="small muted">${s.audience_notes}</span>`}</td>
              <td data-l="Seguidores" class="r num">${compact(s.followers_declared)}${s.followers_verified !== null ? html`<br/><span class="small" style="color:var(--ok)">✓ ${compact(s.followers_verified)}</span>` : ''}</td>
              <td data-l="Vistas prom." class="r num">${compact(s.avg_views_declared)}${s.avg_views_verified !== null ? html`<br/><span class="small" style="color:var(--ok)">✓ ${compact(s.avg_views_verified)}</span>` : ''}</td>
              <td data-l="Interacción" class="r num">${s.engagement_declared ?? '-'} %${s.engagement_verified !== null ? html`<br/><span class="small" style="color:var(--ok)">✓ ${s.engagement_verified} %</span>` : ''}</td>
              <td class="r"><${Button} size="sm" onClick=${() => setVerify({ id: s.id, f: s.followers_verified ?? s.followers_declared ?? '', v: s.avg_views_verified ?? s.avg_views_declared ?? '', e: s.engagement_verified ?? s.engagement_declared ?? '' })}>Verificar</${Button}></td></tr>`)}
          </tbody></table></div><p class="small muted panel-pad" style="padding-top:8px">Declarado por el creador · <span style="color:var(--ok)">✓ verificado por Vocera</span></p>` : html`<${Empty} title="Sin redes registradas" />`}</div>
        <div class="panel"><div class="panel-head"><h2>Tarifas</h2></div><div class="panel-pad">${data.rates.length ? html`<dl class="dl">${data.rates.map(r => html`<dt>${RATE_TYPES[r.rate_type]}</dt><dd class="num">${money(r.amount, r.currency)}</dd>`)}</dl>` : html`<p class="muted">Sin tarifas registradas.</p>`}</div></div>
      </div>
      <div class="stack" style="--stack:20px">
        <div class="panel"><div class="panel-head"><h2>Campañas</h2></div>${data.assignments.length ? html`<div class="list" style="border:0">${data.assignments.map(x => html`<a class="list-row" href=${href('/admin/asignaciones/' + x.id)} style="grid-template-columns:1fr auto">
          <span class="t">${x.campaign}</span><${Badge} map=${ASSIGNMENT_STATUS} value=${x.status} toneOverride=${ADMIN_TONE[x.status]} text=${ADMIN_LABEL[x.status]} /></a>`)}</div>` : html`<p class="panel-pad muted small">Aún no participa en campañas.</p>`}</div>
        <div class="panel panel-pad stack"><h2>Notas internas</h2><p class="small muted">Solo las ve el equipo de Vocera.</p>
          <${Textarea} rows="3" value=${note} onInput=${e => setNote(e.target.value)} aria-label="Nueva nota" />
          <div><${Button} size="sm" variant="dark" loading=${busy} disabled=${!note.trim()} onClick=${() => run(async () => { await q(supabase.from('creator_notes').insert({ creator_id: id, author_id: (await supabase.auth.getUser()).data.user.id, body: note.trim() })); setNote(''); await reload(); }, { success: 'Nota guardada.' })}>Agregar nota</${Button}></div>
          ${data.notes.map(n => html`<div style="border-top:1px solid var(--linea-2);padding-top:10px"><p style="white-space:pre-line">${n.body}</p><p class="small muted">${n.author} · ${dateTime(n.at)}</p></div>`)}
        </div>
        ${data.payout_method && html`<div class="panel panel-pad"><h2>Cobro</h2><p class="small" style="margin-top:6px">${data.payout_method.holder_name} · ${data.payout_method.bank_name} · •••• ${data.payout_method.account_last4} (${data.payout_method.currency})</p></div>`}
      </div>
    </div>
    <${Modal} open=${reject !== null} title="Pedir cambios en el perfil" onClose=${() => setReject(null)} footer=${html`<${Button} onClick=${() => setReject(null)}>Cancelar</${Button}>
      <${Button} variant="dark" loading=${busy} onClick=${() => run(async () => { await rpc('admin_review_profile', { p_user: id, p_approve: false, p_reason: reject }); setReject(null); await reload(); }, { success: 'Le pedimos cambios al creador.' })}>Enviar</${Button}>`}>
      <${Field} label="¿Qué debe corregir o completar?" hint="El creador verá este mensaje."><${Textarea} rows="4" value=${reject || ''} onInput=${e => setReject(e.target.value)} /></${Field}>
    </${Modal}>
    <${Modal} open=${!!verify} title="Verificar métricas" onClose=${() => setVerify(null)} footer=${html`<${Button} onClick=${() => setVerify(null)}>Cancelar</${Button}>
      <${Button} variant="primary" loading=${busy} onClick=${() => run(async () => { await rpc('admin_verify_social', { p_account: verify.id, p_followers: verify.f === '' ? null : Number(verify.f), p_avg_views: verify.v === '' ? null : Number(verify.v), p_engagement: verify.e === '' ? null : Number(verify.e) }); setVerify(null); await reload(); }, { success: 'Métricas verificadas.' })}>Guardar verificación</${Button}>`}>
      ${verify && html`<div class="form"><p class="small muted">Registra los valores que comprobaste en las estadísticas de la plataforma.</p>
        <${Field} label="Seguidores"><${Input} type="number" min="0" value=${verify.f} onInput=${e => setVerify({ ...verify, f: e.target.value })} /></${Field}>
        <${Field} label="Visualizaciones promedio"><${Input} type="number" min="0" value=${verify.v} onInput=${e => setVerify({ ...verify, v: e.target.value })} /></${Field}>
        <${Field} label="Interacción (%)"><${Input} type="number" min="0" max="100" step="0.1" value=${verify.e} onInput=${e => setVerify({ ...verify, e: e.target.value })} /></${Field}></div>`}
    </${Modal}>
  </div>`;
}

// ===================== Campañas =====================
export function AdminCampaigns() {
  const { data, error, reload } = useLoad(() => rpc('admin_campaigns'));
  if (error) return html`<${ErrorBox} message=${error} retry=${reload} />`;
  if (!data) return html`<${Loading} />`;
  return html`<div>
    <div class="page-head"><div><h1>Campañas</h1></div><a class="btn btn-primary" href=${href('/admin/campanas/nueva')}><${Icon} name="plus" size="18" />Nueva campaña</a></div>
    ${data.length ? html`<div class="list">${data.map(c => html`<a class="list-row campaign-row" href=${href('/admin/campanas/' + c.id)}>
      <span><span class="t">${c.name}</span><span class="s" style="display:block">${c.brand || 'Sin marca'} · ${date(c.starts_on)}${c.ends_on ? ' al ' + date(c.ends_on) : ''}</span></span>
      <span><${Badge} map=${CAMPAIGN_STATUS} value=${c.status} /></span>
      <span class="c3 small">${c.creators} creadores · ${c.in_progress} en curso</span>
      <span class="c3 num small">${c.default_fee !== null ? money(c.default_fee, c.currency) : '-'}</span></a>`)}</div>`
      : html`<div class="panel"><${Empty} title="Aún no hay campañas" action=${html`<a class="btn btn-primary" href=${href('/admin/campanas/nueva')}>Crear la primera</a>`}>Crea una campaña, completa su brief y asígnale creadores aprobados.</${Empty}></div>`}
  </div>`;
}

const BLANK = { name: '', brand: '', brand_visible_to_creators: false, objective: '', description: '', platforms: ['tiktok'], starts_on: '', ends_on: '',
  default_fee: '', currency: 'PEN', payment_terms: '', usage_rights: '', ad_authorization_days: '', max_revision_rounds: 2,
  requires_client_approval: true, requires_contract: true, requires_product: false, requires_script: true, requires_publication: true, requires_ad_code: false,
  invite_expires_days: 5, script_due_on: '', video_due_on: '', publish_on: '',
  brief: '', formats: '', content_duration: '', technical_requirements: '', mandatory_messages: '', forbidden_claims: '', deliverables_summary: '' };

export function CampaignForm({ id }) {
  const loader = useLoad(() => id ? rpc('admin_campaign_detail', { p_campaign: id }) : Promise.resolve(null), [id]);
  if (id && loader.error) return html`<${ErrorBox} message=${loader.error} retry=${loader.reload} />`;
  if (id && !loader.data) return html`<${Loading} />`;
  const init = id ? { ...BLANK, ...loader.data.campaign, ...(loader.data.brief || {}), brand: loader.data.brand?.name || '' } : BLANK;
  return html`<${CampaignFormInner} id=${id} init=${init} />`;
}

function CampaignFormInner({ id, init }) {
  const [f, setF] = useState(Object.fromEntries(Object.entries(init).map(([k, v]) => [k, v === null ? '' : v])));
  const [errors, setErrors] = useState({});
  const [busy, run] = useAction();
  const set = k => e => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const Flag = (k, l, hint) => html`<label class="check"><input type="checkbox" checked=${f[k]} onChange=${set(k)} /><span><strong>${l}</strong>${hint && html`<br/><span class="small muted">${hint}</span>`}</span></label>`;
  async function save() {
    const e = {};
    if (f.name.trim().length < 2) e.name = 'Ponle un nombre a la campaña.';
    if (f.ends_on && f.starts_on && f.ends_on < f.starts_on) e.ends_on = 'La fecha de fin es anterior al inicio.';
    if (f.default_fee !== '' && Number(f.default_fee) < 0) e.default_fee = 'El honorario no puede ser negativo.';
    setErrors(e); if (Object.keys(e).length) return;
    await run(async () => {
      let brandId = null;
      if (f.brand.trim()) {
        const found = await q(supabase.from('brands').select('id').eq('name', f.brand.trim()).limit(1));
        brandId = found[0]?.id || (await q(supabase.from('brands').insert({ name: f.brand.trim() }).select('id').single())).id;
      }
      const nul = v => (v === '' ? null : v);
      const row = { brand_id: brandId, brand_visible_to_creators: f.brand_visible_to_creators, name: f.name.trim(), objective: nul(f.objective), description: nul(f.description),
        platforms: f.platforms, starts_on: nul(f.starts_on), ends_on: nul(f.ends_on), default_fee: f.default_fee === '' ? null : Number(f.default_fee), currency: f.currency,
        payment_terms: nul(f.payment_terms), usage_rights: nul(f.usage_rights), ad_authorization_days: f.ad_authorization_days === '' ? null : Number(f.ad_authorization_days),
        max_revision_rounds: Number(f.max_revision_rounds), requires_client_approval: f.requires_client_approval, requires_contract: f.requires_contract,
        requires_product: f.requires_product, requires_script: f.requires_script, requires_publication: f.requires_publication, requires_ad_code: f.requires_ad_code,
        invite_expires_days: Number(f.invite_expires_days), script_due_on: nul(f.script_due_on), video_due_on: nul(f.video_due_on), publish_on: nul(f.publish_on) };
      let cid = id;
      if (id) await q(supabase.from('campaigns').update(row).eq('id', id));
      else cid = (await q(supabase.from('campaigns').insert({ ...row, created_by: (await supabase.auth.getUser()).data.user.id }).select('id').single())).id;
      const brief = { campaign_id: cid, brief: nul(f.brief), formats: nul(f.formats), content_duration: nul(f.content_duration), technical_requirements: nul(f.technical_requirements),
        mandatory_messages: nul(f.mandatory_messages), forbidden_claims: nul(f.forbidden_claims), deliverables_summary: nul(f.deliverables_summary) };
      await q(supabase.from('campaign_briefs').upsert(brief, { onConflict: 'campaign_id' }));
      navigate('/admin/campanas/' + cid, { replace: !id });
    }, { success: 'Campaña guardada.' });
  }
  return html`<div>
    <a class="small" href=${href(id ? '/admin/campanas/' + id : '/admin/campanas')} style="display:inline-flex;gap:6px;align-items:center;margin-bottom:12px"><${Icon} name="back" size="16" />Volver</a>
    <div class="page-head"><div><h1>${id ? 'Editar campaña' : 'Nueva campaña'}</h1><p>Se guarda como borrador. Podrás activarla cuando tenga brief, honorario y fecha de inicio.</p></div></div>
    <div class="stack" style="--stack:20px">
      <div class="panel panel-pad form"><h2>Datos generales</h2><div class="form-grid">
        <${Field} full label="Nombre" error=${errors.name}><${Input} value=${f.name} onInput=${set('name')} /></${Field}>
        <${Field} label="Marca" optional><${Input} value=${f.brand} onInput=${set('brand')} /></${Field}>
        <div class="field" style="justify-content:flex-end">${Flag('brand_visible_to_creators', 'Mostrar la marca a los creadores', 'Si no, verán "Marca confidencial".')}</div>
        <${Field} full label="Objetivo" optional><${Input} value=${f.objective} onInput=${set('objective')} /></${Field}>
        <${Field} full label="Descripción" optional><${Textarea} rows="3" value=${f.description} onInput=${set('description')} /></${Field}>
        <div class="field full"><span class="label">Plataformas</span><${ChipSelect} options=${Object.entries(PLATFORMS)} value=${f.platforms} onChange=${v => setF({ ...f, platforms: v })} /></div>
        <${Field} label="Inicio"><${Input} type="date" value=${f.starts_on} onInput=${set('starts_on')} /></${Field}>
        <${Field} label="Fin" optional error=${errors.ends_on}><${Input} type="date" value=${f.ends_on} onInput=${set('ends_on')} /></${Field}>
      </div></div>
      <div class="panel panel-pad form"><h2>Brief</h2><div class="form-grid">
        <${Field} full label="Brief completo"><${Textarea} rows="6" value=${f.brief} onInput=${set('brief')} /></${Field}>
        <${Field} label="Formatos exigidos" optional><${Input} value=${f.formats} onInput=${set('formats')} placeholder="Video vertical 9:16" /></${Field}>
        <${Field} label="Duración del contenido" optional><${Input} value=${f.content_duration} onInput=${set('content_duration')} placeholder="30 a 45 segundos" /></${Field}>
        <${Field} full label="Requisitos técnicos" optional><${Textarea} rows="2" value=${f.technical_requirements} onInput=${set('technical_requirements')} /></${Field}>
        <${Field} full label="Mensajes obligatorios" optional><${Textarea} rows="2" value=${f.mandatory_messages} onInput=${set('mandatory_messages')} /></${Field}>
        <${Field} full label="Palabras o afirmaciones prohibidas" optional><${Textarea} rows="2" value=${f.forbidden_claims} onInput=${set('forbidden_claims')} /></${Field}>
        <${Field} full label="Entregables solicitados" optional><${Textarea} rows="2" value=${f.deliverables_summary} onInput=${set('deliverables_summary')} /></${Field}>
      </div></div>
      <div class="panel panel-pad form"><h2>Condiciones comerciales y fechas</h2><div class="form-grid">
        <${Field} label="Honorario base por creador" error=${errors.default_fee}><${Input} type="number" min="0" step="0.01" value=${f.default_fee} onInput=${set('default_fee')} /></${Field}>
        <${Field} label="Moneda"><${Select} value=${f.currency} onChange=${set('currency')} options=${CURRENCIES} /></${Field}>
        <${Field} full label="Condiciones de pago" optional><${Input} value=${f.payment_terms} onInput=${set('payment_terms')} placeholder="Ej. 15 días tras la validación final" /></${Field}>
        <${Field} full label="Derechos de uso del contenido" optional><${Textarea} rows="2" value=${f.usage_rights} onInput=${set('usage_rights')} /></${Field}>
        <${Field} label="Vigencia de autorizaciones publicitarias (días)" optional><${Input} type="number" min="1" value=${f.ad_authorization_days} onInput=${set('ad_authorization_days')} /></${Field}>
        <${Field} label="Máximo de rondas de corrección"><${Input} type="number" min="0" max="10" value=${f.max_revision_rounds} onInput=${set('max_revision_rounds')} /></${Field}>
        <${Field} label="Días para responder la invitación"><${Input} type="number" min="1" max="60" value=${f.invite_expires_days} onInput=${set('invite_expires_days')} /></${Field}>
        <${Field} label="Entrega de guion" optional><${Input} type="date" value=${f.script_due_on} onInput=${set('script_due_on')} /></${Field}>
        <${Field} label="Entrega de video" optional><${Input} type="date" value=${f.video_due_on} onInput=${set('video_due_on')} /></${Field}>
        <${Field} label="Publicación" optional><${Input} type="date" value=${f.publish_on} onInput=${set('publish_on')} /></${Field}>
      </div></div>
      <div class="panel panel-pad form"><h2>Requisitos del flujo y del pago</h2>
        <p class="small muted">Definen qué etapas existen en esta campaña y qué condiciones se exigen antes de autorizar el pago. El creador las ve.</p>
        ${Flag('requires_client_approval', 'Requiere aprobación del cliente para cada creador')}
        ${Flag('requires_contract', 'Requiere contrato firmado')}
        ${Flag('requires_product', 'Incluye envío de producto')}
        ${Flag('requires_script', 'Requiere guion aprobado antes de grabar')}
        ${Flag('requires_publication', 'El creador publica en sus redes (con evidencia)')}
        ${Flag('requires_ad_code', 'Requiere código de autorización publicitaria (p. ej. Spark Ads)', 'El pago queda bloqueado hasta validar el código.')}
      </div>
      <div class="row"><${Button} variant="primary" loading=${busy} onClick=${save}>Guardar campaña</${Button}></div>
    </div>
  </div>`;
}

export function AdminCampaignDetail({ id }) {
  const { data, error, reload } = useLoad(() => rpc('admin_campaign_detail', { p_campaign: id }), [id]);
  const [busy, run] = useAction();
  const [assign, setAssign] = useState(null);
  if (error) return html`<${ErrorBox} message=${error} retry=${reload} />`;
  if (!data) return html`<${Loading} rows=${4} />`;
  const c = data.campaign;
  return html`<div>
    <a class="small" href=${href('/admin/campanas')} style="display:inline-flex;gap:6px;align-items:center;margin-bottom:12px"><${Icon} name="back" size="16" />Campañas</a>
    <div class="page-head"><div><h1>${c.name}</h1><p>${data.brand?.name || 'Sin marca'} · ${date(c.starts_on)}${c.ends_on ? ' al ' + date(c.ends_on) : ''} · Honorario base ${money(c.default_fee, c.currency)}</p></div>
      <div class="row"><${Badge} map=${CAMPAIGN_STATUS} value=${c.status} /><a class="btn btn-sm" href=${href('/admin/campanas/' + id + '/editar')}>Editar</a>
        ${c.status === 'draft' && html`<${Button} size="sm" variant="primary" loading=${busy} onClick=${() => run(async () => { await rpc('admin_set_campaign_status', { p_campaign: id, p_status: 'active' }); await reload(); }, { success: 'Campaña activa.' })}>Activar</${Button}>`}
        ${c.status === 'active' && html`<${Button} size="sm" onClick=${async () => { const r = await ask('Motivo del cierre', { optional: true, title: 'Cerrar campaña', confirmLabel: 'Cerrar campaña' }); if (r !== null) run(async () => { await rpc('admin_set_campaign_status', { p_campaign: id, p_status: 'closed', p_reason: r }); await reload(); }); }}>Cerrar</${Button}>`}
      </div></div>
    <div class="section-head"><h2>Creadores asignados</h2>${c.status !== 'closed' && c.status !== 'cancelled' && html`<${Button} variant="primary" onClick=${() => setAssign({ query: '', fee: c.default_fee ?? '', results: null })}><${Icon} name="plus" size="18" />Asignar creador</${Button}>`}</div>
    ${data.assignments.length ? html`<div class="list">${data.assignments.map(x => html`<a class="list-row campaign-row" href=${href('/admin/asignaciones/' + x.id)}>
      <span><span class="t">${x.creator}</span><span class="s" style="display:block">${x.artistic_name || ''}</span></span>
      <span><${Badge} map=${ASSIGNMENT_STATUS} value=${x.status} toneOverride=${ADMIN_TONE[x.status]} text=${ADMIN_LABEL[x.status]} /></span>
      <span class="c3 num small">${money(x.fee, x.currency)}</span><span class="c3 small muted">${dateTime(x.updated_at)}</span></a>`)}</div>`
      : html`<div class="panel"><${Empty} title="Sin creadores asignados">Asigna creadores con perfil aprobado. Después registra la aprobación del cliente y envía la invitación.</${Empty}></div>`}
    <${Modal} open=${!!assign} title="Asignar creador" onClose=${() => setAssign(null)}>
      ${assign && html`<div class="form">
        <form class="input-group" onSubmit=${async e => { e.preventDefault(); const r = await rpc('admin_search_creators', { p_query: assign.query || null, p_status: 'approved' }); setAssign({ ...assign, results: r }); }}>
          <${Input} type="search" placeholder="Buscar creador aprobado" value=${assign.query} onInput=${e => setAssign({ ...assign, query: e.target.value })} aria-label="Buscar creador" />
          <${Button} type="submit" variant="dark">Buscar</${Button}></form>
        <${Field} label=${'Honorario acordado (' + c.currency + ')'}><${Input} type="number" min="0" step="0.01" value=${assign.fee} onInput=${e => setAssign({ ...assign, fee: e.target.value })} /></${Field}>
        ${assign.results && (assign.results.length ? html`<div class="list">${assign.results.map(r => {
          const taken = data.assignments.some(x => x.creator_id === r.user_id);
          return html`<div class="list-row" style="grid-template-columns:1fr auto"><span><span class="t">${r.full_name}</span><span class="s" style="display:block">${r.main_category || ''} · ${compact(r.total_followers)} seguidores</span></span>
            <${Button} size="sm" variant="primary" disabled=${taken} loading=${busy} onClick=${() => run(async () => { await rpc('admin_assign_creator', { p_campaign: id, p_creator: r.user_id, p_fee: assign.fee === '' ? null : Number(assign.fee) }); setAssign(null); await reload(); }, { success: 'Creador asignado.' })}>${taken ? 'Ya asignado' : 'Asignar'}</${Button}></div>`;
        })}</div>` : html`<p class="muted small">No hay creadores aprobados con ese nombre.</p>`)}
      </div>`}
    </${Modal}>
  </div>`;
}

// ===================== Pagos =====================
export function AdminPayments() {
  const { data, error, reload } = useLoad(() => rpc('admin_payments'));
  const [filter, setFilter] = useState('todo');
  const [csv, setCsv] = useState(null);
  const [busy, run] = useAction();
  if (error) return html`<${ErrorBox} message=${error} retry=${reload} />`;
  if (!data) return html`<${Loading} />`;
  const groups = { todo: ['Por decidir', p => ['requirements_pending', 'in_review', 'incident'].includes(p.status)], transfer: ['Por transferir', p => ['approved', 'scheduled'].includes(p.status)],
    done: ['Transferidos', p => ['transferred', 'confirmed'].includes(p.status)], all: ['Todos', () => true] };
  const list = data.filter(groups[filter][1]);
  const exportCsv = () => run(async () => {
    const csv = await rpc('admin_export_payments_csv');
    if (config.demo) { setCsv(csv); return; }
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `pagos-vocera-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
  }, { success: 'Reporte exportado.' });
  return html`<div>
    <div class="page-head"><div><h1>Pagos</h1><p>Autoriza solo cuando todas las condiciones se cumplen. Este portal no mueve dinero: registra decisiones y transferencias.</p></div>
      <${Button} loading=${busy} onClick=${exportCsv}><${Icon} name="download" size="18" />Exportar CSV</${Button}></div>
    <div class="tabs" role="tablist">${Object.entries(groups).map(([k, [l, fn]]) => html`<button role="tab" aria-selected=${filter === k} onClick=${() => setFilter(k)}>${l} (${data.filter(fn).length})</button>`)}</div>
    ${list.length ? html`<div class="table-wrap"><table class="table stackable"><thead><tr><th>Creador</th><th>Campaña</th><th>Concepto</th><th class="r">Importe</th><th>Estado</th><th>Condiciones</th><th></th></tr></thead><tbody>
      ${list.map(p => html`<tr><td data-l="Creador">${p.creator}</td><td data-l="Campaña">${p.campaign}</td><td data-l="Concepto">${p.concept === 'fee' ? 'Honorario' : 'Bonificación'}</td>
        <td data-l="Importe" class="r num">${money(p.amount, p.currency)}</td><td data-l="Estado"><${Badge} map=${PAYMENT_STATUS} value=${p.status} />${p.incident_note && html`<br/><span class="small err">${p.incident_note}</span>`}</td>
        <td data-l="Condiciones">${p.ready === null || p.ready === undefined ? '-' : p.ready ? html`<span class="badge tone-ok">Cumplidas</span>` : html`<span class="badge tone-wait">Pendientes</span>`}</td>
        <td class="r"><a class="btn btn-sm" href=${href('/admin/asignaciones/' + p.assignment_id + '?tab=pago')}>Abrir</a></td></tr>`)}</tbody></table></div>`
      : html`<div class="panel"><${Empty} title="Nada en esta bandeja" /></div>`}
    <${Modal} open=${csv !== null} title="Reporte de pagos (CSV)" onClose=${() => setCsv(null)} footer=${html`<${Button} variant="primary" onClick=${() => {
        navigator.clipboard?.writeText(csv).then(() => toast('Copiado.'), () => toast('Selecciona el texto y cópialo.', 'error')); }}>Copiar</${Button}>`}>
      <textarea class="textarea mono" rows="10" readonly aria-label="Contenido CSV" value=${csv || ''}></textarea>
    </${Modal}>
  </div>`;
}

// ===================== Auditoría =====================
export function AdminAudit() {
  const { data, error, reload } = useLoad(() => rpc('admin_audit', { p_limit: 300 }));
  if (error) return html`<${ErrorBox} message=${error} retry=${reload} />`;
  if (!data) return html`<${Loading} />`;
  return html`<div>
    <div class="page-head"><div><h1>Auditoría</h1><p>Acciones sensibles: quién, cuándo, qué registro y qué cambió.</p></div></div>
    <div class="table-wrap"><table class="table stackable"><thead><tr><th>Fecha</th><th>Quién</th><th>Acción</th><th>Registro</th><th>Cambio</th><th>Motivo</th></tr></thead><tbody>
      ${data.map(l => html`<tr><td data-l="Fecha" class="nowrap">${dateTime(l.at)}</td><td data-l="Quién">${l.actor || 'Sistema'}${l.actor_role ? html`<br/><span class="small muted">${l.actor_role}</span>` : ''}</td>
        <td data-l="Acción">${l.action.replace(/_/g, ' ')}</td><td data-l="Registro" class="small"><span class="mono">${l.table}</span><br/><span class="muted">${(l.record_id || '').slice(0, 8)}</span></td>
        <td data-l="Cambio">${l.old || l.new ? html`${l.old || '-'} → ${l.new || '-'}` : ''}</td><td data-l="Motivo">${l.reason || ''}</td></tr>`)}
    </tbody></table></div>
  </div>`;
}
