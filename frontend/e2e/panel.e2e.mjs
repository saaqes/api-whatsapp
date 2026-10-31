// Prueba de extremo a extremo del panel con un navegador real (Playwright + Chromium).
// Uso:  E2E_EMAIL=... E2E_PASSWORD=... npm run test:e2e
// Requiere el servidor en marcha (npm run build && npm start) y Playwright instalado
// (npm i -D playwright && npx playwright install chromium).
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require("playwright");
} catch {
  playwright = require(process.env.PLAYWRIGHT_PATH ?? "/opt/node-tools/node_modules/playwright");
}

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.E2E_EMAIL ?? "admin@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "ClaveSegura2026";
const OUT = process.env.E2E_OUT ?? path.resolve("test-results");
mkdirSync(OUT, { recursive: true });

const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
  console.log(`${cond ? "✔" : "✘"} ${msg}`);
};

const browser = await playwright.chromium.launch();

async function session(viewport, theme) {
  const context = await browser.newContext({ viewport, colorScheme: theme, locale: "es-ES" });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("response", (r) => {
    if (r.url().includes("/api/") && r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`);
  });
  return { context, page, errors };
}

async function login(page) {
  await page.goto(BASE);
  await page.getByLabel("Correo electrónico").fill(EMAIL);
  await page.getByLabel("Contraseña").fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.getByRole("heading", { name: "Inicio" }).waitFor({ timeout: 15000 });
}

// ─── Escritorio, tema claro: recorrido completo y acciones ───
{
  const { context, page, errors } = await session({ width: 1440, height: 900 }, "light");
  await page.goto(BASE);
  await page.getByLabel("Correo electrónico").fill(EMAIL);
  await page.getByLabel("Contraseña").fill("incorrecta-123");
  await page.getByRole("button", { name: "Entrar" }).click();
  check(
    await page.getByText("Correo o contraseña incorrectos").waitFor({ timeout: 5000 }).then(() => true, () => false),
    "login con contraseña incorrecta muestra error",
  );
  errors.length = 0; // el 401 de ese intento fallido es esperado
  await page.getByLabel("Contraseña").fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.getByRole("heading", { name: "Inicio" }).waitFor({ timeout: 15000 });
  check(true, "login correcto");
  await page.getByText("Mensajes de los últimos 7 días").waitFor();
  check(await page.locator(".recharts-surface").count() > 0, "el inicio dibuja el gráfico");
  await page.screenshot({ path: `${OUT}/01-inicio-claro.png`, fullPage: true });

  await page.getByRole("link", { name: /Conversaciones/ }).click();
  await page.getByText("Andrés Gómez").first().click();
  const bubble = (t) => page.locator("[data-msg-id]").filter({ hasText: t }).first();
  await bubble("¿Tienen precios para mayoristas?").waitFor();
  check(true, "la conversación muestra el historial");
  await page.getByPlaceholder("Escribe una respuesta…").fill("Hola Andrés, soy del equipo. Te ayudo con precios de mayoreo.");
  await page.getByRole("button", { name: "Enviar" }).click();
  await bubble("Hola Andrés, soy del equipo").waitFor({ timeout: 8000 });
  check(true, "respuesta manual enviada y visible");
  await page.getByRole("switch", { checked: false }).first().waitFor({ timeout: 8000 });
  check(true, "la IA se pausó automáticamente al responder manualmente");
  await page.screenshot({ path: `${OUT}/02-conversacion-claro.png` });
  await page.getByRole("switch").first().click();
  await page.getByRole("switch", { checked: true }).first().waitFor({ timeout: 8000 });
  check(true, "la IA se reactiva desde la conversación");

  await page.getByRole("link", { name: "Contactos" }).click();
  await page.getByRole("heading", { name: "Contactos" }).waitFor();
  await page.getByText("Carlos Ruiz").click();
  await page.getByText("Memoria de la IA").waitFor();
  await page.getByPlaceholder("Ej.: Prefiere que le hablen de usted").fill("Prefiere que le hablen de usted");
  await page.getByRole("button", { name: "Añadir" }).click();
  await page.getByText("Añadido por el equipo").first().waitFor();
  check(true, "se añade un recuerdo manual al contacto");
  await page.screenshot({ path: `${OUT}/03-contacto-claro.png`, fullPage: true });

  await page.getByRole("link", { name: "Base de conocimientos" }).click();
  await page.getByText("Envíos").first().waitFor();
  await page.getByPlaceholder("¿Cuánto cuesta el envío?").fill("cuanto cuesta el envio a cali");
  await page.getByRole("button", { name: "Buscar" }).click();
  await page.getByText("$12.000").first().waitFor();
  check(true, "la prueba de búsqueda encuentra el conocimiento");
  await page.getByRole("button", { name: "Nota", exact: true }).click();
  await page.getByPlaceholder("Ej.: Política de envíos").fill("Devoluciones");
  await page.locator("textarea").first().fill("Aceptamos devoluciones dentro de los 30 días con la factura.");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await page.getByText("Aceptamos devoluciones dentro").waitFor();
  check(true, "se crea una nota en la base de conocimientos");
  await page.screenshot({ path: `${OUT}/04-conocimiento-claro.png`, fullPage: true });

  await page.getByRole("link", { name: "Automatizaciones" }).click();
  await page.getByText("Pedir asesor").waitFor();
  await page.getByPlaceholder("Probar un mensaje de ejemplo…").fill("necesito un ASESOR");
  await page.getByRole("button", { name: "Probar" }).click();
  await page.getByText("Se activaría la regla «Pedir asesor»").waitFor();
  check(true, "el probador de reglas detecta la regla");
  await page.screenshot({ path: `${OUT}/05-automatizaciones-claro.png`, fullPage: true });

  await page.getByRole("link", { name: "Estadísticas" }).click();
  await page.getByText("Mensajes por día").waitFor();
  await page.getByRole("button", { name: "Ver tabla" }).click();
  await page.getByRole("columnheader", { name: "Recibidos" }).waitFor();
  check(true, "las estadísticas ofrecen vista de tabla");
  await page.getByRole("button", { name: "Ver gráficos" }).click();
  await page.screenshot({ path: `${OUT}/06-estadisticas-claro.png`, fullPage: true });

  await page.getByRole("link", { name: "Simulador" }).click();
  await page.getByRole("button", { name: "Cliente de prueba" }).click();
  await page.getByPlaceholder("Escribe como cliente…").fill("Me llamo Valentina");
  await page.getByRole("button", { name: "Enviar" }).click();
  await page.locator("[data-msg-id]").filter({ hasText: 'Recibí tu mensaje: "Me llamo Valentina"' }).waitFor({ timeout: 15000 });
  check(true, "el simulador obtiene respuesta de la IA");
  await page.screenshot({ path: `${OUT}/07-simulador-claro.png` });

  await page.getByRole("link", { name: "Configuración de la IA" }).click();
  await page.getByText("Temperatura: no disponible").waitFor();
  await page.getByRole("button", { name: "Ver prompt del sistema" }).click();
  await page.getByText("Eres Sofía, el asistente de Moda Andina").waitFor();
  check(true, "la vista previa del prompt refleja la configuración");
  await page.keyboard.press("Escape");
  await page.screenshot({ path: `${OUT}/08-ia-claro.png`, fullPage: true });

  await page.getByRole("link", { name: "Conexiones y sistema" }).click();
  await page.getByText("URL de devolución de llamada (webhook)").waitFor();
  const body = await page.content();
  check(!body.includes("test_app_secret_123"), "el App Secret no aparece en el navegador");
  await page.screenshot({ path: `${OUT}/09-sistema-claro.png`, fullPage: true });

  // Botón general
  await page.getByTitle("Botón general de respuestas automáticas").click();
  await page.getByRole("button", { name: "Detener todo" }).click();
  await page.getByText("Respuestas automáticas detenidas.").waitFor();
  check(true, "el botón general detiene las respuestas automáticas");
  await page.getByTitle("Botón general de respuestas automáticas").click();
  await page.getByText("Respuestas automáticas reactivadas").waitFor();

  check(errors.length === 0, `sin errores de consola en escritorio claro ${errors.length ? JSON.stringify(errors) : ""}`);
  await context.close();
}

// ─── Escritorio, tema oscuro ───
{
  const { context, page, errors } = await session({ width: 1440, height: 900 }, "dark");
  await login(page);
  check(await page.evaluate(() => document.documentElement.classList.contains("dark")), "el tema oscuro sigue la preferencia del sistema");
  await page.getByText("Mensajes de los últimos 7 días").waitFor();
  await page.screenshot({ path: `${OUT}/10-inicio-oscuro.png`, fullPage: true });
  await page.getByRole("link", { name: /Conversaciones/ }).click();
  await page.getByText("Laura Pérez").first().click();
  await page.locator("[data-msg-id]").filter({ hasText: "¿hacen envíos a Cali?" }).first().waitFor();
  await page.screenshot({ path: `${OUT}/11-conversacion-oscuro.png` });
  await page.getByRole("link", { name: "Estadísticas" }).click();
  await page.getByText("Mensajes por día").waitFor();
  await page.screenshot({ path: `${OUT}/12-estadisticas-oscuro.png`, fullPage: true });
  check(errors.length === 0, `sin errores de consola en tema oscuro ${errors.length ? JSON.stringify(errors) : ""}`);
  await context.close();
}

// ─── Móvil ───
{
  const { context, page, errors } = await session({ width: 390, height: 844 }, "light");
  await login(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check(!overflow, "sin desplazamiento horizontal en móvil (inicio)");
  await page.screenshot({ path: `${OUT}/13-inicio-movil.png`, fullPage: true });
  await page.getByRole("button", { name: "Abrir menú" }).click();
  await page.getByRole("link", { name: /Conversaciones/ }).click();
  await page.getByText("María López").first().click();
  await page.locator("[data-msg-id]").filter({ hasText: "¿Qué medios de pago aceptan?" }).first().waitFor();
  const overflow2 = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check(!overflow2, "sin desplazamiento horizontal en móvil (chat)");
  await page.screenshot({ path: `${OUT}/14-chat-movil.png` });
  check(errors.length === 0, `sin errores de consola en móvil ${errors.length ? JSON.stringify(errors) : ""}`);
  await context.close();
}

await browser.close();
if (failures.length) {
  console.error(`\n${failures.length} comprobación(es) fallida(s)`);
  process.exit(1);
}
console.log(`\nTodas las comprobaciones pasaron. Capturas en ${OUT}`);
