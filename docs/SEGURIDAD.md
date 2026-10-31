# Seguridad, privacidad y políticas de Meta

## Medidas implementadas

| Riesgo | Medida | Dónde |
|---|---|---|
| Robo de credenciales | Credenciales en variables de entorno o **cifradas con AES-256-GCM** en la base de datos (clave `ENCRYPTION_KEY`). El panel solo muestra los últimos caracteres; **la API Key nunca llega al navegador** | `services/settings.service.ts`, `utils/crypto.ts` |
| Webhooks falsos | Firma **X-Hub-Signature-256** (HMAC-SHA256 con el App Secret) sobre el cuerpo en bruto; obligatoria en producción y en modo real | `webhooks/whatsapp.routes.ts` |
| Verificación del webhook | Comparación en tiempo constante del Verify Token | ídem |
| Mensajes duplicados | Índice único por `wamid` + comprobación previa; la cola deduplica respuestas pendientes; antes de enviar se comprueba que nadie respondió ya | `pipeline/inbound.ts`, `pipeline/reply.ts` |
| Acceso al panel | Usuarios con contraseña (**scrypt**, sal aleatoria), política mínima (10+ caracteres, letras y números) | `services/auth.service.ts` |
| Sesiones | Token aleatorio de 256 bits; en la base solo se guarda su **hash**; cookie **firmada, HttpOnly, SameSite=Strict** y **Secure** en producción; caducidad renovable; cambiar la contraseña cierra las demás sesiones | ídem, `routes/auth.routes.ts` |
| Fuerza bruta | Bloqueo de la cuenta 15 min tras 5 intentos fallidos + 10 intentos por IP cada 15 min; tiempo de respuesta igual exista o no el usuario | ídem, `app.ts` |
| CSRF | Cookie SameSite=Strict + verificación de `Origin`/`Sec-Fetch-Site` en toda petición que modifica datos | `middleware/auth.ts` |
| Control de acceso | Roles **Propietario / Administrador / Agente**; credenciales y usuarios solo para el propietario | rutas |
| Inyección SQL | Consultas parametrizadas (Prisma y plantillas etiquetadas); la búsqueda solo acepta letras y números | `knowledge/` |
| XSS | React escapa todo el contenido; **CSP** estricta (`script-src 'self'`, `frame-ancestors 'none'`); los archivos de clientes se sirven con `CSP: sandbox` y solo los tipos seguros en línea (HTML/SVG se descargan) | `app.ts`, `routes/system.routes.ts` |
| Cabeceras | Helmet: HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`… | `app.ts` |
| Validación de entradas | Esquemas **Zod** en todas las rutas; límites de tamaño (cuerpo 2 MB, archivos 10 MB, mensajes configurables) | rutas |
| Abuso / costos | Límite global de solicitudes por IP; límites de gasto diario/mensual; respuestas máximas por contacto | `services/budget.service.ts` |
| Prompt injection | Instrucciones del sistema con prioridad explícita; todo lo del cliente (y memoria/conocimiento) se trata como **datos**; se eliminan etiquetas que intenten "salir" del bloque de datos; las herramientas no pueden cambiar la configuración ni acceder a otros contactos | `ai/prompt.ts`, `ai/tools.ts` |
| Separación de datos | Cada consulta filtra por `contactId`; la memoria de un contacto nunca se incluye en otro; las ediciones de memoria verifican el contacto (probado en `tests/`) | `memory/`, `routes/contacts.routes.ts` |
| Datos sensibles en la memoria | La extracción tiene prohibido guardar contraseñas, tarjetas, documentos, salud, etc.; la IA no los pide | `memory/memory.service.ts` |
| Registros | Logs estructurados con **redacción** de cabeceras de autorización, cookies y claves; errores visibles en el panel (30 días) | `utils/logger.ts` |
| Copias de seguridad | Exportación JSON desde el panel (sin credenciales) + restauración por script; copias automáticas del proveedor de base de datos | `services/backup.service.ts` |
| Dependencias | `npm audit` sin vulnerabilidades (las transitivas vulnerables se fijaron con `overrides`) | `package.json` |
| Identificador ante Anthropic | Se envía un id opaco del contacto (no el teléfono) en `metadata.user_id` | `ai/responder.ts` |

## Recomendaciones de operación

- Usa contraseñas largas y únicas; crea usuarios **Agente** para quien solo atiende conversaciones.
- **No cambies `ENCRYPTION_KEY`** una vez en producción (las credenciales guardadas en el panel dependen de ella).
- Rota el token de Meta y la API Key de Claude si sospechas una filtración (el panel permite reemplazarlos sin redeploy).
- Activa el **límite de gasto** en la consola de Anthropic además del del panel.
- Descarga una copia de seguridad semanal.

## Políticas de WhatsApp y consentimiento

- **Ventana de atención de 24 h:** solo se pueden enviar mensajes libres dentro de las 24 h posteriores al último mensaje
  del cliente. El sistema lo controla: fuera de la ventana el panel solo permite **plantillas aprobadas**, y la IA solo
  responde a mensajes recibidos (los reenvíos con más de 12 h de retraso no se responden automáticamente).
- **Plantillas:** se crean en WhatsApp Manager y Meta las aprueba. El panel lista las aprobadas y permite enviarlas con sus variables.
- **Consentimiento (opt-in):** antes de escribir por iniciativa propia a alguien con plantillas, debes contar con su
  consentimiento según las políticas de Meta y la ley de tu país. Este sistema no envía campañas masivas.
- **Baja (opt-out):** si el cliente escribe **STOP/BAJA** (configurable) deja de recibir mensajes automáticos y no se le
  pueden enviar plantillas desde el panel; con **ALTA** vuelve.
- **Transparencia:** la IA reconoce ser un asistente virtual si se le pregunta, y siempre puede derivar a una persona.
- **Política de privacidad:** el servidor publica `/privacy` y `/data-deletion` (necesarias para publicar la app de Meta).
  **Revísalas y adáptalas** a tu negocio y a la normativa aplicable (por ejemplo, protección de datos personales en tu país).
- **Derecho de supresión:** en el panel, **Contactos → Eliminar contacto y datos** borra mensajes, memoria y uso.
- **Proveedores:** los mensajes se procesan con Meta y Anthropic; inclúyelo en tu aviso de privacidad.
