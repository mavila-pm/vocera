# Dashboard Vocera · Requerimiento original

> Texto entregado por Mauro Ávila para construir el Portal de Creadores y el Panel Administrador de Vocera. Se conserva tal cual, como referencia del alcance. El estado de cada punto está en `docs/PORTAL.md`.

## Rol del equipo

Actúa como un equipo multidisciplinario formado por:

- Senior Product Manager.
- SaaS Product Architect.
- Senior UX/UI Designer.
- Creative Director.
- Senior Full-Stack Engineer.
- Database Architect.
- Authentication & Security Engineer.
- QA Engineer.
- CRO y UX Writing Specialist.

Tu misión es convertir la web existente de VOCERA en una plataforma profesional para gestionar creadores de contenido y campañas comerciales.

No quiero solamente un dashboard visual. Quiero una aplicación web funcional, conectada a una base de datos y preparada para operar con usuarios reales.

Debes trabajar sobre mi proyecto existente en GitHub, manteniendo su identidad de marca, funcionalidades actuales y arquitectura cuando sea razonable.

## Inputs

- Repositorio GitHub: mavila-pm/vocera
- Web publicada: vocera.lat
- Objetivo: crear el Portal de Creadores y el Panel Administrador de Vocera.
- Idioma principal: español.
- Estilo: premium, moderno, humano, limpio, intuitivo, profesional y mobile-first.

## Instrucciones generales

Antes de modificar el código:

1. Inspecciona el repositorio existente.
2. Identifica el framework, dependencias, backend y sistema de autenticación.
3. Revisa si ya existen tablas, usuarios, campañas o almacenamiento de archivos.
4. Comprueba los skills de diseño, frontend, copywriting, humanizer, copy-editing y page-cro configurados anteriormente.
5. Aprovecha los skills disponibles y verifica cualquier instalación faltante antes de utilizarla.
6. Crea una rama de desarrollo independiente.
7. Diseña la arquitectura necesaria para que el portal sea escalable y seguro.

No reconstruyas la web pública innecesariamente. El dashboard debe convivir con la página comercial de Vocera. No elimines ni modifiques funcionalidades existentes sin una razón justificada. No inventes datos comerciales, clientes, creadores ni testimonios reales.

## Módulo 1 · Autenticación y cuentas

Registro con nombre completo, correo, teléfono con código de país, contraseña, confirmación de contraseña y aceptación de términos y política de privacidad.

Funciones: registro, verificación de correo, inicio de sesión, recuperación y restablecimiento de contraseña, cierre de sesión, cambio de contraseña y gestión de sesiones. Usar un proveedor de autenticación seguro; nunca contraseñas en texto plano. Protección contra acceso no autorizado y contra abuso.

Roles:

- **CREADOR**: solo consulta y modifica sus propios datos y campañas asignadas.
- **ADMIN VOCERA**: gestiona usuarios, campañas, contratos, entregables y pagos.
- **CLIENTE/MARCA**: modelo de permisos preparado para una fase futura.

Todos los controles de acceso se validan en el backend.

## Módulo 2 · Bienvenida y onboarding

Mensaje de bienvenida en el primer ingreso: "¡Bienvenido a Vocera! Este es tu espacio para conectar con oportunidades, participar en campañas, entregar contenido y gestionar tus pagos. Completa tu perfil para que podamos conocerte y considerarte en futuras campañas."

Onboarding por pasos:

1. **Información personal**: foto, nombre completo, nombre artístico, fecha de nacimiento (solo si es necesaria y con base legal), país, ciudad, correo, teléfono, biografía, categoría principal y secundarias.
2. **Redes sociales**: Instagram, TikTok, YouTube y otras; usuario y enlace, seguidores, promedio de visualizaciones, engagement, características de la audiencia y capturas de métricas. Distinguir métricas declaradas de verificadas.
3. **Perfil comercial**: tarifas por video, publicación, historia y paquete; moneda; disponibilidad; modalidades de colaboración; portafolio.
4. **Datos adicionales**: dirección de envío (si acepta producto), información bancaria (puede completarse después) y documentación contractual cuando corresponda.

Guardar el progreso, mostrar el porcentaje completado y los requisitos pendientes, no exigir datos sensibles antes de tiempo, y confirmar al final que el perfil queda en evaluación.

## Módulo 3 · Dashboard principal

- **Encabezado**: saludo, foto, notificaciones y estado del perfil.
- **Indicadores**: campañas activas, invitaciones nuevas, entregables pendientes, campañas completadas, dinero pendiente de pago y pagos recibidos.
- **Mis próximas acciones**, ordenadas por prioridad y con enlace a su pantalla: completar perfil, revisar invitación, confirmar disponibilidad, firmar contrato, confirmar producto, enviar guion, entregar video, atender correcciones, entregar código publicitario, publicar y completar datos de cobro.
- **Mis campañas recientes**: nombre, marca (si está autorizada), estado, honorario, fecha límite y próxima acción.
- **Calendario** con fechas importantes y vencimientos.

Sin cifras ficticias presentadas como reales, y con estados vacíos útiles.

## Módulo 4 · Gestión de campañas

Apartado "Mis campañas" con invitaciones, activas, en revisión, finalizadas e historial. Página de detalle con nombre, marca, objetivo, descripción, brief completo, formatos, duración, plataformas, requisitos técnicos, mensajes obligatorios, afirmaciones prohibidas, entregables, máximo de correcciones, fechas límite, condiciones comerciales, honorarios, condiciones de pago, derechos de uso y vigencia de autorizaciones.

Flujo de estados:

1. Creador registrado.
2. Perfil en revisión.
3. Creador preseleccionado.
4. Pendiente de aprobación del cliente.
5. Aprobado por el cliente.
6. Invitación enviada.
7. Disponibilidad confirmada.
8. Contrato pendiente.
9. Contrato firmado.
10. Producto pendiente de recepción (si corresponde).
11. Producto recibido.
12. Guion pendiente.
13. Guion en revisión.
14. Guion aprobado.
15. Producción en curso.
16. Video entregado.
17. Video en revisión.
18. Correcciones solicitadas.
19. Video aprobado.
20. Códigos publicitarios pendientes (si corresponden).
21. Publicación programada.
22. Publicación confirmada.
23. Validación final.
24. Pago pendiente de autorización.
25. Pago aprobado.
26. Pago enviado.
27. Pago confirmado.

Además, estados alternativos: rechazado, cancelado, vencido y suspendido. Adaptar el flujo a cada campaña y nunca avanzar sin cumplir las condiciones.

## Módulo 5 · Contratos y firma

- **El admin**: asocia un contrato a una campaña y a un creador, configura fechas, consulta el estado de firma, descarga la versión firmada y revisa el historial de aceptación.
- **El creador**: lee el contrato, consulta las condiciones, firma con un sistema válido e integrado, descarga una copia y consulta contratos anteriores.

No simular firmas legales. Sin proveedor integrado, dejar la interfaz y la integración preparadas, sin declarar el contrato firmado sin evidencia válida.

## Módulo 6 · Productos recibidos

Producto, descripción, cantidad, valor declarado, empresa, estado del envío, número de seguimiento, fecha prevista y fecha de recepción. El creador confirma la recepción con fecha y foto, y reporta problemas. Reflejar las obligaciones aceptadas, no cobrar el producto automáticamente y registrar incidencias.

## Módulo 7 · Guiones y aprobación previa

El creador escribe el guion o sube un PDF/DOCX, adjunta referencias y una muestra, guarda borradores y lo envía a revisión. El admin aprueba, solicita modificaciones, comenta o rechaza con motivo. Estados: borrador, enviado, en revisión, correcciones solicitadas y aprobado. Registrar fechas, versiones y comentarios. La producción final solo se autoriza con el guion aprobado, salvo excepción documentada.

## Módulo 8 · Entrega de videos y documentos

- **Formatos**: MP4 y MOV, PDF y DOCX.
- **Funciones**: arrastrar y soltar, progreso de subida, validación de formato y tamaño, almacenamiento seguro, previsualización, descargas autorizadas, asociación a campañas y entregables, fecha de entrega, versiones y estado de revisión.
- **Almacenamiento**: privado, con subida segura de archivos grandes y sin guardar videos en la base relacional.
- **Correcciones**: registran motivo, fecha, ronda, máximo de rondas, comentarios y nueva versión; respetan lo acordado en el brief.

## Módulo 9 · Códigos publicitarios y autorizaciones

Campos: plataforma, código, publicación relacionada, URL, emisión, vencimiento, estado de validación y observaciones. Información restringida. Si el código es obligatorio, bloquear la autorización del pago hasta validarlo.

## Módulo 10 · Publicaciones

Plataforma, contenido aprobado, fecha y hora programadas, instrucciones y estado. El creador consulta el calendario, marca la publicación como realizada, adjunta la URL y evidencia, y reporta problemas. Vocera valida.

## Módulo 11 · Pagos y datos bancarios

**Mis pagos**: total ganado, saldo pendiente de validación, aprobados, en proceso, recibidos y bonificaciones. Distinguir honorarios acordados, importes devengados y pagos realizados. El historial muestra campaña, fecha, honorario, bonificación, total, moneda, estado, fecha de transferencia y comprobante.

Estados: requisitos pendientes, en revisión, aprobado, programado, transferido, confirmado e incidencia.

Antes de aprobar un pago se valida:

- Contrato firmado.
- Entregables completos.
- Contenido aprobado.
- Entrega dentro de plazo.
- Correcciones resueltas.
- Códigos validados.
- Publicación con evidencia.
- Datos de cobro válidos.
- Ausencia de incumplimientos.

Reglas configurables por campaña y visibles para el creador. La autorización final la da un admin. Sin transferencias reales sin integración verificada. Bonos como conceptos separados.

**Datos bancarios**: titular, país, banco, tipo de cuenta, número/IBAN, identificación bancaria, moneda y otros datos. Almacenamiento seguro y cifrado, acceso estricto, enmascaramiento y nada de datos de prueba presentados como reales.

## Módulo 12 · Panel administrador

- **Resumen ejecutivo**: creadores, perfiles por revisar, campañas activas, entregables pendientes, contratos por firmar, pagos por autorizar, vencimientos e incidencias.
- **Gestión de creadores**: búsqueda; filtros por categoría, país, seguidores, engagement, tarifas y disponibilidad; perfiles y portafolios; aprobar o rechazar; notas internas.
- **Gestión de campañas**: crear, configurar brief, fechas y honorarios; asignar creadores; aprobación del cliente; invitaciones; contratos; entregables; correcciones; códigos; publicaciones; pagos.
- **Gestión financiera**: pagos, condiciones cumplidas, autorizaciones, transferencias, comprobantes, incidencias y reportes.
- **Trazabilidad**: quién, cuándo, registro afectado, estado anterior y nuevo, y motivo.

## Módulo 13 · Notificaciones

Notificaciones en la plataforma, por ejemplo:

- Perfil recibido y perfil aprobado.
- Nueva invitación.
- Contrato pendiente.
- Guion aprobado.
- Correcciones solicitadas.
- Video aprobado.
- Código pendiente.
- Campaña por vencer.
- Pago autorizado.
- Transferencia registrada.

Correo preparado solo con un proveedor autorizado, sin simular envíos y sin duplicados.

## Módulo 14 · Base de datos

Entidades orientativas: users, creator_profiles, creator_social_accounts, creator_audience_metrics, creator_rates, creator_availability, campaigns, campaign_briefs, campaign_applications, campaign_invitations, campaign_assignments, campaign_approvals, contracts, contract_signatures, product_shipments, product_receipts, scripts, script_reviews, deliverables, deliverable_versions, revision_requests, advertising_authorizations, publications, payout_methods, payments, payment_requirements, bonuses, notifications y audit_logs.

Relaciones, restricciones, índices, políticas de seguridad y migraciones versionadas. No eliminar datos sin autorización.

## Módulo 15 · Diseño y experiencia

Un SaaS profesional y coherente con Vocera:

- Mobile-first.
- Jerarquía clara y navegación sencilla.
- Formularios progresivos.
- Estados vacíos, de carga y de error.
- Confirmaciones y microinteracciones discretas.
- Accesibilidad.

Pantallas clave:

1. Registro.
2. Login.
3. Bienvenida.
4. Onboarding.
5. Dashboard de creador.
6. Perfil.
7. Listado de campañas.
8. Detalle de campaña.
9. Contratos.
10. Guion.
11. Videos.
12. Revisiones.
13. Códigos.
14. Publicaciones.
15. Pagos.
16. Datos bancarios.
17. Dashboard administrador.
18. Gestión de creadores.
19. Gestión de campañas.
20. Autorización de pagos.

## Módulo 16 · Seguridad y privacidad

- Autenticación segura y autorización por rol.
- Aislamiento entre creadores.
- Archivos privados y datos bancarios protegidos.
- Validación de entradas y protección contra archivos maliciosos y acceso directo.
- Auditoría de acciones sensibles y manejo seguro de errores.
- Variables de entorno.
- Políticas de privacidad y retención.
- Protección frente a duplicados financieros.
- Sin secretos en el repositorio y sin pagos reales en pruebas.

## Módulo 17 · Prioridades

1. **Base operativa**: autenticación, roles, perfil, onboarding, dashboard, base de datos y admin básico.
2. **Campañas**: creación, asignación, invitaciones, estados, briefs, calendario y confirmaciones.
3. **Producción**: contratos, productos, guiones, aprobaciones, videos, correcciones, códigos y publicaciones.
4. **Finanzas**: datos bancarios seguros, historial, condiciones de liberación, validación, transferencias y comprobantes.
5. **Refinamiento**: notificaciones, accesibilidad, móvil, rendimiento, QA, revisión visual y pruebas de seguridad.

## Módulo 18 · Criterios de aceptación

1. Un creador se registra.
2. Puede iniciar sesión.
3. Completa su perfil.
4. Consulta su dashboard.
5. Un administrador revisa su perfil.
6. Se crea una campaña.
7. Se invita al creador.
8. Se registra su aceptación.
9. Se asocia un contrato.
10. Envía un guion.
11. Un administrador lo aprueba.
12. Sube un video.
13. Se solicitan y entregan correcciones.
14. Se registran códigos publicitarios.
15. Se registra una publicación.
16. El administrador comprueba los requisitos de pago.
17. Se registra un pago de forma segura.
18. El creador ve su historial financiero.
19. Un creador no accede a datos de otro.
20. Funciona en móvil.

Los pasos que dependan de servicios externos no configurados se identifican como pendientes.

**Objetivo final**: convertir Vocera en una plataforma escalable, atractiva y confiable para gestionar de principio a fin las relaciones entre la agencia, los creadores y las marcas.
