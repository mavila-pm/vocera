// Comprueba que las migraciones reales y la prueba SQL corren en PGlite (Postgres WASM).
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { readFileSync, readdirSync } from 'node:fs';
const db = await PGlite.create({ extensions: { pgcrypto, citext } });
const run = async (label, sql) => { try { await db.exec(sql); console.log('OK', label); } catch (e) { console.log('FALLO', label, '→', e.message); process.exit(1); } };
await run('bootstrap', readFileSync('dev/local-supabase/bootstrap.sql', 'utf8'));
for (const f of readdirSync('supabase/migrations').sort()) await run(f, readFileSync('supabase/migrations/' + f, 'utf8'));
await run('clave dev', "select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'payout_encryption_key')");
// La prueba SQL usa metacomandos de psql (\set, \echo): se quitan.
const test = readFileSync('supabase/tests/01_flow_and_security.sql', 'utf8').split('\n').filter(l => !l.startsWith('\\')).join('\n');
let notices = 0; 
const db2 = db; 
try { await db2.exec(test); console.log('OK prueba SQL completa'); } catch (e) { console.log('FALLO prueba SQL →', e.message); process.exit(1); }
console.log((await db.query("select count(*) n from public.audit_logs")).rows);
