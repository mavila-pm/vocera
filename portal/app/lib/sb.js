// Cliente de Supabase + utilidades de llamada con mensajes claros en español.
import { createClient } from '../../vendor/supabase.js';

const cfg = window.VOCERA_CONFIG || {};
const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);

export let supabase = null;
export let config = { ...cfg };

export async function initClient() {
  if (isLocal && !cfg.supabaseUrl) {
    // Desarrollo: emulador local (dev/local-supabase/server.mjs)
    const base = `http://${location.hostname}:54321`;
    const res = await fetch(base + '/__dev/anon-key').catch(() => null);
    if (!res || !res.ok) return false;
    const { anon_key } = await res.json();
    config = { ...cfg, supabaseUrl: base, supabaseAnonKey: anon_key, local: true };
  }
  if (!config.supabaseUrl || !config.supabaseAnonKey) return false;
  supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'vocera-portal-auth' }
  });
  return true;
}

// Traducción de errores conocidos de Supabase Auth / Postgres
const AUTH_MESSAGES = {
  invalid_credentials: 'El correo o la contraseña no coinciden.',
  email_not_confirmed: 'Aún no confirmas tu correo. Revisa tu bandeja de entrada (y la de spam).',
  weak_password: 'La contraseña debe tener al menos 8 caracteres, con letras y números.',
  over_request_rate_limit: 'Demasiados intentos seguidos. Espera un minuto y vuelve a probar.',
  over_email_send_rate_limit: 'Ya enviamos un correo hace poco. Espera un minuto antes de pedir otro.',
  user_already_exists: 'Ya existe una cuenta con este correo.',
  same_password: 'La nueva contraseña debe ser distinta a la actual.',
  session_not_found: 'Tu sesión terminó. Vuelve a iniciar sesión.',
  refresh_token_not_found: 'Tu sesión terminó. Vuelve a iniciar sesión.',
  validation_failed: 'Revisa el formato del correo.'
};

export function friendlyError(e) {
  if (!e) return 'Algo salió mal. Vuelve a intentarlo.';
  const code = e.code || e.error_code;
  if (AUTH_MESSAGES[code]) return AUTH_MESSAGES[code];
  if (e.status === 413 || /exceeded the maximum/i.test(e.message || '')) return 'El archivo supera el tamaño máximo permitido.';
  if (e.status === 415 || /mime type/i.test(e.message || '')) return 'Ese formato de archivo no está permitido.';
  if (/row-level security|permission denied/i.test(e.message || '')) return 'No tienes permiso para esta acción.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(e.message || '')) return 'No hay conexión con el servidor. Revisa tu internet.';
  // Los mensajes de las funciones RPC ya vienen en español y redactados para el usuario.
  if (e.message && !/^[A-Z_]+$/.test(e.message)) return e.message;
  return 'Algo salió mal. Vuelve a intentarlo.';
}

export async function rpc(name, args = {}) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw Object.assign(new Error(friendlyError(error)), { raw: error });
  return data;
}

export async function q(promise) {
  const { data, error } = await promise;
  if (error) throw Object.assign(new Error(friendlyError(error)), { raw: error });
  return data;
}

export async function signedUrl(bucket, path, opts = {}) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, opts.expires || 300, opts.download ? { download: opts.download } : undefined);
  if (error) throw new Error(friendlyError(error));
  return data.signedUrl;
}
