// Punto de entrada del portal: inicializa Supabase, la sesión y las rutas.
import { html, render, useEffect, useState } from '../vendor/preact.js';
import { initClient, supabase, config } from './lib/sb.js';
import { startSession, useSession } from './lib/session.js';
import { usePath, match, href, navigate, replaceHash } from './lib/router.js';
import { Icon, Iso, Toasts, AskHost, Avatar, Loading, Empty } from './ui/kit.js';
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
const SHORT = { 'Mis campañas': 'Campañas', 'Mis pagos': 'Pagos', 'Mi perfil': 'Perfil' };
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
    <header class="pill-wrap">
      <div class="pill-nav">
        <a class="brand" href=${href(isAdmin ? '/admin' : '/')} aria-label="Vocera, inicio"><${Iso} /><span>VOCERA</span><small>${isAdmin ? 'Panel' : 'Creadores'}</small></a>
        <nav class="pill-links" aria-label="Navegación principal">${nav.map(([to, l]) => html`<a href=${href(to)} aria-current=${active(to)}>${l}</a>`)}</nav>
        <div class="pill-tools">
          <a class="icon-btn bell" href=${href('/notificaciones')} aria-current=${active('/notificaciones')} aria-label=${unread ? `Notificaciones (${unread} sin leer)` : 'Notificaciones'}><${Icon} name="bell" />${unread > 0 && html`<span class="dot">${unread > 99 ? '99+' : unread}</span>`}</a>
          <a class="icon-btn" href=${href('/cuenta')} aria-current=${active('/cuenta')} aria-label="Cuenta y seguridad"><${Icon} name="shield" /></a>
          <span class="who hide-mobile" title=${p?.full_name}><${Avatar} name=${p?.full_name} /></span>
          <button class="icon-btn" type="button" onClick=${signOut} aria-label="Cerrar sesión" title="Cerrar sesión"><${Icon} name="logout" /></button>
        </div>
      </div>
    </header>
    <main class="content" id="main" tabindex="-1"><div class="page-enter" key=${path}>${page || html`<${Empty} title="Página no encontrada" action=${html`<a class="btn" href=${href(isAdmin ? '/admin' : '/')}>Ir al inicio</a>`}>Revisa el enlace o vuelve al inicio.</${Empty}>`}</div></main>
    <nav class="tabbar" aria-label="Navegación">
      ${nav.map(([to, l, ic]) => html`<a href=${href(to)} aria-current=${active(to)}><${Icon} name=${ic} />${SHORT[l] || l}</a>`)}
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
  if (path === '/bienvenida') return html`<div class="content"><a class="brand" style="color:var(--tinta);padding:0"><${Iso} /><span>VOCERA</span></a><${Welcome} session=${session} /></div>`;
  return html`<${Shell} session=${session} path=${path} />`;
}

function ConfigMissing() {
  return html`<div class="config-missing stack">
    <a class="brand" style="color:var(--tinta);padding:0"><${Iso} /><span>VOCERA</span></a>
    <h1>El portal aún no está conectado</h1>
    <p class="muted">Falta configurar el proyecto de Supabase (URL y clave pública) en <code>portal/config.js</code>. Ver <code>docs/PORTAL.md</code>.</p>
  </div>`;
}

// Enlaces internos (#/ruta): se resuelven en este documento. Con un <base> distinto
// (por ejemplo, dentro de un iframe) el navegador los trataría como otra página.
document.addEventListener('click', e => {
  const a = e.target.closest && e.target.closest('a[href^="#"]');
  if (!a || a.target || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
  const h = a.getAttribute('href');
  e.preventDefault();
  if (h.startsWith('#/')) { if (location.hash !== h) location.hash = h; else window.dispatchEvent(new HashChangeEvent('hashchange')); }
  else if (h.length > 1) { const t = document.getElementById(h.slice(1)); if (t) { t.focus({ preventScroll: false }); t.scrollIntoView(); } }
});

(async () => {
  const root = document.getElementById('app');
  const ok = await initClient();
  if (!ok) { render(html`<${ConfigMissing} />`, root); return; }
  await startSession();
  // Tras abrir un enlace de correo, el hash con tokens ya fue procesado por supabase-js
  if (location.hash && !location.hash.startsWith('#/')) {
    const err = new URLSearchParams(location.hash.slice(1)).get('error_description');
    replaceHash('#/');
    if (err) setTimeout(() => import('./ui/kit.js').then(k => k.toast('El enlace no es válido o ya venció. Pide uno nuevo.', 'error')), 300);
  }
  render(html`<${App} /><${AskHost} /><${Toasts} />`, root);
})();
