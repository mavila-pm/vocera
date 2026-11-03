// Arranque de la DEMO en el navegador: inicia PGlite, expone el backend al
// portal y monta la barra de demostración. El portal es el mismo código real.
import * as backend from './backend.js';

const app = document.getElementById('app');
const say = msg => { app.innerHTML = `<div class="demo-boot" role="status"><span class="spin"></span><p>${msg}</p></div>`; };
try {
  say('Iniciando la demo…');
  await backend.start(say);
} catch (e) {
  app.innerHTML = `<div class="demo-boot"><h1>No se pudo iniciar la demo</h1><p>Este navegador no permitió cargar la base de datos local (WebAssembly). Prueba en Chrome, Edge, Safari o Firefox actualizados.</p><p class="muted small">${String(e && e.message || e).slice(0, 200)}</p></div>`;
  throw e;
}
window.VOCERA_DEMO = { url: backend.DEMO_URL, fetch: backend.demoFetch, objectUrl: backend.objectUrl };
await import('../../portal/app/main.js');
const { mountDemoBar } = await import('./bar.js');
mountDemoBar(backend);
