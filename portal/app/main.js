// Punto de entrada del portal: inicializa Supabase, la sesión y las rutas.
import { html, render, useEffect, useState } from '../vendor/preact.js';
import { initClient, supabase, config } from './lib/sb.js';
import { startSession, useSession } from './lib/session.js';
import { usePath, match, href, navigate } from './lib/router.js';
import { Icon, Iso, Toasts, Avatar, Loading, Empty } from './ui/kit.js';
import { Login, Register, Forgot, ResetPassword, Legal } from './pages/auth.js';
import { Welcome, Profile } from './pages/profile.js';
import { CreatorHome, Notifications, Account } from './pages/home.js';
import { CampaignList, CampaignDetail } from './pages/campaign.js';
import { MyPayments, BankDetails } from './pages/payments.js';
import { AdminHome, AdminCreators, AdminCreatorDetail, AdminCampaigns, CampaignForm, AdminCampaignDetail, AdminPayments, AdminAudit } from './pages/admin.js';

const CREATOR_NAV = [['/', 'Inicio', 'home'], ['/campanas', 'Mis campañas', 'megaphone'], ['/pagos', 'Mis pagos', 'wallet'], ['/perfil', 'Mi perfil', 'user']];
const CREATOR_EXTRA = [['/notificaciones', 'Notificaciones', 'bell'], ['/cuenta', 'Cuenta y seguridad', 'shield']];
const ADMIN_NAV = [['/admin', 'Resumen', 'home'], ['/admin/creadores', 'Creadores', 'users'], ['/admin/campanas', 'Campañas', 'megaphone'],
  ['/admin/pagos', 'Pagos', 'wallet'], ['/admin/auditoria', 'Auditoría', 'list']];
const ADMIN_EXTRA = [['/notificaciones', 'Notificaciones', 'bell'], ['/cuenta', 'Cuenta y seguridad', 'shield']];

function routes(isAdmin) {
  const common = [['/notificaciones', 'Notificaciones', p => html`<${Notifications} onRead=${p.onRead} />`], ['/cuenta', 'Cuenta y seguridad', p => html`<${Account} session=${p.session} />`]];
  if (isAdmin) return [
    ['/admin', 'Resumen', () => html`<${AdminHome} />`],
    ['/admin/creadores', 'Creadores', () => html`<${AdminCreators} />`],
    ['/admin/creadores/:id', 'Creador', p => html`<${AdminCreatorDetail} id=${p.id} />`],
    ['/admin/campanas', 'Campañas', () => html`<${AdminCampaigns} />`],
    ['/admin/campanas/nueva', 'Nueva campaña', () => html`<${CampaignForm} />`],
    ['/admin/campanas/:id/editar', 'Editar campaña', p => html`<${CampaignForm} id=${p.id} />`],
    ['/admin/campanas/:id', 'Campaña', p => html`<${AdminCampaignDetail} id=${p.id} />`],
    ['/admin/asignaciones/:id', 'Participación', p => html`<${CampaignDetail} id=${p.id} admin session=${p.session} />`],
    ['/admin/pagos', 'Pagos', () => html`<${AdminPayments} />`],
    ['/admin/auditoria', 'Auditoría', () => html`<${AdminAudit} />`],
    ...common
  ];
  return [
    ['/', 'Inicio', p => html`<${CreatorHome} session=${p.session} />`],
    ['/bienvenida', 'Bienvenida', p => html`<${Welcome} session=${p.session} />`],
    ['/perfil', 'Mi perfil', p => html`<${Profile} session=${p.session} />`],
    ['/campanas', 'Mis campañas', () => html`<${CampaignList} />`],
    ['/campanas/:id', 'Campaña', p => html`<${CampaignDetail} id=${p.id} session=${p.session} />`],
    ['/pagos', 'Mis pagos', () => html`<${MyPayments} />`],
    ['/pagos/datos', 'Datos bancarios', () => html`<${BankDetails} />`],
    ...common
  ];
}

function useUnread(session, path) {
  const [n, setN] = useState(0);
  const refresh = () => supabase.from('notifications').select('id', { count: 'exact', head: false }).is('read_at', null).then(({ data }) => setN((data || []).length));
  useEffect(() => { if (session.session) refresh(); }, [path, session.session?.user?.id]);
  useEffect(() => { const t = setInterval(() => session.session && refresh(), 60000); return () => clearInterval(t); }, [session.session?.user?.id]);
  return [n, refresh];
}

function Shell({ session, path }) {
  const isAdmin = session.profile?.role === 'admin';
  const [unread, refreshUnread] = useUnread(session, path);
  const nav = isAdmin ? ADMIN_NAV : CREATOR_NAV;
  const extra = isAdmin ? ADMIN_EXTRA : CREATOR_EXTRA;
  const table = routes(isAdmin);
  let page = null; let title = 'Vocera';
  for (const [pattern, t, view] of table) {
    const m = match(pattern, path);
    if (m) { page = view({ ...m, session, onRead: refreshUnread }); title = t; break; }
  }
  useEffect(() => { document.title = `${title} · Portal Vocera`; }, [title]);
  const active = to => (to === '/' || to === '/admin' ? path === to : path === to || path.startsWith(to + '/')) ? 'page' : undefined;
  const signOut = async () => { await supabase.auth.signOut({ scope: 'local' }); navigate('/entrar', { replace: true }); };
  const p = session.profile;
  return html`<div class="app">
    <a href="#main" class="sr-only" onFocus=${e => e.target.classList.remove('sr-only')} onBlur=${e => e.target.classList.add('sr-only')}>Saltar al contenido</a>
    <aside class="sidebar" aria-label="Navegación principal">
      <a class="brand" href=${href(isAdmin ? '/admin' : '/')}><${Iso} /><span>VOCERA</span><small>${isAdmin ? 'Panel' : 'Creadores'}</small></a>
      <nav class="nav">${nav.map(([to, l, ic]) => html`<a href=${href(to)} aria-current=${active(to)}><${Icon} name=${ic} />${l}</a>`)}</nav>
      <div class="sidebar-foot nav">
        ${extra.map(([to, l, ic]) => html`<a href=${href(to)} aria-current=${active(to)}><${Icon} name=${ic} />${l}${to === '/notificaciones' && unread > 0 && html`<span class="count">${unread}</span>`}</a>`)}
        <a href="#" onClick=${e => { e.preventDefault(); signOut(); }}><${Icon} name="logout" />Cerrar sesión</a>
        <div class="who"><${Avatar} name=${p?.full_name} /><span>${p?.full_name}</span></div>
      </div>
    </aside>
    <div class="main">
      <header class="topbar">
        <a class="brand hide-desktop" href=${href(isAdmin ? '/admin' : '/')} style="padding:0;color:var(--tinta)" aria-label="Inicio"><${Iso} /></a>
        <span class="title">${title}</span>
        <a class="btn btn-ghost bell" href=${href('/notificaciones')} aria-label=${unread ? `Notificaciones (${unread} sin leer)` : 'Notificaciones'}><${Icon} name="bell" />${unread > 0 && html`<span class="dot">${unread > 9 ? '9+' : unread}</span>`}</a>
        <a class="btn btn-ghost" href=${href('/cuenta')} aria-label="Cuenta y seguridad"><${Icon} name="shield" /></a>
      </header>
      <main class="content" id="main" tabindex="-1">${page || html`<${Empty} title="Página no encontrada" action=${html`<a class="btn" href=${href(isAdmin ? '/admin' : '/')}>Ir al inicio</a>`}>Revisa el enlace o vuelve al inicio.</${Empty}>`}</main>
    </div>
    <nav class="tabbar" aria-label="Navegación">
      ${nav.slice(0, 4).map(([to, l, ic]) => html`<a href=${href(to)} aria-current=${active(to)}><${Icon} name=${ic} />${l.replace('Mis ', '').replace('Mi ', '')}</a>`)}
    </nav>
  </div>`;
}

function App() {
  const session = useSession();
  const path = usePath();
  if (!session.ready) return html`<div class="content"><${Loading} rows=${3} /></div>`;
  const authPaths = ['/entrar', '/registro', '/recuperar'];
  if (session.recovery && session.session) return html`<${ResetPassword} />`;
  if (path.startsWith('/legal/')) return html`<${Legal} doc=${path.split('/')[2]} />`;
  if (!session.session) {
    if (path === '/registro') return html`<${Register} />`;
    if (path === '/recuperar') return html`<${Forgot} />`;
    if (path !== '/entrar') { setTimeout(() => navigate('/entrar', { replace: true }), 0); return null; }
    return html`<${Login} />`;
  }
  if (!session.profile) return html`<div class="content"><${Loading} rows=${3} /></div>`;
  const isAdmin = session.profile.role === 'admin';
  // Redirecciones por rol y primer ingreso
  let to = null;
  if (authPaths.includes(path)) to = isAdmin ? '/admin' : '/';
  else if (isAdmin && !path.startsWith('/admin') && !['/notificaciones', '/cuenta'].includes(path)) to = '/admin';
  else if (!isAdmin && path.startsWith('/admin')) to = '/';
  else if (!isAdmin && !session.profile.welcome_seen_at && path !== '/bienvenida') to = '/bienvenida';
  if (to) { setTimeout(() => navigate(to, { replace: true }), 0); return null; }
  if (path === '/bienvenida') return html`<div class="content"><${Welcome} session=${session} /></div>`;
  return html`<${Shell} session=${session} path=${path} />`;
}

function ConfigMissing() {
  return html`<div class="config-missing stack">
    <a class="brand" style="color:var(--tinta);padding:0"><${Iso} /><span>VOCERA</span></a>
    <h1>El portal aún no está conectado</h1>
    <p class="muted">Falta configurar el proyecto de Supabase (URL y clave pública) en <code>portal/config.js</code>. Ver <code>docs/PORTAL.md</code>.</p>
  </div>`;
}

(async () => {
  const root = document.getElementById('app');
  const ok = await initClient();
  if (!ok) { render(html`<${ConfigMissing} />`, root); return; }
  await startSession();
  // Tras abrir un enlace de correo, el hash con tokens ya fue procesado por supabase-js
  if (location.hash && !location.hash.startsWith('#/')) {
    const err = new URLSearchParams(location.hash.slice(1)).get('error_description');
    history.replaceState(null, '', location.pathname + '#/');
    if (err) setTimeout(() => import('./ui/kit.js').then(k => k.toast('El enlace no es válido o ya venció. Pide uno nuevo.', 'error')), 300);
  }
  render(html`<${App} /><${Toasts} />`, root);
})();
