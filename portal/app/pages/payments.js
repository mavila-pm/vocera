// "Mis pagos" y "Datos bancarios" del creador.
import { html, useState } from '../../vendor/preact.js';
import { rpc } from '../lib/sb.js';
import { href, navigate } from '../lib/router.js';
import { PAYMENT_STATUS, ACCOUNT_TYPES, COUNTRIES, CURRENCIES, money, date } from '../lib/format.js';
import { Badge, Button, Empty, Loading, ErrorBox, Field, Input, Select, FileLink, useAction, Icon } from '../ui/kit.js';
import { useLoad } from './home.js';

export function MyPayments() {
  const { data, error, reload } = useLoad(() => rpc('my_payments'));
  if (error) return html`<${ErrorBox} message=${error} retry=${reload} />`;
  if (!data) return html`<${Loading} rows=${4} />`;
  const sums = data.summary.length ? data.summary : [{ currency: 'PEN', earned: 0, pending_validation: 0, approved: 0, in_process: 0, received: 0, bonuses: 0 }];
  return html`<div>
    <div class="page-head"><div><h1>Mis pagos</h1><p>Lo acordado, lo aprobado y lo que ya recibiste, por separado.</p></div>
      <a class="btn" href=${href('/pagos/datos')}><${Icon} name="wallet" size="18" />Datos bancarios</a></div>
    ${!data.payout_method && html`<div class="notice warn" style="margin-bottom:20px"><div><strong>Aún no registras tus datos de cobro</strong>Los necesitamos para autorizar cualquier pago. <a href=${href('/pagos/datos')}>Registrarlos</a></div></div>`}
    ${sums.map(s => html`<section class="pay-summary" aria-label=${'Resumen en ' + s.currency}>
      <div class="money-card is-static"><span class="l">Por validar</span><span class="v num">${money(s.pending_validation, s.currency)}</span>
        <span class="s">Honorarios acordados que aún no cumplen todas las condiciones de pago.</span></div>
      <div class="money-card is-static"><span class="l">Ganado</span><span class="v num ok">${money(s.earned, s.currency)}</span>
        <span class="s">Lo que Vocera ya te transfirió.</span></div>
      <dl class="pay-steps">
        <div><dt>Aprobados</dt><dd class="num">${money(s.approved, s.currency)}</dd></div>
        <div><dt>En proceso</dt><dd class="num">${money(s.in_process, s.currency)}</dd></div>
        <div><dt>Confirmaste que recibiste</dt><dd class="num">${money(s.received, s.currency)}</dd></div>
        <div><dt>Bonificaciones</dt><dd class="num">${money(s.bonuses, s.currency)}</dd></div>
      </dl>
    </section>`)}

    <div class="section-head"><h2>Historial</h2></div>
    ${data.items.length ? html`<div class="table-wrap" tabindex="0" role="region" aria-label="Tabla (desplázala si no entra completa)"><table class="table stackable">
      <thead><tr><th>Campaña</th><th>Fecha</th><th class="r">Honorario</th><th class="r">Bonificación</th><th>Estado</th><th>Transferencia</th><th>Comprobante</th></tr></thead>
      <tbody>${data.items.map(p => html`<tr>
        <td data-l="Campaña"><a href=${href('/campanas/' + p.assignment_id + '?tab=pago')}>${p.campaign}</a></td>
        <td data-l="Fecha">${date(p.created_at)}</td>
        <td data-l="Honorario" class="r num">${p.concept === 'fee' ? money(p.amount, p.currency) : '-'}</td>
        <td data-l="Bonificación" class="r num">${p.concept === 'bonus' ? money(p.amount, p.currency) : '-'}</td>
        <td data-l="Estado"><${Badge} map=${PAYMENT_STATUS} value=${p.status} />${p.incident_note && html`<br/><span class="small err">${p.incident_note}</span>`}</td>
        <td data-l="Transferencia">${p.transferred_at ? date(p.transferred_at) : p.scheduled_for ? 'Programado ' + date(p.scheduled_for) : '-'}</td>
        <td data-l="Comprobante">${p.receipt_path ? html`<${FileLink} bucket="documents" path=${p.receipt_path} download>Descargar</${FileLink}>` : '-'}</td>
      </tr>`)}</tbody></table></div>`
    : html`<div class="panel"><${Empty} title="Todavía no tienes pagos">Cuando aceptes una campaña, verás aquí su honorario y cada paso hasta la transferencia.</${Empty}></div>`}
  </div>`;
}

export function BankDetails() {
  const { data, error, reload } = useLoad(() => rpc('my_payments'));
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({ holder: '', country: 'PE', bank: '', type: 'savings', currency: 'PEN', account: '', bank_id: '', extra: '' });
  const [errors, setErrors] = useState({});
  const [busy, run] = useAction();
  if (error) return html`<${ErrorBox} message=${error} retry=${reload} />`;
  if (!data) return html`<${Loading} rows=${3} />`;
  const pm = data.payout_method;
  const set = k => e => setF({ ...f, [k]: e.target.value });
  async function save(e) {
    e.preventDefault();
    const er = {};
    if (f.holder.trim().length < 3) er.holder = 'Escribe el nombre del titular tal como figura en el banco.';
    if (f.bank.trim().length < 2) er.bank = 'Indica el banco.';
    const clean = f.account.replace(/[\s-]/g, '');
    if (!/^[A-Za-z0-9]{6,40}$/.test(clean)) er.account = 'Solo letras y números, entre 6 y 40 caracteres.';
    if (f.country === 'PE' && f.bank_id && !/^\d{20}$/.test(f.bank_id.replace(/[\s-]/g, ''))) er.bank_id = 'El CCI tiene 20 dígitos.';
    setErrors(er); if (Object.keys(er).length) return;
    await run(async () => {
      await rpc('set_payout_method', { p_holder: f.holder, p_country: f.country, p_bank: f.bank, p_account_type: f.type, p_currency: f.currency,
        p_account_number: f.account, p_bank_identifier: f.bank_id || null, p_extra: f.extra || null });
      setF({ ...f, account: '', bank_id: '', extra: '' }); setEditing(false); await reload();
    }, { success: 'Datos de cobro guardados de forma segura.' });
  }
  return html`<div>
    <a class="small" href=${href('/pagos')} style="display:inline-flex;gap:6px;align-items:center;margin-bottom:12px"><${Icon} name="back" size="16" />Mis pagos</a>
    <div class="page-head"><div><h1>Datos bancarios</h1><p>Los usamos solo para transferirte tus pagos.</p></div></div>
    <div class="cols">
      <div>
        ${pm && !editing ? html`<div class="panel panel-pad stack">
          <div class="row between"><h2>Cuenta registrada</h2><span class="badge tone-ok">Activa</span></div>
          <dl class="dl"><dt>Titular</dt><dd>${pm.holder_name}</dd><dt>Banco</dt><dd>${pm.bank_name}</dd><dt>Tipo</dt><dd>${ACCOUNT_TYPES[pm.account_type]}</dd>
            <dt>Cuenta</dt><dd class="mono">•••• ${pm.account_last4}</dd><dt>Moneda</dt><dd>${pm.currency}</dd><dt>Registrada</dt><dd>${date(pm.created_at)}</dd></dl>
          <div><${Button} onClick=${() => { setF({ ...f, holder: pm.holder_name, country: pm.country, bank: pm.bank_name, type: pm.account_type, currency: pm.currency }); setEditing(true); }}>Cambiar cuenta</${Button}></div>
        </div>` : html`<form class="panel panel-pad form" onSubmit=${save} novalidate autocomplete="off">
          <h2>${pm ? 'Nueva cuenta de cobro' : 'Registra tu cuenta de cobro'}</h2>
          <div class="form-grid">
            <${Field} full label="Titular de la cuenta" error=${errors.holder}><${Input} value=${f.holder} onInput=${set('holder')} autocomplete="name" /></${Field}>
            <${Field} label="País"><${Select} value=${f.country} onChange=${set('country')} options=${COUNTRIES.map(c => [c[0], c[1]])} /></${Field}>
            <${Field} label="Banco" error=${errors.bank}><${Input} value=${f.bank} onInput=${set('bank')} /></${Field}>
            <${Field} label="Tipo de cuenta"><${Select} value=${f.type} onChange=${set('type')} options=${Object.entries(ACCOUNT_TYPES)} /></${Field}>
            <${Field} label="Moneda"><${Select} value=${f.currency} onChange=${set('currency')} options=${CURRENCIES} /></${Field}>
            <${Field} full label=${f.type === 'iban' ? 'IBAN' : 'Número de cuenta'} error=${errors.account}><${Input} value=${f.account} onInput=${set('account')} inputmode="text" spellcheck="false" autocomplete="off" /></${Field}>
            <${Field} full label=${f.country === 'PE' ? 'CCI (código de cuenta interbancario)' : 'Código bancario (SWIFT/BIC, ABA u otro)'} optional error=${errors.bank_id}>
              <${Input} value=${f.bank_id} onInput=${set('bank_id')} spellcheck="false" autocomplete="off" /></${Field}>
            <${Field} full label="Otros datos para la transferencia" optional hint="Por ejemplo, documento de identidad del titular si tu banco lo exige."><${Input} value=${f.extra} onInput=${set('extra')} autocomplete="off" /></${Field}>
          </div>
          <div class="row"><${Button} type="submit" variant="primary" loading=${busy}>Guardar de forma segura</${Button}>${pm && html`<${Button} variant="ghost" onClick=${() => setEditing(false)}>Cancelar</${Button}>`}</div>
        </form>`}
      </div>
      <div class="notice" style="align-self:start"><div><strong>Cómo protegemos tus datos</strong>
        El número de cuenta se guarda cifrado. En el portal solo se muestran los 4 últimos dígitos. Únicamente el equipo autorizado de Vocera puede ver el número completo, indicando el motivo, y cada consulta queda registrada.</div></div>
    </div>
  </div>`;
}
