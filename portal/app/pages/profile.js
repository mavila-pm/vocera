// Bienvenida + onboarding en 4 pasos (también es "Mi perfil profesional").
import { html, useState, useEffect } from '../../vendor/preact.js';
import { supabase, rpc, q } from '../lib/sb.js';
import { navigate } from '../lib/router.js';
import { loadProfile } from '../lib/session.js';
import { CATEGORIES, COUNTRIES, PLATFORMS, RATE_TYPES, AVAILABILITY, COLLAB_MODES, CURRENCIES, PROFILE_STATUS, compact } from '../lib/format.js';
import { Field, Input, Select, Textarea, Button, ChipSelect, FileDrop, Avatar, Badge, Progress, Loading, ErrorBox, Icon, toast, useAction, FileLink } from '../ui/kit.js';

export function Welcome({ session }) {
  const [busy, run] = useAction();
  const go = () => run(async () => { await rpc('mark_welcome_seen'); await loadProfile(); navigate('/perfil', { replace: true }); });
  const name = (session.profile?.full_name || '').split(' ')[0];
  return html`<div class="welcome">
    <h1>¡Bienvenido a Vocera${name ? ', ' + name : ''}!</h1>
    <p class="lead">Este es tu espacio para conectar con oportunidades, participar en campañas, entregar contenido y gestionar tus pagos.</p>
    <p class="lead">Completa tu perfil para que podamos conocerte y considerarte en futuras campañas.</p>
    <ol>
      <li><div><strong>Información personal</strong><p class="muted small">Quién eres y qué tipo de contenido creas.</p></div></li>
      <li><div><strong>Redes sociales</strong><p class="muted small">Tus cuentas y métricas. Vocera las verificará más adelante.</p></div></li>
      <li><div><strong>Perfil comercial</strong><p class="muted small">Tus tarifas, disponibilidad y trabajos anteriores.</p></div></li>
      <li><div><strong>Datos adicionales</strong><p class="muted small">Solo lo que haga falta. Los datos bancarios puedes dejarlos para después.</p></div></li>
    </ol>
    <p class="muted small" style="margin-top:12px">Puedes guardar y continuar cuando quieras: tu avance queda registrado.</p>
    <div class="row" style="margin-top:24px"><${Button} variant="primary" loading=${busy} onClick=${go}>Completar mi perfil <${Icon} name="arrow" size="18" /></${Button}></div>
  </div>`;
}

const STEPS = ['Información personal', 'Redes sociales', 'Perfil comercial', 'Datos adicionales'];

export function Profile({ session }) {
  const uid = session.session.user.id;
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [step, setStep] = useState(Math.min(Math.max(session.profile?.onboarding_step || 1, 1), 4));

  async function load() {
    setErr(null);
    try {
      const [p, c, social, rates, priv, completion] = await Promise.all([
        q(supabase.from('profiles').select('full_name,phone,email,status,status_reason').eq('id', uid).single()),
        q(supabase.from('creator_profiles').select('*').eq('user_id', uid).maybeSingle()),
        q(supabase.from('creator_social_accounts').select('*').eq('user_id', uid).order('created_at')),
        q(supabase.from('creator_rates').select('*').eq('user_id', uid)),
        q(supabase.from('creator_private_details').select('*').eq('user_id', uid).maybeSingle()),
        rpc('creator_completion')
      ]);
      setData({ p, c: c || { user_id: uid, secondary_categories: [], collaboration_modes: [], portfolio_links: [] }, social, rates, priv: priv || { user_id: uid }, completion });
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);
  if (err) return html`<${ErrorBox} message=${err} retry=${load} />`;
  if (!data) return html`<${Loading} rows=${4} />`;

  const comp = data.completion;
  const status = data.p.status;
  const editable = status !== 'suspended';
  const goto = async n => { setStep(n); window.scrollTo(0, 0); rpc('save_onboarding_step', { p_step: n }).catch(() => {}); };
  const refresh = async () => { const completion = await rpc('creator_completion'); setData(d => ({ ...d, completion })); };

  return html`<div>
    <div class="page-head"><div>
      <h1>${status === 'incomplete' ? 'Completa tu perfil' : 'Mi perfil profesional'}</h1>
      <p>${status === 'incomplete' ? 'Cuanto más completo, más fácil es considerarte para campañas que encajen contigo.' : 'Mantén tus datos al día: los usamos para proponerte campañas.'}</p>
    </div><${Badge} map=${PROFILE_STATUS} value=${status} /></div>

    ${status === 'rejected' && html`<div class="notice warn" style="margin-bottom:20px"><div><strong>Vocera te pidió cambios</strong>${data.p.status_reason}</div></div>`}
    ${status === 'in_review' && html`<div class="notice" style="margin-bottom:20px"><div><strong>Tu perfil está en revisión</strong>Te avisaremos aquí cuando el equipo de Vocera lo apruebe. Puedes seguir editándolo.</div></div>`}

    <div class="panel panel-pad" style="margin-bottom:20px">
      <div class="row between"><strong>Perfil completado</strong><span class="num">${comp.percent} %</span></div>
      <div style="margin:10px 0 12px"><${Progress} label="Perfil completado" value=${comp.percent} ok=${comp.percent === 100} /></div>
      ${comp.percent < 100 && html`<p class="small muted">Te falta: ${comp.items.filter(i => !i.done).map(i => i.label).join(' · ')}</p>`}
    </div>

    <ol class="steps" aria-label="Pasos del perfil">
      ${STEPS.map((s, i) => {
        const n = i + 1; const items = comp.items.filter(x => x.step === n);
        const st = n === step ? 'current' : items.length && items.every(x => x.done) ? 'done' : 'todo';
        return html`<li data-state=${st}><button type="button" onClick=${() => goto(n)} aria-current=${n === step ? 'step' : undefined}>
          <span class="n">Paso ${n}</span><span class="lbl">${s}</span></button></li>`;
      })}
    </ol>

    <div class="panel panel-pad">
      ${step === 1 && html`<${StepPersonal} uid=${uid} data=${data} setData=${setData} onSaved=${refresh} next=${() => goto(2)} editable=${editable} />`}
      ${step === 2 && html`<${StepSocial} uid=${uid} data=${data} reload=${load} next=${() => goto(3)} back=${() => goto(1)} />`}
      ${step === 3 && html`<${StepCommercial} uid=${uid} data=${data} reload=${load} next=${() => goto(4)} back=${() => goto(2)} />`}
      ${step === 4 && html`<${StepExtra} uid=${uid} data=${data} reload=${load} back=${() => goto(3)} status=${status} />`}
    </div>
  </div>`;
}

function StepPersonal({ uid, data, setData, onSaved, next, editable }) {
  const [f, setF] = useState({ full_name: data.p.full_name || '', phone: data.p.phone || '', ...data.c, bio: data.c.bio || '' });
  const [errors, setErrors] = useState({});
  const [busy, run] = useAction();
  const set = k => e => setF({ ...f, [k]: e.target.value });
  async function save(goNext) {
    const e = {};
    if (f.full_name.trim().length < 3) e.full_name = 'Escribe tu nombre completo.';
    if (f.phone && !/^\+[1-9]\d{6,14}$/.test(f.phone.replace(/[\s-]/g, ''))) e.phone = 'Usa el formato internacional, por ejemplo +51987654321.';
    if (f.bio && f.bio.length > 600) e.bio = 'Máximo 600 caracteres.';
    if (f.birth_date && new Date(f.birth_date) > new Date()) e.birth_date = 'La fecha no puede ser futura.';
    setErrors(e); if (Object.keys(e).length) return;
    await run(async () => {
      await q(supabase.from('profiles').update({ full_name: f.full_name.trim(), phone: f.phone ? f.phone.replace(/[\s-]/g, '') : null }).eq('id', uid));
      await q(supabase.from('creator_profiles').upsert({ user_id: uid, artistic_name: f.artistic_name || null, birth_date: f.birth_date || null,
        country: f.country || null, city: f.city || null, bio: f.bio || null, main_category: f.main_category || null,
        secondary_categories: f.secondary_categories || [] }, { onConflict: 'user_id' }));
      await onSaved(); await loadProfile();
      if (goNext) next();
    }, { success: 'Guardado.' });
  }
  async function onAvatar(file) {
    await q(supabase.from('creator_profiles').upsert({ user_id: uid, avatar_path: file.path }, { onConflict: 'user_id' }));
    setF(x => ({ ...x, avatar_path: file.path })); setData(d => ({ ...d, c: { ...d.c, avatar_path: file.path } }));
    await onSaved(); toast('Foto actualizada.');
  }
  return html`<form class="form" onSubmit=${e => { e.preventDefault(); save(true); }} novalidate>
    <h2>Información personal</h2>
    <div class="row" style="align-items:flex-start;gap:20px">
      <${Avatar} lg name=${f.full_name} path=${f.avatar_path} />
      <div class="grow"><${FileDrop} kind="avatar" ownerId=${uid} folder="perfil" onUploaded=${onAvatar} label="Sube tu foto de perfil" hint="Una foto clara de tu rostro. JPG, PNG o WEBP, hasta 5 MB." disabled=${!editable} /></div>
    </div>
    <div class="form-grid">
      <${Field} label="Nombre completo" error=${errors.full_name}><${Input} autocomplete="name" value=${f.full_name} onInput=${set('full_name')} /></${Field}>
      <${Field} label="Nombre artístico" hint="Cómo te conoce tu audiencia."><${Input} value=${f.artistic_name || ''} onInput=${set('artistic_name')} maxlength="80" /></${Field}>
      <${Field} label="País"><${Select} placeholder="Selecciona" value=${f.country || ''} onChange=${set('country')} options=${COUNTRIES.map(c => [c[0], c[1]])} /></${Field}>
      <${Field} label="Ciudad"><${Input} autocomplete="address-level2" value=${f.city || ''} onInput=${set('city')} maxlength="80" /></${Field}>
      <${Field} label="Correo" hint="Para cambiarlo, escríbenos."><${Input} value=${data.p.email} readonly /></${Field}>
      <${Field} label="Teléfono" error=${errors.phone}><${Input} type="tel" autocomplete="tel" value=${f.phone} onInput=${set('phone')} placeholder="+51987654321" /></${Field}>
      <${Field} label="Fecha de nacimiento" optional hint="Solo la usamos para confirmar la mayoría de edad en contratos y campañas con restricción de edad." error=${errors.birth_date}>
        <${Input} type="date" value=${f.birth_date || ''} onInput=${set('birth_date')} max=${new Date().toISOString().slice(0, 10)} /></${Field}>
      <${Field} label="Categoría principal"><${Select} placeholder="Selecciona" value=${f.main_category || ''} onChange=${set('main_category')} options=${CATEGORIES} /></${Field}>
      <${Field} full label="Biografía" hint=${`${(f.bio || '').length}/600 · Cuéntanos qué creas y para quién (mínimo 30 caracteres).`} error=${errors.bio}>
        <${Textarea} value=${f.bio} onInput=${set('bio')} maxlength="600" rows="4" /></${Field}>
      <div class="field full"><span class="label">Categorías secundarias <span class="opt">(hasta 6)</span></span>
        <${ChipSelect} options=${CATEGORIES.filter(c => c !== f.main_category)} value=${f.secondary_categories || []} max=${6} onChange=${v => setF({ ...f, secondary_categories: v })} /></div>
    </div>
    <div class="row between">
      <${Button} onClick=${() => save(false)} loading=${busy}>Guardar</${Button}>
      <${Button} type="submit" variant="primary" loading=${busy}>Guardar y continuar</${Button}>
    </div>
  </form>`;
}

const emptyAccount = () => ({ platform: 'instagram', handle: '', url: '', followers_declared: '', avg_views_declared: '', engagement_declared: '', audience_notes: '' });

function StepSocial({ uid, data, reload, next, back }) {
  const [editing, setEditing] = useState(data.social.length ? null : emptyAccount());
  const [errors, setErrors] = useState({});
  const [busy, run] = useAction();
  async function save() {
    const a = editing; const e = {};
    if (!a.handle.trim()) e.handle = 'Escribe tu usuario.';
    if (a.url && !/^https?:\/\//i.test(a.url)) e.url = 'El enlace debe empezar con https://';
    if (a.engagement_declared !== '' && (Number(a.engagement_declared) < 0 || Number(a.engagement_declared) > 100)) e.engagement_declared = 'Entre 0 y 100.';
    setErrors(e); if (Object.keys(e).length) return;
    const row = { platform: a.platform, handle: a.handle.trim(), url: a.url || null,
      followers_declared: a.followers_declared === '' ? null : Number(a.followers_declared),
      avg_views_declared: a.avg_views_declared === '' ? null : Number(a.avg_views_declared),
      engagement_declared: a.engagement_declared === '' ? null : Number(a.engagement_declared),
      audience_notes: a.audience_notes || null, evidence_path: a.evidence_path || null };
    await run(async () => {
      if (a.id) await q(supabase.from('creator_social_accounts').update(row).eq('id', a.id));
      else await q(supabase.from('creator_social_accounts').insert({ ...row, user_id: uid }));
      setEditing(null); await reload();
    }, { success: 'Red guardada.' });
  }
  const del = id => run(async () => { await q(supabase.from('creator_social_accounts').delete().eq('id', id)); await reload(); }, { success: 'Red eliminada.' });
  const set = k => e => setEditing({ ...editing, [k]: e.target.value });

  return html`<div class="form">
    <h2>Redes sociales</h2>
    <p class="muted small">Las métricas que indiques quedan como <strong>declaradas</strong>. Vocera las verifica antes de usarlas en una propuesta.</p>
    ${data.social.length > 0 && html`<div class="list">${data.social.map(s => html`<div class="list-row" style="grid-template-columns:1fr auto">
      <div><span class="t">${PLATFORMS[s.platform]} · ${s.handle}</span>
        <span class="s" style="display:block">${compact(s.followers_verified ?? s.followers_declared)} seguidores · ${s.engagement_verified ?? s.engagement_declared ?? '-'} % interacción ·
          ${s.verified_at ? html`<span class="badge tone-ok">Verificado por Vocera</span>` : html`<span class="badge tone-wait">Declarado</span>`}</span></div>
      <div class="row"><${Button} size="sm" onClick=${() => setEditing({ ...emptyAccount(), ...s, followers_declared: s.followers_declared ?? '', avg_views_declared: s.avg_views_declared ?? '', engagement_declared: s.engagement_declared ?? '' })}>Editar</${Button}>
        <${Button} size="sm" variant="ghost" onClick=${() => del(s.id)} aria-label=${'Eliminar ' + s.handle}>Eliminar</${Button}></div>
    </div>`)}</div>`}
    ${editing ? html`<div class="panel panel-pad" style="background:var(--papel-2)">
      <div class="form-grid">
        <${Field} label="Plataforma"><${Select} value=${editing.platform} onChange=${set('platform')} options=${Object.entries(PLATFORMS)} /></${Field}>
        <${Field} label="Usuario" error=${errors.handle}><${Input} value=${editing.handle} onInput=${set('handle')} placeholder="@tuusuario" /></${Field}>
        <${Field} full label="Enlace al perfil" optional error=${errors.url}><${Input} type="url" value=${editing.url || ''} onInput=${set('url')} placeholder="https://" /></${Field}>
        <${Field} label="Seguidores"><${Input} type="number" min="0" inputmode="numeric" value=${editing.followers_declared} onInput=${set('followers_declared')} /></${Field}>
        <${Field} label="Promedio de visualizaciones" optional><${Input} type="number" min="0" inputmode="numeric" value=${editing.avg_views_declared} onInput=${set('avg_views_declared')} /></${Field}>
        <${Field} label="Interacción (%)" optional hint="Interacciones ÷ alcance o seguidores, según tu plataforma." error=${errors.engagement_declared}>
          <${Input} type="number" min="0" max="100" step="0.1" inputmode="decimal" value=${editing.engagement_declared} onInput=${set('engagement_declared')} /></${Field}>
        <${Field} full label="Características de tu audiencia" optional hint="Edad, ciudades, intereses. Lo que sepas por tus estadísticas.">
          <${Textarea} rows="3" value=${editing.audience_notes || ''} onInput=${set('audience_notes')} maxlength="500" /></${Field}>
        <div class="field full"><span class="label">Captura de tus métricas <span class="opt">(opcional)</span></span>
          ${editing.evidence_path ? html`<p class="small">Archivo cargado. <${FileLink} bucket="documents" path=${editing.evidence_path} /></p>`
            : html`<${FileDrop} kind="image" ownerId=${uid} folder="metricas" onUploaded=${f => setEditing(x => ({ ...x, evidence_path: f.path }))} label="Sube una captura de tus estadísticas" />`}</div>
      </div>
      <div class="row" style="margin-top:16px">
        <${Button} variant="dark" loading=${busy} onClick=${save}>Guardar red</${Button}>
        ${data.social.length > 0 && html`<${Button} variant="ghost" onClick=${() => setEditing(null)}>Cancelar</${Button}>`}
      </div>
    </div>` : html`<div><${Button} onClick=${() => setEditing(emptyAccount())}><${Icon} name="plus" size="18" />Agregar otra red</${Button}></div>`}
    <div class="row between"><${Button} variant="ghost" onClick=${back}>Atrás</${Button}><${Button} variant="primary" onClick=${next}>Continuar</${Button}></div>
  </div>`;
}

function StepCommercial({ uid, data, reload, next, back }) {
  const [f, setF] = useState({ availability: data.c.availability || '', availability_note: data.c.availability_note || '',
    collaboration_modes: data.c.collaboration_modes || [], portfolio: (data.c.portfolio_links || []).join('\n'), default_currency: data.c.default_currency || 'PEN' });
  const [rates, setRates] = useState(data.rates.length ? data.rates.map(r => ({ ...r })) : [{ rate_type: 'video', amount: '', currency: f.default_currency }]);
  const [errors, setErrors] = useState({});
  const [busy, run] = useAction();
  async function save(goNext) {
    const e = {};
    const links = f.portfolio.split(/\s+/).map(s => s.trim()).filter(Boolean);
    if (links.some(l => !/^https?:\/\//i.test(l))) e.portfolio = 'Cada enlace debe empezar con https://';
    if (links.length > 10) e.portfolio = 'Máximo 10 enlaces.';
    const valid = rates.filter(r => r.amount !== '' && r.amount !== null);
    if (valid.some(r => Number(r.amount) < 0)) e.rates = 'Las tarifas no pueden ser negativas.';
    const keys = valid.map(r => r.rate_type + r.currency);
    if (new Set(keys).size !== keys.length) e.rates = 'Hay tarifas repetidas para el mismo tipo y moneda.';
    setErrors(e); if (Object.keys(e).length) return;
    await run(async () => {
      await q(supabase.from('creator_profiles').upsert({ user_id: uid, availability: f.availability || null, availability_note: f.availability_note || null,
        collaboration_modes: f.collaboration_modes, portfolio_links: links, default_currency: f.default_currency }, { onConflict: 'user_id' }));
      await q(supabase.from('creator_rates').delete().eq('user_id', uid));
      if (valid.length) await q(supabase.from('creator_rates').insert(valid.map(r => ({ user_id: uid, rate_type: r.rate_type, amount: Number(r.amount), currency: r.currency, notes: r.notes || null }))));
      await reload(); if (goNext) next();
    }, { success: 'Guardado.' });
  }
  return html`<div class="form">
    <h2>Perfil comercial</h2>
    <div class="field"><span class="label">Tarifas de referencia</span>
      <p class="hint">Son tu punto de partida. El honorario de cada campaña se acuerda caso por caso.</p>
      ${rates.map((r, i) => html`<div class="input-group" style="margin-top:8px">
        <${Select} aria-label="Tipo de tarifa" value=${r.rate_type} onChange=${e => setRates(rates.map((x, j) => j === i ? { ...x, rate_type: e.target.value } : x))} options=${Object.entries(RATE_TYPES)} />
        <${Input} aria-label="Monto" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Monto" value=${r.amount} onInput=${e => setRates(rates.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} />
        <${Select} aria-label="Moneda" value=${r.currency} onChange=${e => setRates(rates.map((x, j) => j === i ? { ...x, currency: e.target.value } : x))} options=${CURRENCIES} />
        <${Button} variant="ghost" aria-label="Quitar tarifa" onClick=${() => setRates(rates.filter((_, j) => j !== i))}><${Icon} name="x" size="18" /></${Button}>
      </div>`)}
      ${errors.rates && html`<p class="err" role="alert">${errors.rates}</p>`}
      <div style="margin-top:10px"><${Button} size="sm" onClick=${() => setRates([...rates, { rate_type: 'post', amount: '', currency: f.default_currency }])}><${Icon} name="plus" size="16" />Agregar tarifa</${Button}></div>
    </div>
    <div class="form-grid">
      <${Field} label="Moneda principal"><${Select} value=${f.default_currency} onChange=${e => setF({ ...f, default_currency: e.target.value })} options=${CURRENCIES} /></${Field}>
      <${Field} label="Disponibilidad"><${Select} placeholder="Selecciona" value=${f.availability} onChange=${e => setF({ ...f, availability: e.target.value })} options=${Object.entries(AVAILABILITY)} /></${Field}>
      <${Field} full label="Detalle de disponibilidad" optional><${Input} value=${f.availability_note} onInput=${e => setF({ ...f, availability_note: e.target.value })} placeholder="Ej. fines de semana, desde noviembre" maxlength="300" /></${Field}>
    </div>
    <div class="field"><span class="label">Modalidades de colaboración</span><${ChipSelect} options=${COLLAB_MODES} value=${f.collaboration_modes} onChange=${v => setF({ ...f, collaboration_modes: v })} /></div>
    <${Field} label="Portafolio o trabajos anteriores" hint="Pega un enlace por línea (videos, perfiles o carpetas compartidas)." error=${errors.portfolio}>
      <${Textarea} rows="4" value=${f.portfolio} onInput=${e => setF({ ...f, portfolio: e.target.value })} placeholder="https://" /></${Field}>
    <div class="row between"><${Button} variant="ghost" onClick=${back}>Atrás</${Button}>
      <div class="row"><${Button} onClick=${() => save(false)} loading=${busy}>Guardar</${Button}><${Button} variant="primary" onClick=${() => save(true)} loading=${busy}>Guardar y continuar</${Button}></div></div>
  </div>`;
}

function StepExtra({ uid, data, reload, back, status }) {
  const [accepts, setAccepts] = useState(!!data.c.accepts_product_campaigns);
  const [f, setF] = useState({ shipping_recipient: data.priv.shipping_recipient || '', shipping_address: data.priv.shipping_address || '',
    shipping_city: data.priv.shipping_city || '', shipping_reference: data.priv.shipping_reference || '' });
  const [busy, run] = useAction();
  const [sent, setSent] = useState(status === 'in_review');
  const comp = data.completion;
  async function saveExtra() {
    await run(async () => {
      await q(supabase.from('creator_profiles').upsert({ user_id: uid, accepts_product_campaigns: accepts }, { onConflict: 'user_id' }));
      if (accepts) await q(supabase.from('creator_private_details').upsert({ user_id: uid, ...f }, { onConflict: 'user_id' }));
      await reload();
    }, { success: 'Guardado.' });
  }
  const submit = () => run(async () => { await saveExtra(); await rpc('submit_profile_for_review'); await loadProfile(); setSent(true); });
  if (sent) return html`<div class="empty" style="padding:24px 0">
    <${Icon} name="check" size="32" /><strong>¡Listo! Recibimos tu perfil.</strong>
    <p>Quedará disponible para evaluación por el equipo de Vocera. Te avisaremos aquí cuando tengamos una respuesta.</p>
    <a class="btn btn-primary" href="#/" style="margin-top:16px">Ir a mi inicio</a></div>`;
  return html`<div class="form">
    <h2>Datos adicionales</h2>
    <label class="check"><input type="checkbox" checked=${accepts} onChange=${e => setAccepts(e.target.checked)} />
      <span><strong>Acepto campañas que incluyen envío de producto</strong><br/><span class="muted small">Solo entonces te pediremos una dirección de envío.</span></span></label>
    ${accepts && html`<div class="form-grid">
      <${Field} label="Nombre de quien recibe"><${Input} value=${f.shipping_recipient} onInput=${e => setF({ ...f, shipping_recipient: e.target.value })} /></${Field}>
      <${Field} label="Ciudad / distrito"><${Input} value=${f.shipping_city} onInput=${e => setF({ ...f, shipping_city: e.target.value })} /></${Field}>
      <${Field} full label="Dirección de envío"><${Input} autocomplete="street-address" value=${f.shipping_address} onInput=${e => setF({ ...f, shipping_address: e.target.value })} maxlength="300" /></${Field}>
      <${Field} full label="Referencia" optional><${Input} value=${f.shipping_reference} onInput=${e => setF({ ...f, shipping_reference: e.target.value })} /></${Field}>
    </div>`}
    <div class="notice"><div><strong>Datos bancarios: puedes completarlos después</strong>Los necesitaremos recién cuando tengas un pago por recibir. <a href="#/pagos/datos">Registrarlos ahora</a></div></div>
    <div class="notice"><div><strong>Documentos contractuales</strong>Si una campaña requiere documentación adicional, te la pediremos dentro de esa campaña.</div></div>
    ${!comp.can_submit && status !== 'approved' && html`<div class="notice warn"><div><strong>Para enviar tu perfil te falta:</strong>${comp.items.filter(i => !i.done).map(i => i.label).join(' · ')}</div></div>`}
    <div class="row between"><${Button} variant="ghost" onClick=${back}>Atrás</${Button}>
      ${['incomplete', 'rejected'].includes(status)
        ? html`<${Button} variant="primary" loading=${busy} disabled=${!comp.can_submit} onClick=${submit}>Enviar perfil a revisión</${Button}>`
        : html`<${Button} variant="primary" loading=${busy} onClick=${saveExtra}>Guardar</${Button}>`}
    </div>
  </div>`;
}
