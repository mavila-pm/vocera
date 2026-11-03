// Enrutador por hash (#/ruta): funciona en GitHub Pages sin reglas de servidor.
import { useEffect, useState } from '../../vendor/preact.js';

export function currentPath() {
  const h = location.hash;
  if (!h.startsWith('#/')) return '/';
  return h.slice(1).split('?')[0] || '/';
}
export function query() {
  const h = location.hash; const i = h.indexOf('?');
  return new URLSearchParams(i >= 0 ? h.slice(i + 1) : '');
}
export function navigate(path, { replace = false } = {}) {
  const target = '#' + (path.startsWith('/') ? path : '/' + path);
  if (replace) replaceHash(target); else location.hash = target;
  if (replace) window.dispatchEvent(new HashChangeEvent('hashchange'));
}
export function href(path) { return '#' + path; }

// Reemplaza el hash sin crear entrada de historial. Usa la URL completa del
// documento (no una relativa): dentro de un iframe 'about:srcdoc' una URL
// relativa se resolvería contra otra dirección y el navegador la rechaza.
export function replaceHash(target) {
  try { history.replaceState(history.state, '', location.href.split('#')[0] + target); }
  catch { location.hash = target; }
}

export function usePath() {
  const [path, setPath] = useState(currentPath());
  useEffect(() => {
    const on = () => { setPath(currentPath()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    // Si hubo una redirección antes de registrar el listener, se sincroniza aquí
    setPath(currentPath());
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return path;
}

// Coincide "/campanas/:id" con "/campanas/abc" → { id: 'abc' }
export function match(pattern, path) {
  const p = pattern.split('/').filter(Boolean); const s = path.split('/').filter(Boolean);
  if (p.length !== s.length) return null;
  const params = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(s[i]);
    else if (p[i] !== s[i]) return null;
  }
  return params;
}
