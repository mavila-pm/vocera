// =====================================================================
// Prueba E2E del portal (criterios de aceptación del Módulo 18).
// Levanta: Postgres local (ya iniciado), emulador de Supabase y servidor
// estático; recrea la base, y recorre el flujo completo en Chromium con
// un creador y un admin reales. No usa servicios externos ni datos reales.
//   node tests/e2e/run.mjs
// =====================================================================
import { spawn, execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright');
import { createClient } from '@supabase/supabase-js';

const ROOT = new URL('../../', import.meta.url).pathname;
const OUT = process.env.E2E_OUT || ROOT + 'tests/e2e/.out';
mkdirSync(OUT, { recursive: true });
const SITE = 'http://localhost:8765/portal/';
const API = 'http://localhost:54321';
const results = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function step(name, fn) {
  const t = Date.now();
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - t }); console.log('  ✔', name); }
  catch (e) { results.push({ name, ok: false, error: e.message.split('\n')[0] }); console.log('  ✘', name, '→', e.message.split('\n')[0]); throw e; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };

// ---------- infraestructura ----------
execSync('bash dev/local-supabase/reset-db.sh', { cwd: ROOT, stdio: 'ignore' });
execSync(`rm -rf ${ROOT}dev/local-supabase/.data`);
const api = spawn('node', ['dev/local-supabase/server.mjs'], { cwd: ROOT, stdio: 'ignore' });
const web = spawn('python3', ['-m', 'http.server', '8765', '--directory', ROOT], { stdio: 'ignore' });
await sleep(1500);
const { anon_key } = await (await fetch(API + '/__dev/anon-key')).json();
const psql = sql => execSync(`psql -h ${process.env.PGHOST || '/tmp'} -p ${process.env.PGPORT || 54329} -U postgres -d vocera_dev -tAc "${sql.replace(/"/g, '\\"')}"`).toString().trim();

// Archivos de prueba (contenido mínimo válido para el tipo)
const files = {
  png: { name: 'foto.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5e0d7c80000000049454e44ae426082', 'hex') },
  pdf: name => ({ name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n') }),
  mp4: name => ({ name, mimeType: 'video/mp4', buffer: Buffer.concat([Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex'), Buffer.alloc(2048)]) })
};

const browser = await chromium.launch();
const ctxC = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const C = await ctxC.newPage(); const A = await ctxA.newPage();
const errors = [];
for (const [who, p] of [['creador', C], ['admin', A]]) {
  p.on('pageerror', e => errors.push(`${who}: ${e.message}`));
  p.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_TUNNEL|Failed to load resource/.test(m.text())) errors.push(`${who}: ${m.text()}`); });
}
// Respuestas para los prompt() de acciones secundarias del admin
const answers = [];
A.on('dialog', d => d.accept(answers.shift() ?? ''));

const toastSeen = async (p, text) => p.locator('.toast', { hasText: text }).first().waitFor({ timeout: 8000 });
const tab = async (p, name) => { await p.getByRole('tab', { name: new RegExp('^' + name) }).click(); await sleep(300); };
const mail = async email => (await (await fetch(`${API}/__dev/emails?email=${email}`)).json())[0].link + '&redirect_to=' + encodeURIComponent(SITE);
const today = new Date().toISOString().slice(0, 10);
let assignmentId;

try {
  console.log('\nCriterios de aceptación');
  // 1. Registro
  await step('1. Un creador se registra (con verificación de correo)', async () => {
    await C.goto(SITE + '#/registro');
    await C.fill('input[autocomplete=name]', 'Lucía Fernández');
    await C.fill('input[type=email]', 'lucia@ejemplo.pe');
    await C.fill('input[type=tel]', '987654321');
    const pw = C.locator('input[autocomplete=new-password]');
    await pw.nth(0).fill('corta'); await pw.nth(1).fill('corta');
    await C.click('button[type=submit]');
    await C.getByText('Usa al menos 8 caracteres').waitFor();
    await C.getByText('Necesitamos tu aceptación').waitFor();
    await pw.nth(0).fill('Segura2026'); await pw.nth(1).fill('Segura2026');
    await C.check('input[type=checkbox]');
    await C.click('button[type=submit]');
    await C.getByText('Revisa tu correo').waitFor();
  });
  await step('2. Puede iniciar sesión (antes de verificar, se le bloquea)', async () => {
    await C.goto(SITE + '#/entrar');
    await C.fill('input[type=email]', 'lucia@ejemplo.pe'); await C.fill('input[autocomplete=current-password]', 'Segura2026');
    await C.click('button[type=submit]');
    await C.getByText('Aún no confirmas tu correo').waitFor();
    await C.goto(await mail('lucia@ejemplo.pe'));
    await C.getByText('¡Bienvenido a Vocera, Lucía!').waitFor();
  });
  await step('3. Completa su perfil (4 pasos, con foto y envío a revisión)', async () => {
    await C.click('text=Completar mi perfil');
    await C.getByRole('heading', { name: 'Información personal' }).waitFor();
    await C.locator('input[type=file]').setInputFiles(files.png);
    await toastSeen(C, 'Foto actualizada');
    await C.getByLabel('Nombre artístico').fill('Lu en la cocina');
    await C.getByLabel('País').selectOption('PE');
    await C.getByLabel('Ciudad').fill('Lima');
    await C.getByLabel('Categoría principal').selectOption('Gastronomía');
    await C.getByLabel('Biografía').fill('Recetas rápidas y económicas para quienes cocinan después del trabajo.');
    await C.getByRole('button', { name: 'Hogar y decoración' }).click();
    await C.click('text=Guardar y continuar');
    await C.getByRole('heading', { name: 'Redes sociales' }).waitFor();
    await C.getByLabel('Plataforma').selectOption('tiktok');
    await C.getByLabel('Usuario').fill('@lu.cocina');
    await C.getByLabel('Enlace al perfil').fill('https://www.tiktok.com/@lu.cocina');
    await C.getByLabel('Seguidores').fill('15400');
    await C.getByLabel('Interacción (%)').fill('6.2');
    await C.click('text=Guardar red'); await toastSeen(C, 'Red guardada');
    await C.getByText('Declarado').waitFor();
    await C.click('button:has-text("Continuar")');
    await C.getByRole('heading', { name: 'Perfil comercial' }).waitFor();
    await C.getByLabel('Monto').fill('800');
    await C.getByLabel('Disponibilidad', { exact: true }).selectOption('available');
    await C.getByLabel('Portafolio o trabajos anteriores').fill('https://www.tiktok.com/@lu.cocina/video/1');
    await C.click('text=Guardar y continuar');
    await C.getByRole('heading', { name: 'Datos adicionales' }).waitFor();
    await C.getByText('Perfil completado').locator('..').getByText('100 %').waitFor();
    await C.click('text=Enviar perfil a revisión');
    await C.getByText('¡Listo! Recibimos tu perfil.').waitFor();
    await C.screenshot({ path: OUT + '/03-perfil-enviado.png', fullPage: true });
  });
  await step('4. Consulta su dashboard', async () => {
    await C.click('text=Ir a mi inicio');
    await C.getByRole('heading', { name: 'Hola, Lucía' }).waitFor();
    await C.getByText('Perfil en revisión').first().waitFor();
    await C.getByRole('heading', { name: 'Mis próximas acciones' }).waitFor();
    await C.screenshot({ path: OUT + '/04-dashboard-creador.png', fullPage: true });
  });

  // Admin: alta por SQL (como se documenta para el primer admin)
  await fetch(API + '/auth/v1/signup', { method: 'POST', headers: { apikey: anon_key, 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'equipo@vocera.test', password: 'Admin2026x', data: { full_name: 'Equipo Vocera' } }) });
  psql("update auth.users set email_confirmed_at = now() where email = 'equipo@vocera.test'");
  psql("update public.profiles set role = 'admin', welcome_seen_at = now() where email = 'equipo@vocera.test'");

  await step('5. Un administrador revisa y aprueba su perfil', async () => {
    await A.goto(SITE + '#/entrar');
    await A.fill('input[type=email]', 'equipo@vocera.test'); await A.fill('input[autocomplete=current-password]', 'Admin2026x');
    await A.click('button[type=submit]');
    await A.getByRole('heading', { name: 'Resumen' }).waitFor();
    await A.screenshot({ path: OUT + '/05-admin-resumen.png', fullPage: true });
    await A.click('nav.nav >> text=Creadores');
    await A.getByText('Lucía Fernández').first().click();
    await A.getByText('Perfil enviado a revisión').waitFor();
    await A.click('text=Aprobar perfil'); await toastSeen(A, 'Perfil aprobado');
  });
  await step('6. Se puede crear una campaña (brief, condiciones y requisitos)', async () => {
    await A.goto(SITE + '#/admin/campanas/nueva');
    await A.getByLabel('Nombre', { exact: true }).fill('Lanzamiento salsa picante');
    await A.getByLabel(/^Marca/).fill('Marca de prueba');
    await A.locator('input[type=date]').first().fill(today);
    await A.getByLabel('Brief completo').fill('Prepara una receta real usando la salsa en menos de 45 segundos.');
    await A.getByLabel('Mensajes obligatorios').fill('Decir el nombre del producto en los primeros 3 segundos.');
    await A.getByLabel('Palabras o afirmaciones prohibidas').fill('No prometer beneficios para la salud.');
    await A.getByLabel('Honorario base por creador').fill('800');
    await A.getByLabel('Entrega de video').fill(new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10));
    await A.getByText('Requiere código de autorización publicitaria').click();
    await A.click('text=Guardar campaña'); await toastSeen(A, 'Campaña guardada');
    await A.click('button:has-text("Activar")'); await toastSeen(A, 'Campaña activa');
  });
  await step('7. Se puede invitar al creador (con aprobación del cliente registrada)', async () => {
    await A.click('text=Asignar creador');
    await A.getByLabel('Buscar creador').fill('Lucía'); await A.click('dialog >> text=Buscar');
    await A.click('dialog >> button:has-text("Asignar")'); await toastSeen(A, 'Creador asignado');
    await A.getByText('Lucía Fernández').click();
    assignmentId = A.url().split('/asignaciones/')[1].split('?')[0];
    await tab(A, 'Gestión');
    await A.click('text=Registrar aprobación del cliente');
    await A.locator('dialog textarea').fill('Aprobado por correo del cliente');
    await A.click('dialog >> button:has-text("Registrar aprobación")'); await toastSeen(A, 'Aprobación del cliente registrada');
    await A.click('text=Enviar invitación'); await toastSeen(A, 'Invitación enviada');
  });
  await step('8. Se registra su aceptación', async () => {
    await C.goto(SITE + '#/campanas?f=invitations'); await C.reload();
    await C.getByText('Lanzamiento salsa picante').click();
    await C.getByText('¿Tienes disponibilidad para esta campaña?').waitFor();
    await C.getByText('No prometer beneficios para la salud.').waitFor();
    await C.screenshot({ path: OUT + '/08-invitacion.png', fullPage: true });
    await C.click('text=Confirmar disponibilidad'); await toastSeen(C, 'Confirmaste tu disponibilidad');
    await C.getByText('Vocera está preparando tu contrato').first().waitFor();
  });
  await step('9. Se asocia un contrato (y la firma se registra solo con evidencia)', async () => {
    await A.reload(); await tab(A, 'Contrato');
    await A.click('text=Emitir contrato');
    await A.getByLabel('Resumen de condiciones').fill('Honorario S/ 800. Dos rondas de corrección. Uso pagado por 30 días.');
    await A.locator('input[type=file]').setInputFiles(files.pdf('contrato-v1.pdf'));
    await A.getByText('Documento cargado.').waitFor();
    await A.click('text=Enviar contrato'); await toastSeen(A, 'Contrato enviado');
    await C.reload(); await tab(C, 'Contrato');
    await C.click('text=Confirmar que lo leí'); await toastSeen(C, 'Registramos que leíste');
    await C.getByText('Pendiente de firma').waitFor();
    await A.reload(); await tab(A, 'Contrato');
    await A.click('text=Registrar firma');
    await A.click('dialog >> button:has-text("Registrar firma")');
    await toastSeen(A, 'Adjunta el documento firmado');
    await A.locator('dialog input[type=file]').setInputFiles(files.pdf('contrato-firmado.pdf'));
    await A.getByText('Evidencia cargada.').waitFor();
    await A.click('dialog >> button:has-text("Registrar firma")'); await toastSeen(A, 'Firma registrada');
  });
  await step('10. El creador envía un guion', async () => {
    await C.reload(); await tab(C, 'Guion');
    await C.getByLabel('Guion', { exact: true }).fill('Escena 1: digo el nombre de la salsa. Escena 2: preparo tacos en 30 segundos.');
    await C.click('text=Guardar borrador'); await toastSeen(C, 'Borrador guardado');
    await C.click('text=Enviar a revisión'); await toastSeen(C, 'Enviamos tu guion');
  });
  await step('11. Un administrador aprueba el guion', async () => {
    await A.reload(); await tab(A, 'Guion');
    await A.click('button:has-text("Aprobar")'); await A.click('dialog >> text=Confirmar'); await toastSeen(A, 'Revisión registrada');
    await A.getByText('Aprobado').first().waitFor();
  });
  await step('12. El creador sube un video (con validación de formato)', async () => {
    await tab(A, 'Entregas');
    await A.click('text=Agregar entregable');
    await A.getByLabel('Título').fill('Video vertical 30 s'); await A.click('button:has-text("Crear")'); await toastSeen(A, 'Entregable creado');
    await C.reload(); await tab(C, 'Entregas');
    await C.locator('input[type=file]').setInputFiles({ name: 'archivo-no-permitido.exe', mimeType: 'application/x-msdownload', buffer: Buffer.from('MZ') });
    await C.getByText('Formato no permitido').waitFor();
    // Ejecutable disfrazado de .mp4: lo detecta la firma binaria del archivo
    await C.locator('input[type=file]').setInputFiles({ name: 'disfrazado.mp4', mimeType: 'video/mp4', buffer: Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64)]) });
    await C.getByText('no corresponde a un').waitFor();
    await C.locator('input[type=file]').setInputFiles(files.mp4('receta-v1.mp4'));
    await toastSeen(C, 'Entrega registrada');
    await C.getByText('receta-v1.mp4').waitFor();
  });
  await step('13. Se solicitan y entregan correcciones', async () => {
    await A.reload(); await tab(A, 'Entregas');
    await A.click('text=Solicitar corrección');
    await A.getByLabel('Motivo').fill('Audio bajo al inicio'); await A.click('dialog >> button:has-text("Enviar")'); await toastSeen(A, 'Corrección solicitada');
    await C.reload(); await tab(C, 'Entregas');
    await C.getByText('Corrección 1 de 2: Audio bajo al inicio').waitFor();
    await C.locator('input[type=file]').setInputFiles(files.mp4('receta-v2.mp4'));
    await toastSeen(C, 'Entrega registrada');
    await A.reload(); await tab(A, 'Entregas');
    await A.getByRole('button', { name: 'Ver' }).first().click(); await A.locator('dialog video').waitFor(); await A.keyboard.press('Escape');
    await A.click('button:has-text("Aprobar")'); await toastSeen(A, 'Entregable aprobado');
  });
  await step('15. Se registra una publicación', async () => {
    await tab(A, 'Publicación'); await A.click('text=Programar publicación');
    await A.getByLabel('Fecha y hora').fill(new Date(Date.now() + 864e5).toISOString().slice(0, 16));
    await A.getByLabel('Instrucciones').fill('Publicar 19:00 con #publicidad');
    await A.click('button:has-text("Programar")'); await toastSeen(A, 'Publicación programada');
    await C.reload(); await tab(C, 'Publicación');
    await C.click('text=Marcar como publicada');
    await C.getByLabel('Enlace público de la publicación').fill('https://www.tiktok.com/@lu.cocina/video/2');
    await C.click('dialog >> text=Confirmar'); await toastSeen(C, 'Publicación registrada');
    await A.reload(); await tab(A, 'Publicación'); await A.click('button:has-text("Validar")'); await toastSeen(A, 'Publicación validada');
  });
  await step('14. Se registran códigos publicitarios (restringidos y validados)', async () => {
    await C.reload(); await tab(C, 'Códigos');
    await C.click('text=Registrar código');
    await C.getByLabel('Código de autorización').fill('#SPARK-QA-7781');
    await C.click('button:has-text("Guardar")'); await toastSeen(C, 'Código enviado a validación');
    await C.getByText('•••').first().waitFor();
    await A.reload(); await tab(A, 'Códigos'); await A.click('button:has-text("Validar")'); await toastSeen(A, 'Código validado');
  });
  await step('16. El administrador comprueba los requisitos de pago', async () => {
    await A.reload(); await tab(A, 'Pago');
    await A.click('text=Registrar validación final'); await toastSeen(A, 'Validación final registrada');
    await A.getByText('Datos de cobro registrados').waitFor();
    assert(await A.getByRole('button', { name: 'Autorizar pago' }).isDisabled(), 'Autorizar pago debería estar bloqueado sin datos de cobro');
    await C.goto(SITE + '#/pagos/datos'); await C.reload();
    await C.getByLabel('Titular de la cuenta').fill('Lucía Fernández');
    await C.getByLabel('Banco').fill('Banco de Prueba');
    await C.getByLabel('Número de cuenta').fill('191-00000000-0-00');
    await C.click('text=Guardar de forma segura'); await toastSeen(C, 'Datos de cobro guardados');
    await C.getByText('•••• 0000').waitFor();
    await A.reload(); await tab(A, 'Pago');
    await A.getByText('Todo listo').waitFor();
  });
  await step('17. Se registra un pago de forma segura (autorización + transferencia)', async () => {
    await A.click('button:has-text("Autorizar pago")');
    assert(await A.locator('dialog button:has-text("Autorizar S/")').isDisabled(), 'Debe exigir confirmar ausencia de incumplimientos');
    await A.locator('dialog input[type=checkbox]').check();
    await A.click('dialog button:has-text("Autorizar S/")'); await toastSeen(A, 'Pago autorizado');
    await A.click('text=Registrar transferencia');
    await A.getByLabel('Número de operación').fill('OP-2026-0001');
    await A.locator('dialog input[type=file]').setInputFiles(files.pdf('comprobante.pdf'));
    await A.getByText('Comprobante cargado.').waitFor();
    await A.click('dialog >> button:has-text("Registrar")'); await toastSeen(A, 'Transferencia registrada');
  });
  await step('18. El creador ve su historial financiero', async () => {
    await C.goto(SITE + '#/pagos'); await C.reload();
    await C.getByText('Transferido').first().waitFor();
    await C.getByRole('cell', { name: 'Lanzamiento salsa picante' }).waitFor();
    await C.screenshot({ path: OUT + '/18-mis-pagos.png', fullPage: true });
    await C.goto(SITE + `#/campanas/${assignmentId}?tab=pago`); await C.reload();
    await C.click('text=Confirmar recepción'); await toastSeen(C, 'Pago confirmado');
    await C.getByText('Pago confirmado').first().waitFor();
  });
  await step('19. Un creador no puede acceder a datos de otro', async () => {
    const sbB = createClient(API, anon_key, { auth: { persistSession: false } });
    await sbB.auth.signUp({ email: 'otro@ejemplo.pe', password: 'OtraClave1', options: { data: { full_name: 'Otro Creador' } } });
    psql("update auth.users set email_confirmed_at = now() where email = 'otro@ejemplo.pe'");
    await sbB.auth.signInWithPassword({ email: 'otro@ejemplo.pe', password: 'OtraClave1' });
    for (const t of ['creator_profiles', 'creator_social_accounts', 'campaign_assignments', 'campaigns', 'contracts', 'deliverables', 'payments', 'payout_methods', 'advertising_authorizations', 'audit_logs']) {
      const { data } = await sbB.from(t).select('*');
      assert(!data || data.length === 0, `B pudo leer ${t}`);
    }
    const bundle = await sbB.rpc('get_assignment_bundle', { p_id: assignmentId });
    assert(bundle.error && /No tienes acceso/.test(bundle.error.message), 'B pudo abrir la campaña de A');
    const adm = await sbB.rpc('admin_overview'); assert(adm.error, 'B pudo usar una función de admin');
    const files_ = await sbB.storage.from('deliverables').list(); assert(!files_.data || files_.data.length === 0, 'B pudo listar archivos');
    const up = await sbB.storage.from('deliverables').upload(psql("select id from auth.users where email='lucia@ejemplo.pe'") + '/x.mp4', new Blob(['x'], { type: 'video/mp4' }));
    assert(up.error, 'B pudo subir a la carpeta de A');
    const ciph = await sbB.from('payout_methods').select('account_ciphertext'); assert(ciph.error, 'la columna cifrada es legible');
  });
  await step('20. La plataforma funciona en móvil (320-375 px, sin desbordes)', async () => {
    for (const w of [320, 375, 768]) {
      await C.setViewportSize({ width: w, height: 780 });
      for (const route of ['#/', `#/campanas/${assignmentId}`, '#/pagos', '#/perfil']) {
        await C.goto(SITE + route); await C.reload(); await sleep(900);
        const ov = await C.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert(ov <= 0, `desborde horizontal de ${ov}px en ${route} a ${w}px`);
        if (w === 375) await C.screenshot({ path: `${OUT}/20-movil-${route.replace(/[^a-z]/g, '') || 'inicio'}.png`, fullPage: true });
      }
      assert(await C.locator('.tabbar').isVisible() === (w <= 900), 'barra de navegación móvil');
    }
    await A.setViewportSize({ width: 375, height: 780 });
    for (const route of ['#/admin', '#/admin/creadores', '#/admin/pagos', `#/admin/asignaciones/${assignmentId}`]) {
      await A.goto(SITE + route); await A.reload(); await sleep(900);
      const ov = await A.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert(ov <= 0, `admin: desborde de ${ov}px en ${route}`);
    }
    await A.screenshot({ path: OUT + '/20-movil-admin-asignacion.png', fullPage: true });
  });
  await step('Extra: accesibilidad WCAG 2.1 AA (axe) en pantallas clave', async () => {
    const axe = require('axe-core');
    const check = async (p, route, who) => {
      await p.goto(SITE + route); await p.reload(); await sleep(1000);
      await p.addScriptTag({ content: axe.source });
      const r = await p.evaluate(() => axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa'] }));
      const bad = r.violations.filter(v => ['serious', 'critical'].includes(v.impact));
      assert(!bad.length, `${who} ${route}: ` + bad.map(v => v.id + ' (' + v.nodes.length + ')').join(', '));
    };
    await C.setViewportSize({ width: 1280, height: 900 });
    for (const r of ['#/', '#/campanas', `#/campanas/${assignmentId}`, '#/pagos', '#/pagos/datos', '#/perfil', '#/cuenta', '#/notificaciones']) await check(C, r, 'creador');
    await A.setViewportSize({ width: 1280, height: 900 });
    for (const r of ['#/admin', '#/admin/creadores', '#/admin/campanas', `#/admin/asignaciones/${assignmentId}?tab=pago`, '#/admin/pagos', '#/admin/auditoria']) await check(A, r, 'admin');
    const anon = await browser.newPage();
    for (const r of ['#/entrar', '#/registro', '#/recuperar']) await check(anon, r, 'público');
    await anon.close();
  });
  await step('Extra: auditoría y notificaciones registradas', async () => {
    const n = Number(psql("select count(*) from public.audit_logs where action = 'assignment_status'"));
    assert(n >= 12, 'pocos cambios de estado auditados: ' + n);
    const pend = Number(psql("select count(*) from public.notifications where email_status = 'pending_provider'"));
    assert(pend > 0, 'no hay notificaciones registradas');
    await A.setViewportSize({ width: 1280, height: 900 });
    await A.goto(SITE + '#/admin/auditoria'); await A.reload(); await A.getByText('payment authorized').first().waitFor();
    await A.screenshot({ path: OUT + '/extra-auditoria.png' });
  });
} catch (e) {
  await C.screenshot({ path: OUT + '/fallo-creador.png', fullPage: true }).catch(() => {});
  await A.screenshot({ path: OUT + '/fallo-admin.png', fullPage: true }).catch(() => {});
} finally {
  await browser.close(); api.kill(); web.kill();
  const ok = results.filter(r => r.ok).length;
  console.log(`\nResultado: ${ok}/${results.length} pasos superados`);
  if (errors.length) console.log('Errores de consola:\n' + errors.slice(0, 10).join('\n'));
  writeFileSync(OUT + '/resultados.json', JSON.stringify({ results, consoleErrors: errors }, null, 2));
  process.exit(ok === results.length && results.length >= 21 && !errors.length ? 0 : 1);
}
