# Costos del sistema

> Precios consultados en **octubre de 2026**. Todos los proveedores pueden cambiarlos: confirma siempre en sus
> páginas oficiales (enlazadas abajo) antes de presupuestar. **Ningún servicio gratuito está garantizado para siempre.**
> Los costos que muestra el panel son **estimaciones** calculadas con la tabla de precios de `backend/src/ai/models.ts`.

## Resumen

| Concepto | Gratis | De pago | Recomendado para empezar |
|---|---|---|---|
| **Claude API (Anthropic)** | No (prepago por uso) | Por tokens | Depende del modelo y del volumen (ver ejemplos) |
| **WhatsApp Business Platform** | Responder a clientes que te escriben (dentro de 24 h) | Plantillas fuera de la ventana de 24 h | 0 USD si solo respondes |
| **Alojamiento (Render)** | Plan Free (se duerme) | Starter ≈ 7 USD/mes | Starter, 24/7 |
| **Base de datos** | Neon Free (0,5 GB) | Neon de pago o Render Postgres (≈ 6 USD/mes) | Neon Free |
| **Transcripción de audio** | — | Por minuto de audio (OpenAI/Groq) | Desactivada por defecto |
| **Túnel Cloudflare, UptimeRobot** | Sí | — | Opcionales |

**Mínimo realista para un negocio pequeño:** ≈ 7 USD/mes (Render Starter) + el consumo de Claude
(desde menos de 1 USD hasta 20+ USD al mes según modelo y volumen) + 0 USD de WhatsApp si solo respondes.

---

## 1. Claude API (Anthropic) — de pago por uso

Fuente: tabla de precios de Anthropic (octubre de 2026) · <https://claude.com/pricing>

| Modelo | Entrada (USD / millón de tokens) | Salida | Lectura de caché |
|---|---|---|---|
| Claude Opus 5.5 *(por defecto: máxima calidad)* | 4,00 | 20,00 | 0,20 |
| Claude Sonnet 5.5 | 2,00 | 10,00 | 0,20 |
| Claude Haiku 5.5 *(el más económico; precio para prompts de hasta 100K tokens)* | 0,10 | 0,50 | ≈ 0,01 (estimado) |

- Un **token** ≈ ¾ de palabra en español. El razonamiento interno de la IA se cobra como **salida**.
- La parte fija del prompt (personalidad, reglas) se guarda en **caché**: las siguientes respuestas la leen a una fracción del precio.
- Cada respuesta incluye: prompt del sistema, memoria del contacto, conocimiento relevante, los últimos mensajes y la respuesta.

### Estimación por respuesta (texto, conversación típica)

Supuesto: ~1.300 tokens de entrada sin caché + ~1.200 en caché + ~300 de salida (esfuerzo "bajo").

| Modelo | Costo aproximado por respuesta | 1.000 respuestas/mes | 10.000 respuestas/mes |
|---|---|---|---|
| Opus 5.5 | ≈ 0,012 USD | ≈ 12 USD | ≈ 120 USD |
| Sonnet 5.5 | ≈ 0,006 USD | ≈ 6 USD | ≈ 60 USD |
| Haiku 5.5 | ≈ 0,0003 USD | ≈ 0,30 USD | ≈ 3 USD |

Costos adicionales:
- **Memoria:** una llamada pequeña cada N mensajes (por defecto 6). Usa el "modelo para memoria" (puedes poner Haiku 5.5 para que sea casi gratis).
- **Imágenes:** una foto añade ~1.000–1.600 tokens de entrada. **PDF:** según páginas.
- **Esfuerzo medio/alto** genera más razonamiento (más tokens de salida).
- **Simulador:** las pruebas también consumen (se ven como "Simulador" en Estadísticas).

> Estos números son orientativos. El panel registra el consumo **real** de cada llamada (tokens y costo estimado) en
> **Inicio** y **Estadísticas**; usa esos datos después de una semana para tu presupuesto real.

**Cómo pagar:** <https://platform.claude.com> → **Settings → Billing** → comprar créditos (prepago). No hay cuota mensual fija.

---

## 2. WhatsApp Business Platform (Meta)

Fuente: página oficial de precios <https://developers.facebook.com/docs/whatsapp/pricing>.
Según esa página (consultada en octubre de 2026, mediante buscador porque el sitio de Meta no era accesible desde el
entorno de desarrollo):

- **Desde el 1 de noviembre de 2024, las conversaciones de servicio son gratuitas.**
- **Los mensajes que no son plantillas** (texto, imagen, etc.) **son gratuitos** y solo se pueden enviar **dentro de la
  ventana de atención de 24 horas** que se abre cada vez que el cliente te escribe.
- Las **plantillas de utilidad** enviadas dentro de esa ventana también son gratuitas.
- Las **plantillas** enviadas fuera de la ventana (marketing, utilidad, autenticación) **se cobran por mensaje**; el precio depende del país y de la categoría.

**Qué significa para este sistema:** la IA solo responde a clientes que escriben primero, siempre dentro de la ventana
de 24 h → **0 USD de Meta**. Solo pagarías si desde el panel envías **plantillas** a alguien que no escribió en las
últimas 24 h. El panel muestra en **Estadísticas → Mensajes facturables de WhatsApp** lo que Meta marque como facturable.

> ⚠️ Durante la investigación apareció un blog de terceros afirmando cambios de precio para mensajes de servicio en 2026
> que **no coincide** con la página oficial de Meta. Revisa la página oficial periódicamente.

Otros puntos:
- El **número de prueba** es gratuito.
- Para enviar plantillas necesitas añadir un **método de pago** en WhatsApp Manager.
- Meta aplica **límites de mensajería** a conversaciones iniciadas por el negocio (no afectan a responder).

---

## 3. Alojamiento — Render

Fuente: <https://render.com/pricing> (precios reportados en 2026; la página de Render no se pudo leer directamente).

| Plan | Precio | Características | Para este proyecto |
|---|---|---|---|
| Free | 0 USD | 512 MB RAM, 0,1 CPU, **se duerme tras 15 min sin tráfico** (arranque ~30–60 s) | Solo pruebas |
| **Starter** | ≈ 7 USD/mes | 512 MB RAM, 0,5 CPU, siempre encendido | **Recomendado** |

Además Render cobra un plan de "workspace" (el plan Hobby es 0 USD para uso individual).
El sistema usa ~120–250 MB de RAM, cabe holgadamente en Starter.

**Por qué un solo servicio:** el panel web y la API van en el mismo servidor y la cola de tareas usa la propia base de
datos (sin Redis). Así pagas **un** servicio en lugar de tres.

---

## 4. Base de datos

| Opción | Precio | Límites relevantes |
|---|---|---|
| **Neon Free** (recomendada) | 0 USD | 0,5 GB de almacenamiento por proyecto, 100 horas de cómputo (CU-h) al mes, se suspende tras 5 min sin actividad y despierta en segundos. Fuente: <https://neon.com/pricing> |
| Neon de pago | desde uso (≈ 0,106 USD/CU-h + 0,35 USD/GB-mes) | Sin suspensión forzada al pasar límites |
| Render Postgres | ≈ 6 USD/mes (el plan gratuito **caduca a los 30 días**) | Útil si prefieres todo en Render |

**Diseño pensado para el plan gratuito de Neon:** el servidor **no consulta la base de datos en bucle** (la cola de tareas
se despierta solo cuando hay trabajo) y `/api/health` no toca la base de datos. Así, sin tráfico, Neon puede
suspenderse y no gasta horas de cómputo. 0,5 GB equivalen a cientos de miles de mensajes de texto.

---

## 5. Servicios adicionales (opcionales)

| Servicio | Para qué | Costo |
|---|---|---|
| Transcripción de audio (OpenAI o Groq) | Entender notas de voz | De pago por minuto de audio. Consulta <https://openai.com/api/pricing> o <https://groq.com/pricing> |
| Búsqueda semántica (embeddings, p. ej. Voyage AI) | Búsquedas por significado | **No implementado**; la búsqueda actual (texto completo de PostgreSQL) es gratuita |
| Dominio propio | `ia.tunegocio.com` | ≈ 10–15 USD/año según registrador |
| Cloudflare Tunnel, UptimeRobot | Pruebas locales y monitoreo | Gratis |

---

## 6. Controles de presupuesto incluidos

| Control | Dónde | Efecto |
|---|---|---|
| **Límite diario y mensual (USD)** | Panel → Conexiones y sistema → Presupuesto | Al alcanzarlo la IA deja de responder, envía un aviso (una vez) y marca el contacto para atención humana |
| **Respuestas por contacto (hora/día)** | Mismo lugar | Evita que una sola persona (o un abuso) dispare el gasto |
| **Longitud máxima de mensaje entrante** | Mismo lugar | Recorta textos enormes antes de enviarlos a Claude |
| **Límite de gasto de Anthropic** | platform.claude.com → Settings → Limits | Tope definitivo a nivel de cuenta |
| Modelo, esfuerzo y límite de tokens | Configuración de la IA | Elegir Haiku/Sonnet y esfuerzo "bajo" reduce mucho el costo |
| Mensajes en contexto y frecuencia de memoria | Configuración de la IA | Menos historial = menos tokens por respuesta |
| Análisis de imágenes y documentos | Configuración de la IA | Desactívalos si no los necesitas |
| Botón general "Detener todo" | Barra superior | Corta todas las respuestas automáticas al instante |

### Recomendación para empezar con poco gasto
1. Modelo principal **Claude Opus 5.5** (mejor calidad) con esfuerzo **bajo**, o **Sonnet 5.5** si el volumen es alto.
2. Modelo de memoria **Haiku 5.5**.
3. Límite diario 2–5 USD y mensual 30–50 USD en el panel, más un límite mensual en la consola de Anthropic.
4. Revisa **Estadísticas** al final de la primera semana y ajusta.
