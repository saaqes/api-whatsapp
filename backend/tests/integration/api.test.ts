import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { prisma } from "../../src/database/prisma.js";
import { createUser } from "../../src/services/auth.service.js";
import { getSecret } from "../../src/services/settings.service.js";
import { loginAs, randomIp, resetDb, useMockClaude } from "../helpers.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await resetDb();
  useMockClaude();
});

describe("autenticación y sesiones", () => {
  it("exige sesión en la API del panel", async () => {
    for (const url of ["/api/dashboard", "/api/conversations", "/api/contacts", "/api/settings", "/api/knowledge"]) {
      expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
    }
  });

  it("emite cookie segura, firmada, httpOnly y SameSite=Strict", async () => {
    await createUser({ email: "a@test.com", name: "A", password: "ClaveSegura2026", role: "OWNER" });
    const res = await app.inject({ method: "POST", url: "/api/auth/login", remoteAddress: randomIp(), payload: { email: "A@test.com", password: "ClaveSegura2026" } });
    expect(res.statusCode).toBe(200);
    const c = res.cookies.find((x) => x.name === "wa_ai_session")!;
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe("Strict");
    // El token guardado en la base de datos es un hash, no el valor de la cookie
    const session = await prisma.session.findFirstOrThrow();
    expect(c.value).not.toContain(session.tokenHash);
    const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: `wa_ai_session=${c.value}` } });
    expect(me.json().user.email).toBe("a@test.com");
    expect(JSON.stringify(me.json())).not.toContain("passwordHash");
  });

  it("rechaza cookies manipuladas y cierra sesión", async () => {
    const { cookie } = await loginAs(app);
    const tampered = cookie.slice(0, -3) + "abc";
    expect((await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: tampered } })).statusCode).toBe(401);
    await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie } });
    expect((await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } })).statusCode).toBe(401);
  });

  it("bloquea la cuenta tras 5 intentos fallidos", async () => {
    await createUser({ email: "b@test.com", name: "B", password: "ClaveSegura2026", role: "OWNER" });
    for (let i = 0; i < 5; i++) {
      const r = await app.inject({ method: "POST", url: "/api/auth/login", remoteAddress: randomIp(), payload: { email: "b@test.com", password: "incorrecta1" } });
      expect(r.statusCode).toBe(401);
    }
    // Aunque el atacante cambie de IP, la cuenta queda bloqueada temporalmente.
    const locked = await app.inject({ method: "POST", url: "/api/auth/login", remoteAddress: randomIp(), payload: { email: "b@test.com", password: "ClaveSegura2026" } });
    expect(locked.statusCode).toBe(429);
  });

  it("limita los intentos de inicio de sesión por IP", async () => {
    const ip = randomIp();
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) {
      const r = await app.inject({ method: "POST", url: "/api/auth/login", remoteAddress: ip, payload: { email: `x${i}@test.com`, password: "incorrecta1" } });
      codes.push(r.statusCode);
    }
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes[10]).toBe(429);
  });

  it("bloquea peticiones de otro origen (CSRF)", async () => {
    const { cookie } = await loginAs(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/settings/assistant",
      headers: { cookie, origin: "https://atacante.example", "sec-fetch-site": "cross-site" },
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(403);
  });

  it("aplica control de acceso por rol", async () => {
    const agent = await loginAs(app, "AGENT");
    expect((await app.inject({ method: "GET", url: "/api/settings", headers: { cookie: agent.cookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/knowledge", headers: { cookie: agent.cookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/users", headers: { cookie: agent.cookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/conversations", headers: { cookie: agent.cookie } })).statusCode).toBe(200);
    const admin = await loginAs(app, "ADMIN");
    const r = await app.inject({
      method: "PUT",
      url: "/api/settings/secrets/anthropic_api_key",
      headers: { cookie: admin.cookie },
      payload: { value: "sk-ant-xxxxxxxx" },
    });
    expect(r.statusCode).toBe(403); // solo el propietario gestiona credenciales
  });
});

describe("configuración y credenciales", () => {
  it("guarda credenciales cifradas y nunca las devuelve al navegador", async () => {
    const { cookie } = await loginAs(app);
    const key = "sk-ant-api03-SUPERSECRETO-1234";
    const put = await app.inject({ method: "PUT", url: "/api/settings/secrets/anthropic_api_key", headers: { cookie }, payload: { value: key } });
    expect(put.statusCode).toBe(200);
    const row = await prisma.secret.findUniqueOrThrow({ where: { key: "anthropic_api_key" } });
    expect(row.ciphertext).not.toContain("SUPERSECRETO");
    expect(await getSecret("anthropic_api_key")).toBe(key);
    const res = await app.inject({ method: "GET", url: "/api/settings", headers: { cookie } });
    expect(res.body).not.toContain("SUPERSECRETO");
    const s = res.json().secrets.find((x: any) => x.key === "anthropic_api_key");
    expect(s).toMatchObject({ configured: true, source: "panel" });
    expect(s.hint).toMatch(/…1234$/);
    expect(res.json().temperatureSupported).toBe(false);
  });

  it("valida la configuración de la IA", async () => {
    const { cookie } = await loginAs(app);
    const bad = await app.inject({ method: "PUT", url: "/api/settings/ai", headers: { cookie }, payload: { maxTokens: 5 } });
    expect(bad.statusCode).toBe(400);
    const badTz = await app.inject({ method: "PUT", url: "/api/settings/general", headers: { cookie }, payload: { timezone: "Marte/Olimpo" } });
    expect(badTz.statusCode).toBe(400);
    const ok = await app.inject({ method: "PUT", url: "/api/settings/ai", headers: { cookie }, payload: { assistantName: "Lucía", effort: "medium" } });
    expect(ok.json()).toMatchObject({ assistantName: "Lucía", effort: "medium", model: "claude-opus-5-5" });
    const preview = await app.inject({ method: "GET", url: "/api/settings/prompt-preview", headers: { cookie } });
    expect(preview.json().prompt).toContain("Eres Lucía");
  });

  it("rechaza una API Key con formato incorrecto", async () => {
    const { cookie } = await loginAs(app);
    const r = await app.inject({ method: "PUT", url: "/api/settings/secrets/anthropic_api_key", headers: { cookie }, payload: { value: "hola mundo" } });
    expect(r.statusCode).toBe(400);
  });
});

describe("conversaciones y contactos", () => {
  it("no permite mensajes libres fuera de la ventana de 24 h", async () => {
    const { cookie } = await loginAs(app);
    const c = await prisma.contact.create({ data: { waId: "57300", lastInboundAt: new Date(Date.now() - 25 * 3600_000), lastMessageAt: new Date() } });
    const r = await app.inject({ method: "POST", url: `/api/conversations/${c.id}/messages`, headers: { cookie }, payload: { text: "hola" } });
    expect(r.statusCode).toBe(400);
    expect(r.json().message).toContain("plantilla");
    const list = await app.inject({ method: "GET", url: "/api/conversations", headers: { cookie } });
    expect(list.json().items[0].windowOpen).toBe(false);
  });

  it("busca conversaciones por nombre, número o texto de mensajes", async () => {
    const { cookie } = await loginAs(app);
    const a = await prisma.contact.create({ data: { waId: "573001", profileName: "Andrés", lastMessageAt: new Date() } });
    const b = await prisma.contact.create({ data: { waId: "573002", profileName: "Laura", lastMessageAt: new Date() } });
    await prisma.message.create({ data: { contactId: b.id, direction: "INBOUND", author: "CONTACT", text: "quiero zapatos rojos", status: "RECEIVED" } });
    const q = async (s: string) =>
      (await app.inject({ method: "GET", url: `/api/conversations?search=${encodeURIComponent(s)}`, headers: { cookie } })).json().items.map((i: any) => i.id);
    expect(await q("andrés")).toEqual([a.id]);
    expect(await q("573002")).toEqual([b.id]);
    expect(await q("ZAPATOS")).toEqual([b.id]);
  });

  it("gestiona recuerdos solo dentro del contacto indicado", async () => {
    const { cookie } = await loginAs(app);
    const a = await prisma.contact.create({ data: { waId: "A" } });
    const b = await prisma.contact.create({ data: { waId: "B" } });
    const created = await app.inject({ method: "POST", url: `/api/contacts/${a.id}/memories`, headers: { cookie }, payload: { content: "Prefiere el color azul", category: "PREFERENCE" } });
    const mem = created.json();
    expect(mem.source).toBe("MANUAL");
    // Intentar editarlo o borrarlo "a través" de otro contacto no funciona
    expect((await app.inject({ method: "PATCH", url: `/api/contacts/${b.id}/memories/${mem.id}`, headers: { cookie }, payload: { content: "x" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `/api/contacts/${b.id}/memories/${mem.id}`, headers: { cookie } })).statusCode).toBe(404);
    expect((await app.inject({ method: "PATCH", url: `/api/contacts/${a.id}/memories/${mem.id}`, headers: { cookie }, payload: { content: "Prefiere el verde" } })).json().content).toBe("Prefiere el verde");
    expect((await app.inject({ method: "DELETE", url: `/api/contacts/${a.id}/memories/${mem.id}`, headers: { cookie } })).statusCode).toBe(200);
  });

  it("bloquear un contacto y eliminar todos sus datos", async () => {
    const { cookie } = await loginAs(app);
    const c = await prisma.contact.create({ data: { waId: "573001" } });
    await prisma.message.create({ data: { contactId: c.id, direction: "INBOUND", author: "CONTACT", text: "hola", status: "RECEIVED", replyState: "PENDING" } });
    await app.inject({ method: "PATCH", url: `/api/contacts/${c.id}`, headers: { cookie }, payload: { blocked: true, tags: ["spam", "spam"] } });
    const after = await prisma.contact.findUniqueOrThrow({ where: { id: c.id } });
    expect(after.blocked).toBe(true);
    expect(after.tags).toEqual(["spam"]);
    expect((await prisma.message.findFirstOrThrow()).replyState).toBe("SKIPPED");
    expect((await app.inject({ method: "DELETE", url: `/api/contacts/${c.id}`, headers: { cookie } })).statusCode).toBe(200);
    expect(await prisma.message.count()).toBe(0);
  });
});

describe("base de conocimientos", () => {
  it("crea, busca, edita y elimina documentos", async () => {
    const { cookie } = await loginAs(app);
    const faq = await app.inject({
      method: "POST",
      url: "/api/knowledge",
      headers: { cookie },
      payload: { title: "Devoluciones", kind: "FAQ", question: "¿Puedo devolver un producto?", answer: "Sí, tienes 30 días con la factura." },
    });
    expect(faq.statusCode).toBe(200);
    const search = async (q: string) =>
      (await app.inject({ method: "GET", url: `/api/knowledge-search?q=${encodeURIComponent(q)}`, headers: { cookie } })).json().results;
    expect((await search("devolución de productos"))[0].content).toContain("30 días");
    await app.inject({ method: "PATCH", url: `/api/knowledge/${faq.json().id}`, headers: { cookie }, payload: { answer: "Sí, tienes 15 días." } });
    expect((await search("devolver"))[0].content).toContain("15 días");
    await app.inject({ method: "PATCH", url: `/api/knowledge/${faq.json().id}`, headers: { cookie }, payload: { enabled: false } });
    expect(await search("devolver")).toHaveLength(0);
    await app.inject({ method: "DELETE", url: `/api/knowledge/${faq.json().id}`, headers: { cookie } });
    expect(await prisma.knowledgeChunk.count()).toBe(0);
  });

  it("sube archivos TXT y rechaza formatos no admitidos", async () => {
    const { cookie } = await loginAs(app);
    const multipart = (filename: string, type: string, content: string) => {
      const boundary = "----test" + Math.random().toString(16).slice(2);
      const body =
        `--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\nCatálogo\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n${content}\r\n--${boundary}--\r\n`;
      return { payload: body, headers: { cookie, "content-type": `multipart/form-data; boundary=${boundary}` } };
    };
    const ok = await app.inject({ method: "POST", url: "/api/knowledge/upload", ...multipart("catalogo.txt", "text/plain", "Camiseta básica: $25.000. Jean clásico: $80.000.") });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ title: "Catálogo", kind: "FILE", fileName: "catalogo.txt" });
    const bad = await app.inject({ method: "POST", url: "/api/knowledge/upload", ...multipart("virus.exe", "application/octet-stream", "MZ") });
    expect(bad.statusCode).toBe(400);
  });

  it("extrae texto de PDFs", async () => {
    const { extractFileText } = await import("../../src/knowledge/knowledge.service.js");
    // PDF mínimo válido con el texto "Envios gratis desde 100000 pesos"
    const pdf = buildTinyPdf("Envios gratis desde 100000 pesos");
    const text = await extractFileText(pdf, "application/pdf", "politicas.pdf");
    expect(text).toContain("Envios gratis desde 100000 pesos");
  });
});

describe("sistema", () => {
  it("exporta copias de seguridad sin credenciales ni contraseñas", async () => {
    const { cookie } = await loginAs(app);
    await app.inject({ method: "PUT", url: "/api/settings/secrets/whatsapp_access_token", headers: { cookie }, payload: { value: "EAASECRETO123456" } });
    await prisma.contact.create({ data: { waId: "573001", profileName: "Andrés" } });
    const res = await app.inject({ method: "GET", url: "/api/system/backup", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.body).toContain("Andrés");
    expect(res.body).not.toContain("EAASECRETO");
    expect(res.body).not.toContain("scrypt$");
  });

  it("el panel informa el estado del sistema", async () => {
    const { cookie } = await loginAs(app);
    const res = await app.inject({ method: "GET", url: "/api/dashboard", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const d = res.json();
    expect(d).toHaveProperty("today.inbound");
    expect(d.whatsappMode).toBe("simulation");
    expect(d.week).toHaveLength(7);
    const stats = await app.inject({ method: "GET", url: "/api/stats?days=30", headers: { cookie } });
    expect(stats.json().series).toHaveLength(30);
  });

  it("sirve la política de privacidad pública y aplica cabeceras de seguridad", async () => {
    const res = await app.inject({ method: "GET", url: "/privacy" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Política de privacidad");
    expect(res.headers["x-frame-options"]).toBeDefined();
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });
});

/** Genera un PDF de una página con un texto (para probar la extracción sin archivos externos). */
function buildTinyPdf(text: string): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

describe("seguridad adicional", () => {
  it("los archivos de clientes nunca se sirven como HTML ejecutable en el panel", async () => {
    const { liveMode, fakeMeta } = await import("../helpers.js");
    await liveMode();
    fakeMeta((c) => {
      if (c.url.endsWith("/EVIL")) return { json: { id: "EVIL", url: "https://lookaside.fbsbx.com/evil", mime_type: "text/html" } };
      if (c.url.endsWith("/SVG")) return { json: { id: "SVG", url: "https://lookaside.fbsbx.com/svg", mime_type: "image/svg+xml" } };
      if (c.url.endsWith("/IMG")) return { json: { id: "IMG", url: "https://lookaside.fbsbx.com/img", mime_type: "image/jpeg" } };
      if (c.url.startsWith("https://lookaside")) return { body: Buffer.from("<script>alert(1)</script>"), contentType: "text/html" };
      return undefined;
    });
    const { cookie } = await loginAs(app);
    const contact = await prisma.contact.create({ data: { waId: "573001" } });
    const mk = (mediaId: string, type: "DOCUMENT" | "IMAGE") =>
      prisma.message.create({ data: { contactId: contact.id, direction: "INBOUND", author: "CONTACT", type, mediaId, status: "RECEIVED", mediaFilename: "x.html" } });
    for (const [id, type] of [["EVIL", "DOCUMENT"], ["SVG", "IMAGE"]] as const) {
      const m = await mk(id, type);
      const res = await app.inject({ method: "GET", url: `/api/media/${m.id}`, headers: { cookie } });
      expect(res.headers["content-type"]).toBe("application/octet-stream");
      expect(res.headers["content-disposition"]).toMatch(/^attachment/);
      expect(res.headers["content-security-policy"]).toContain("sandbox");
    }
    const img = await mk("IMG", "IMAGE");
    const ok = await app.inject({ method: "GET", url: `/api/media/${img.id}`, headers: { cookie } });
    expect(ok.headers["content-type"]).toBe("image/jpeg");
    expect(ok.headers["content-disposition"]).toMatch(/^inline/);
    expect(ok.headers["content-security-policy"]).toContain("sandbox");
  });

  it("en modo real exige la firma aunque falte el App Secret", async () => {
    const { liveMode, textWebhook } = await import("../helpers.js");
    await liveMode();
    const { env } = await import("../../src/config/env.js");
    const { clearSecretCache } = await import("../../src/services/settings.service.js");
    const prev = env.META_APP_SECRET;
    (env as { META_APP_SECRET?: string }).META_APP_SECRET = "";
    clearSecretCache();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/webhooks/whatsapp",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify(textWebhook("573001", "hola")),
      });
      expect(res.statusCode).toBe(401);
      expect(await prisma.message.count()).toBe(0);
    } finally {
      (env as { META_APP_SECRET?: string }).META_APP_SECRET = prev;
      clearSecretCache();
    }
  });

  it("cambiar la contraseña cierra las otras sesiones", async () => {
    await createUser({ email: "c@test.com", name: "C", password: "ClaveSegura2026", role: "OWNER" });
    const login = async () => {
      const r = await app.inject({ method: "POST", url: "/api/auth/login", remoteAddress: randomIp(), payload: { email: "c@test.com", password: "ClaveSegura2026" } });
      const c = r.cookies.find((x) => x.name === "wa_ai_session")!;
      return `wa_ai_session=${c.value}`;
    };
    const a = await login();
    const b = await login();
    const r = await app.inject({ method: "POST", url: "/api/auth/password", headers: { cookie: a }, payload: { current: "ClaveSegura2026", next: "NuevaClave2027" } });
    expect(r.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: a } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: b } })).statusCode).toBe(401);
  });

  it("el sondeo de sesión no devuelve 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/auth/session" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ user: null });
  });
});
