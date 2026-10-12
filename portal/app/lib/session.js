// Estado de sesión compartido (sesión de Supabase + perfil con rol).
import { useEffect, useState } from '../../vendor/preact.js';
import { supabase } from './sb.js';

const state = { ready: false, session: null, profile: null, recovery: false };
const subs = new Set();
const emit = () => subs.forEach(f => f({ ...state }));

export async function loadProfile() {
  if (!state.session) { state.profile = null; return emit(); }
  const { data } = await supabase.from('profiles').select('id,role,full_name,email,phone,status,status_reason,welcome_seen_at,onboarding_step')
    .eq('id', state.session.user.id).maybeSingle();
  state.profile = data || null;
  emit();
}

export async function startSession() {
  const { data } = await supabase.auth.getSession();
  state.session = data.session;
  supabase.auth.onAuthStateChange((event, session) => {
    state.session = session;
    if (event === 'PASSWORD_RECOVERY') state.recovery = true;
    if (event === 'SIGNED_OUT') { state.profile = null; state.recovery = false; }
    // Evita llamadas a Supabase dentro del callback (recomendación de supabase-js)
    setTimeout(() => loadProfile(), 0);
  });
  await loadProfile();
  state.ready = true;
  emit();
}

export function clearRecovery() { state.recovery = false; emit(); }
export function getState() { return { ...state }; }
export function useSession() {
  const [s, set] = useState({ ...state });
  useEffect(() => { subs.add(set); return () => subs.delete(set); }, []);
  return s;
}
