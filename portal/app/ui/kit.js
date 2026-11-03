// Componentes base del portal (Preact + htm, sin compilación).
import { html, useState, useEffect, useRef, useCallback, cloneElement } from '../../vendor/preact.js';
import { label, tone, initials, bytes } from '../lib/format.js';
import { uploadFile, RULES } from '../lib/upload.js';
import { signedUrl, config } from '../lib/sb.js';

// ---------- Íconos (trazo 1.75, un solo set dibujado a mano) ----------
const P = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  megaphone: 'M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zm12-3a5 5 0 0 1 0 8m3-11a9 9 0 0 1 0 14',
  wallet: 'M3 7a2 2 0 0 1 2-2h13v4M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2zm14 7h.01',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 9a7 7 0 0 1 14 0',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-6 10a6 6 0 0 1 12 0m2-10a3 3 0 1 0 0-6m2 16a5 5 0 0 0-3-4.6',
  bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9m4.3 13a1.9 1.9 0 0 0 3.4 0',
  shield: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  check: 'M4 12.5 9.5 18 20 6.5',
  x: 'M6 6l12 12M18 6 6 18',
  arrow: 'M5 12h13M13 6l6 6-6 6',
  back: 'M19 12H6M11 6l-6 6 6 6',
  upload: 'M12 16V4m0 0L7 9m5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3',
  download: 'M12 4v12m0 0-5-5m5 5 5-5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zm0 0v5h5',
  calendar: 'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zm0 4h16M8 2v4m8-4v4',
  logout: 'M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5m5 5H3',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-13v4l3 2',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  alert: 'M12 9v4m0 4h.01M10.3 3.9 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm10 2-4.3-4.3',
  menu: 'M4 6h16M4 12h16M4 18h16'
};
export const Icon = ({ name, size }) => html`<svg viewBox="0 0 24 24" width=${size || 20} height=${size || 20} fill="none" stroke="currentColor"
  stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d=${P[name]} /></svg>`;
export const Iso = ({ cls }) => html`<svg class=${cls} viewBox="0 0 121 100" aria-hidden="true" focusable="false"><polygon fill="currentColor" points="36,0 68,0 32,100 0,100"/><polygon fill="currentColor" points="89,0 121,0 85,100 53,100"/></svg>`;

// ---------- Botón con estado de carga ----------
export function Button({ variant = '', size = '', loading, children, block, ...rest }) {
  const cls = ['btn', variant && `btn-${variant}`, size && `btn-${size}`, block && 'btn-block', rest.class].filter(Boolean).join(' ');
  return html`<button type="button" ...${rest} class=${cls} disabled=${rest.disabled || loading} aria-busy=${loading ? 'true' : undefined}>
    ${loading && html`<span class="spin" aria-hidden="true"></span>`}${children}</button>`;
}

// Ejecuta una acción asíncrona con estado de carga, aviso y bloqueo de doble envío
export function useAction() {
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const run = useCallback(async (fn, { success, onError } = {}) => {
    if (running.current) return;
    running.current = true; setBusy(true);
    try { const r = await fn(); if (success) toast(success); return r; }
    catch (e) { (onError || (m => toast(m, 'error')))(e.message || 'Algo salió mal.'); }
    finally { running.current = false; setBusy(false); }
  }, []);
  return [busy, run];
}

// ---------- Campos ----------
let uid = 0;
export function Field({ label: lab, hint, error, optional, children, full, id }) {
  const ref = useRef(null);
  if (!ref.current) ref.current = 'f' + (++uid);
  const fid = id || ref.current;
  const kid = Array.isArray(children) ? children[0] : children;
  const control = kid && kid.props ? cloneElement(kid, { id: fid, 'aria-invalid': error ? 'true' : undefined,
    'aria-describedby': [hint && fid + '-h', error && fid + '-e'].filter(Boolean).join(' ') || undefined }) : kid;
  return html`<div class=${'field' + (full ? ' full' : '')}>
    <label for=${fid}>${lab}${optional && html` <span class="opt">(opcional)</span>`}</label>
    ${control}
    ${hint && html`<p class="hint" id=${fid + '-h'}>${hint}</p>`}
    ${error && html`<p class="err" id=${fid + '-e'} role="alert">${error}</p>`}
  </div>`;
}
export const Input = props => html`<input class="input" ...${props} />`;
export const Textarea = props => html`<textarea class="textarea" ...${props}></textarea>`;
export const Select = ({ options, placeholder, ...props }) => html`<select class="select" ...${props}>
  ${placeholder !== undefined && html`<option value="">${placeholder}</option>`}
  ${options.map(o => Array.isArray(o) ? html`<option value=${o[0]}>${o[1]}</option>` : html`<option value=${o}>${o}</option>`)}
</select>`;

export function PasswordInput(props) {
  const [show, setShow] = useState(false);
  return html`<div class="password-wrap"><input class="input" ...${props} type=${show ? 'text' : 'password'} />
    <button type="button" class="btn btn-ghost btn-sm" onClick=${() => setShow(!show)} aria-label=${show ? 'Ocultar contraseña' : 'Mostrar contraseña'}>${show ? 'Ocultar' : 'Mostrar'}</button></div>`;
}

// ---------- Estados ----------
export const Badge = ({ map, value, toneOverride, text }) => html`<span class=${'badge tone-' + (toneOverride || tone(map, value))}>${text || label(map, value)}</span>`;

export function Empty({ title, children, action }) {
  return html`<div class="empty"><${Iso} /><strong>${title}</strong>${children && html`<p>${children}</p>`}${action}</div>`;
}
export const Skeleton = ({ h = 16, w = '100%', style }) => html`<div class="skeleton" style=${{ height: h + 'px', width: w, ...style }} aria-hidden="true"></div>`;
export function Loading({ rows = 3 }) {
  return html`<div class="stack" role="status" aria-label="Cargando">${Array.from({ length: rows }, (_, i) => html`<${Skeleton} h=${i ? 56 : 28} w=${i ? '100%' : '40%'} />`)}</div>`;
}
export function ErrorBox({ message, retry }) {
  return html`<div class="notice error" role="alert"><div><strong>No pudimos cargar esta información</strong>${message}
    ${retry && html`<div style="margin-top:10px"><${Button} size="sm" onClick=${retry}>Reintentar</${Button}></div>`}</div></div>`;
}
export const Progress = ({ value, ok, label: lab }) => html`<div class=${'progress' + (ok ? ' ok' : '')} role="progressbar" aria-label=${lab || 'Progreso'} aria-valuemin="0" aria-valuemax="100" aria-valuenow=${Math.round(value)}><span style=${{ width: Math.min(100, value) + '%' }}></span></div>`;

export function Avatar({ name, path, lg }) {
  const [url, setUrl] = useState(null);
  useEffect(() => { let on = true; if (path) signedUrl('avatars', path, { expires: 3600 }).then(u => on && setUrl(u)).catch(() => {}); return () => { on = false; }; }, [path]);
  return html`<span class=${'avatar' + (lg ? ' lg' : '')}>${url ? html`<img src=${url} alt="" />` : initials(name)}</span>`;
}

// ---------- Avisos (toasts) ----------
let pushToast = () => {};
export function toast(msg, kind = 'ok') { pushToast({ msg, kind, id: Math.random() }); }
export function Toasts() {
  const [items, setItems] = useState([]);
  const ref = useRef();
  useEffect(() => { pushToast = t => { setItems(x => [...x, t].slice(-2)); setTimeout(() => setItems(x => x.filter(i => i.id !== t.id)), t.kind === 'error' ? 7000 : 4000); }; }, []);
  // popover="manual" lleva los avisos a la capa superior: se ven incluso sobre un modal abierto
  useEffect(() => {
    const el = ref.current; if (!el || !el.showPopover) return;
    if (items.length) { try { if (el.matches(':popover-open')) el.hidePopover(); el.showPopover(); } catch {} }
    else { try { el.hidePopover(); } catch {} }
  }, [items.length]);
  return html`<div class="toasts" ref=${ref} popover="manual" role="status" aria-live="polite">${items.map(t => html`<div class=${'toast' + (t.kind === 'error' ? ' error' : '')} key=${t.id}>${t.msg}</div>`)}</div>`;
}

// ---------- Modal accesible (dialog nativo) ----------
export function Modal({ open, title, onClose, children, footer }) {
  const ref = useRef();
  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (open && !d.open) d.showModal(); if (!open && d.open) d.close();
  }, [open]);
  return html`<dialog class="modal" ref=${ref} onClose=${onClose} onCancel=${e => { e.preventDefault(); onClose(); }} aria-labelledby="modal-title">
    ${open && html`<div class="modal-head"><h2 id="modal-title">${title}</h2>
      <button class="btn btn-ghost btn-sm" onClick=${onClose} aria-label="Cerrar"><${Icon} name="x" /></button></div>
      <div class="modal-body">${children}</div>${footer && html`<div class="modal-foot">${footer}</div>`}`}
  </dialog>`;
}

// ---------- Subida de archivos con arrastrar y soltar ----------
export function FileDrop({ kind, ownerId, folder, onUploaded, label: lab, hint, disabled }) {
  const [over, setOver] = useState(false);
  const [state, setState] = useState(null); // { name, size, progress, error, done }
  const input = useRef();
  async function handle(file) {
    if (!file || disabled) return;
    setState({ name: file.name, size: file.size, progress: 0 });
    try {
      const res = await uploadFile({ file, kind, ownerId, folder, onProgress: p => setState(s => ({ ...s, progress: p * 100 })) });
      setState(s => ({ ...s, progress: 100, done: true }));
      await onUploaded(res);
    } catch (e) { setState(s => ({ ...s, error: e.message })); }
  }
  return html`<div>
    <label class=${'drop' + (over ? ' over' : '')} style=${{ display: 'block', position: 'relative', opacity: disabled ? .6 : 1 }}
      onDragOver=${e => { e.preventDefault(); setOver(true); }} onDragLeave=${() => setOver(false)}
      onDrop=${e => { e.preventDefault(); setOver(false); handle(e.dataTransfer.files[0]); }}>
      <input type="file" ref=${input} disabled=${disabled} accept=${Object.keys(RULES[kind].types).join(',')}
        onChange=${e => { handle(e.target.files[0]); e.target.value = ''; }} />
      <${Icon} name="upload" size="22" />
      <strong style="margin-top:8px">${lab || 'Arrastra tu archivo aquí o selecciónalo'}</strong>
      <span class="hint">${hint || RULES[kind].label}</span>
    </label>
    ${state && html`<div class="upload-item" aria-live="polite">
      <span class="small"><strong>${state.name}</strong> · ${bytes(state.size)}</span>
      <span class="small ${state.error ? 'err' : 'muted'}">${state.error ? 'Error' : state.done ? 'Listo' : Math.round(state.progress) + ' %'}</span>
      <${Progress} value=${state.progress} ok=${state.done} />
      ${state.error && html`<p class="err" role="alert" style="grid-column:1/-1">${state.error}</p>`}
    </div>`}
  </div>`;
}

// Abre un archivo privado con una URL firmada temporal (enlace real, no window.open).
// En la demo se muestra una vista previa: ahí las descargas y pestañas nuevas están bloqueadas.
export function FileLink({ bucket, path, children, download }) {
  const [busy, run] = useAction();
  const [preview, setPreview] = useState(null);
  if (!path) return null;
  const name = path.split('/').pop();
  const open = () => run(async () => {
    const u = await signedUrl(bucket, path, { expires: 120, download: download ? name : undefined });
    if (config.demo) return setPreview(u);
    const a = document.createElement('a'); a.href = u; a.target = '_blank'; a.rel = 'noopener'; a.click();
  });
  const ext = (name.split('.').pop() || '').toLowerCase();
  return html`<button type="button" class="link-btn" disabled=${busy} onClick=${open}>${children || 'Ver archivo'}</button>
    ${preview && html`<${Modal} open title=${name.replace(/^\d+-/, '')} onClose=${() => setPreview(null)}>
      ${['png', 'jpg', 'jpeg', 'webp'].includes(ext) ? html`<img src=${preview} alt=${'Vista previa de ' + name} style="max-width:100%;border-radius:6px" />`
        : ['mp4', 'mov', 'webm', 'm4v'].includes(ext) ? html`<div class="video-frame"><video controls src=${preview}></video></div>`
        : html`<p class="muted">El archivo está guardado de forma privada. En el portal real se abre o descarga desde aquí; en esta demo solo se confirma que existe.</p>`}
    </${Modal}>`}`;
}

export function VideoPreview({ path }) {
  const [url, setUrl] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { signedUrl('deliverables', path, { expires: 1800 }).then(setUrl).catch(e => setErr(e.message)); }, [path]);
  if (err) return html`<p class="err">${err}</p>`;
  if (!url) return html`<${Skeleton} h=${200} />`;
  return html`<div class="video-frame"><video controls preload="metadata" src=${url} playsinline>Tu navegador no puede reproducir este formato. Descárgalo para verlo.</video></div>`;
}

// Selección múltiple como chips
export function ChipSelect({ options, value = [], onChange, max }) {
  return html`<div class="chips" role="group">${options.map(opt => {
    const [o, lab] = Array.isArray(opt) ? opt : [opt, opt];
    const on = value.includes(o);
    return html`<button type="button" class="chip" aria-pressed=${on ? 'true' : 'false'} onClick=${() => {
      if (on) onChange(value.filter(v => v !== o)); else if (!max || value.length < max) onChange([...value, o]);
    }}>${on && html`<${Icon} name="check" size="14" />`}${lab}</button>`;
  })}</div>`;
}

export function Confirm({ open, title, children, confirmLabel = 'Confirmar', danger, onConfirm, onClose, busy }) {
  return html`<${Modal} open=${open} title=${title} onClose=${onClose} footer=${html`
    <${Button} onClick=${onClose}>Cancelar</${Button}>
    <${Button} variant=${danger ? 'dark' : 'primary'} loading=${busy} onClick=${onConfirm}>${confirmLabel}</${Button}>`}>${children}</${Modal}>`;
}

// ---------- Pregunta con formulario propio (reemplaza a window.prompt) ----------
// ask('Motivo del cierre') → Promise<string|null>. Misma forma de uso que
// prompt(), pero con modal accesible, validación y estilo de la marca.
// (Además, prompt() no funciona en todos los entornos: algunos lo bloquean.)
let pushAsk = null;
export function ask(label, opts = {}) {
  if (typeof opts === 'string') opts = { defaultValue: opts };
  return new Promise(resolve => {
    if (!pushAsk) return resolve(null);
    pushAsk({ label, ...opts, resolve });
  });
}
export function AskHost() {
  const [q, setQ] = useState(null);
  const [value, setValue] = useState('');
  const [err, setErr] = useState(null);
  useEffect(() => { pushAsk = req => { setQ(req); setValue(req.defaultValue || ''); setErr(null); }; return () => { pushAsk = null; }; }, []);
  const close = v => { if (q) q.resolve(v); setQ(null); };
  const submit = e => {
    e && e.preventDefault();
    const v = value.trim();
    if (!q.optional && !v) return setErr('Completa este campo para continuar.');
    if (q.minLength && v.length < q.minLength) return setErr(`Escribe al menos ${q.minLength} caracteres.`);
    if (q.type === 'number' && v && !(Number(v) > 0)) return setErr('Ingresa un monto mayor que cero.');
    close(v);
  };
  const long = !q?.type || q.type === 'textarea';
  return html`<${Modal} open=${!!q} title=${q?.title || 'Confirma la acción'} onClose=${() => close(null)} footer=${html`
      <${Button} onClick=${() => close(null)}>Cancelar</${Button}>
      <${Button} variant="primary" onClick=${submit}>${q?.confirmLabel || 'Continuar'}</${Button}>`}>
    ${q && html`<form onSubmit=${submit} novalidate>
      <${Field} label=${q.label} hint=${q.hint} error=${err} optional=${q.optional}>
        ${long ? html`<${Textarea} rows="3" value=${value} onInput=${e => setValue(e.target.value)} autofocus />`
          : html`<${Input} type=${q.type} value=${value} onInput=${e => setValue(e.target.value)} autofocus step=${q.type === 'number' ? '0.01' : undefined} />`}
      </${Field}></form>`}
  </${Modal}>`;
}
