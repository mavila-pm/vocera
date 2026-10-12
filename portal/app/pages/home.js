// Dashboard del creador, calendario, notificaciones y cuenta.
import { html, useState, useEffect } from '../../vendor/preact.js';
import { supabase, rpc, q, friendlyError } from '../lib/sb.js';
import { href, navigate } from '../lib/router.js';
import { ASSIGNMENT_STATUS, PROFILE_STATUS, money, date, relDays, dateTime } from '../lib/format.js';
import { Badge, Button, Empty, Loading, ErrorBox, Icon, Avatar, Progress, Field, PasswordInput, toast, useAction, Confirm } from '../ui/kit.js';
import { passwordError } from './auth.js';

export function useLoad(fn, deps = []) {
  const [state, set] = useState({ data: null, error: null, loading: true });
  const load = async () => {
    set(s => ({ ...s, loading: true, error: null }));
    try { set({ data: await fn(), error: null, loading: false }); } catch (e) { set({ data: null, error: e.message, loading: false }); }
  };
  useEffect(() => { load(); }, deps);
  return { ...state, reload: load };
}

export function CreatorHome({ session }) {
  const { data, error, reload } = useLoad(() => rpc('creator_dashboard'));
  if (error) return html`<${ErrorBox} message=${error} retry=${reload} />`;
  if (!data) return html`<${Loading} rows=${4} />`;
  const p = data.profile; const k = data.kpis;
  const first = (p.full_name || '').split(' ')[0];
  const actions = [...data.actions];
  if (p.status === 'incomplete' || p.status === 'rejected')
    actions.unshift({ label: data.completion.percent < 100 ? `Completar perfil (${data.completion.percent} %)` : 'Enviar perfil a revisión', href: '/perfil', priority: 0 });
  const needsPayout = !data.has_payout && data.actions.some(a => a.label === 'Completar datos de cobro');

  return html`<div>
    <div class="page-head">
      <div class="row" style="gap:16px">
        <${Avatar} lg name=${p.full_name} path=${p.avatar_path} />
        <div><h1>Hola, ${first}</h1><p style="margin-top:4px"><${Badge} map=${PROFILE_STATUS} value=${p.status} /></p></div>
      </div>
    </div>

    <div class="kpis" role="list">
      <a class="kpi" role="listitem" href=${href('/campanas?f=active')}><span class="v">${k.active}</span><span class="l">Campañas activas</span></a>
      <a class="kpi" role="listitem" href=${href('/campanas?f=invitations')}><span class="v">${k.invitations}</span><span class="l">Invitaciones nuevas</span></a>
      <a class="kpi" role="listitem" href=${href('/campanas?f=active')}><span class="v">${k.pending_deliverables}</span><span class="l">Entregables pendientes</span></a>
      <a class="kpi" role="listitem" href=${href('/campanas?f=finished')}><span class="v">${k.completed}</span><span class="l">Campañas completadas</span></a>
      ${(data.money.length ? data.money : [{ currency: 'PEN', to_collect: 0, received: 0 }]).map(m => html`
        <a class="kpi" role="listitem" href=${href('/pagos')}><span class="v">${money(m.to_collect || 0, m.currency)}</span><span class="l">Honorarios por cobrar</span></a>
        <a class="kpi" role="listitem" href=${href('/pagos')}><span class="v">${money(m.received || 0, m.currency)}</span><span class="l">Pagos recibidos</span></a>`)}
    </div>

    <div class="cols section">
      <div>
        <div class="section-head"><h2>Mis próximas acciones</h2></div>
        ${actions.length ? html`<div class="list">${actions.map(a => html`
          <a class="list-row action-row" href=${href(a.href || `/campanas/${a.assignment_id}?tab=${a.tab}`)}>
            <span class="ico"><${Icon} name="arrow" /></span>
            <span><span class="t">${a.label}</span>${a.campaign && html`<span class="s" style="display:block">${a.campaign}</span>`}</span>
            ${a.deadline ? html`<span class="small nowrap ${new Date(a.deadline) < new Date() ? 'err' : 'muted'}">${relDays(a.deadline)}</span>` : html`<span></span>`}
          </a>`)}</div>`
        : html`<div class="panel"><${Empty} title="Estás al día">Cuando tengas algo por hacer en una campaña, aparecerá aquí ordenado por prioridad.</${Empty}></div>`}

        <div class="section"><${RecentCampaigns} /></div>
      </div>
      <div>
        ${p.status === 'in_review' && html`<div class="notice" style="margin-bottom:16px"><div><strong>Perfil en revisión</strong>Te avisaremos cuando Vocera lo apruebe para empezar a recibir invitaciones.</div></div>`}
        ${needsPayout && html`<div class="notice warn" style="margin-bottom:16px"><div><strong>Falta tu dato de cobro</strong>Sin él no podemos autorizar tus pagos. <a href=${href('/pagos/datos')}>Completar</a></div></div>`}
        <div class="section-head"><h2>Calendario</h2></div>
        <${Calendar} />
      </div>
    </div>
  </div>`;
}

function RecentCampaigns() {
  const { data, error } = useLoad(() => rpc('my_campaigns'));
  if (error) return html`<p class="err">${error}</p>`;
  if (!data) return html`<${Loading} rows=${2} />`;
  const list = data.filter(c => c.group !== 'history').slice(0, 5);
  return html`<div class="section-head"><h2>Mis campañas recientes</h2><a href=${href('/campanas')} class="small">Ver todas</a></div>
    ${list.length ? html`<${CampaignRows} items=${list} />`
      : html`<div class="panel"><${Empty} title="Todavía no tienes campañas">Cuando Vocera te invite a una campaña, la verás aquí con su brief, fechas y honorario.</${Empty}></div>`}`;
}

export function CampaignRows({ items }) {
  return html`<div class="list">${items.map(c => html`<a class="list-row campaign-row" href=${href('/campanas/' + c.id)}>
    <span><span class="t">${c.name}</span><span class="s" style="display:block">${c.brand || 'Marca confidencial'}${c.next_action ? ' · ' + c.next_action.label : ''}</span></span>
    <span class="c2"><${Badge} map=${ASSIGNMENT_STATUS} value=${c.status} /></span>
    <span class="c3 num small">${money(c.fee, c.currency)}</span>
    <span class="c3 small muted nowrap">${c.deadline ? date(c.deadline, { year: false }) : ''}</span>
  </a>`)}</div>`;
}

export function Calendar({ admin }) {
  const from = new Date(); from.setDate(from.getDate() - 7);
  const to = new Date(); to.setDate(to.getDate() + 45);
  const { data, error } = useLoad(() => rpc('calendar_events', { p_from: from.toISOString().slice(0, 10), p_to: to.toISOString().slice(0, 10) }));
  if (error) return html`<p class="err">${error}</p>`;
  if (!data) return html`<${Loading} rows=${2} />`;
  if (!data.length) return html`<div class="panel"><${Empty} title="Sin fechas próximas">Aquí verás vencimientos de invitaciones, entregas, publicaciones y pagos.</${Empty}></div>`;
  const groups = data.reduce((acc, e) => { (acc[e.day] = acc[e.day] || []).push(e); return acc; }, {});
  return html`<div class="list">${Object.entries(groups).map(([day, evs]) => html`<div class="list-row" style="grid-template-columns:64px 1fr">
    <div><strong class="num">${date(day, { year: false })}</strong><span class="s" style="display:block">${relDays(day)}</span></div>
    <div class="stack" style="--stack:6px">${evs.map(e => html`<a href=${href((admin ? '/admin/asignaciones/' : '/campanas/') + e.assignment_id)} style="display:block;color:inherit;text-decoration:none">
      <span class="t" style="font-weight:600">${e.label}</span><span class="s" style="display:block">${e.campaign}</span></a>`)}</div>
  </div>`)}</div>`;
}

export function Notifications({ onRead }) {
  const { data, error, reload } = useLoad(() => q(supabase.from('notifications').select('id,type,title,body,link,read_at,created_at').order('created_at', { ascending: false }).limit(100)));
  const [busy, run] = useAction();
  if (error) return html`<${ErrorBox} message=${error} retry=${reload} />`;
  if (!data) return html`<${Loading} />`;
  const open = async n => {
    if (!n.read_at) await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id);
    onRead && onRead();
    if (n.link) navigate(n.link);
  };
  return html`<div>
    <div class="page-head"><div><h1>Notificaciones</h1></div>
      ${data.some(n => !n.read_at) && html`<${Button} loading=${busy} onClick=${() => run(async () => { await rpc('mark_all_notifications_read'); await reload(); onRead && onRead(); })}>Marcar todo como leído</${Button}>`}</div>
    ${data.length ? html`<div class="list">${data.map(n => html`<button class="list-row" style="grid-template-columns:10px 1fr auto" onClick=${() => open(n)}>
      <span style=${{ width: '8px', height: '8px', borderRadius: '50%', background: n.read_at ? 'transparent' : 'var(--senal)' }} aria-label=${n.read_at ? '' : 'No leída'}></span>
      <span><span class="t" style=${{ fontWeight: n.read_at ? 500 : 700 }}>${n.title}</span>${n.body && html`<span class="s" style="display:block">${n.body}</span>`}</span>
      <span class="small muted nowrap">${dateTime(n.created_at)}</span></button>`)}</div>`
      : html`<div class="panel"><${Empty} title="No tienes notificaciones">Te avisaremos aquí de invitaciones, revisiones, aprobaciones y pagos.</${Empty}></div>`}
  </div>`;
}

export function Account({ session }) {
  const [f, setF] = useState({ password: '', confirm: '' });
  const [err, setErr] = useState(null);
  const [busy, run] = useAction();
  const [confirm, setConfirm] = useState(null);
  async function change(e) {
    e.preventDefault();
    const pe = passwordError(f.password); if (pe) return setErr(pe);
    if (f.password !== f.confirm) return setErr('Las contraseñas no coinciden.');
    setErr(null);
    await run(async () => {
      const { error } = await supabase.auth.updateUser({ password: f.password });
      if (error) throw new Error(friendlyError(error));
      setF({ password: '', confirm: '' });
    }, { success: 'Contraseña actualizada.' });
  }
  const signOut = scope => run(async () => {
    const { error } = await supabase.auth.signOut({ scope });
    if (error) throw new Error(friendlyError(error));
    setConfirm(null);
    if (scope === 'others') toast('Cerramos tus otras sesiones.'); else navigate('/entrar', { replace: true });
  });
  const u = session.session.user;
  return html`<div>
    <div class="page-head"><div><h1>Cuenta y seguridad</h1><p>${u.email}</p></div></div>
    <div class="cols">
      <form class="panel panel-pad form" onSubmit=${change} novalidate>
        <h2>Cambiar contraseña</h2>
        <${Field} label="Nueva contraseña" hint="Mínimo 8 caracteres, con letras y números."><${PasswordInput} autocomplete="new-password" value=${f.password} onInput=${e => setF({ ...f, password: e.target.value })} /></${Field}>
        <${Field} label="Confirma la contraseña"><${PasswordInput} autocomplete="new-password" value=${f.confirm} onInput=${e => setF({ ...f, confirm: e.target.value })} /></${Field}>
        ${err && html`<p class="err" role="alert">${err}</p>`}
        <div><${Button} type="submit" variant="primary" loading=${busy}>Actualizar contraseña</${Button}></div>
      </form>
      <div class="panel panel-pad stack">
        <h2>Sesiones</h2>
        <p class="muted small">Último ingreso: ${dateTime(u.last_sign_in_at)}. Si usaste el portal en otro dispositivo, puedes cerrar esas sesiones.</p>
        <div class="row"><${Button} variant="dark" loading=${busy} onClick=${() => signOut('local')}>Cerrar sesión aquí</${Button}><${Button} onClick=${() => setConfirm('others')}>Cerrar otras sesiones</${Button}><${Button} onClick=${() => setConfirm('global')}>Cerrar todas</${Button}></div>
        <p class="muted small">¿Quieres eliminar tu cuenta o descargar tus datos? Escríbenos a <a href="mailto:hola@vocera.lat">hola@vocera.lat</a>.</p>
      </div>
    </div>
    <${Confirm} open=${!!confirm} title=${confirm === 'others' ? 'Cerrar otras sesiones' : 'Cerrar todas las sesiones'} busy=${busy}
      onClose=${() => setConfirm(null)} onConfirm=${() => signOut(confirm)} confirmLabel="Cerrar sesiones">
      ${confirm === 'others' ? 'Seguirás conectado en este dispositivo.' : 'Tendrás que volver a iniciar sesión en todos tus dispositivos, incluido este.'}
    </${Confirm}>
  </div>`;
}
