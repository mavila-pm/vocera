// Empaqueta las dependencias del portal en portal/vendor (ESM, sin CDN).
// Se ejecuta solo al actualizar versiones: `npm run vendor`.
import { build } from 'esbuild';
import { writeFileSync, mkdirSync } from 'node:fs';

mkdirSync('portal/vendor', { recursive: true });
const entries = {
  'supabase.js': "export { createClient } from '@supabase/supabase-js';",
  'preact.js': "import { h, render, Fragment, cloneElement } from 'preact'; import htm from 'htm'; export const html = htm.bind(h); export { h, render, Fragment, cloneElement }; export * from 'preact/hooks';",
  'tus.js': "export { Upload } from 'tus-js-client';"
};
for (const [out, contents] of Object.entries(entries)) {
  await build({
    stdin: { contents, resolveDir: process.cwd(), loader: 'js' },
    bundle: true, format: 'esm', platform: 'browser', target: 'es2020', minify: true,
    outfile: `portal/vendor/${out}`, legalComments: 'none',
    banner: { js: `/* ${out} · empaquetado por dev/build-vendor.mjs · ver package.json para versiones */` }
  });
}
writeFileSync('portal/vendor/README.md', 'Dependencias empaquetadas localmente para no depender de CDNs.\nRegenerar con `npm run vendor` (versiones fijadas en package.json).\n');
console.log('vendor listo');
