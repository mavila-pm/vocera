// Etiquetas, tonos y formatos compartidos (español de Perú).

export const ASSIGNMENT_STATUS = {
  preselected: ['Preseleccionado', 'wait'],
  pending_client_approval: ['Pendiente de aprobación del cliente', 'wait'],
  client_approved: ['Aprobado por el cliente', 'wait'],
  invited: ['Invitación recibida', 'action'],
  availability_confirmed: ['Disponibilidad confirmada', 'wait'],
  contract_pending: ['Contrato pendiente', 'action'],
  contract_signed: ['Contrato firmado', 'ok'],
  product_pending: ['Producto pendiente de recepción', 'action'],
  product_received: ['Producto recibido', 'ok'],
  script_pending: ['Guion pendiente', 'action'],
  script_in_review: ['Guion en revisión', 'wait'],
  script_approved: ['Guion aprobado', 'ok'],
  in_production: ['Producción en curso', 'action'],
  video_delivered: ['Video entregado', 'wait'],
  video_in_review: ['Video en revisión', 'wait'],
  revisions_requested: ['Correcciones solicitadas', 'warn'],
  video_approved: ['Video aprobado', 'ok'],
  publication_scheduled: ['Publicación programada', 'action'],
  publication_confirmed: ['Publicación confirmada', 'wait'],
  ad_codes_pending: ['Códigos publicitarios pendientes', 'action'],
  final_validation: ['Validación final', 'wait'],
  payment_pending_authorization: ['Pago pendiente de autorización', 'wait'],
  payment_approved: ['Pago aprobado', 'ok'],
  payment_sent: ['Pago enviado', 'action'],
  payment_confirmed: ['Pago confirmado', 'ok'],
  declined: ['Invitación rechazada', 'error'],
  rejected: ['No aprobado', 'error'],
  cancelled: ['Cancelado', 'error'],
  expired: ['Vencido', 'error'],
  suspended: ['Suspendido', 'warn']
};
// Para el admin, "acción" significa que el siguiente paso es de Vocera
export const ADMIN_TONE = {
  preselected: 'action', pending_client_approval: 'action', client_approved: 'action', availability_confirmed: 'action',
  script_in_review: 'action', video_delivered: 'action', video_in_review: 'action', publication_confirmed: 'action',
  final_validation: 'action', payment_pending_authorization: 'action', payment_approved: 'action',
  invited: 'wait', contract_pending: 'wait', script_pending: 'wait', in_production: 'wait', publication_scheduled: 'wait',
  ad_codes_pending: 'wait', payment_sent: 'wait', revisions_requested: 'wait', video_approved: 'action'
};

// Cómo se nombra el mismo estado desde el lado de Vocera
export const ADMIN_LABEL = { invited: 'Invitación enviada', payment_sent: 'Transferencia registrada' };

export const PROFILE_STATUS = {
  incomplete: ['Perfil incompleto', 'action'], in_review: ['Perfil en revisión', 'wait'], approved: ['Perfil aprobado', 'ok'],
  rejected: ['Requiere cambios', 'warn'], suspended: ['Suspendido', 'error']
};
export const PAYMENT_STATUS = {
  requirements_pending: ['Requisitos pendientes', 'wait'], in_review: ['En revisión', 'wait'], approved: ['Aprobado', 'ok'],
  scheduled: ['Programado', 'ok'], transferred: ['Transferido', 'action'], confirmed: ['Confirmado', 'ok'], incident: ['Incidencia', 'error']
};
export const CAMPAIGN_STATUS = { draft: ['Borrador', 'wait'], active: ['Activa', 'ok'], closed: ['Cerrada', 'wait'], cancelled: ['Cancelada', 'error'] };
export const SCRIPT_STATUS = { draft: ['Borrador', 'wait'], submitted: ['Enviado', 'wait'], in_review: ['En revisión', 'wait'],
  changes_requested: ['Correcciones solicitadas', 'warn'], approved: ['Aprobado', 'ok'], rejected: ['Rechazado', 'error'] };
export const DELIVERABLE_STATUS = { pending: ['Pendiente', 'action'], submitted: ['Entregado', 'wait'], in_review: ['En revisión', 'wait'],
  revisions_requested: ['Correcciones solicitadas', 'warn'], approved: ['Aprobado', 'ok'] };
export const CONTRACT_STATUS = { draft: ['Borrador', 'wait'], sent: ['Pendiente de firma', 'action'], signed: ['Firmado', 'ok'], void: ['Anulado', 'error'] };
export const SHIPMENT_STATUS = { preparing: ['Preparando envío', 'wait'], shipped: ['En camino', 'wait'], delivered: ['Entregado por el courier', 'action'],
  received: ['Recibido', 'ok'], issue: ['Con incidencia', 'error'] };
export const PUBLICATION_STATUS = { scheduled: ['Programada', 'action'], published: ['Publicada', 'wait'], validated: ['Validada', 'ok'], issue: ['Con observaciones', 'warn'] };
export const AD_STATUS = { submitted: ['Por validar', 'wait'], valid: ['Válido', 'ok'], invalid: ['No válido', 'error'], expired: ['Vencido', 'error'] };
export const PLATFORMS = { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', facebook: 'Facebook', x: 'X', linkedin: 'LinkedIn', twitch: 'Twitch', other: 'Otra' };
export const RATE_TYPES = { video: 'Video', post: 'Publicación', story: 'Historia', package: 'Paquete de contenido' };
export const AVAILABILITY = { available: 'Disponible', limited: 'Disponibilidad limitada', unavailable: 'No disponible por ahora' };
export const ACCOUNT_TYPES = { savings: 'Ahorros', checking: 'Corriente', interbank: 'Interbancaria (CCI)', iban: 'IBAN', other: 'Otra' };
export const CATEGORIES = ['Gastronomía', 'Moda', 'Belleza', 'Tecnología', 'Fitness y bienestar', 'Viajes', 'Humor y entretenimiento', 'Educación',
  'Finanzas personales', 'Familia y crianza', 'Gaming', 'Música', 'Deportes', 'Hogar y decoración', 'Mascotas', 'Automotriz',
  'Negocios y emprendimiento', 'Estilo de vida', 'Otra'];
export const COLLAB_MODES = ['Video UGC (sin publicar)', 'Publicación en mis redes', 'Historias', 'Transmisión en vivo', 'Evento presencial', 'Embajador de marca'];
export const COUNTRIES = [['PE', 'Perú', '+51'], ['AR', 'Argentina', '+54'], ['BO', 'Bolivia', '+591'], ['BR', 'Brasil', '+55'], ['CL', 'Chile', '+56'],
  ['CO', 'Colombia', '+57'], ['CR', 'Costa Rica', '+506'], ['EC', 'Ecuador', '+593'], ['ES', 'España', '+34'], ['US', 'Estados Unidos', '+1'],
  ['GT', 'Guatemala', '+502'], ['MX', 'México', '+52'], ['PA', 'Panamá', '+507'], ['PY', 'Paraguay', '+595'], ['DO', 'República Dominicana', '+1'],
  ['UY', 'Uruguay', '+598'], ['VE', 'Venezuela', '+58']];
export const CURRENCIES = ['PEN', 'USD', 'EUR', 'MXN', 'COP', 'CLP', 'ARS'];

export const label = (map, key) => (map[key] ? map[key][0] : key || '-');
export const tone = (map, key) => (map[key] ? map[key][1] : 'wait');

export function money(amount, currency = 'PEN') {
  if (amount === null || amount === undefined || amount === '') return '-';
  try { return new Intl.NumberFormat('es-PE', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(amount)); }
  catch { return `${currency} ${Number(amount).toFixed(2)}`; }
}
export function date(d, opts = {}) {
  if (!d) return '-';
  const v = typeof d === 'string' && d.length === 10 ? new Date(d + 'T12:00:00') : new Date(d);
  return new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'short', year: opts.year === false ? undefined : 'numeric', ...opts.extra }).format(v);
}
export function dateTime(d) {
  if (!d) return '-';
  return new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(d));
}
export function relDays(d) {
  if (!d) return '';
  const day = typeof d === 'string' && d.length === 10 ? new Date(d + 'T12:00:00') : new Date(d);
  const diff = Math.round((day.setHours(12, 0, 0, 0) - new Date().setHours(12, 0, 0, 0)) / 864e5);
  if (diff === 0) return 'hoy';
  if (diff === 1) return 'mañana';
  if (diff === -1) return 'ayer';
  return diff > 0 ? `en ${diff} días` : `hace ${-diff} días`;
}
export const compact = n => (n === null || n === undefined ? '-' : new Intl.NumberFormat('es-PE', { notation: 'compact', maximumFractionDigits: 1 }).format(n));
export const initials = name => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
export const bytes = n => (n > 1e9 ? (n / 1e9).toFixed(2) + ' GB' : n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB');
export const mask = (s, keep = 4) => (s ? '•'.repeat(Math.max(4, s.length - keep)) + s.slice(-keep) : '');
