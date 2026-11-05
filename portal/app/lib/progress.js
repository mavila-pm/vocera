// Etapas de una participación, derivadas del estado (igual que el motor del servidor).
// Lo usan el panel "Avance" y la onda de etapas de listas y encabezados.
import { ASSIGNMENT_STATUS } from './format.js';

const ORDER = Object.keys(ASSIGNMENT_STATUS);
const idx = s => ORDER.indexOf(s);
export const CLOSED = ['declined', 'rejected', 'cancelled', 'expired', 'suspended'];

// [etiqueta, desde, hasta, requisito]. Al entregar el video, la producción queda hecha
// y la revisión pasa a ser la etapa actual.
const STAGES = [
  ['Invitación', 'invited', 'invited', null],
  ['Contrato', 'availability_confirmed', 'contract_signed', 'contract'],
  ['Producto', 'product_pending', 'product_received', 'product'],
  ['Guion', 'script_pending', 'script_approved', 'script'],
  ['Producción', 'in_production', 'in_production', null],
  ['Revisión del video', 'video_delivered', 'video_approved', null],
  ['Publicación', 'publication_scheduled', 'publication_confirmed', 'publication'],
  ['Códigos publicitarios', 'ad_codes_pending', 'ad_codes_pending', 'ad_code'],
  ['Validación final', 'final_validation', 'final_validation', null],
  ['Pago', 'payment_pending_authorization', 'payment_confirmed', null]
];

// req: { contract, product, script, publication, ad_code } (booleans)
export function stageTrack(status, req = {}) {
  const closed = CLOSED.includes(status), i = idx(status);
  const list = STAGES.filter(s => !s[3] || req[s[3]]).map(([label, from, to]) => {
    const state = closed ? 'todo'
      : status === 'payment_confirmed' && to === 'payment_confirmed' ? 'done'
      : i > idx(to) ? 'done'
      : i >= idx(from) && i <= idx(to) ? 'current' : 'todo';
    return { label, state };
  });
  const cur = list.findIndex(s => s.state === 'current');
  const done = list.filter(s => s.state === 'done').length;
  return { list, closed, current: cur >= 0 ? list[cur] : null, position: cur >= 0 ? cur + 1 : done, total: list.length, finished: done === list.length };
}

export const reqOf = c => ({ contract: c.requires_contract, product: c.requires_product, script: c.requires_script,
  publication: c.requires_publication, ad_code: c.requires_ad_code });
