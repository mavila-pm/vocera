// Construye la DEMO del portal (artifact): app empaquetada + PGlite + base precalculada.
//   node dev/build-demo.mjs <carpeta-destino>
import { build } from 'esbuild';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2] || 'dist-demo';
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'pglite'), { recursive: true });

// 1) Base con esquema y migraciones reales, precalculada (los datos demo se cargan en el navegador)
const db = await PGlite.create({ extensions: { pgcrypto, citext } });
await db.exec(readFileSync('dev/local-supabase/bootstrap.sql', 'utf8'));
for (const f of readdirSync('supabase/migrations').sort()) await db.exec(readFileSync('supabase/migrations/' + f, 'utf8'));
await db.exec("select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'payout_encryption_key')");
const dump = await db.dumpDataDir('gzip');
writeFileSync(join(OUT, 'demo-db.wasm'), Buffer.from(await dump.arrayBuffer())); // tar.gz; nombre .wasm por el hosting
await db.close();

// 2) App: portal real + backend demo, en un solo módulo
await build({
  entryPoints: ['dev/demo/entry.js'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true,
  outfile: join(OUT, 'app.js'), loader: { '.sql': 'text' }, legalComments: 'none',
  external: ['@electric-sql/pglite', '@electric-sql/pglite/contrib/*']
});

// 3) PGlite (runtime sin mapas de código)
const P = 'node_modules/@electric-sql/pglite/dist';
const RENAME = { 'pglite.wasm': 'pglite.wasm', 'initdb.wasm': 'initdb.wasm', 'pglite.data': 'pglite-data.wasm',
  'pgcrypto.tar.gz': 'pgcrypto-bundle.wasm', 'citext.tar.gz': 'citext-bundle.wasm' };
for (const f of readdirSync(P)) {
  if (f === 'index.js' || /^chunk-.*\.js$/.test(f)) copyFileSync(join(P, f), join(OUT, 'pglite', f));
  else if (RENAME[f]) copyFileSync(join(P, f), join(OUT, 'pglite', RENAME[f]));
}

// 4) Página
const css = readFileSync('portal/styles/portal.css', 'utf8') + '\n' + readFileSync('dev/demo/demo.css', 'utf8');
writeFileSync(join(OUT, 'index.html'), `<!DOCTYPE html><html lang="es"><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>Portal Vocera</title>
<meta name="robots" content="noindex, nofollow">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@100..125,400..800&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
${css}
</style>
<script type="importmap">{"imports":{"@electric-sql/pglite":"./pglite/index.js"}}</script>
<script>window.VOCERA_CONFIG = { supportEmail: 'soporte@vocera.lat', termsVersion: '2026-10-borrador', resumableThresholdBytes: 52428800 };</script>
<div id="demo-bar"></div>
<div id="app"></div>
<script type="module" src="./app.js"></script>
`);
console.log('demo lista en', OUT);
for (const f of readdirSync(OUT)) console.log(' ', f);
