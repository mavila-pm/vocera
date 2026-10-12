// Registro, inicio de sesión, verificación y recuperación de contraseña.
import { html, useState } from '../../vendor/preact.js';
import { supabase, friendlyError, config } from '../lib/sb.js';
import { navigate, href } from '../lib/router.js';
import { COUNTRIES } from '../lib/format.js';
import { Field, Input, Select, PasswordInput, Button, Iso, toast } from '../ui/kit.js';
import { clearRecovery } from '../lib/session.js';

const portalUrl = () => location.origin + location.pathname;

function AuthLayout({ children }) {
  return html`<div class="auth">
    <aside class="auth-side">
      <a class="brand" href="../" style="padding:0"><${Iso} /><span>VOCERA</span></a>
      <div>
        <h2>Tu voz, tus campañas y tus pagos en <em>un solo lugar.</em></h2>
        <p>El portal de Vocera para creadores: recibe invitaciones, entrega tu contenido y sigue cada pago con claridad.</p>
      </div>
      <svg class="bars" viewBox="0 0 620 420" aria-hidden="true"><g transform="translate(76 0) skewX(-19.8)" fill="rgba(236,238,240,.18)">
        ${[[60,174,72],[96,152,115],[132,124,173],[168,142,137],[204,98,223],[240,66,288],[276,30,360],[312,30,360],[348,84,252],[384,113,194],[420,102,216],[456,138,144],[492,161,97],[528,181,58]]
          .map(([x, y, h], i) => html`<rect x=${x} y=${y} width="22" height=${h} fill=${i === 6 || i === 7 ? '#ECEEF0' : i === 4 || i === 9 ? '#7D98F0' : undefined} />`)}
      </g></svg>
      <p class="small" style="opacity:.6">© Vocera</p>
    </aside>
    <main class="auth-main" id="main"><div class="auth-card">${children}</div></main>
  </div>`;
}

export function scorePassword(p) {
  let s = 0;
  if (p.length >= 8) s++;
  if (p.length >= 12) s++;
  if (/[a-z]/i.test(p) && /\d/.test(p)) s++;
  if (/[^a-z0-9]/i.test(p)) s++;
  return Math.min(4, s);
}
export const passwordError = p => (p.length < 8 || !/[a-z]/i.test(p) || !/\d/.test(p)) ? 'Usa al menos 8 caracteres, con letras y números.' : null;

export function Login() {
  const [f, setF] = useState({ email: '', password: '' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);
  async function submit(e) {
    e.preventDefault(); if (busy) return;
    setErr(null); setUnconfirmed(false); setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: f.email.trim(), password: f.password });
    setBusy(false);
    if (error) { setErr(friendlyError(error)); setUnconfirmed(error.code === 'email_not_confirmed'); return; }
    navigate('/', { replace: true });
  }
  async function resend() {
    const { error } = await supabase.auth.resend({ type: 'signup', email: f.email.trim(), options: { emailRedirectTo: portalUrl() } });
    toast(error ? friendlyError(error) : 'Te enviamos un nuevo enlace de confirmación.', error ? 'error' : 'ok');
  }
  return html`<${AuthLayout}>
    <h1>Inicia sesión</h1>
    <p class="sub">Entra a tu espacio en Vocera.</p>
    <form class="form" onSubmit=${submit} novalidate>
      <${Field} label="Correo"><${Input} type="email" autocomplete="email" required value=${f.email} onInput=${e => setF({ ...f, email: e.target.value })} /></${Field}>
      <${Field} label="Contraseña"><${PasswordInput} autocomplete="current-password" required value=${f.password} onInput=${e => setF({ ...f, password: e.target.value })} /></${Field}>
      ${err && html`<div class="notice error" role="alert"><div>${err}${unconfirmed && html` <button type="button" class="link-btn" onClick=${resend}>Reenviar enlace</button>`}</div></div>`}
      <${Button} type="submit" variant="primary" block loading=${busy}>Entrar</${Button}>
    </form>
    <p class="auth-foot"><a href=${href('/recuperar')}>¿Olvidaste tu contraseña?</a></p>
    <p class="auth-foot">¿Eres creador y aún no tienes cuenta? <a href=${href('/registro')}>Crea tu cuenta</a></p>
  </${AuthLayout}>`;
}

export function Register() {
  const [f, setF] = useState({ full_name: '', email: '', cc: '+51', phone: '', password: '', confirm: '', terms: false });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const set = k => e => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  function validate() {
    const e = {};
    if (f.full_name.trim().length < 3) e.full_name = 'Escribe tu nombre y apellido.';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) e.email = 'Revisa el correo: debe tener la forma nombre@dominio.com.';
    const digits = f.phone.replace(/\D/g, '');
    if (digits.length < 6 || digits.length > 12) e.phone = 'Escribe tu número sin el código de país.';
    const pe = passwordError(f.password); if (pe) e.password = pe;
    if (f.confirm !== f.password) e.confirm = 'Las contraseñas no coinciden.';
    if (!f.terms) e.terms = 'Necesitamos tu aceptación para crear la cuenta.';
    setErrors(e);
    return !Object.keys(e).length;
  }
  async function submit(ev) {
    ev.preventDefault(); if (busy || !validate()) return;
    setBusy(true);
    const phone = f.cc + f.phone.replace(/\D/g, '');
    const { error } = await supabase.auth.signUp({
      email: f.email.trim().toLowerCase(), password: f.password,
      options: { emailRedirectTo: portalUrl(), data: { full_name: f.full_name.trim(), phone, terms_accepted: 'true', terms_version: config.termsVersion } }
    });
    setBusy(false);
    if (error) { setErrors({ form: friendlyError(error) }); return; }
    setDone(true);
  }
  if (done) return html`<${AuthLayout}>
    <h1>Revisa tu correo</h1>
    <p class="sub">Te enviamos un enlace a <strong>${f.email}</strong> para confirmar tu cuenta. Ábrelo desde este dispositivo para entrar directamente.</p>
    <div class="notice"><div>Si no lo ves en unos minutos, revisa la carpeta de spam o promociones.</div></div>
    <p class="auth-foot"><a href=${href('/entrar')}>Volver a iniciar sesión</a></p>
  </${AuthLayout}>`;

  const score = scorePassword(f.password);
  return html`<${AuthLayout}>
    <h1>Crea tu cuenta de creador</h1>
    <p class="sub">Toma un minuto. Después completarás tu perfil a tu ritmo.</p>
    <form class="form" onSubmit=${submit} novalidate>
      <${Field} label="Nombre completo" error=${errors.full_name}><${Input} autocomplete="name" value=${f.full_name} onInput=${set('full_name')} /></${Field}>
      <${Field} label="Correo" error=${errors.email}><${Input} type="email" autocomplete="email" inputmode="email" value=${f.email} onInput=${set('email')} /></${Field}>
      <${Field} label="Teléfono" hint="Lo usamos para coordinar campañas contigo." error=${errors.phone}>
        <div class="input-group">
          <${Select} aria-label="Código de país" value=${f.cc} onChange=${set('cc')} options=${COUNTRIES.filter((c, i, a) => a.findIndex(x => x[2] === c[2]) === i).map(c => [c[2], c[0] + ' ' + c[2]])} />
          <${Input} type="tel" autocomplete="tel-national" inputmode="tel" placeholder="987 654 321" value=${f.phone} onInput=${set('phone')} aria-label="Número de teléfono" />
        </div>
      </${Field}>
      <${Field} label="Contraseña" error=${errors.password} hint="Mínimo 8 caracteres, con letras y números.">
        <${PasswordInput} autocomplete="new-password" value=${f.password} onInput=${set('password')} />
      </${Field}>
      ${f.password && html`<div class="strength" data-score=${score} aria-label=${'Seguridad de la contraseña: ' + ['muy baja', 'baja', 'media', 'buena', 'alta'][score]}><span></span><span></span><span></span><span></span></div>`}
      <${Field} label="Confirma la contraseña" error=${errors.confirm}><${PasswordInput} autocomplete="new-password" value=${f.confirm} onInput=${set('confirm')} /></${Field}>
      <div>
        <label class="check"><input type="checkbox" checked=${f.terms} onChange=${set('terms')} aria-invalid=${errors.terms ? 'true' : undefined} />
          <span>Acepto los <a href=${href('/legal/terminos')} target="_blank">términos de uso</a> y la <a href=${href('/legal/privacidad')} target="_blank">política de privacidad</a> de Vocera.</span></label>
        ${errors.terms && html`<p class="err" role="alert">${errors.terms}</p>`}
      </div>
      ${errors.form && html`<div class="notice error" role="alert"><div>${errors.form}</div></div>`}
      <${Button} type="submit" variant="primary" block loading=${busy}>Crear cuenta</${Button}>
    </form>
    <p class="auth-foot">¿Ya tienes cuenta? <a href=${href('/entrar')}>Inicia sesión</a></p>
  </${AuthLayout}>`;
}

export function Forgot() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState(null);
  async function submit(e) {
    e.preventDefault(); if (busy) return;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { setErr('Revisa el formato del correo.'); return; }
    setBusy(true); setErr(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: portalUrl() });
    setBusy(false);
    if (error) { setErr(friendlyError(error)); return; }
    setSent(true);
  }
  return html`<${AuthLayout}>
    <h1>Recupera tu acceso</h1>
    ${sent ? html`<p class="sub">Si existe una cuenta con <strong>${email}</strong>, recibirás un enlace para crear una nueva contraseña. El enlace vence en 24 horas.</p>`
      : html`<p class="sub">Te enviaremos un enlace para crear una nueva contraseña.</p>
      <form class="form" onSubmit=${submit} novalidate>
        <${Field} label="Correo" error=${err}><${Input} type="email" autocomplete="email" value=${email} onInput=${e => setEmail(e.target.value)} /></${Field}>
        <${Button} type="submit" variant="primary" block loading=${busy}>Enviar enlace</${Button}>
      </form>`}
    <p class="auth-foot"><a href=${href('/entrar')}>Volver a iniciar sesión</a></p>
  </${AuthLayout}>`;
}

// Se muestra tras abrir el enlace de recuperación (evento PASSWORD_RECOVERY)
export function ResetPassword() {
  const [f, setF] = useState({ password: '', confirm: '' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault(); if (busy) return;
    const pe = passwordError(f.password); if (pe) return setErr(pe);
    if (f.password !== f.confirm) return setErr('Las contraseñas no coinciden.');
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: f.password });
    setBusy(false);
    if (error) return setErr(friendlyError(error));
    clearRecovery();
    toast('Listo, tu contraseña fue actualizada.');
    navigate('/', { replace: true });
  }
  return html`<${AuthLayout}>
    <h1>Crea una nueva contraseña</h1>
    <p class="sub">Elige una contraseña que no uses en otros sitios.</p>
    <form class="form" onSubmit=${submit} novalidate>
      <${Field} label="Nueva contraseña" hint="Mínimo 8 caracteres, con letras y números."><${PasswordInput} autocomplete="new-password" value=${f.password} onInput=${e => setF({ ...f, password: e.target.value })} /></${Field}>
      <${Field} label="Confirma la contraseña"><${PasswordInput} autocomplete="new-password" value=${f.confirm} onInput=${e => setF({ ...f, confirm: e.target.value })} /></${Field}>
      ${err && html`<div class="notice error" role="alert"><div>${err}</div></div>`}
      <${Button} type="submit" variant="primary" block loading=${busy}>Guardar contraseña</${Button}>
    </form>
  </${AuthLayout}>`;
}

// Textos legales: BORRADOR pendiente de revisión por un abogado
export function Legal({ doc }) {
  return html`<${AuthLayout}>
    <h1>${doc === 'privacidad' ? 'Política de privacidad' : 'Términos de uso'}</h1>
    <div class="notice warn" style="margin:16px 0"><div><strong>Documento pendiente</strong>Vocera publicará aquí el texto legal revisado por un profesional. Este portal no debe abrirse al público hasta entonces.</div></div>
    <p class="muted">Mientras tanto, los datos que registras se usan solo para gestionar tu participación en campañas de Vocera. Puedes pedir la eliminación de tu cuenta escribiendo a hola@vocera.lat.</p>
    <p class="auth-foot"><a href=${href('/registro')}>Volver</a></p>
  </${AuthLayout}>`;
}
