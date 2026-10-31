# Asistente de IA para WhatsApp (Claude + WhatsApp Cloud API)

Un asistente que responde automáticamente a tus clientes de WhatsApp como una persona del equipo: recuerda a cada
contacto, consulta la información de tu negocio, entiende imágenes y PDF, y te deja tomar el control cuando quieras
desde un panel web.

- **WhatsApp:** solo la **API oficial de Meta (Cloud API)** con webhooks firmados. Sin WhatsApp Web, QR ni bots no oficiales.
- **IA:** **Claude** (Anthropic) mediante el SDK oficial. Modelo por defecto: Claude Opus 5.5 (configurable).
- **Panel:** React + Tailwind, modo claro/oscuro, adaptado a móvil.

> 📘 **Empieza aquí:** [docs/INSTALACION.md](docs/INSTALACION.md) — guía paso a paso para Windows, desde cero hasta producción.

## Funciones

| Área | Qué incluye |
|---|---|
| Conversación | Respuestas naturales, agrupación de mensajes seguidos, "escribiendo…", formato de WhatsApp, división de mensajes largos, idioma del cliente, preguntas de aclaración |
| Memoria | Corto plazo (últimos mensajes), largo plazo (datos del cliente), resumen automático, clasificación e intención; editable y borrable; aislada por contacto; nunca inventa recuerdos |
| Conocimiento | Notas, preguntas frecuentes, PDF y TXT; búsqueda en español antes de responder; reconoce cuando no tiene el dato |
| Medios | Análisis de fotos, lectura de PDF/texto; notas de voz con servicio de transcripción opcional |
| Control humano | Pausar/reactivar la IA por contacto, respuesta manual, pausa automática al responder, derivación a una persona (por regla o por la IA), botón general para detener todo |
| Automatizaciones | Bienvenida, horario de atención, reglas por palabra clave (respuesta, etiquetas, derivación), baja STOP/ALTA |
| Panel | Inicio (estado de conexiones, KPIs, costos, errores), Conversaciones, Contactos, Base de conocimientos, Automatizaciones, Estadísticas, Simulador, Configuración de la IA, Conexiones y sistema (credenciales, presupuesto, usuarios, errores, copias) |
| Seguridad | Firma de webhooks, credenciales cifradas, sesiones seguras, roles, CSRF, CSP, límites, validación, deduplicación — ver [docs/SEGURIDAD.md](docs/SEGURIDAD.md) |
| Costos | Estimación por llamada, límites diario/mensual y por contacto — ver [docs/COSTOS.md](docs/COSTOS.md) |

## Inicio rápido (desarrollo)

Requisitos: Node.js 22+, una base PostgreSQL (Neon gratis o `docker compose up -d`).

```bash
npm install
```

```bash
npm run setup
```

Edita `.env` (`DATABASE_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ANTHROPIC_API_KEY`…) y luego:

```bash
npm run db:migrate
```

```bash
npm run dev
```

Panel: <http://localhost:5173> · API: <http://localhost:3000> · Webhook: `/webhooks/whatsapp`.
Sin API Key aún, puedes explorar el panel con `CLAUDE_MOCK=true` (respuestas simuladas, claramente señalizadas).

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run setup` | Crea `.env` con claves aleatorias |
| `npm run dev` | Backend (3000) + panel (5173) con recarga automática |
| `npm run db:migrate` | Aplica las migraciones a la base de datos |
| `npm run build` / `npm start` | Compila y ejecuta en modo producción (el backend sirve el panel compilado) |
| `npm test` | 94 pruebas automatizadas del backend (requieren PostgreSQL de pruebas) |
| `npm run test:e2e` | Prueba del panel con navegador real (requiere Playwright y el servidor en marcha) |
| `npm run typecheck` | Comprobación de tipos de backend y panel |
| `npm run admin:create -- correo "Nombre" "Clave" [OWNER\|ADMIN\|AGENT]` | Crea un usuario del panel |
| `npm run backup:restore -w backend -- archivo.json` | Restaura una copia de seguridad |

## Documentación

| Documento | Contenido |
|---|---|
| [docs/INSTALACION.md](docs/INSTALACION.md) | Los 20 pasos: programas, Meta, número de prueba, webhook, tokens, Anthropic, `.env`, pruebas, número real, despliegue en Render + Neon, verificación |
| [docs/COSTOS.md](docs/COSTOS.md) | Claude, WhatsApp, alojamiento, base de datos y servicios opcionales; gratis vs. de pago; control de presupuesto |
| [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) | Diseño, decisiones, flujo de un mensaje, memoria, conocimiento, estado real de cada función |
| [docs/SEGURIDAD.md](docs/SEGURIDAD.md) | Medidas de seguridad, privacidad, ventana de 24 h, plantillas y consentimiento |
| [docs/SOLUCION-DE-PROBLEMAS.md](docs/SOLUCION-DE-PROBLEMAS.md) | Errores frecuentes y su solución |

## Estado de verificación

| Componente | Verificado | Cómo |
|---|---|---|
| Webhook (verificación, firma, duplicados, estados) | ✅ | Pruebas de integración + peticiones HTTP reales al servidor |
| Pipeline de respuesta, control humano, automatizaciones, presupuesto | ✅ | Pruebas de integración con PostgreSQL real y Claude simulado |
| Contrato de la Graph API (formato de envío, leído/escribiendo, plantillas, medios, errores) | ✅ | Pruebas contra una Graph API simulada |
| Panel web (todas las secciones, claro/oscuro, móvil) | ✅ | Navegador real (Playwright), sin errores de consola, también sobre la compilación de producción |
| Arranque de producción (migraciones en base vacía, cabeceras, cierre ordenado) | ✅ | Comandos exactos de Render ejecutados localmente |
| **Conexión real con Claude** | ⏳ Pendiente de tu API Key | El código usa el SDK oficial; pruébalo con **Probar conexión** y el Simulador |
| **Conexión real con Meta** | ⏳ Pendiente de tus credenciales | Pruébalo con **Probar conexión** y escribiendo al número de prueba |
| Imagen Docker | ⏳ No construida aquí (sin Docker en el entorno de desarrollo) | `docker compose --profile app up --build` |
| Transcripción de audio real | ⏳ Pendiente de una API Key de OpenAI/Groq | Probada contra un servicio simulado |
