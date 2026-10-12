/* Configuración pública del portal.
   La URL del proyecto y la "anon key" de Supabase son públicas por diseño:
   la seguridad la dan las políticas RLS y las funciones del servidor.
   NUNCA pongas aquí la service_role key ni otros secretos.
   En localhost se usa el emulador de dev/local-supabase automáticamente. */
window.VOCERA_CONFIG = {
  supabaseUrl: '',          // p. ej. https://xxxxxxxx.supabase.co  (pendiente: proyecto no creado)
  supabaseAnonKey: '',      // anon key del proyecto
  termsVersion: '2026-10-borrador',
  resumableThresholdBytes: 50 * 1024 * 1024
};
