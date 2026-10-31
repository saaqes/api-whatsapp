# Arquitectura

## Visión general

```
 Cliente de WhatsApp
        │  mensaje
        ▼
 Meta · WhatsApp Cloud API ──── webhook HTTPS firmado (X-Hub-Signature-256) ────┐
        ▲                                                                       ▼
        │ envío (Graph API)                                  ┌─────────────── Servidor Node.js (Fastify) ───────────────┐
        │                                                    │  /webhooks/whatsapp → valida firma → guarda (idempotente)│
        └──────────── cola: send_message ◄───────────────────│  cola en PostgreSQL: reply → send_message → memory_update│
                                                             │  Pipeline de respuesta:                                  │
 Claude API (Anthropic) ◄──── generateReply ─────────────────│   bloqueo → STOP → botón general → IA pausada →          │
   · prompt estable en caché                                 │   bienvenida → horario → reglas → presupuesto → Claude   │
   · herramientas controladas                                │  Panel web (React) servido en el mismo dominio           │
   · respaldo ante rechazos                                  │  API del panel (/api/*) con sesión, roles y CSRF         │
                                                             └──────────────────────────┬───────────────────────────────┘
                                                                                        ▼
                                                                    PostgreSQL (Neon / Render / local)
                                                     contactos · mensajes · memoria · conocimiento · reglas · uso · cola
```

## Tecnologías y decisiones

| Elemento | Elección | Por qué |
|---|---|---|
| Backend | **Node.js 22 + TypeScript + Fastify 5** | Rápido, tipado, plugins oficiales de seguridad (helmet, rate-limit, cookie, multipart) |
| ORM | **Prisma 7** (adaptador `pg`) | Esquema declarativo, migraciones versionadas, sin motor binario |
| Base de datos | **PostgreSQL** | Fiable; incluye búsqueda de texto completo en español (sin servicio extra) |
| Cola de tareas | **Propia, sobre PostgreSQL** (en lugar de Redis + BullMQ) | Un servicio menos que pagar y mantener. Persistente, con reintentos, agrupación por contacto y sin sondeo continuo (permite que Neon se suspenda) |
| IA | **Claude** vía SDK oficial `@anthropic-ai/sdk` 1.x | API versión 2026-10-21; modelo por defecto Claude Opus 5.5 |
| WhatsApp | **WhatsApp Cloud API oficial** (Graph API, `fetch` nativo) | Sin librerías no oficiales ni WhatsApp Web |
| Frontend | **React 19 + Vite + Tailwind CSS 4**, TanStack Query, Recharts | Moderno, rápido, modo claro/oscuro, responsive |
| Despliegue | **Render** (1 servicio web) + **Neon** | Bajo costo; el panel y la API comparten servidor y dominio (cookies seguras sin CORS) |

> Cambio respecto a la arquitectura sugerida: **no se usa Redis/BullMQ**. Para el volumen de un negocio (cientos o miles
> de mensajes al día) una cola en PostgreSQL es suficiente, más barata y más simple. Limitación: está pensada para **una
> instancia** del servidor (ver "Escalar").

## Estructura del código

```
api-whatsapp/
├── backend/
│   ├── prisma/                 esquema y migraciones SQL
│   ├── src/
│   │   ├── config/env.ts       variables de entorno validadas
│   │   ├── database/           cliente Prisma
│   │   ├── webhooks/           webhook de WhatsApp (verificación + firma + recepción)
│   │   ├── whatsapp/           cliente de la Graph API y parser del webhook
│   │   ├── pipeline/           inbound.ts (guardar/deduplicar) y reply.ts (decidir y responder)
│   │   ├── ai/                 claude.ts, prompt.ts, responder.ts, tools.ts, models.ts (precios)
│   │   ├── memory/             memoria corto/largo plazo y extracción estructurada
│   │   ├── knowledge/          base de conocimientos (fragmentos + búsqueda)
│   │   ├── automations/        reglas, horarios, baja (STOP)
│   │   ├── media/              imágenes/PDF para Claude, transcripción de audio
│   │   ├── queue/              cola persistente y registro de trabajos
│   │   ├── services/           ajustes y credenciales cifradas, envíos, presupuesto, estadísticas, auth, copias
│   │   ├── routes/             API del panel
│   │   ├── middleware/         sesión, roles, verificación de origen
│   │   └── utils/              cifrado, texto, horarios, errores, logs
│   ├── scripts/                crear administrador, restaurar copia
│   └── tests/                  pruebas unitarias e integración (PostgreSQL real)
├── frontend/
│   ├── src/{pages,components,layouts,hooks,services,lib,styles}
│   └── e2e/panel.e2e.mjs       prueba del panel con navegador real
├── docs/                       instalación, costos, arquitectura, seguridad, problemas
├── scripts/setup.mjs           genera .env con claves aleatorias
├── Dockerfile · docker-compose.yml · render.yaml · .env.example
```

## Flujo de un mensaje

1. **Webhook** (`webhooks/whatsapp.routes.ts`): verifica la firma HMAC-SHA256 sobre el cuerpo **en bruto**, ignora
   eventos de otros números, y para cada mensaje llama a `handleInbound`.
2. **Recepción** (`pipeline/inbound.ts`): si el `wamid` ya existe, es un reenvío de Meta → se ignora (protección contra
   duplicados con índice único). Crea/actualiza el contacto, guarda el mensaje como `PENDING` y programa un trabajo
   `reply` con **espera agrupada** (debounce): si el cliente envía 3 mensajes seguidos, se responde una vez a los tres.
   El webhook responde 200 en milisegundos.
3. **Respuesta** (`pipeline/reply.ts`, trabajo `reply`, nunca dos a la vez para el mismo contacto):
   1. Bloqueado / STOP / botón general / IA pausada → no responde (se registra el motivo).
   2. Bienvenida (1.ª vez), aviso fuera de horario, reglas por palabra clave (respuesta, etiquetas, derivación).
   3. Límites de presupuesto y anti-abuso.
   4. Marca como leído + "escribiendo…".
   5. Construye el contexto: historial reciente (texto), memoria del contacto, conocimiento relevante, medios
      (imágenes/PDF descargados de Meta, audio transcrito).
   6. Llama a Claude (con herramientas si las necesita).
   7. **Antes de enviar** vuelve a comprobar: ¿se pausó la IA?, ¿respondió una persona?, ¿llegaron mensajes nuevos?
      (en ese caso **regenera** la respuesta incluyéndolos). Así nunca hay respuestas duplicadas ni desactualizadas.
   8. Convierte Markdown al formato de WhatsApp, divide si supera 4.096 caracteres y encola `send_message`.
   9. Cada N mensajes programa `memory_update`.
4. **Envío** (`services/outbound.service.ts`): envía por la Graph API; errores temporales (5xx, 429, límites) se
   reintentan con espera exponencial; errores definitivos (p. ej. 131047, fuera de 24 h) se marcan como fallidos con
   un mensaje claro y un botón **Reintentar** en el panel.
5. **Estados** (`handleStatus`): enviado → entregado → leído (nunca retrocede), fallido con explicación, y categoría de precio de Meta.

## Integración con Claude

- **Prompt en dos bloques:** uno **estable** (identidad, estilo, reglas de seguridad, instrucciones del negocio) marcado
  para **caché** — las siguientes llamadas lo leen a una fracción del precio — y uno **variable** (fecha/hora, memoria del
  contacto, conocimiento recuperado) que va después del punto de caché.
- **Historial como texto:** cada turno anterior se envía como texto. No se reenvían bloques de razonamiento de turnos
  anteriores, por lo que el historial (que se recorta y resume) nunca invalida el razonamiento del modelo.
- **Esfuerzo** (`low`/`medium`/`high`) controla cuánto piensa el modelo, la latencia y el costo. La **temperatura** no
  se envía: la versión actual de la API la rechaza en todos los modelos.
- **Respaldo ante rechazos:** se envía `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`): si los filtros
  de seguridad rechazan por error una solicitud, Anthropic la reintenta en un modelo de respaldo. Si aun así se rechaza,
  no se envía nada y el contacto se marca para atención humana.
- **Herramientas controladas** (`ai/tools.ts`, esquemas estrictos): `search_knowledge_base` y `request_human_agent`.
  Se ejecutan en el servidor ligadas al contacto actual: el modelo no puede elegir otro contacto ni cambiar la configuración.
- **Errores**: autenticación/saldo/modelo inválido → no se reintenta y se avisa en el panel; 429/5xx/conexión → la cola reintenta.

## Memoria

| Tipo | Implementación |
|---|---|
| Corto plazo | Últimos N mensajes del contacto (configurable, 20 por defecto, máx. ~30.000 caracteres) |
| Largo plazo | `ContactMemory`: hechos breves por categoría (personal, preferencia, negocio, otro) |
| Resumen | `Contact.summary`: resumen acumulado de toda la relación |
| Extracción | Cada N mensajes, Claude (salida estructurada validada con Zod) propone añadir/actualizar/eliminar hechos y actualiza el resumen, la clasificación (prospecto/cliente/soporte) y la intención |
| Garantías | Solo hechos dichos por el cliente; sin datos sensibles; los hechos manuales del equipo no se tocan; todo id se valida contra el contacto; límite de hechos por contacto |
| Honestidad | El prompt indica que solo puede "recordar" lo que figura en su memoria o en el historial visible |

## Base de conocimientos

Documentos (nota, pregunta frecuente o archivo PDF/TXT) divididos en fragmentos de ~1.200 caracteres con solapamiento.
Cada fragmento tiene una columna `tsvector` generada por PostgreSQL (`spanish`, texto sin tildes) con índice GIN.
Antes de cada respuesta se buscan los fragmentos más relevantes (consulta con OR de las palabras del cliente, ordenada
por relevancia) y se añaden al contexto; la IA puede además buscar con la herramienta. Si no hay resultados, el contexto
lo dice explícitamente para que la IA reconozca que no tiene la información.

**Extensión prevista:** búsqueda semántica con *embeddings* (Anthropic recomienda Voyage AI). Requiere un servicio
externo de pago; la interfaz `searchKnowledge()` es el único punto a cambiar.

## Funciones avanzadas: estado real

| Función | Estado |
|---|---|
| Análisis de fotografías | ✅ Implementado (visión de Claude; JPEG/PNG/WebP/GIF ≤ 5 MB) |
| Lectura de documentos | ✅ PDF (Claude) y texto (TXT/CSV/JSON). ❌ Word/Excel: se pide al cliente un PDF |
| Transcripción de audios | ✅ Implementado con un servicio externo compatible con OpenAI (OpenAI/Groq); **desactivado por defecto, con costo**. Probado con un servidor simulado; requiere tu API Key para usarlo de verdad |
| Reconocimiento de voz en tiempo real / responder con audio | ❌ No implementado (las respuestas son texto) |
| Resúmenes de conversaciones | ✅ Automáticos y editables |
| Detección de intención y clasificación de contactos | ✅ En cada actualización de memoria (no en cada mensaje) |
| Herramientas externas controladas | ✅ Arquitectura en `ai/tools.ts` (dos herramientas incluidas) |
| Respuestas en varios idiomas | ✅ Responde en el idioma del cliente (configurable) |
| Vídeos | ❌ Claude no procesa vídeo; la IA pide una descripción |

## Escalar

- **Vertical:** el plan Starter atiende cómodamente un negocio pequeño/mediano. Sube de plan si la CPU/RAM se queda corta.
- **Varias instancias:** la cola evita conflictos entre trabajos del mismo contacto también entre instancias, pero los
  temporizadores son por proceso y los límites de solicitudes se guardan en memoria. Para escalar horizontalmente,
  sustituye la cola por BullMQ + Redis y el almacén de límites por Redis (los puntos de cambio están aislados en `queue/` y `app.ts`).
