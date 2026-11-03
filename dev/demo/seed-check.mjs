// Verifica que bootstrap + migraciones + datos demo cargan en PGlite y deja un resumen.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { readFileSync, readdirSync } from 'node:fs';
const t0 = Date.now();
const db = await PGlite.create({ extensions: { pgcrypto, citext } });
await db.exec(readFileSync('dev/local-supabase/bootstrap.sql', 'utf8'));
for (const f of readdirSync('supabase/migrations').sort()) await db.exec(readFileSync('supabase/migrations/' + f, 'utf8'));
await db.exec("select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'payout_encryption_key')");
const t1 = Date.now();
try { await db.exec(readFileSync('dev/demo/seed.sql', 'utf8')); } catch (e) { console.log('FALLO seed →', e.message); process.exit(1); }
console.log('migraciones', t1 - t0, 'ms · seed', Date.now() - t1, 'ms');
console.log((await db.query("select c.name, p.full_name, a.status from public.campaign_assignments a join public.campaigns c on c.id=a.campaign_id join public.profiles p on p.id=a.creator_id order by c.name")).rows);
console.log((await db.query("select email, role, status from public.profiles order by email")).rows);
