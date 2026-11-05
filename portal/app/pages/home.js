// Dashboard del creador, calendario, notificaciones y cuenta.
import { html, useState, useEffect } from '../../vendor/preact.js';
import { supabase, rpc, q, friendlyError } from '../lib/sb.js';
import { href, navigate } from '../lib/router.js';
import { ASSIGNMENT_STATUS, PROFILE_STATUS, money, date, relDays, dateTime } from '../lib/format.js';
import { Wave, CountUp, Badge, Button, Empty, Loading, ErrorBox, Icon, Avatar, Progress, Field, PasswordInput, toast, useAction, Confirm } from '../ui/kit.js';
import { passwordError } from './auth.js';
import { stageTrack } from '../lib/progress.js';

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
  const camps = useLoad(() => rpc('my_campaigns'));
  if (error) return html`<${ErrorBox} message=${error} retry=${reload} />`;
  if (!data) return html`<${Loading} rows=${4} />`;
  const p = data.profile;
  const first = (p.full_name || '').split(' ')[0];
  const actions = [...data.actions];
  if (p.status === 'incomplete' || p.status === 'rejected')
    actions.unshift({ label: data.completion.percent < 100 ? `Completar perfil (${data.completion.percent} %)` : 'Enviar perfil a revisión', href: '/perfil', priority: 0 });
  const needsPayout = !data.has_payout && data.actions.some(a => a.label === 'Completar datos de cobro');

  const money0 = data.money.length ? data.money : [{ currency: 'PEN', to_collect: 0, received: 0 }];
  const comp = data.completion;
  const [next, ...later] = actions;
  // Jerarquía: un único siguiente paso protagonista; luego campañas; dinero y fechas al costado.
  return html`<div class="home">
    <div class="page-head home-head">
      <div class="row" style="gap:16px">
        <${Avatar} lg name=${p.full_name} path=${p.avatar_path} />
        <div><h1>Hola, ${first}</h1><p style="margin-top:6px"><${Badge} map=${PROFILE_STATUS} value=${p.status} /></p></div>
      </div>
      ${comp.percent < 100 && html`<a class="profile-meter" href=${href('/perfil')}>
        <span class="small"><strong>Tu perfil está al ${comp.percent} %</strong>. ${comp.total - comp.done === 1 ? 'Falta 1 dato' : `Faltan ${comp.total - comp.done} datos`}</span>
        <${Progress} label="Perfil completado" value=${comp.percent} /></a>`}
    </div>

    ${(p.status === 'in_review' || needsPayout || p.status === 'rejected') && html`<div class="stack" style="--stack:10px;margin-bottom:24px">
      ${p.status === 'in_review' && html`<div class="notice"><div><strong>Perfil en revisión</strong>Te avisaremos cuando Vocera lo apruebe para empezar a recibir invitaciones.</div></div>`}
      ${p.status === 'rejected' && html`<div class="notice warn"><div><strong>Vocera te pidió cambios en tu perfil</strong>${p.status_reason || ''} <a href=${href('/perfil')}>Revisar</a></div></div>`}
      ${needsPayout && html`<div class="notice warn"><div><strong>Falta tu dato de cobro</strong>Sin él no podemos autorizar tus pagos. <a href=${href('/pagos/datos')}>Completar</a></div></div>`}
    </div>`}

    <${NextStep} action=${next} campaigns=${camps.data} />

    <div class="cols home-cols">
      <div class="stack" style="--stack:36px">
        ${later.length > 0 && html`<section aria-labelledby="h-actions">
          <div class="section-head"><h2 id="h-actions">Después</h2><span class="small muted">${later.length === 1 ? '1 pendiente' : later.length + ' pendientes'}</span></div>
          <div class="list">${later.map(a => html`
            <a class="list-row action-row" href=${actionHref(a)}>
              <span class="ico" aria-hidden="true"><${Icon} name="arrow" /></span>
              <span><span class="t">${a.label}</span>${a.campaign && html`<span class="s" style="display:block">${a.campaign}</span>`}</span>
              ${a.deadline ? html`<span class="small nowrap ${new Date(a.deadline) < new Date() ? 'err' : 'muted'}">${relDays(a.deadline)}</span>` : html`<span></span>`}
            </a>`)}</div>
        </section>`}
        <section aria-labelledby="h-camp">
          <div class="section-head"><h2 id="h-camp">Tus campañas</h2><a href=${href('/campanas')} class="small">Ver todas</a></div>
          <${RecentCampaigns} state=${camps} />
        </section>
      </div>
      <div class="stack" style="--stack:36px">
        <section aria-labelledby="h-money">
          <div class="section-head"><h2 id="h-money">Tus pagos</h2><a href=${href('/pagos')} class="small">Ver detalle</a></div>
          ${money0.map(m => html`<a class="money-card" href=${href('/pagos')}>
            <span class="l">Por cobrar</span>
            <span class="v num">${money(m.to_collect || 0, m.currency)}</span>
            <span class="s">Honorarios acordados que aún no se transfieren.</span>
            <span class="received"><span>Recibido</span><strong class="num">${money(m.received || 0, m.currency)}</strong></span>
          </a>`)}
        </section>
        <section aria-labelledby="h-cal"><div class="section-head"><h2 id="h-cal">Próximas fechas</h2></div><${Calendar} /></section>
      </div>
    </div>
  </div>`;
}

const actionHref = a => href(a.href || `/campanas/${a.assignment_id}?tab=${a.tab}`);

// El siguiente paso: un solo bloque en señal con una sola acción. Si no hay nada, se dice con calma.
function NextStep({ action, campaigns }) {
  if (!action) return html`<section class="next-step is-clear" aria-labelledby="h-next">
    <div><h2 id="h-next">Estás al día</h2><p>Cuando una campaña necesite algo de ti, aparecerá aquí primero.</p></div></section>`;
  const c = action.assignment_id && (campaigns || []).find(x => x.id === action.assignment_id);
  const track = c && stageTrack(c.status, c.requires || {});
  const late = action.deadline && new Date(action.deadline) < new Date();
  return html`<section class="next-step" aria-labelledby="h-next">
    <div class="ns-body">
      <p class="ns-kicker">Tu siguiente paso</p>
      <h2 id="h-next">${action.label}</h2>
      <p class="ns-meta">${action.campaign || 'Tu perfil'}${action.deadline ? html`<span class=${late ? 'ns-late' : ''}>${late ? 'Venció ' : 'Vence '}${relDays(action.deadline)}</span>` : ''}</p>
      <a class="btn btn-invert btn-lg" href=${actionHref(action)}>Ir ahora</a>
    </div>
    ${track && html`<div class="ns-track"><${Wave} track=${track} size="lg" label=${'Avance de ' + c.name} />
      <span class="small">${track.current ? `Etapa ${track.position} de ${track.total}: ${track.current.label}` : ''}</span></div>`}
  </section>`;
}

function RecentCampaigns({ state }) {
  const { data, error } = state;
  if (error) return html`<p class="err">${error}</p>`;
  if (!data) return html`<${Loading} rows=${2} />`;
  const list = data.filter(c => c.group !== 'history').slice(0, 5);
  return html`${list.length ? html`<${CampaignRows} items=${list} />`
      : html`<div class="panel"><${Empty} title="Todavía no tienes campañas">Cuando Vocera te invite a una campaña, la verás aquí con su brief, fechas y honorario.</${Empty}></div>`}`;
}

export function CampaignRows({ items }) {
  return html`<div class="list">${items.map(c => { const t = stageTrack(c.status, c.requires || {}); return html`<a class="list-row campaign-row" href=${href('/campanas/' + c.id)}>
    <span class="cr-main"><span class="t">${c.name}</span><span class="s">${c.brand || 'Marca confidencial'}</span></span>
    <span class="cr-status"><${Badge} map=${ASSIGNMENT_STATUS} value=${c.status} /></span>
    <span class="cr-track"><${Wave} track=${t} />${c.next_action && html`<span class="s">${c.next_action.label}</span>`}</span>
    <span class="cr-fig"><span class="num">${money(c.fee, c.currency)}</span>${c.deadline && html`<span class="s nowrap">${date(c.deadline, { year: false })}</span>`}</span>
  </a>`; })}</div>`;
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
        <p class="muted small">¿Quieres eliminar tu cuenta o descargar tus datos? Escríbenos a <a href="mailto:soporte@vocera.lat">soporte@vocera.lat</a>.</p>
      </div>
    </div>
    <${Confirm} open=${!!confirm} title=${confirm === 'others' ? 'Cerrar otras sesiones' : 'Cerrar todas las sesiones'} busy=${busy}
      onClose=${() => setConfirm(null)} onConfirm=${() => signOut(confirm)} confirmLabel="Cerrar sesiones">
      ${confirm === 'others' ? 'Seguirás conectado en este dispositivo.' : 'Tendrás que volver a iniciar sesión en todos tus dispositivos, incluido este.'}
    </${Confirm}>
  </div>`;
}
