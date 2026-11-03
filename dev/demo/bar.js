// Barra de la demo: aviso de datos ficticios, acceso rápido por rol y bandeja de correos.
import { html, render, useState, useEffect } from '../../portal/vendor/preact.js';
import { supabase } from '../../portal/app/lib/sb.js';
import { markRecovery } from '../../portal/app/lib/session.js';
import { navigate } from '../../portal/app/lib/router.js';
import { toast } from '../../portal/app/ui/kit.js';

const ACCOUNTS = [
  ['Creadora', 'lucia@vocera.demo', 'Entrar como creadora'],
  ['Admin', 'equipo@vocera.demo', 'Entrar como admin vocera'],
  ['En revisión', 'diego@vocera.demo', 'Entrar como creador en revisión']
];
const PASS = 'Demo2026';

function Bar({ backend }) {
  const [mails, setMails] = useState([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = () => backend.mailbox().then(setMails).catch(() => {});
  useEffect(() => { load(); return backend.onChange(load); }, []);
  const pending = mails.filter(m => !m.used_at).length;
  async function enter(email) {
    if (busy) return; setBusy(true);
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    const { error } = await supabase.auth.signInWithPassword({ email, password: PASS });
    setBusy(false);
    if (error) return toast('No se pudo entrar: ' + error.message, 'error');
    navigate('/', { replace: true });
  }
  async function openLink(m) {
    try {
      const r = await backend.openMailLink(m.token);
      const { error } = await supabase.auth.setSession({ access_token: r.session.access_token, refresh_token: r.session.refresh_token });
      if (error) throw error;
      if (r.kind === 'recovery') markRecovery();
      setOpen(false);
      navigate('/', { replace: true });
      toast(r.kind === 'recovery' ? 'Enlace abierto: crea tu nueva contraseña.' : 'Correo confirmado. Ya estás dentro.');
    } catch (e) { toast(e.message, 'error'); }
  }
  return html`<div class="demo-bar" role="region" aria-label="Controles de la demo">
    <div class="demo-bar-in">
      <span class="demo-tag">Demo</span>
      <span class="demo-note">Datos ficticios en este navegador. Se reinicia al recargar.</span>
      <span class="demo-acts"><span class="demo-lbl">Entrar como:</span>
        ${ACCOUNTS.map(([label, email, aria]) => html`<button type="button" class="demo-btn" aria-label=${aria} disabled=${busy} onClick=${() => enter(email)}>${label}</button>`)}
        <button type="button" class="demo-btn" aria-label="Correos de prueba" aria-expanded=${open} onClick=${() => setOpen(!open)}>Correos${pending ? ` (${pending})` : ''}</button>
      </span>
    </div>
    ${open && html`<div class="demo-mail">
      <p class="small">Aquí llegan los correos que en producción enviaría Supabase (confirmación de cuenta y recuperación de contraseña). Contraseña de las cuentas demo: <code>${PASS}</code></p>
      ${mails.length ? html`<ul>${mails.map(m => html`<li>
        <span><strong>${m.kind === 'signup' ? 'Confirma tu cuenta' : 'Restablece tu contraseña'}</strong> · ${m.email}</span>
        ${m.used_at ? html`<span class="small">Usado</span>` : html`<button type="button" class="demo-btn" onClick=${() => openLink(m)}>Abrir enlace</button>`}
      </li>`)}</ul>` : html`<p class="small">Sin correos todavía. Crea una cuenta o pide recuperar tu contraseña.</p>`}
    </div>`}
  </div>`;
}

export function mountDemoBar(backend) {
  const host = document.getElementById('demo-bar');
  render(html`<${Bar} backend=${backend} />`, host);
}
