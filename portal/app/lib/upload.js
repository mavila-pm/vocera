// Subida segura a Storage con progreso.
// * Archivos grandes (≥ umbral) usan subida reanudable TUS de Supabase,
//   en bloques de 6 MB, para videos pesados y conexiones inestables.
// * El resto usa la subida estándar con XHR (permite mostrar el progreso).
// La validación del cliente es una ayuda: el servidor vuelve a validar tipo
// y tamaño (configuración del bucket) y la carpeta (políticas RLS).
import { supabase, config } from './sb.js';
import { Upload } from '../../vendor/tus.js';

export const RULES = {
  avatar:   { bucket: 'avatars', max: 5 * 1024 * 1024, types: { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }, label: 'JPG, PNG o WEBP, hasta 5 MB' },
  document: { bucket: 'documents', max: 25 * 1024 * 1024, types: { 'application/pdf': 'pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx' }, label: 'PDF o DOCX, hasta 25 MB' },
  image:    { bucket: 'documents', max: 10 * 1024 * 1024, types: { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' }, label: 'JPG, PNG, WEBP o PDF, hasta 10 MB' },
  video:    { bucket: 'deliverables', max: 5 * 1024 * 1024 * 1024, types: { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/x-m4v': 'm4v' }, label: 'MP4, MOV o WEBM, hasta 5 GB' }
};
const EXT_MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/x-m4v' };

export function detectMime(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  // Algunos navegadores no informan el tipo de .mov o .docx: se deduce por extensión.
  return file.type || EXT_MIME[ext] || '';
}

export function validateFile(file, kind) {
  const r = RULES[kind];
  const mime = detectMime(file);
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!r.types[mime] || EXT_MIME[ext] !== mime) return `Formato no permitido. Usa ${r.label}.`;
  if (file.size === 0) return 'El archivo está vacío.';
  if (file.size > r.max) return `El archivo pesa más de lo permitido (${r.label}).`;
  return null;
}

// Firma binaria ("magic bytes"): evita archivos disfrazados con otra extensión,
// por ejemplo un ejecutable renombrado a .mp4. Complementa la validación del servidor.
const SIGNATURES = {
  'image/png': b => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/jpeg': b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': b => String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP',
  'application/pdf': b => String.fromCharCode(...b.slice(0, 5)) === '%PDF-',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': b => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04,
  'video/mp4': b => String.fromCharCode(...b.slice(4, 8)) === 'ftyp',
  'video/quicktime': b => ['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip'].includes(String.fromCharCode(...b.slice(4, 8))),
  'video/x-m4v': b => String.fromCharCode(...b.slice(4, 8)) === 'ftyp',
  'video/webm': b => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3
};
export async function checkSignature(file) {
  const mime = detectMime(file);
  const test = SIGNATURES[mime];
  if (!test) return 'Formato no permitido.';
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  return test(head) ? null : 'El contenido del archivo no corresponde a un ' + (mime.split('/')[1] || 'archivo').toUpperCase() + ' válido. No se subió.';
}

const safe = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').slice(-60);

// ownerId: carpeta del creador (las políticas exigen que la ruta empiece por su id)
export function buildPath(ownerId, folder, file, kind) {
  const ext = RULES[kind].types[detectMime(file)];
  const base = safe(file.name.replace(/\.[^.]+$/, '')) || 'archivo';
  return `${ownerId}/${folder}/${Date.now()}-${base}.${ext}`;
}

export async function uploadFile({ file, kind, ownerId, folder, onProgress }) {
  const err = validateFile(file, kind) || await checkSignature(file);
  if (err) throw new Error(err);
  const { bucket } = RULES[kind];
  const path = buildPath(ownerId, folder, file, kind);
  const mime = detectMime(file);
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Tu sesión terminó. Vuelve a iniciar sesión.');
  const threshold = config.resumableThresholdBytes || 50 * 1024 * 1024;

  if (file.size >= threshold && !config.local) {
    await new Promise((resolve, reject) => {
      const up = new Upload(file, {
        endpoint: `${config.supabaseUrl}/storage/v1/upload/resumable`,
        retryDelays: [0, 3000, 5000, 10000, 20000],
        headers: { authorization: `Bearer ${session.access_token}`, 'x-upsert': 'false' },
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        metadata: { bucketName: bucket, objectName: path, contentType: mime, cacheControl: '3600' },
        chunkSize: 6 * 1024 * 1024,
        onError: e => reject(new Error('La subida se interrumpió. Puedes reintentar: se retomará donde quedó.', { cause: e })),
        onProgress: (sent, total) => onProgress && onProgress(sent / total),
        onSuccess: resolve
      });
      up.findPreviousUploads().then(prev => { if (prev.length) up.resumeFromPreviousUpload(prev[0]); up.start(); });
    });
    return { bucket, path, mime, size: file.size, name: file.name };
  }

  if (config.demo) {
    // Demo: misma petición de Storage, servida por el backend local; progreso simulado
    for (const p of [0.25, 0.6, 0.9]) { onProgress && onProgress(p); await new Promise(r => setTimeout(r, 120)); }
    const fd = new FormData(); fd.append('cacheControl', '3600'); fd.append('', new File([file], file.name, { type: mime }));
    const res = await window.VOCERA_DEMO.fetch(`${config.supabaseUrl}/storage/v1/object/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`,
      { method: 'POST', headers: { authorization: `Bearer ${session.access_token}` }, body: fd });
    if (!res.ok) throw new Error(res.status === 413 ? 'El archivo supera el tamaño máximo permitido.' : res.status === 415 ? 'Ese formato de archivo no está permitido.' : 'No se pudo subir el archivo.');
    onProgress && onProgress(1);
    return { bucket, path, mime, size: file.size, name: file.name };
  }

  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${config.supabaseUrl}/storage/v1/object/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`);
    xhr.setRequestHeader('authorization', `Bearer ${session.access_token}`);
    xhr.setRequestHeader('apikey', config.supabaseAnonKey);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.upload.onprogress = e => e.lengthComputable && onProgress && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let msg = 'No se pudo subir el archivo.';
      if (xhr.status === 413) msg = 'El archivo supera el tamaño máximo permitido.';
      else if (xhr.status === 415) msg = 'Ese formato de archivo no está permitido.';
      else if (xhr.status === 403) msg = 'No tienes permiso para subir este archivo.';
      reject(new Error(msg));
    };
    xhr.onerror = () => reject(new Error('Se perdió la conexión durante la subida. Vuelve a intentarlo.'));
    const fd = new FormData();
    fd.append('cacheControl', '3600');
    fd.append('', new File([file], file.name, { type: mime }));
    xhr.send(fd);
  });
  return { bucket, path, mime, size: file.size, name: file.name };
}
