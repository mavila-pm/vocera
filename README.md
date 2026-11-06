# Vocera — preparación para ChatGPT Business

Esta rama separa una copia estática de la web disponible en GitHub, lista para importar como un Site nuevo. La exportación de la versión 14 de Sites sigue pendiente: el servicio devolvió `Sites workspace migration is in progress` el 6 de noviembre de 2026.

## Qué contiene

- `dist/`: HTML, CSS, JavaScript y recursos de la rama `vocera-motion-experience`, commit `7988c7d9b067bcdc78ae6e00a03e35b0e20a413c`.
- `.openai/hosting.json`: configuración estática sin identidad del Site personal.
- `migration-status.json`: versión publicada que falta recuperar y origen de esta copia.

**Esta base no está cotejada con vocera.lat, versión 14.** El commit publicado de Sites es distinto. El repositorio principal, sus otras ramas y el portal se conservan.

## Completar el traslado

1. Recuperar el código del Site personal, versión 14, cuando Sites permita exportarlo.
2. Comparar HTML, imágenes, rutas y envío del formulario; incorporar los archivos actuales a esta rama. El formulario de esta copia usa una integración externa existente; no se ha probado su recepción.
3. Desde el espacio Business, abrir este repositorio y esta rama. Crear un Site NUEVO con esta fuente y conservar el nuevo project_id que entregue Sites.
4. Probar la vista móvil, navegación, formularios y recursos en la URL nueva.
5. Con el sitio validado, conectar vocera.lat desde la cuenta destino. GitHub no transfiere dominios ni configuración del servidor.

No se ha desplegado esta rama.
