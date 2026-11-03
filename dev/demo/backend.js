// =====================================================================
// Backend de DEMOSTRACIÓN que corre en el navegador (no se despliega).
// Postgres real compilado a WebAssembly (PGlite) con las MISMAS
// migraciones del portal: RLS, funciones y reglas de negocio idénticas.
// Responde a supabase-js por medio de un fetch propio:
//   /auth/v1 · /rest/v1 · /storage/v1
// Los tokens son de demo (sin firma) y los correos van a una bandeja local.
// =====================================================================
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { citext } from '@electric-sql/pglite/contrib/citext';
import seedSql from './seed.sql';

export const DEMO_URL = 'https://demo.vocera.local';
let db;
const listeners = new Set();
const emit = () => listeners.forEach(f => f());

// ---------- arranque ----------
export async function start(onProgress = () => {}) {
  onProgress('Cargando la base de datos…');
  const blob = await (await fetch('./demo-db.tar.gz')).blob();
  db = await PGlite.create({ loadDataDir: blob, extensions: { pgcrypto, citext } });
  onProgress('Preparando datos de ejemplo…');
  await db.exec(seedSql);
  onProgress('Listo');
}
export const onChange = f => { listeners.add(f); return () => listeners.delete(f); };

// ---------- utilidades ----------
const b64 = o => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const unb64 = s => JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/')))));
const rnd = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, '0')).join('');
const TTL = 3600;
// Formato JWT (cabecera.carga.firma) para que supabase-js lo lea; la firma es ficticia: solo demo.
const HEADER = b64({ alg: 'none', typ: 'JWT', kid: 'demo' });
function token(claims) { return HEADER + '.' + b64(claims) + '.demo'; }
function claimsFrom(headers) {
  const auth = headers.get('authorization') || '';
  const t = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!t.startsWith(HEADER + '.')) return { role: 'anon' };
  try { const c = unb64(t.split('.')[1]); return c.exp && c.exp < Date.now() / 1000 ? null : c; } catch { return null; }
}
const json = (status, body, extra = {}) => new Response(body === undefined ? null : JSON.stringify(body),
  { status, headers: { 'content-type': 'application/json', ...extra } });
const authErr = (status, code, msg) => json(status, { code: status, error_code: code, msg, message: msg });

async function asRole(claims, fn) {
  return db.transaction(async tx => {
    const role = claims.role === 'authenticated' ? 'authenticated' : 'anon';
    await tx.query(`set local role ${role}`);
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    return fn(tx);
  });
}
const pgVal = v => (v !== null && typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v)
  : Array.isArray(v) ? '{' + v.map(x => x === null ? 'NULL' : '"' + String(x).replace(/["\\]/g, m => '\\' + m) + '"').join(',') + '}' : v);
function pgError(e) {
  const code = e.code || 'P0001';
  const status = code === '42501' ? 403 : code === '23505' ? 409 : 400;
  return json(status, { code, message: e.message, details: e.detail || null, hint: e.hint || null });
}

// ---------- AUTH ----------
function userJson(u) {
  return { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, phone: '', email_confirmed_at: u.email_confirmed_at,
    confirmed_at: u.email_confirmed_at, last_sign_in_at: u.last_sign_in_at, app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: u.raw_user_meta_data || {}, identities: [], created_at: u.created_at, updated_at: u.updated_at, is_anonymous: false };
}
async function issueSession(u, sessionId = rnd(8)) {
  const now = Math.floor(Date.now() / 1000);
  const access = token({ aud: 'authenticated', sub: u.id, email: u.email, role: 'authenticated', session_id: sessionId, iat: now, exp: now + TTL });
  const refresh = sessionId + '.' + rnd(16);
  await db.query('insert into auth.local_refresh_tokens (token, user_id) values ($1, $2)', [refresh, u.id]);
  await db.query('update auth.users set last_sign_in_at = now() where id = $1', [u.id]);
  return { access_token: access, token_type: 'bearer', expires_in: TTL, expires_at: now + TTL, refresh_token: refresh, user: userJson(u) };
}
const userByEmail = async e => (await db.query('select * from auth.users where lower(email) = lower($1)', [e])).rows[0];
async function mailToken(u, kind) {
  const t = rnd(16);
  await db.query('insert into auth.local_email_tokens (token, user_id, kind) values ($1, $2, $3)', [t, u.id, kind]);
  emit();
}

async function auth(req, path, url) {
  const body = req.method === 'GET' ? {} : await req.json().catch(() => ({}));
  if (path === '/signup') {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email || '')) return authErr(400, 'validation_failed', 'invalid email');
    if (!body.password || body.password.length < 8 || !/[a-z]/i.test(body.password) || !/\d/.test(body.password)) return authErr(422, 'weak_password', 'weak');
    if (await userByEmail(body.email)) return json(200, { id: crypto.randomUUID(), email: body.email, aud: 'authenticated', role: '', user_metadata: {}, identities: [] });
    const { rows } = await db.query(`insert into auth.users (email, encrypted_password, raw_user_meta_data)
      values ($1, extensions.crypt($2, extensions.gen_salt('bf', 6)), $3) returning *`, [body.email.toLowerCase(), body.password, JSON.stringify(body.data || {})]);
    await mailToken(rows[0], 'signup');
    return json(200, { ...userJson(rows[0]), confirmation_sent_at: new Date().toISOString() });
  }
  if (path === '/resend') { const u = await userByEmail(body.email || ''); if (u && !u.email_confirmed_at) await mailToken(u, 'signup'); return json(200, {}); }
  if (path === '/recover') { const u = await userByEmail(body.email || ''); if (u) await mailToken(u, 'recovery'); return json(200, {}); }
  if (path === '/token') {
    const grant = url.searchParams.get('grant_type');
    if (grant === 'password') {
      const { rows } = await db.query(`select * from auth.users where lower(email) = lower($1) and encrypted_password = extensions.crypt($2, encrypted_password)`, [body.email || '', body.password || '']);
      if (!rows[0]) return authErr(400, 'invalid_credentials', 'Invalid login credentials');
      if (!rows[0].email_confirmed_at) return authErr(400, 'email_not_confirmed', 'Email not confirmed');
      return json(200, await issueSession(rows[0]));
    }
    if (grant === 'refresh_token') {
      const { rows } = await db.query('update auth.local_refresh_tokens set revoked = true where token = $1 and not revoked returning user_id', [body.refresh_token || '']);
      if (!rows[0]) return authErr(400, 'refresh_token_not_found', 'Invalid Refresh Token');
      const u = (await db.query('select * from auth.users where id = $1', [rows[0].user_id])).rows[0];
      return json(200, await issueSession(u, String(body.refresh_token).split('.')[0]));
    }
  }
  const c = claimsFrom(req.headers);
  if (!c || c.role !== 'authenticated') return authErr(401, 'no_authorization', 'Invalid JWT');
  const active = (await db.query('select 1 from auth.local_refresh_tokens where token like $1 and not revoked limit 1', [c.session_id + '.%'])).rows[0];
  if (!active && path !== '/logout') return authErr(403, 'session_not_found', 'Session not found');
  if (path === '/user' && req.method === 'GET') return json(200, userJson((await db.query('select * from auth.users where id = $1', [c.sub])).rows[0]));
  if (path === '/user' && req.method === 'PUT') {
    if (body.password) {
      if (body.password.length < 8 || !/[a-z]/i.test(body.password) || !/\d/.test(body.password)) return authErr(422, 'weak_password', 'weak');
      await db.query(`update auth.users set encrypted_password = extensions.crypt($2, extensions.gen_salt('bf', 6)), updated_at = now() where id = $1`, [c.sub, body.password]);
    }
    return json(200, userJson((await db.query('select * from auth.users where id = $1', [c.sub])).rows[0]));
  }
  if (path === '/logout') {
    const scope = url.searchParams.get('scope') || 'global';
    if (scope === 'local') await db.query('update auth.local_refresh_tokens set revoked = true where token like $1', [c.session_id + '.%']);
    else if (scope === 'others') await db.query('update auth.local_refresh_tokens set revoked = true where user_id = $1 and token not like $2', [c.sub, c.session_id + '.%']);
    else await db.query('update auth.local_refresh_tokens set revoked = true where user_id = $1', [c.sub]);
    return new Response(null, { status: 204 });
  }
  return authErr(404, 'not_found', 'not found');
}

// Bandeja de correo de la demo
export async function mailbox() {
  return (await db.query(`select t.token, t.kind, t.created_at, t.used_at, u.email from auth.local_email_tokens t
    join auth.users u on u.id = t.user_id order by t.created_at desc limit 20`)).rows;
}
export async function openMailLink(tok) {
  const t = (await db.query('select * from auth.local_email_tokens where token = $1 and used_at is null', [tok])).rows[0];
  if (!t) throw new Error('El enlace ya se usó.');
  await db.query('update auth.local_email_tokens set used_at = now() where token = $1', [tok]);
  if (t.kind === 'signup') await db.query('update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where id = $1', [t.user_id]);
  const u = (await db.query('select * from auth.users where id = $1', [t.user_id])).rows[0];
  emit();
  return { kind: t.kind, session: await issueSession(u) };
}

// ---------- REST (subconjunto de PostgREST) ----------
const ident = s => { if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw Object.assign(new Error('Identificador no válido'), { code: 'PGRST100' }); return '"' + s + '"'; };
function filters(params, vals) {
  const w = [];
  for (const [k, raw] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
    const m = /^(not\.)?(eq|neq|gt|gte|lt|lte|like|ilike|is|in)\.(.*)$/s.exec(raw);
    if (!m) throw Object.assign(new Error('Filtro no soportado'), { code: 'PGRST100' });
    const [, neg, op, val] = m; const col = ident(k); let e;
    if (op === 'is') e = `${col} is ${val === 'null' ? 'null' : val === 'true' ? 'true' : 'false'}`;
    else if (op === 'in') { vals.push(pgVal(val.replace(/^\(|\)$/g, '').split(',').map(x => x.replace(/^"|"$/g, '')))); e = `${col}::text = any($${vals.length}::text[])`; }
    else {
      vals.push(val);
      const o = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', like: 'like', ilike: 'ilike' }[op];
      e = ['gt', 'gte', 'lt', 'lte'].includes(op) ? `${col} ${o} $${vals.length}` : `${col}::text ${o} $${vals.length}`;
    }
    w.push(neg ? `not (${e})` : e);
  }
  return w.length ? ' where ' + w.join(' and ') : '';
}
const sel = s => (!s || s === '*' ? '*' : s.split(',').map(x => x.trim()).filter(Boolean).map(ident).join(', '));
const ord = o => (!o ? '' : ' order by ' + o.split(',').map(p => { const [c, d, n] = p.split('.'); return ident(c) + (d === 'desc' ? ' desc' : ' asc') + (n === 'nullslast' ? ' nulls last' : n === 'nullsfirst' ? ' nulls first' : ''); }).join(', '));

async function rest(req, path, url) {
  const c = claimsFrom(req.headers);
  if (!c) return json(401, { code: 'PGRST301', message: 'JWT vencido' });
  const single = (req.headers.get('accept') || '').includes('vnd.pgrst.object');
  const prefer = req.headers.get('prefer') || '';
  const p = url.searchParams;
  if (path.startsWith('/rpc/')) {
    const fn = path.slice(5); const args = await req.json().catch(() => ({}));
    const out = await asRole(c, async tx => {
      const { rows: procs } = await tx.query(`select p.proargnames as names, array(select format_type(t, null) from unnest(p.proargtypes) t) as types,
        p.proretset as retset from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1`, [fn]);
      if (!procs[0]) throw Object.assign(new Error('Función no encontrada'), { code: 'PGRST202' });
      const keys = Object.keys(args); const pr = procs.find(x => keys.every(k => (x.names || []).includes(k))) || procs[0];
      const vals = []; const parts = keys.map(k => {
        const i = pr.names.indexOf(k); let v = args[k]; const ty = pr.types[i] === 'character' ? 'bpchar' : pr.types[i];
        if (ty === 'jsonb' || ty === 'json') v = v === null ? null : JSON.stringify(v); else v = pgVal(v);
        vals.push(v); return `${ident(k)} => $${vals.length}::${ty}`;
      });
      const call = `public.${ident(fn)}(${parts.join(', ')})`;
      if (pr.retset) return (await tx.query(`select coalesce(json_agg(t), '[]'::json) as r from ${call} t`, vals)).rows[0].r;
      return (await tx.query(`select to_json(${call}) as r`, vals)).rows[0].r;
    });
    emit();
    return json(200, out === undefined ? null : out);
  }
  const table = ident(path.slice(1)); const vals = [];
  if (req.method === 'GET' || req.method === 'HEAD') {
    const w = filters(p, vals);
    const lim = p.get('limit') ? ` limit ${Number(p.get('limit'))}` : '';
    const rows = await asRole(c, async tx => (await tx.query(`select coalesce(json_agg(t), '[]'::json) as r from (select ${sel(p.get('select'))} from public.${table}${w}${ord(p.get('order'))}${lim}) t`, vals)).rows[0].r);
    if (single) return rows.length === 1 ? json(200, rows[0]) : json(406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' });
    return json(200, rows, { 'content-range': `0-${Math.max(rows.length - 1, 0)}/*` });
  }
  if (req.method === 'POST') {
    const body = await req.json(); const list = Array.isArray(body) ? body : [body];
    const cols = p.get('columns') ? p.get('columns').split(',').map(x => x.replace(/"/g, '').trim()) : Object.keys(list[0]);
    const tuples = list.map(r => '(' + cols.map(k => { vals.push(pgVal(r[k] === undefined ? null : r[k])); return `$${vals.length}`; }).join(', ') + ')');
    let sql = `insert into public.${table} (${cols.map(ident).join(', ')}) values ${tuples.join(', ')}`;
    if (prefer.includes('resolution=merge-duplicates')) {
      const oc = (p.get('on_conflict') || 'id').split(',');
      const upd = cols.filter(k => !oc.includes(k)).map(k => `${ident(k)} = excluded.${ident(k)}`).join(', ');
      sql += ` on conflict (${oc.map(ident).join(', ')}) do ` + (upd ? `update set ${upd}` : 'nothing');
    }
    const ret = prefer.includes('return=representation');
    const rows = await asRole(c, async tx => (await tx.query(sql + (ret ? ' returning *' : ''), vals)).rows);
    emit();
    return ret ? json(201, single ? rows[0] : rows) : new Response(null, { status: 201 });
  }
  if (req.method === 'PATCH') {
    const body = await req.json();
    const sets = Object.keys(body).map(k => { vals.push(pgVal(body[k])); return `${ident(k)} = $${vals.length}`; });
    const w = filters(p, vals); const ret = prefer.includes('return=representation');
    const rows = await asRole(c, async tx => (await tx.query(`update public.${table} set ${sets.join(', ')}${w}${ret ? ' returning *' : ''}`, vals)).rows);
    emit();
    return ret ? json(200, single ? rows[0] : rows) : new Response(null, { status: 204 });
  }
  if (req.method === 'DELETE') {
    const w = filters(p, vals); if (!w) return json(400, { message: 'DELETE requiere filtros' });
    await asRole(c, tx => tx.query(`delete from public.${table}${w}`, vals));
    emit();
    return new Response(null, { status: 204 });
  }
  return json(405, { message: 'Método no soportado' });
}

// ---------- STORAGE ----------
async function storage(req, path) {
  const c = claimsFrom(req.headers);
  if (!c) return json(401, { message: 'JWT vencido' });
  const m = /^\/object\/([^/]+)\/(.+)$/.exec(path);
  if (m && req.method === 'POST') {
    const [, bucket, raw] = m; const name = decodeURIComponent(raw);
    const fd = await req.formData(); const file = [...fd.values()].find(v => v instanceof Blob);
    if (!file) return json(400, { message: 'Archivo no recibido' });
    const bk = (await db.query('select * from storage.buckets where id = $1', [bucket])).rows[0];
    if (!bk) return json(400, { message: 'Bucket not found' });
    if (bk.file_size_limit && file.size > Number(bk.file_size_limit)) return json(413, { statusCode: '413', message: 'The object exceeded the maximum allowed size' });
    if (bk.allowed_mime_types && !bk.allowed_mime_types.includes(file.type)) return json(415, { statusCode: '415', message: `mime type ${file.type} is not supported` });
    // En la demo se guarda como máximo 1 MB del archivo (suficiente para vistas previas de imágenes)
    const data = new Uint8Array(await file.slice(0, 1024 * 1024).arrayBuffer());
    try {
      await asRole(c, tx => tx.query(`insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ($1, $2, $3::uuid, $4, $5)`,
        [bucket, name, c.sub, c.sub, JSON.stringify({ mimetype: file.type, size: file.size })]));
    } catch (e) {
      if (e.code === '23505') return json(409, { message: 'The resource already exists' });
      return json(403, { statusCode: '403', message: 'new row violates row-level security policy' });
    }
    await db.query('insert into demo.files values ($1, $2, $3, $4)', [bucket, name, file.type, data]);
    return json(200, { Key: `${bucket}/${name}` });
  }
  return json(404, { message: 'No soportado en la demo' });
}

// URL temporal para ver un archivo (respeta RLS: solo dueño o admin)
export async function objectUrl(bucket, name, accessToken) {
  const c = claimsFrom(new Headers({ authorization: 'Bearer ' + accessToken }));
  const ok = await asRole(c || { role: 'anon' }, async tx => (await tx.query('select 1 from storage.objects where bucket_id = $1 and name = $2', [bucket, name])).rows[0]);
  if (!ok) throw new Error('No tienes acceso a este archivo.');
  const f = (await db.query('select mime, data from demo.files where bucket = $1 and name = $2', [bucket, name])).rows[0];
  if (!f) throw new Error('Archivo no disponible en la demo.');
  return URL.createObjectURL(new Blob([f.data], { type: f.mime }));
}

// fetch que supabase-js usa en la demo
export async function demoFetch(input, init = {}) {
  const req = new Request(input, init);
  const url = new URL(req.url);
  await new Promise(r => setTimeout(r, 60)); // latencia mínima para que se vean los estados de carga
  try {
    if (url.pathname.startsWith('/auth/v1')) return await auth(req, url.pathname.slice(8), url);
    if (url.pathname.startsWith('/rest/v1')) return await rest(req, url.pathname.slice(8), url);
    if (url.pathname.startsWith('/storage/v1')) return await storage(req, url.pathname.slice(11));
    return json(404, { message: 'not found' });
  } catch (e) {
    return pgError(e);
  }
}
