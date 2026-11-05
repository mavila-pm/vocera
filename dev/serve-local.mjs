// Portal Vocera en local, sin Supabase ni PostgreSQL instalados.
//   npm run local   →  construye la versión local y la abre en http://localhost:5173
// La base de datos es PostgreSQL real compilado a WebAssembly (PGlite) y vive en el navegador:
// mismas migraciones, mismas reglas de seguridad y datos de ejemplo. Se reinicia al recargar.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { execFile, spawnSync } from 'node:child_process';

const ROOT = resolve('dist-demo');
const PORT = Number(process.env.PORT) || 5173;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.data': 'application/octet-stream' };

if (!process.argv.includes('--no-build')) {
  console.log('Construyendo el portal…');
  const r = spawnSync(process.execPath, ['dev/build-demo.mjs', 'dist-demo'], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status || 1);
}

createServer(async (req, res) => {
  try {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = normalize(join(ROOT, url));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    if ((await stat(file).catch(() => null))?.isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('No encontrado'); }
}).listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}/`;
  console.log(`\nPortal Vocera listo en ${url}\nCuentas: creadora, admin y creador en revisión desde la barra amarilla.\nCtrl + C para detener.\n`);
  if (!process.argv.includes('--no-open')) {
    const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    execFile(cmd[0], cmd[1], () => {});
  }
});
