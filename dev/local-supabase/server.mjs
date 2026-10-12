// =====================================================================
// Emulador LOCAL de Supabase (solo desarrollo y pruebas E2E).
// NO se despliega. Implementa el subconjunto de las APIs que usa el portal:
//   /auth/v1    registro, verificación de correo, login, refresh, logout,
//               recuperación y cambio de contraseña (tokens JWT HS256)
//   /rest/v1    tablas y RPC; cada petición corre en una transacción con
//               SET ROLE + request.jwt.claims, así que las políticas RLS y
//               los permisos de Postgres se aplican igual que en Supabase
//   /storage/v1 subida, URL firmadas y descarga, con RLS sobre storage.objects
// Los correos NO se envían: quedan en una bandeja local (/__dev/emails).
// =====================================================================
import http from 'node:http';
import { createReadStream, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import Busboy from 'busboy';

const PORT = Number(process.env.API_PORT || 54321);
const SECRET = process.env.LOCAL_JWT_SECRET || 'solo-desarrollo-local-no-usar-en-produccion-0000';
const DATA_DIR = resolve(process.env.DATA_DIR || new URL('./.data', import.meta.url).pathname);
const pool = new pg.Pool({
  host: process.env.PGHOST || '/tmp', port: Number(process.env.PGPORT || 54329),
  user: 'postgres', database: process.env.DB || 'vocera_dev', max: 10
});

export const ANON_KEY = jwt.sign({ role: 'anon', iss: 'vocera-local' }, SECRET, { expiresIn: '10y' });
const ACCESS_TTL = 3600;

// ---------- utilidades HTTP ----------
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, prefer, accept-profile, content-profile, x-upsert, range, accept, x-supabase-api-version, cache-control',
  'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS, HEAD',
  'access-control-expose-headers': 'content-range, content-length'
};
function send(res, status, body, headers = {}) {
  const isStr = typeof body === 'string';
  res.writeHead(status, { ...CORS, 'content-type': isStr ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', ...headers });
  res.end(body === undefined ? '' : isStr ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((ok, ko) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > 5e6) { ko(new Error('payload')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => ok(Buffer.concat(chunks)));
    req.on('error', ko);
  });
}
async function json(req) { const b = await readBody(req); return b.length ? JSON.parse(b.toString('utf8')) : {}; }

// Límite simple por IP para endpoints sensibles (Supabase aplica los suyos en producción)
const hits = new Map();
function limited(req, key, max = 20, windowMs = 60000) {
  const k = key + ':' + (req.socket.remoteAddress || '');
  const now = Date.now();
  const arr = (hits.get(k) || []).filter(t => now - t < windowMs);
  arr.push(now); hits.set(k, arr);
  return arr.length > max;
}

function claimsFrom(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : req.headers.apikey;
  if (!token) return { role: 'anon' };
  try { return jwt.verify(token, SECRET); } catch { return null; }
}

// Ejecuta fn(client) dentro de una transacción con el rol del token
async function asRole(claims, fn) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const role = claims.role === 'authenticated' ? 'authenticated' : claims.role === 'service_role' ? 'service_role' : 'anon';
    await c.query(`set local role ${role}`);
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (e) { await c.query('rollback').catch(() => {}); throw e; }
  finally { c.release(); }
}
function pgError(res, e) {
  const status = e.code === '42501' ? 403 : e.code === '23505' ? 409 : e.code === 'PGRST116' ? 406 : /^PGRST/.test(e.code || '') ? 400 : e.code === 'P0001' || /^2/.test(e.code || '') || /^4/.test(e.code || '') ? 400 : 500;
  send(res, status, { code: e.code || 'PGRST000', message: e.message, details: e.detail || null, hint: e.hint || null });
}

// =====================================================================
// AUTH
// =====================================================================
function userJson(u) {
  return {
    id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, phone: u.phone || '',
    email_confirmed_at: u.email_confirmed_at, confirmed_at: u.email_confirmed_at, last_sign_in_at: u.last_sign_in_at,
    app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: u.raw_user_meta_data || {},
    identities: [], created_at: u.created_at, updated_at: u.updated_at, is_anonymous: false
  };
}
async function issueSession(u, sessionId = randomUUID()) {
  const now = Math.floor(Date.now() / 1000);
  const access = jwt.sign({ aud: 'authenticated', sub: u.id, email: u.email, role: 'authenticated', session_id: sessionId,
    app_metadata: { provider: 'email' }, user_metadata: u.raw_user_meta_data || {}, iat: now, exp: now + ACCESS_TTL }, SECRET);
  const refresh = sessionId + '.' + randomBytes(24).toString('hex');
  await pool.query('insert into auth.local_refresh_tokens (token, user_id) values ($1, $2)', [refresh, u.id]);
  await pool.query('update auth.users set last_sign_in_at = now() where id = $1', [u.id]);
  return { access_token: access, token_type: 'bearer', expires_in: ACCESS_TTL, expires_at: now + ACCESS_TTL, refresh_token: refresh, user: userJson(u) };
}
const authErr = (res, status, code, msg) => send(res, status, { code: status, error_code: code, msg, message: msg });
const getUserByEmail = async email => (await pool.query('select * from auth.users where lower(email) = lower($1)', [email])).rows[0];

async function createEmailToken(user, kind, redirectTo) {
  const token = randomBytes(20).toString('hex');
  await pool.query('insert into auth.local_email_tokens (token, user_id, kind, redirect_to) values ($1,$2,$3,$4)', [token, user.id, kind, redirectTo || null]);
  console.log(`[correo local] ${kind} para ${user.email}: http://localhost:${PORT}/auth/v1/verify?token=${token}&type=${kind}`);
  return token;
}

async function handleAuth(req, res, path, url) {
  if (path === '/signup' && req.method === 'POST') {
    if (limited(req, 'signup', 10)) return authErr(res, 429, 'over_request_rate_limit', 'Demasiados intentos. Espera un minuto.');
    const b = await json(req);
    if (!b.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email)) return authErr(res, 400, 'validation_failed', 'Unable to validate email address: invalid format');
    if (!b.password || b.password.length < 8 || !/[A-Za-z]/.test(b.password) || !/\d/.test(b.password))
      return authErr(res, 422, 'weak_password', 'Password should be at least 8 characters and contain letters and digits.');
    const existing = await getUserByEmail(b.email);
    if (existing) {
      // Igual que Supabase: no revela si el correo existe.
      return send(res, 200, { id: randomUUID(), email: b.email, aud: 'authenticated', role: '', user_metadata: {}, identities: [] });
    }
    const { rows } = await pool.query(
      `insert into auth.users (email, encrypted_password, raw_user_meta_data)
       values ($1, extensions.crypt($2, extensions.gen_salt('bf', 10)), $3) returning *`,
      [b.email.toLowerCase(), b.password, b.data || {}]);
    await createEmailToken(rows[0], 'signup', url.searchParams.get('redirect_to'));
    return send(res, 200, { ...userJson(rows[0]), confirmation_sent_at: new Date().toISOString() });
  }
  if (path === '/resend' && req.method === 'POST') {
    if (limited(req, 'resend', 5)) return authErr(res, 429, 'over_email_send_rate_limit', 'Espera un minuto antes de pedir otro correo.');
    const b = await json(req); const u = await getUserByEmail(b.email || '');
    if (u && !u.email_confirmed_at) await createEmailToken(u, 'signup', b.options?.emailRedirectTo || url.searchParams.get('redirect_to'));
    return send(res, 200, {});
  }
  if (path === '/verify' && req.method === 'GET') {
    const token = url.searchParams.get('token');
    const { rows } = await pool.query('select t.*, u.email from auth.local_email_tokens t join auth.users u on u.id = t.user_id where token = $1', [token]);
    const t = rows[0];
    const redirect = (t && t.redirect_to) || url.searchParams.get('redirect_to') || 'http://localhost:8765/portal/';
    if (!t || t.used_at || Date.now() - new Date(t.created_at).getTime() > 24 * 3600e3) {
      res.writeHead(303, { location: redirect + '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired' });
      return res.end();
    }
    await pool.query('update auth.local_email_tokens set used_at = now() where token = $1', [token]);
    if (t.kind === 'signup') await pool.query('update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where id = $1', [t.user_id]);
    const u = (await pool.query('select * from auth.users where id = $1', [t.user_id])).rows[0];
    const s = await issueSession(u);
    const hash = new URLSearchParams({ access_token: s.access_token, expires_at: s.expires_at, expires_in: s.expires_in,
      refresh_token: s.refresh_token, token_type: 'bearer', type: t.kind });
    res.writeHead(303, { location: redirect + '#' + hash.toString() });
    return res.end();
  }
  if (path === '/token' && req.method === 'POST') {
    const grant = url.searchParams.get('grant_type'); const b = await json(req);
    if (grant === 'password') {
      if (limited(req, 'login', 15)) return authErr(res, 429, 'over_request_rate_limit', 'Demasiados intentos. Espera un minuto.');
      const { rows } = await pool.query(
        `select * from auth.users where lower(email) = lower($1) and encrypted_password = extensions.crypt($2, encrypted_password)`, [b.email || '', b.password || '']);
      if (!rows[0]) return authErr(res, 400, 'invalid_credentials', 'Invalid login credentials');
      if (!rows[0].email_confirmed_at) return authErr(res, 400, 'email_not_confirmed', 'Email not confirmed');
      return send(res, 200, await issueSession(rows[0]));
    }
    if (grant === 'refresh_token') {
      const { rows } = await pool.query(
        `update auth.local_refresh_tokens set revoked = true where token = $1 and not revoked returning user_id`, [b.refresh_token || '']);
      if (!rows[0]) return authErr(res, 400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
      const u = (await pool.query('select * from auth.users where id = $1', [rows[0].user_id])).rows[0];
      return send(res, 200, await issueSession(u, String(b.refresh_token).split('.')[0]));
    }
    return authErr(res, 400, 'unsupported_grant_type', 'unsupported grant');
  }
  if (path === '/recover' && req.method === 'POST') {
    if (limited(req, 'recover', 5)) return authErr(res, 429, 'over_email_send_rate_limit', 'Espera un minuto antes de pedir otro correo.');
    const b = await json(req); const u = await getUserByEmail(b.email || '');
    if (u) await createEmailToken(u, 'recovery', url.searchParams.get('redirect_to'));
    return send(res, 200, {});
  }
  const claims = claimsFrom(req);
  if (!claims || claims.role !== 'authenticated') return authErr(res, 401, 'no_authorization', 'Invalid JWT');
  const active = await pool.query('select 1 from auth.local_refresh_tokens where token like $1 and not revoked limit 1', [claims.session_id + '.%']);
  if (!active.rows[0] && path !== '/logout') return authErr(res, 403, 'session_not_found', 'Session from session_id claim in JWT does not exist');
  if (path === '/user' && req.method === 'GET') {
    const u = (await pool.query('select * from auth.users where id = $1', [claims.sub])).rows[0];
    return u ? send(res, 200, userJson(u)) : authErr(res, 404, 'user_not_found', 'User not found');
  }
  if (path === '/user' && req.method === 'PUT') {
    const b = await json(req);
    if (b.password) {
      if (b.password.length < 8 || !/[A-Za-z]/.test(b.password) || !/\d/.test(b.password))
        return authErr(res, 422, 'weak_password', 'Password should be at least 8 characters and contain letters and digits.');
      await pool.query(`update auth.users set encrypted_password = extensions.crypt($2, extensions.gen_salt('bf', 10)), updated_at = now() where id = $1`, [claims.sub, b.password]);
    }
    if (b.data) await pool.query(`update auth.users set raw_user_meta_data = raw_user_meta_data || $2, updated_at = now() where id = $1`, [claims.sub, b.data]);
    const u = (await pool.query('select * from auth.users where id = $1', [claims.sub])).rows[0];
    return send(res, 200, userJson(u));
  }
  if (path === '/logout' && req.method === 'POST') {
    const scope = url.searchParams.get('scope') || 'global';
    if (scope === 'local') await pool.query('update auth.local_refresh_tokens set revoked = true where token like $1', [claims.session_id + '.%']);
    else if (scope === 'others') await pool.query('update auth.local_refresh_tokens set revoked = true where user_id = $1 and token not like $2', [claims.sub, claims.session_id + '.%']);
    else await pool.query('update auth.local_refresh_tokens set revoked = true where user_id = $1', [claims.sub]);
    return send(res, 204);
  }
  return authErr(res, 404, 'not_found', 'Not found');
}

// =====================================================================
// REST (subconjunto de PostgREST)
// =====================================================================
const ident = s => { if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw Object.assign(new Error('Identificador no válido: ' + s), { code: 'PGRST100' }); return '"' + s + '"'; };
function parseFilters(params, values) {
  const where = [];
  for (const [k, raw] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
    const m = /^(not\.)?(eq|neq|gt|gte|lt|lte|like|ilike|is|in)\.(.*)$/s.exec(raw);
    if (!m) throw Object.assign(new Error('Filtro no soportado: ' + raw), { code: 'PGRST100' });
    const [, neg, op, val] = m; const col = ident(k);
    let expr;
    if (op === 'is') expr = `${col} is ${val === 'null' ? 'null' : val === 'true' ? 'true' : 'false'}`;
    else if (op === 'in') {
      const items = val.replace(/^\(|\)$/g, '').split(',').map(x => x.replace(/^"|"$/g, ''));
      values.push(items); expr = `${col}::text = any($${values.length})`;
    } else {
      values.push(val);
      const sqlOp = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', like: 'like', ilike: 'ilike' }[op];
      expr = `${col}::text ${sqlOp} $${values.length}`;
      if (['gt', 'gte', 'lt', 'lte'].includes(op)) expr = `${col} ${sqlOp} $${values.length}`;
    }
    where.push(neg ? `not (${expr})` : expr);
  }
  return where.length ? ' where ' + where.join(' and ') : '';
}
function selectList(sel) {
  if (!sel || sel === '*') return '*';
  return sel.split(',').map(s => s.trim()).filter(Boolean).map(ident).join(', ');
}
function orderBy(o) {
  if (!o) return '';
  return ' order by ' + o.split(',').map(p => {
    const [c, dir, nulls] = p.split('.');
    return ident(c) + (dir === 'desc' ? ' desc' : ' asc') + (nulls === 'nullslast' ? ' nulls last' : nulls === 'nullsfirst' ? ' nulls first' : '');
  }).join(', ');
}

async function handleRest(req, res, path, url) {
  const claims = claimsFrom(req);
  if (!claims) return send(res, 401, { code: 'PGRST301', message: 'JWT inválido o vencido' });
  const single = (req.headers.accept || '').includes('vnd.pgrst.object');
  const prefer = req.headers.prefer || '';
  const p = url.searchParams;

  if (path.startsWith('/rpc/')) {
    const fn = path.slice(5);
    const args = req.method === 'POST' ? await json(req) : Object.fromEntries(p);
    const out = await asRole(claims, async c => {
      const { rows: procs } = await c.query(
        `select p.proargnames as names, array(select format_type(t, null) from unnest(p.proargtypes) t) as types,
                p.proretset as retset, format_type(p.prorettype, null) as rettype
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1`, [fn]);
      if (!procs[0]) throw Object.assign(new Error(`Función ${fn} no encontrada`), { code: 'PGRST202' });
      const keys = Object.keys(args);
      const proc = procs.find(pr => keys.every(k => (pr.names || []).includes(k))) || procs[0];
      const vals = []; const parts = [];
      keys.forEach(k => {
        const i = proc.names.indexOf(k); let v = args[k];
        if (proc.types[i] === 'jsonb' || proc.types[i] === 'json') v = v === null ? null : JSON.stringify(v);
        vals.push(v); parts.push(`${ident(k)} => $${vals.length}::${proc.types[i] === 'character' ? 'bpchar' : proc.types[i]}`);
      });
      const call = `public.${ident(fn)}(${parts.join(', ')})`;
      if (proc.retset) return (await c.query(`select coalesce(json_agg(t), '[]'::json) as r from ${call} t`, vals)).rows[0].r;
      return (await c.query(`select to_json(${call}) as r`, vals)).rows[0].r;
    });
    // PostgREST siempre responde JSON (también para escalares como un uuid)
    return send(res, 200, JSON.stringify(out === undefined ? null : out), { 'content-type': 'application/json; charset=utf-8' });
  }

  const table = ident(path.slice(1));
  const values = [];
  if (req.method === 'GET' || req.method === 'HEAD') {
    const where = parseFilters(p, values);
    const lim = p.get('limit') ? ` limit ${Number(p.get('limit'))}` : '';
    const off = p.get('offset') ? ` offset ${Number(p.get('offset'))}` : '';
    const rows = await asRole(claims, async c =>
      (await c.query(`select coalesce(json_agg(t), '[]'::json) as r from (select ${selectList(p.get('select'))} from public.${table}${where}${orderBy(p.get('order'))}${lim}${off}) t`, values)).rows[0].r);
    if (single) {
      if (rows.length !== 1) return send(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${rows.length} rows` });
      return send(res, 200, rows[0]);
    }
    return send(res, 200, rows, { 'content-range': `0-${Math.max(rows.length - 1, 0)}/*` });
  }
  if (req.method === 'POST') {
    const body = await json(req); const list = Array.isArray(body) ? body : [body];
    if (!list.length) return send(res, 201, []);
    const cols = (p.get('columns') ? p.get('columns').split(',').map(x => x.replace(/"/g, '').trim()) : Object.keys(list[0]));
    const tuples = list.map(r => '(' + cols.map(cn => { const v = r[cn]; values.push(v !== null && typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v) : v); return `$${values.length}`; }).join(', ') + ')');
    let sql = `insert into public.${table} (${cols.map(ident).join(', ')}) values ${tuples.join(', ')}`;
    if (prefer.includes('resolution=merge-duplicates')) {
      const conflict = (p.get('on_conflict') || 'id').split(',').map(ident).join(', ');
      const upd = cols.filter(cn => !(p.get('on_conflict') || 'id').split(',').includes(cn)).map(cn => `${ident(cn)} = excluded.${ident(cn)}`).join(', ');
      sql += ` on conflict (${conflict}) do ` + (upd ? `update set ${upd}` : 'nothing');
    }
    const ret = prefer.includes('return=representation');
    const rows = await asRole(claims, async c => (await c.query(sql + (ret ? ' returning *' : ''), values)).rows);
    if (!ret) return send(res, 201);
    if (single) return send(res, 201, rows[0]);
    return send(res, 201, rows);
  }
  if (req.method === 'PATCH') {
    const body = await json(req);
    const sets = Object.keys(body).map(k => { const v = body[k]; values.push(v !== null && typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v) : v); return `${ident(k)} = $${values.length}`; });
    const where = parseFilters(p, values);
    const ret = prefer.includes('return=representation');
    const rows = await asRole(claims, async c => (await c.query(`update public.${table} set ${sets.join(', ')}${where}${ret ? ' returning *' : ''}`, values)).rows);
    if (!ret) return send(res, 204);
    return send(res, 200, single ? rows[0] : rows);
  }
  if (req.method === 'DELETE') {
    const where = parseFilters(p, values);
    if (!where) return send(res, 400, { code: 'PGRST100', message: 'DELETE requiere filtros' });
    await asRole(claims, c => c.query(`delete from public.${table}${where}`, values));
    return send(res, 204);
  }
  return send(res, 405, { message: 'Método no soportado' });
}

// =====================================================================
// STORAGE
// =====================================================================
function parseUpload(req) {
  const type = req.headers['content-type'] || '';
  if (!type.startsWith('multipart/form-data')) {
    return readBody(req).then(buf => ({ buf, mime: type.split(';')[0] || 'application/octet-stream' }));
  }
  return new Promise((ok, ko) => {
    const bb = Busboy({ headers: req.headers, limits: { fileSize: 6 * 1024 * 1024 * 1024 } });
    let file = null; const chunks = [];
    bb.on('file', (_name, stream, info) => { file = { mime: info.mimeType }; stream.on('data', d => chunks.push(d)); });
    bb.on('close', () => file ? ok({ buf: Buffer.concat(chunks), mime: file.mime }) : ko(new Error('Archivo no recibido')));
    bb.on('error', ko);
    req.pipe(bb);
  });
}
async function handleStorage(req, res, path, url) {
  const claims = claimsFrom(req);
  let m;
  if ((m = /^\/object\/sign\/([^/]+)\/(.+)$/.exec(path)) && req.method === 'GET') {
    const [, bucket, name] = m;
    try {
      const t = jwt.verify(url.searchParams.get('token') || '', SECRET);
      if (t.url !== `${bucket}/${decodeURIComponent(name)}`) throw new Error();
    } catch { return send(res, 400, { statusCode: '400', error: 'InvalidSignature', message: 'La URL firmada no es válida o venció' }); }
    const file = join(DATA_DIR, bucket, decodeURIComponent(name));
    let st; try { st = statSync(file); } catch { return send(res, 404, { message: 'Objeto no encontrado' }); }
    const { rows } = await pool.query('select metadata from storage.objects where bucket_id = $1 and name = $2', [bucket, decodeURIComponent(name)]);
    const mime = rows[0]?.metadata?.mimetype || 'application/octet-stream';
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    const headers = { ...CORS, 'content-type': mime, 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=60', 'x-content-type-options': 'nosniff' };
    if (url.searchParams.has('download')) headers['content-disposition'] = `attachment; filename="${(url.searchParams.get('download') || 'archivo').replace(/[^\w.\-]/g, '_')}"`;
    if (range) {
      const start = range[1] ? Number(range[1]) : 0; const end = range[2] ? Number(range[2]) : st.size - 1;
      res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${st.size}`, 'content-length': end - start + 1 });
      return createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, 'content-length': st.size });
    return createReadStream(file).pipe(res);
  }
  if (!claims) return send(res, 401, { statusCode: '401', error: 'Unauthorized', message: 'JWT inválido' });
  if ((m = /^\/object\/sign\/([^/]+)\/(.+)$/.exec(path)) && req.method === 'POST') {
    const [, bucket, name] = m; const b = await json(req); const objectName = decodeURIComponent(name);
    const found = await asRole(claims, async c => (await c.query('select 1 from storage.objects where bucket_id = $1 and name = $2', [bucket, objectName])).rows[0]);
    if (!found) return send(res, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
    const token = jwt.sign({ url: `${bucket}/${objectName}` }, SECRET, { expiresIn: Math.min(Number(b.expiresIn) || 60, 3600) });
    return send(res, 200, { signedURL: `/object/sign/${bucket}/${encodeURI(objectName)}?token=${token}` });
  }
  if ((m = /^\/object\/([^/]+)\/(.+)$/.exec(path)) && (req.method === 'POST' || req.method === 'PUT')) {
    const [, bucket, name] = m; const objectName = decodeURIComponent(name);
    if (objectName.includes('..')) return send(res, 400, { statusCode: '400', error: 'InvalidKey', message: 'Ruta no válida' });
    const { buf, mime } = await parseUpload(req);
    const bk = (await pool.query('select * from storage.buckets where id = $1', [bucket])).rows[0];
    if (!bk) return send(res, 400, { statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' });
    if (bk.file_size_limit && buf.length > Number(bk.file_size_limit)) return send(res, 413, { statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' });
    if (bk.allowed_mime_types && !bk.allowed_mime_types.includes(mime)) return send(res, 415, { statusCode: '415', error: 'invalid_mime_type', message: `mime type ${mime} is not supported` });
    try {
      const row = await asRole(claims, async c => (await c.query(
        `insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ($1, $2, $3::uuid, $4::text, $5) returning id`,
        [bucket, objectName, claims.sub || null, claims.sub || null, { mimetype: mime, size: buf.length }])).rows[0]);
      const file = join(DATA_DIR, bucket, objectName);
      mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, buf);
      return send(res, 200, { Key: `${bucket}/${objectName}`, Id: row.id });
    } catch (e) {
      if (e.code === '23505') return send(res, 409, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
      if (e.code === '42501') return send(res, 403, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
      throw e;
    }
  }
  return send(res, 404, { message: 'No soportado por el emulador local' });
}

// =====================================================================
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204);
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = decodeURI(url.pathname);
  try {
    if (path.startsWith('/auth/v1')) return await handleAuth(req, res, path.slice(8), url);
    if (path.startsWith('/rest/v1')) return await handleRest(req, res, path.slice(8), url);
    if (path.startsWith('/storage/v1')) return await handleStorage(req, res, path.slice(11), url);
    if (path === '/__dev/emails') {
      const { rows } = await pool.query(`select t.token, t.kind, t.created_at, u.email from auth.local_email_tokens t join auth.users u on u.id = t.user_id
        where ($1 = '' or lower(u.email) = lower($1)) order by t.created_at desc limit 20`, [url.searchParams.get('email') || '']);
      return send(res, 200, rows.map(r => ({ ...r, link: `http://localhost:${PORT}/auth/v1/verify?token=${r.token}&type=${r.kind}` })));
    }
    if (path === '/__dev/anon-key') return send(res, 200, { anon_key: ANON_KEY, url: `http://localhost:${PORT}` });
    return send(res, 404, { message: 'not found' });
  } catch (e) {
    if (e.code) return pgError(res, e);
    console.error(e);
    return send(res, 500, { message: 'Error interno del emulador' });
  }
});
server.listen(PORT, () => console.log(`Emulador Supabase local en http://localhost:${PORT}\nANON_KEY=${ANON_KEY}`));
