# Portal de Creadores y Panel Vocera

Aplicación web para gestionar la relación agencia–creador–marca de punta a punta: cuentas, perfiles, campañas, contratos, productos, guiones, entregas, correcciones, códigos publicitarios, publicaciones y pagos.

Convive con la web comercial: la landing sigue en `/` (`index.html`) y el portal vive en `/portal/`.

---

## 1. Arquitectura

| Capa | Tecnología | Por qué |
|---|---|---|
| Frontend | `portal/` · Preact + htm empaquetados en `portal/vendor` (sin build, sin CDN) | GitHub Pages solo sirve archivos estáticos. Así no hace falta un servidor ni un paso de compilación para publicar. |
| Backend | Supabase: Postgres + Auth + Storage | Gestiona contraseñas (hash), verificación de correo, recuperación, sesiones y límites de abuso sin código propio. |
| Autorización | Row Level Security + funciones RPC `security definer` | Todas las reglas se validan en la base de datos, no en la interfaz. |
| Archivos | Supabase Storage, 3 buckets privados y URL firmadas temporales | Los videos nunca se guardan en la base relacional. |
| Datos bancarios | Cifrado `pgcrypto` (AES-256) con clave en Supabase Vault | La clave no está en el repositorio. La API solo expone los 4 últimos dígitos. |

### Principio del motor de estados

El estado de cada creador en una campaña **se deriva de los hechos registrados**, no se escribe a mano. Esos hechos son: aprobación del cliente, aceptación, contrato con evidencia, producto recibido, guion aprobado, entregables aprobados, publicación validada, código válido, validación final y pago.

La función `private.derive_assignment_status` calcula la etapa. Cada acción (RPC) exige que esa etapa se haya alcanzado. Así no pueden existir estados inconsistentes y no se salta ninguna etapa obligatoria. Las etapas aplicables dependen de la configuración de la campaña (`requires_contract`, `requires_product`, `requires_script`, `requires_publication`, `requires_ad_code`, `requires_client_approval`).

Decisión de diseño: los códigos Spark Ads se piden **después** de la publicación, porque la plataforma los genera sobre un post que ya existe.

### Roles

| Rol | Qué puede hacer |
|---|---|
| `creator` | Solo sus datos y las campañas a las que fue invitado. |
| `admin` | Gestión completa. Toda acción sensible queda en `audit_logs`. |
| `brand` | Modelo preparado (`brands`, `brand_members` y políticas de lectura de sus campañas). El portal de marca no está implementado. |

El rol nunca se toma de los datos que envía el navegador: toda cuenta nace como `creator`.

## 2. Estructura

```
portal/                 App (index.html, config.js, app/, styles/, vendor/)
supabase/migrations/    8 migraciones versionadas (0100 → 0800)
supabase/tests/         Prueba de integración SQL (flujo + seguridad)
dev/local-supabase/     SOLO desarrollo: réplica de esquemas Supabase + emulador de API
dev/build-vendor.mjs    Empaqueta preact/htm/supabase-js/tus-js-client en portal/vendor
tests/e2e/run.mjs       Prueba E2E de los 20 criterios de aceptación (Playwright)
docs/BRIEF.md           Requerimiento original del proyecto
```

### Migraciones

| Archivo | Contenido |
|---|---|
| `0100_core_accounts` | Perfiles, roles, marcas, auditoría, notificaciones (con deduplicación), alta automática al registrarse |
| `0200_creators` | Perfil profesional, redes (métricas declaradas y verificadas por separado), tarifas, datos privados, notas internas, completitud, revisión de perfil, búsqueda con filtros |
| `0300_campaigns` | Campañas, briefs, asignaciones creador–campaña, aprobaciones del cliente |
| `0400_production` | Contratos, firmas con evidencia, constancia de lectura, envíos, recepciones, incidencias, guiones y revisiones, entregables y versiones, correcciones, códigos publicitarios, publicaciones |
| `0500_finance` | Métodos de cobro cifrados, pagos (único por asignación), bonificaciones, excepciones documentadas |
| `0600_workflow` | Motor de estados y todas las acciones RPC con precondiciones |
| `0700_storage` | Buckets privados (tipo y tamaño validados en el servidor) y políticas por carpeta |
| `0800_read_models` | Consultas para dashboards, calendario, bundle de campaña, panel, auditoría y exportación CSV |

## 3. Desarrollo local

Requisitos: Node 20+, PostgreSQL 16 y Chromium/Playwright para las pruebas.

```bash
npm install
# Postgres local en el puerto 54329 (socket /tmp); ver dev/local-supabase/reset-db.sh
npm run db:test        # recrea vocera_dev, aplica migraciones y corre la prueba SQL
npm run dev:api        # emulador de Supabase en http://localhost:54321
python3 -m http.server 8765   # sirve el repo; abrir http://localhost:8765/portal/
npm run test:e2e       # flujo completo en el navegador
```

En `localhost` el portal se conecta solo al emulador. Los correos no se envían: el emulador los imprime en consola y los expone en `http://localhost:54321/__dev/emails`. El emulador es solo para desarrollo: implementa el subconjunto de la API que usa el portal y aplica las mismas políticas RLS, pero **no se despliega**.

## 4. Puesta en producción (pendiente de autorización)

1. Crear un proyecto Supabase **nuevo y exclusivo de Vocera**. No reutilizar los proyectos existentes de la cuenta. Conviene un plan de pago, ver "Dependencias".
2. Aplicar las migraciones con Supabase CLI (`supabase db push`) o desde el SQL Editor, en orden.
3. Crear la clave de cifrado en Vault desde el SQL Editor. Genera la clave en un equipo seguro y no la guardes en el repositorio:
   ```sql
   select vault.create_secret('<64 caracteres hex aleatorios>', 'payout_encryption_key');
   ```
4. En Auth, configurar:
   - Site URL `https://vocera.lat/portal/` y redirect URLs `https://vocera.lat/portal/`.
   - Confirmación de correo activada.
   - Contraseña mínima de 8 caracteres, con letras y dígitos.
   - SMTP propio (por ejemplo Resend o SES). El SMTP por defecto de Supabase no sirve para usuarios reales.
   - Plantillas de correo en español.
5. Promover al primer admin desde el SQL Editor, después de que se registre:
   ```sql
   update public.profiles set role = 'admin' where email = 'correo@vocera.lat';
   ```
6. Completar `portal/config.js` con `supabaseUrl` y `supabaseAnonKey` (la anon key es pública por diseño). **Nunca** pongas ahí la `service_role` key.
7. Publicar los textos legales revisados (`#/legal/terminos` y `#/legal/privacidad` muestran hoy un aviso de pendiente).
8. Agregar el enlace "Portal de creadores" en la web pública cuando todo lo anterior esté listo.

## 5. Seguridad: qué está implementado

- RLS en todas las tablas. Las columnas de estado no tienen permiso UPDATE para la API: solo cambian por RPC con validación de rol, propiedad y etapa.
- Aislamiento entre creadores verificado con pruebas: lectura, escritura, archivos y RPC.
- Archivos privados con políticas por carpeta (`<bucket>/<id_creador>/…`). No se permite sobrescribir ni borrar desde la app (cada entrega es una versión nueva). Las descargas usan URL firmadas de corta duración.
- Datos bancarios cifrados. La columna cifrada no es legible por la API. Ver el número completo exige rol admin y motivo, y queda auditado. Los logs nunca guardan el número.
- Códigos publicitarios visibles solo para el creador dueño y el admin. No se guardan en la auditoría.
- Pagos: un único honorario por asignación (índice único), bloqueo de fila al autorizar, transición de estados estricta y número de operación único. Así no hay autorizaciones ni transferencias duplicadas. El portal **no mueve dinero**.
- Contratos: el estado "firmado" exige evidencia (documento firmado o constancia del proveedor). Leer el contrato genera una constancia de lectura, no una firma.
- Notificaciones por correo registradas como `pending_provider`: no se simula ningún envío.
- Validación de formato y tamaño en el cliente y en el servidor (configuración de buckets). La validación de RPC usa mensajes en español.

## 6. Dependencias externas y funciones incompletas

| Tema | Estado | Qué falta |
|---|---|---|
| Proyecto Supabase de producción | **Pendiente** | Crear el proyecto y aplicarle las migraciones (requiere autorización). |
| SMTP transaccional | **Pendiente** | Configurar un proveedor. Sin él, los correos de verificación solo llegan a direcciones del equipo y con límite horario. |
| Correos de notificación (invitaciones, pagos, etc.) | **Pendiente** | Edge Function que procese `notifications.email_status = 'pending_provider'` con el proveedor elegido. |
| Firma electrónica | **Pendiente** | Integrar un proveedor (por ejemplo DocuSign, Dropbox Sign o un proveedor local acreditado) con webhook → `contract_signatures (method = 'esign_provider')`. Hoy se registra la evidencia manualmente. |
| Videos > 50 MB | **Requiere plan de pago** | El plan gratuito de Supabase limita cada archivo a 50 MB. El portal ya usa subida reanudable (TUS) a partir de 50 MB. |
| Antivirus de archivos | **Pendiente** | Escaneo asíncrono de archivos subidos (por ejemplo, una Edge Function con un servicio de escaneo). Hoy se valida el tipo y el tamaño. |
| Textos legales | **Pendiente** | Términos, política de privacidad, retención de datos y contratos tipo revisados por un abogado (Ley N.° 29733 de Protección de Datos Personales en Perú). |
| Portal de marca | Fuera de alcance | El modelo de permisos está listo; faltan las pantallas. |
| Doble aprobación de pagos | Recomendado | Hoy un mismo admin puede autorizar y registrar la transferencia. Para montos altos conviene exigir dos personas. |
| Subida de copia firmada por el creador | Recomendado | Hoy el admin sube la evidencia de firma. |
| Rate limiting de RPC | Recomendado | Supabase limita Auth; para RPC conviene monitoreo y límites por IP en el gateway. |
