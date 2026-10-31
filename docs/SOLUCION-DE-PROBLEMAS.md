# Solución de problemas

Primero mira **Panel → Inicio → Errores recientes** y **Conexiones y sistema → Errores**: casi todos los fallos
quedan registrados ahí con un mensaje en español. En Render, revisa también la pestaña **Logs** del servicio.

## Instalación (PC)

| Síntoma | Causa | Solución |
|---|---|---|
| `"node" no se reconoce como un comando` | Node.js no instalado o PowerShell abierto antes de instalarlo | Instala Node.js 22 LTS (paso 2) y abre una ventana nueva de PowerShell; si sigue, reinicia el PC |
| `la ejecución de scripts está deshabilitada en este sistema` | Política de PowerShell | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` y responde **S**, o usa "Símbolo del sistema" (cmd) |
| `❌ Configuración inválida … DATABASE_URL` | Falta el archivo `.env` o la variable | Ejecuta `npm run setup` y completa `.env` (paso 13) |
| `ENCRYPTION_KEY debe tener al menos 32 caracteres` | `.env` copiado a mano sin claves | `npm run setup` las genera; no las cambies después |
| `No se pudo conectar a la base de datos` | Cadena de Neon mal copiada, o Docker apagado | Copia de nuevo la cadena (Neon → **Connect**) y comprueba que termine en `?sslmode=require` |
| `npm run db:migrate` se queda colgado o falla con "prepared statement" | Usaste la cadena **con pooling** (`-pooler`) de Neon | En Neon → Connect, desactiva **Connection pooling** y copia la cadena directa |
| `EADDRINUSE: port 3000` | Ya hay otra copia del servidor abierta | Cierra la otra ventana o cambia `PORT` en `.env` |
| No puedo entrar al panel | Usuario no creado | Revisa `ADMIN_EMAIL`/`ADMIN_PASSWORD` (10+ caracteres con letras y números) y reinicia; o `npm run admin:create -- correo "Nombre" "Clave1234567"` |
| "Demasiados intentos fallidos" | Protección contra fuerza bruta | Espera 15 minutos |

## WhatsApp / Meta

| Síntoma | Causa | Solución |
|---|---|---|
| Meta dice **"No se pudo validar la URL de devolución de llamada o el token de verificación"** | Servidor apagado, URL incorrecta, HTTP en vez de HTTPS, o Verify Token distinto | La URL debe ser `https://…/webhooks/whatsapp`, el servidor debe estar encendido y el token **idéntico** al de `WHATSAPP_VERIFY_TOKEN` (o al guardado en el panel) |
| Verifica bien pero **no llegan mensajes** al panel | No te suscribiste al campo `messages`, la app no está publicada, o la WABA del número real no está suscrita | Meta → WhatsApp → Configuración → Campos del webhook → `messages`. Publica la app (paso 17.7). Pulsa **Suscribir app a la WABA** en el panel |
| Errores "Firma del webhook no válida" | El App Secret configurado no es el de esta app | Copia de nuevo **Configuración → Básica → Clave secreta de la app** |
| Error **190** / "token no válido o caducó" | Token temporal (24 h) caducado | Crea el **token permanente** (paso 10) y guárdalo en el panel |
| Error **131030** "destinatario no permitido" | Con el número de prueba solo puedes escribir a números autorizados | Agrega el número en **Configuración de la API → Para → Administrar la lista** |
| Error **131047** "más de 24 horas" | Fuera de la ventana de atención | Solo puedes escribir con una **plantilla aprobada** (botón *Enviar plantilla* en la conversación) |
| Error **133010** "número no registrado" | Número real sin registrar en la Cloud API | Panel → Conexiones → **Registrar número (PIN)** |
| Error **10/200** permisos | El token no tiene los permisos | Regenera el token con `whatsapp_business_messaging` y `whatsapp_business_management` y control total sobre la app y la WABA |
| El mensaje se ve "enviado" pero nunca "entregado" | Problema del destinatario o calidad del número | Revisa **Errores**; Meta informa el motivo en el estado "fallido" |
| Las respuestas dicen "simulado" | Modo simulación activo | Conexiones → Modo de envío: **Real** (o `WHATSAPP_MODE=live`) |
| El botón "Probar" de Meta no crea nada | Es esperado: Meta envía un número de teléfono ficticio que se ignora | Prueba escribiendo desde tu WhatsApp |

## IA (Claude)

| Síntoma | Causa | Solución |
|---|---|---|
| La IA no responde y en Errores dice "Falta la API Key" | No configurada | Pégala en Conexiones → Claude, o en `ANTHROPIC_API_KEY` |
| "API Key de Claude no es válida" | Clave mal copiada o revocada | Crea una nueva en platform.claude.com → Settings → API keys |
| "Tu cuenta de Anthropic no tiene saldo" | Sin créditos | platform.claude.com → Billing → añade créditos |
| "Claude respondió con límite de uso (429)" | Demasiadas solicitudes para tu nivel | Se reintenta solo; si es frecuente, sube de nivel en Anthropic o usa otro modelo |
| "El modelo configurado no existe" | ID de modelo mal escrito | Configuración de la IA → elige un modelo de la lista |
| Las respuestas empiezan por `[Modo prueba]` | `CLAUDE_MOCK=true` | Ponlo en `false` y reinicia |
| La IA no responde a un contacto | IA pausada, contacto bloqueado, escribió STOP, límite de presupuesto, fuera de horario, o el botón general detenido | Abre la conversación: bajo el mensaje aparece **"Sin respuesta automática: motivo"** |
| La IA inventa datos del negocio | Falta información en la base de conocimientos | Añade una pregunta frecuente con el dato correcto y prueba con **Probar la búsqueda** |
| La IA responde muy largo/corto | Ajuste de longitud | Configuración de la IA → Longitud de las respuestas, e instrucciones |
| "No pudo responder (filtro de seguridad)" | Los filtros de Claude rechazaron el mensaje | Responde manualmente; el sistema ya reintenta en un modelo de respaldo automáticamente |
| No entiende notas de voz | Claude no procesa audio | Activa la transcripción (Configuración de la IA → Medios) con una API Key de OpenAI o Groq |

## Despliegue (Render)

| Síntoma | Causa | Solución |
|---|---|---|
| El build falla en `npm ci` | `package-lock.json` desactualizado | En tu PC: `npm install`, haz commit del `package-lock.json` y vuelve a desplegar |
| "Configuración inválida" en los logs | Falta una variable | Render → Environment → añade la que indique el mensaje |
| Las credenciales guardadas en el panel dejan de funcionar ("No se puede descifrar") | Cambió `ENCRYPTION_KEY` | Vuelve a introducirlas en el panel (o restaura la clave anterior) |
| El primer mensaje tarda ~1 minuto | Plan Free de Render dormido | Usa el plan Starter |
| La base de datos "suspendida" en Neon | Se agotaron las horas gratuitas del mes | Pasa a un plan de pago de Neon o espera al mes siguiente |

## Ejecutar las pruebas

```bash
npm test
```

Requiere una base PostgreSQL de pruebas vacía (por defecto `postgresql://wa:wa@localhost:5432/whatsapp_ai_test`, o define
`TEST_DATABASE_URL`) con las migraciones aplicadas:

```bash
$env:DATABASE_URL="postgresql://usuario:clave@localhost:5432/whatsapp_ai_test"; npm run db:migrate
```

(en PowerShell; en Linux/macOS: `DATABASE_URL=... npm run db:migrate`).
