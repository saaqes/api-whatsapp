# Guía de instalación paso a paso (Windows)

Esta guía te lleva desde cero hasta tener la IA respondiendo en tu WhatsApp, funcionando 24/7 en internet.
No necesitas experiencia previa: cada paso indica **qué página abrir**, **qué botón pulsar**, **qué escribir**,
**qué deberías ver** y **cómo comprobar que lo hiciste bien**.

> ⏱️ Tiempo estimado: 2 a 3 horas la primera vez (gran parte es esperar verificaciones de Meta).
>
> ⚠️ **Sobre las pantallas de Meta, Anthropic, Render y Neon:** estas empresas cambian sus menús con frecuencia.
> Los nombres de botones de esta guía son los habituales en 2025-2026 (en español y, entre paréntesis, en inglés).
> Si un botón tiene otro nombre, busca el más parecido: el objetivo de cada paso no cambia.

## Índice

| Parte | Pasos |
|---|---|
| A. Preparar tu PC | 1. Programas · 2. Node.js · 3. Dependencias · 4. Abrir y ejecutar |
| B. Meta / WhatsApp | 5. Cuenta de Meta for Developers · 6. Crear la app · 7. WhatsApp Business Platform · 8. Número de prueba · 9. Webhook · 10. Identificadores y tokens |
| C. Claude | 11. Cuenta de Anthropic · 12. API Key |
| D. Poner todo en marcha | 13. Variables de entorno · 14. Backend · 15. Panel · 16. Probar la IA |
| E. Producción | 17. Número real · 18. Desplegar en internet · 19. Comprobar el despliegue · 20. Errores comunes |

---

## Parte A — Preparar tu PC

### Paso 1. Programas que necesitas

| Programa | Para qué | Obligatorio |
|---|---|---|
| **Node.js 22 LTS** | Ejecuta el proyecto | Sí |
| **Git para Windows** | Descargar el código y publicarlo en GitHub/Render | Sí |
| **Visual Studio Code** | Editar el archivo `.env` cómodamente | Recomendado (el Bloc de notas también sirve) |
| Una cuenta de **GitHub** | Render despliega desde GitHub | Sí, para el paso 18 |
| **Neon** (base de datos en la nube, gratis) | Guardar contactos, mensajes y memoria | Sí (o Docker/PostgreSQL local) |

**Git para Windows:**
1. Abre <https://git-scm.com/download/win>.
2. La descarga empieza sola (si no, pulsa **Click here to download**).
3. Ejecuta el instalador y pulsa **Next** en todas las pantallas (las opciones por defecto están bien) y luego **Install** → **Finish**.

**Visual Studio Code (opcional):** abre <https://code.visualstudio.com/>, pulsa **Download for Windows**, instala con las opciones por defecto.

✅ **Cómo saber si lo hiciste bien:** pulsa la tecla Windows, escribe `PowerShell` y ábrelo. Escribe:

```bash
git --version
```

Debe aparecer algo como `git version 2.x`.

### Paso 2. Instalar Node.js

1. Abre <https://nodejs.org/es>.
2. Pulsa el botón **Descargar Node.js (LTS)** (versión 22 o superior).
3. Ejecuta el archivo `.msi` descargado → **Siguiente** → acepta la licencia → **Siguiente** en todo → **Instalar** → **Finalizar**.
   No hace falta marcar la casilla de "herramientas para módulos nativos".
4. **Cierra y vuelve a abrir PowerShell** (para que reconozca Node).

✅ **Comprobación:**

```bash
node -v
```

```bash
npm -v
```

Debe mostrar `v22.x.x` (o superior) y un número de versión de npm. Si dice "no se reconoce como un comando", reinicia el PC.

> 💡 Si al usar `npm` aparece **"la ejecución de scripts está deshabilitada en este sistema"**, ejecuta una vez
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` y responde **S** (o usa la aplicación "Símbolo del sistema" en lugar de PowerShell).

### Paso 3. Descargar el proyecto e instalar las dependencias

1. Elige una carpeta, por ejemplo `Documentos`. En PowerShell:

```bash
cd $HOME\Documents
```

2. Descarga el código (cámbialo por la URL de tu repositorio si es otro):

```bash
git clone https://github.com/saaqes/api-whatsapp.git
```

```bash
cd api-whatsapp
```

> El código se desarrolló en la rama `claude/laughing-meitner-ye0tdf`. Si todavía no la fusionaste en `main`,
> cámbiate a ella con: `git checkout claude/laughing-meitner-ye0tdf`

3. Instala las dependencias (tarda 1–3 minutos y descarga unos 300 MB):

```bash
npm install
```

✅ **Qué deberías ver:** al final, algo como `added 400 packages` y `found 0 vulnerabilities`.
Si aparece `Generated Prisma Client`, perfecto: también se preparó el acceso a la base de datos.

### Paso 4. Crear la base de datos, abrir y ejecutar el proyecto (primera vez)

**4.1 Crear la base de datos gratuita en Neon** (la usarás también en producción):

1. Abre <https://neon.com> y pulsa **Sign up**. Puedes entrar con tu cuenta de Google o GitHub.
2. Crea un proyecto (**Create project**):
   - **Project name:** `whatsapp-ai`
   - **Postgres version:** la que venga por defecto (16 o superior)
   - **Region:** **AWS US East 2 (Ohio)** (la misma región que usaremos en Render; reduce la latencia).
3. En el panel del proyecto pulsa **Connect** (Conectar). En la ventana:
   - **Branch:** `main` · **Database:** `neondb`
   - **Desactiva "Connection pooling"** (importante: las migraciones necesitan la conexión directa).
   - Copia la cadena que empieza por `postgresql://…` y termina en `?sslmode=require`.

✅ La cadena se parece a: `postgresql://neondb_owner:XXXX@ep-algo-123456.us-east-2.aws.neon.tech/neondb?sslmode=require`
(sin la palabra `-pooler`). Guárdala; la usarás en el paso 13.

> Alternativa sin internet: si tienes Docker Desktop, `docker compose up -d` crea una base local y la cadena es
> `postgresql://whatsapp:whatsapp@localhost:5432/whatsapp_ai`.

**4.2 Crear el archivo de configuración:**

```bash
npm run setup
```

✅ Verás `Archivo .env creado` y `Generados automáticamente: ENCRYPTION_KEY, SESSION_SECRET, WHATSAPP_VERIFY_TOKEN`.
Ahora sigue el **paso 13** para completar `.env` (como mínimo `DATABASE_URL`, `ADMIN_EMAIL` y `ADMIN_PASSWORD`) y vuelve aquí.

**4.3 Crear las tablas en la base de datos:**

```bash
npm run db:migrate
```

✅ Debe terminar con `All migrations have been successfully applied.`

**4.4 Ejecutar:** sigue los pasos 14 y 15 (`npm run dev`).

> 🔒 **Nunca subas el archivo `.env` a GitHub ni lo compartas.** Ya está excluido en `.gitignore`.

---

## Parte B — Meta y WhatsApp Business Platform

Usaremos **únicamente la API oficial (WhatsApp Cloud API)**. No se usa WhatsApp Web, ni códigos QR, ni automatización
del navegador: es el método aprobado por Meta y no pone en riesgo tu número.

### Paso 5. Crear una cuenta en Meta for Developers

1. Abre <https://developers.facebook.com/> y pulsa **Iniciar sesión** (*Log in*) con tu cuenta de Facebook.
   (Si no tienes, crea una en facebook.com; usa datos reales: Meta puede verificar la identidad).
2. Si es la primera vez, pulsa **Comenzar** (*Get started*) y completa el registro como desarrollador:
   acepta los términos, verifica tu número de teléfono o correo y elige tu ocupación.

✅ **Comprobación:** arriba a la derecha aparece **Mis apps** (*My Apps*).

### Paso 6. Crear una aplicación de Meta

1. Ve a <https://developers.facebook.com/apps> y pulsa **Crear app** (*Create app*).
2. **Detalles de la app:** nombre (por ejemplo `Asistente IA de Moda Andina`) y tu correo de contacto → **Siguiente**.
3. **Caso de uso:** elige **Conectarte con los clientes a través de WhatsApp** (*Connect with customers through WhatsApp*) → **Siguiente**.
4. **Negocio:** selecciona tu **portfolio comercial** (*business portfolio*). Si no tienes, elige crear uno con el nombre de tu negocio.
5. Revisa el resumen y pulsa **Crear app** (puede pedirte tu contraseña de Facebook).

✅ **Qué deberías ver:** el panel de tu app. En el menú lateral aparece **WhatsApp** (o un botón **Personalizar caso de uso**).

### Paso 7. Configurar WhatsApp Business Platform

1. En el panel de la app, abre **WhatsApp → Configuración de la API** (*API Setup*). Si ves un botón
   **Personalizar el caso de uso** (*Customize use case*), púlsalo primero y luego **Configuración de la API**.
2. Si te lo pide, acepta los términos de WhatsApp Business y elige/crea una **cuenta de WhatsApp Business (WABA)**.
   Meta crea automáticamente una cuenta de prueba con un **número de prueba gratuito**.

✅ **Qué deberías ver:** una página con las secciones **Paso 1: seleccionar números de teléfono**, un campo **De** (*From*)
con un número de prueba (+1 555…), un **Identificador del número de teléfono** y un **Identificador de la cuenta de WhatsApp Business**.

### Paso 8. Conseguir y usar el número de prueba

El número de prueba es gratuito y sirve para probar con **hasta 5 números destinatarios** que tú autorices.

1. En **Configuración de la API**, en el campo **Para** (*To*), pulsa **Administrar la lista de números de teléfono**
   (*Manage phone number list*) → **Agregar número de teléfono**.
2. Escribe **tu número personal** con el código de país (por ejemplo `+57 300 1112233`) → **Siguiente**.
3. Te llega un **código por WhatsApp**: escríbelo y confirma.
4. Pulsa **Enviar mensaje** (*Send message*): Meta envía la plantilla de ejemplo `hello_world` a tu WhatsApp.

✅ **Comprobación:** recibes en tu WhatsApp el mensaje "Hello World" desde el número de prueba.
**Guarda ese contacto** en tu teléfono: es el número al que escribirás para hablar con tu IA.

### Paso 9. Configurar el webhook

El webhook es la dirección a la que Meta envía los mensajes que recibe tu número. Debe ser **HTTPS público**.
Tienes dos opciones:

- **Opción recomendada:** despliega primero en Render (paso 18) y usa `https://TU-APP.onrender.com/webhooks/whatsapp`.
- **Opción para probar en tu PC:** un túnel gratuito de Cloudflare:

```bash
winget install --id Cloudflare.cloudflared
```

```bash
cloudflared tunnel --url http://localhost:3000
```

  Copia la dirección `https://algo-aleatorio.trycloudflare.com` que aparece. (Cambia cada vez que lo ejecutas.)

**Configurarlo en Meta:**

1. En el panel de la app, abre **WhatsApp → Configuración** (*Configuration*).
2. En **Webhook**, pulsa **Editar** (*Edit*) y completa:
   - **URL de devolución de llamada** (*Callback URL*): `https://TU-DOMINIO/webhooks/whatsapp`
   - **Token de verificación** (*Verify token*): el valor de `WHATSAPP_VERIFY_TOKEN` de tu `.env`
     (o el que veas en Render → Environment). **Debe ser idéntico.**
3. Pulsa **Verificar y guardar** (*Verify and save*). Tu servidor debe estar encendido en ese momento.
4. En **Campos del webhook** (*Webhook fields*) pulsa **Administrar** (*Manage*) y **suscríbete al campo `messages`** → **Listo**.

✅ **Cómo saber si funcionó:**
- Meta muestra el webhook como verificado (sin mensaje de error).
- En el panel de la IA → **Inicio → Webhook de Meta**, "Verificado" muestra "hace un momento".
- Si falla: revisa que el Verify Token sea exactamente igual y que la URL termine en `/webhooks/whatsapp` (ver paso 20).

### Paso 10. Obtener los identificadores y tokens

Necesitas 6 datos. Anótalos para el paso 13:

| Dato | Dónde se obtiene |
|---|---|
| **Meta App ID** | Panel de la app → **Configuración de la app → Básica** (*App settings → Basic*) → **Identificador de la app** |
| **Meta App Secret** | Misma página → **Clave secreta de la app** (*App secret*) → **Mostrar** (pide tu contraseña) |
| **WhatsApp Business Account ID** | **WhatsApp → Configuración de la API** → "Identificador de la cuenta de WhatsApp Business" |
| **Phone Number ID** | Misma página → "Identificador del número de teléfono" (debajo del número **De**) |
| **Verify Token** | Lo inventas tú (`npm run setup` ya generó uno). Es el mismo que pusiste en el paso 9 |
| **Access Token** | Ver abajo: temporal para probar, **permanente** para producción |

**Access Token temporal (solo para probar):** en **Configuración de la API** pulsa **Generar token de acceso**.
⚠️ Caduca a las **24 horas**; cuando caduque, la IA dejará de poder responder (error 190).

**Access Token permanente (obligatorio para producción):**

1. Abre <https://business.facebook.com/settings> (Configuración del negocio de tu portfolio).
2. **Usuarios → Usuarios del sistema** (*System users*) → **Agregar** (*Add*).
   Nombre: `whatsapp-ia` · Rol: **Administrador** → **Crear usuario del sistema**.
3. Con el usuario seleccionado, pulsa **Asignar activos** (*Assign assets*):
   - **Apps** → tu app → activa **Control total** (*Full control*).
   - **Cuentas de WhatsApp** → tu cuenta de WhatsApp Business → **Control total**.
   → **Guardar cambios**.
4. Pulsa **Generar nuevo token** (*Generate new token*):
   - **App:** tu app.
   - **Caducidad del token:** **Nunca** (*Never*).
   - **Permisos:** marca `whatsapp_business_messaging` y `whatsapp_business_management`.
   → **Generar token** y **cópialo ahora** (no se vuelve a mostrar).

✅ **Comprobación (en el paso 16):** en el panel, **Conexiones y sistema → Probar conexión** de WhatsApp dice
"Conectado: (nombre) +1 555…". Si dice "token no válido", el token se copió incompleto o caducó.

---

## Parte C — Claude (Anthropic)

### Paso 11. Crear una cuenta de Anthropic

1. Abre <https://platform.claude.com/> (la antigua `console.anthropic.com` redirige allí).
2. Pulsa **Sign up** y regístrate con tu correo o Google. Verifica tu correo.
3. Completa los datos de tu organización (nombre del negocio, uso previsto).
4. Ve a **Settings → Billing** (Facturación) y **añade créditos** con tu tarjeta (el uso de la API es prepago;
   la consola indica el importe mínimo). Sin créditos, Claude rechaza las solicitudes.
5. **Muy recomendado:** en **Settings → Limits** define un **límite de gasto mensual** (por ejemplo 20 USD).
   Es la protección definitiva contra gastos inesperados.

✅ **Comprobación:** en **Billing** ves tu saldo de créditos mayor que 0.

### Paso 12. Generar la API Key de Claude

1. En la consola, ve a **Settings → API keys** (Claves de API).
2. Pulsa **Create Key** (Crear clave). Nombre: `whatsapp-ia` → **Create**.
3. **Copia la clave** (empieza por `sk-ant-…`). Solo se muestra una vez. Si la pierdes, crea otra y borra la antigua.

> 🔒 La API Key solo se guarda en el servidor (en `.env` o cifrada desde el panel). El navegador nunca la recibe.

✅ **Comprobación (en el paso 16):** **Conexiones y sistema → Claude → Probar conexión** muestra "Conectado: Claude Opus 5.5".

---

## Parte D — Poner todo en marcha en tu PC

### Paso 13. Configurar las variables de entorno

Abre el archivo `.env` de la carpeta del proyecto con VS Code (`code .env`) o con el Bloc de notas (`notepad .env`).
Cada línea es `NOMBRE=valor`, **sin espacios ni comillas**.

| Variable | Qué poner |
|---|---|
| `DATABASE_URL` | La cadena de Neon del paso 4.1 |
| `ADMIN_EMAIL` | Tu correo (para entrar al panel) |
| `ADMIN_PASSWORD` | Una contraseña de **10+ caracteres con letras y números** |
| `ANTHROPIC_API_KEY` | La clave `sk-ant-…` del paso 12 (o déjala vacía y ponla luego en el panel) |
| `CLAUDE_MOCK` | `false` para usar Claude real · `true` solo para ver el panel sin API Key (respuestas simuladas) |
| `META_APP_ID`, `META_APP_SECRET` | Paso 10 |
| `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_PHONE_NUMBER_ID` | Paso 10 |
| `WHATSAPP_ACCESS_TOKEN` | Paso 10 |
| `WHATSAPP_VERIFY_TOKEN` | Ya generado; el mismo que pongas en Meta |
| `WHATSAPP_MODE` | `simulation` mientras pruebas sin enviar; `live` para responder de verdad |
| `PUBLIC_URL` | La URL pública si usas un túnel (p. ej. `https://xxx.trycloudflare.com`); en Render no hace falta |
| `ENCRYPTION_KEY`, `SESSION_SECRET` | Ya generados. **No los cambies después** |

Guarda el archivo (Ctrl+S).

> Los datos de Meta y Claude también se pueden escribir más tarde desde el panel (**Conexiones y sistema**).
> Allí se guardan **cifrados** y tienen prioridad sobre el `.env`.

✅ **Comprobación:** al arrancar (paso 14) no aparece el mensaje `❌ Configuración inválida`.

### Paso 14. Ejecutar el backend

En PowerShell, dentro de la carpeta del proyecto:

```bash
npm run dev
```

Este comando arranca **a la vez** el servidor (backend, puerto 3000) y el panel (puerto 5173).
Para arrancar solo el backend: `npm run dev:api`.

✅ **Qué deberías ver** (en azul, prefijo `[api]`):
- `Administrador inicial creado: tu@correo.com` (solo la primera vez)
- `Servidor listo en http://localhost:3000 — WhatsApp: modo SIMULACIÓN`
- `Claude: Conectado: Claude Opus 5.5` (o el error que corresponda)

Comprueba en el navegador <http://localhost:3000/api/health> → debe mostrar `{"ok":true,...}`.
Deja esta ventana abierta mientras uses el sistema (Ctrl+C para detenerlo).

### Paso 15. Ejecutar el panel (frontend)

Si usaste `npm run dev`, el panel ya está en marcha (prefijo `[panel]`). Si no, abre otra ventana de PowerShell y ejecuta `npm run dev:panel`.

1. Abre <http://localhost:5173>.
2. Entra con `ADMIN_EMAIL` y `ADMIN_PASSWORD`.

✅ **Qué deberías ver:** la página **Inicio** con las tarjetas WhatsApp, Claude, Servidor y Webhook.

### Paso 16. Probar la IA

**16.1 Personalizar la IA (2 minutos):**
1. **Configuración de la IA:** nombre del asistente, nombre y descripción del negocio, personalidad e instrucciones → **Guardar configuración**.
2. **Base de conocimientos:** añade tus preguntas frecuentes (horario, precios, envíos, pagos) o sube un PDF/TXT.
   Usa **Probar la búsqueda** para ver qué encontraría la IA.

**16.2 Probar sin WhatsApp (Simulador):**
1. Abre **Simulador** → escribe un nombre → **+**.
2. Escribe como si fueras un cliente: "Hola, me llamo Andrés y tengo una tienda de ropa".
3. Tras unos segundos aparece la respuesta de la IA. A la derecha verás los tokens y el costo de cada respuesta.
4. Envía 6 mensajes y mira cómo aparece "Se llama Andrés" en **Lo que sabe la IA** (memoria).
5. Pregunta "¿recuerdas cómo me llamo?" → debe responder con tu nombre.

✅ Si la respuesta empieza por `[Modo prueba]`, tienes `CLAUDE_MOCK=true`: cámbialo a `false` y reinicia (Ctrl+C y `npm run dev`).

**16.3 Probar con WhatsApp de verdad (número de prueba):**
1. Completa los datos de Meta (paso 10/13) y el webhook (paso 9).
2. En **Conexiones y sistema** pon **Modo de envío: Real** → **Guardar datos de WhatsApp** → **Probar conexión**.
3. Desde tu WhatsApp personal (el que autorizaste en el paso 8), **escribe al número de prueba**: "Hola".

✅ **Qué deberías ver:** en tu teléfono, el mensaje se marca como leído, aparece "escribiendo…" y llega la respuesta.
En el panel, **Conversaciones** muestra el chat con la etiqueta "IA" en la respuesta.

**16.4 Probar el control humano:** en la conversación, desactiva el interruptor **IA activa**, escribe tú una respuesta
desde el panel y envíala. Llega a tu WhatsApp. Escribe de nuevo desde el teléfono: la IA **no** responde
(el mensaje aparece en el panel como "Sin respuesta automática: IA pausada"). Reactívala y vuelve a escribir.

---

## Parte E — Producción

### Paso 17. Conectar un número real de WhatsApp

El número de prueba solo habla con 5 destinatarios autorizados. Para atender a cualquier cliente necesitas un número real.

**Requisitos del número:**
- Puede ser fijo o móvil, capaz de recibir un SMS o llamada para verificarlo.
- **No puede estar activo en la app de WhatsApp o WhatsApp Business.** Si lo usas allí, primero debes eliminar esa cuenta
  (en la app: **Ajustes → Cuenta → Eliminar cuenta**) o migrarlo. Lo más sencillo es usar un número nuevo.
  (Meta ofrece una modalidad de "coexistencia" con la app WhatsApp Business, pero requiere un flujo de alta de
  proveedor tecnológico que este proyecto no implementa.)

**Pasos:**
1. En el panel de la app → **WhatsApp → Configuración de la API** → **Agregar número de teléfono** (*Add phone number*)
   (o desde WhatsApp Manager: <https://business.facebook.com/wa/manage/phone-numbers/>).
2. Completa el **perfil**: nombre visible (debe coincidir con tu marca; Meta lo revisa), categoría y descripción.
3. Verifica el número con el **código por SMS o llamada**.
4. Registra el número en la Cloud API: en el panel de la IA → **Conexiones y sistema** → escribe el nuevo
   **Phone Number ID** → **Guardar** → **Registrar número (PIN)** → elige un **PIN de 6 dígitos** (es la verificación en dos pasos del número; guárdalo).
5. Pulsa **Suscribir app a la WABA**: hace que los mensajes de este número lleguen a tu webhook.
6. Si generaste el token permanente antes de tener este número, comprueba que el usuario del sistema tenga
   **control total** sobre la cuenta de WhatsApp (paso 10) y vuelve a **Probar conexión**.
7. **Publica la app** (modo *Live*): en el panel de la app de Meta, completa en **Configuración de la app → Básica**:
   - **URL de la Política de privacidad:** `https://TU-APP.onrender.com/privacy` (el sistema ya la incluye; revisa el texto).
   - **Instrucciones de eliminación de datos:** `https://TU-APP.onrender.com/data-deletion`.
   - Icono y categoría de la app.
   Luego pulsa **Publicar** (*Publish*) o cambia **Modo de la app** a **Activo** (*Live*). Meta puede no enviar
   algunos webhooks a apps en modo desarrollo.
8. Añade un **método de pago** en WhatsApp Manager si vas a enviar plantillas (mensajes iniciados por el negocio).
   Responder a clientes que te escriben primero no requiere plantillas (ver `docs/COSTOS.md`).

✅ **Comprobación:** desde **cualquier** WhatsApp escribe a tu número real: llega la respuesta de la IA y la conversación aparece en el panel.
Meta puede tardar desde minutos hasta 1–2 días en aprobar el nombre visible y, según tu cuenta, pedir la **verificación del negocio**.

### Paso 18. Desplegar para que funcione sin tu PC encendido

Usaremos **Render** (servidor) + **Neon** (base de datos). Ver costos en `docs/COSTOS.md`.

**18.1 Subir el código a GitHub** (si aún no está): el repositorio `saaqes/api-whatsapp` ya contiene el código en la rama
`claude/laughing-meitner-ye0tdf`. Fusiónala en `main` desde GitHub (**Pull requests → New pull request → Merge**) o despliega directamente esa rama.

**18.2 Crear el servicio en Render:**
1. Abre <https://dashboard.render.com/> y regístrate con **GitHub** (botón **GitHub**). Autoriza a Render a ver tu repositorio.
2. Pulsa **New +** → **Blueprint**.
3. Elige el repositorio `api-whatsapp` → **Connect**. Render detecta el archivo `render.yaml`.
4. Selecciona la **rama** donde está el código.
5. Render pide los valores marcados como secretos. Completa:
   - `DATABASE_URL`: la cadena **directa** de Neon (paso 4.1).
   - `ADMIN_EMAIL` y `ADMIN_PASSWORD`: tu usuario del panel en producción.
   - `ANTHROPIC_API_KEY`: tu clave `sk-ant-…`.
   - `META_APP_ID`, `META_APP_SECRET`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN` (permanente).
   - `ENCRYPTION_KEY`, `SESSION_SECRET` y `WHATSAPP_VERIFY_TOKEN` se generan solos.
6. Pulsa **Apply** (Aplicar). El primer despliegue tarda 3–6 minutos.

✅ **Qué deberías ver:** en **Logs**: `All migrations have been successfully applied.` y luego
`Servidor listo … WhatsApp: modo REAL`. Arriba aparece tu URL: `https://whatsapp-ai-xxxx.onrender.com`.

**18.3 Actualizar el webhook en Meta** con la URL de Render (paso 9):
- Callback URL: `https://whatsapp-ai-xxxx.onrender.com/webhooks/whatsapp`
- Verify token: Render → tu servicio → **Environment** → copia el valor de `WHATSAPP_VERIFY_TOKEN`.

> El plan **Starter** de Render funciona 24/7. El plan **Free** se "duerme" tras 15 minutos sin tráfico: el primer
> mensaje tras dormir tarda ~1 minuto en responderse. Para un negocio real usa Starter.

### Paso 19. Comprobar que todo funciona después del desplegar

1. Abre `https://TU-APP.onrender.com/api/health` → `{"ok":true,…}`.
2. Abre `https://TU-APP.onrender.com/api/health/ready` → `{"ok":true,"database":"ok"}`.
3. Entra al panel `https://TU-APP.onrender.com` con tu usuario de producción.
4. **Inicio:** las tarjetas **WhatsApp** y **Claude** muestran "Conectado". Pulsa **Probar** si dicen otra cosa.
5. Escribe a tu número desde un teléfono: en **Inicio → Webhook de Meta** "Último evento" pasa a "ahora" y llega la respuesta.
6. **Errores recientes** debe estar vacío. Revisa también **Estadísticas** al día siguiente.
7. **Monitoreo opcional (gratuito):** crea un monitor en <https://uptimerobot.com> que revise `https://TU-APP.onrender.com/api/health` cada 5 minutos y te avise por correo si cae.
8. **Copias de seguridad:** **Conexiones y sistema → Copias de seguridad → Descargar copia ahora** (hazlo semanalmente).
   Neon además conserva un historial para restaurar la base de datos a un momento anterior (ver tu plan en neon.com).

### Paso 20. Solución de errores comunes

Consulta **[docs/SOLUCION-DE-PROBLEMAS.md](SOLUCION-DE-PROBLEMAS.md)**: incluye los errores más frecuentes
(webhook que no verifica, token caducado, error 131030/131047, la IA no responde, PowerShell bloquea npm, etc.)
con su causa y su solución.

---

## Mantenimiento

| Tarea | Cómo |
|---|---|
| Actualizar el sistema | `git pull` y en Render se redespliega solo (o **Manual Deploy**) |
| Cambiar la personalidad o instrucciones | Panel → Configuración de la IA (sin redeploy) |
| Detener la IA de inmediato | Botón **IA activa** arriba a la derecha → Detener todo |
| Ver el gasto | Panel → Inicio / Estadísticas, y la consola de Anthropic |
| Crear más usuarios | Panel → Conexiones y sistema → Usuarios (roles Administrador o Agente) |
| Ejecutar las pruebas automáticas | `npm test` (necesita una base PostgreSQL de pruebas; ver README) |
