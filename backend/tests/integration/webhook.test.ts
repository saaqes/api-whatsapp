import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { prisma } from "../../src/database/prisma.js";
import { updateSection } from "../../src/services/settings.service.js";
import { drain, postWebhook, resetDb, statusWebhook, textWebhook, useMockClaude } from "../helpers.js";

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

describe("verificación del webhook (GET)", () => {
  it("devuelve el challenge con el Verify Token correcto", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-test-token&hub.challenge=12345",
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("12345");
  });

  it("rechaza un Verify Token incorrecto", async () => {
    const res = await app.inject({ method: "GET", url: "/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=otro&hub.challenge=1" });
    expect(res.statusCode).toBe(403);
    expect(await prisma.errorLog.count({ where: { source: "WEBHOOK" } })).toBe(1);
  });
});

describe("recepción de mensajes (POST)", () => {
  it("rechaza firmas inválidas o ausentes", async () => {
    const body = JSON.stringify(textWebhook("573001", "hola"));
    const noSig = await app.inject({ method: "POST", url: "/webhooks/whatsapp", headers: { "content-type": "application/json" }, payload: body });
    expect(noSig.statusCode).toBe(401);
    const bad = await postWebhook(app, textWebhook("573001", "hola"), "secreto_equivocado");
    expect(bad.statusCode).toBe(401);
    expect(await prisma.message.count()).toBe(0);
  });

  it("guarda el mensaje, crea el contacto y responde una sola vez aunque Meta reenvíe el webhook", async () => {
    const payload = textWebhook("573001112233", "Hola!", { id: "wamid.DUP", name: "Andrés" });
    const r1 = await postWebhook(app, payload);
    const r2 = await postWebhook(app, payload);
    const r3 = await postWebhook(app, payload);
    expect([r1.statusCode, r2.statusCode, r3.statusCode]).toEqual([200, 200, 200]);
    await drain();
    const contact = await prisma.contact.findUniqueOrThrow({ where: { waId: "573001112233" } });
    expect(contact.profileName).toBe("Andrés");
    expect(await prisma.message.count({ where: { direction: "INBOUND" } })).toBe(1);
    expect(await prisma.message.count({ where: { direction: "OUTBOUND", author: "AI" } })).toBe(1);
  });

  it("ignora webhooks de otro número de teléfono", async () => {
    await updateSection("whatsapp", { phoneNumberId: "PNID" });
    await postWebhook(app, textWebhook("573001", "hola", { phoneNumberId: "OTRO" }));
    expect(await prisma.message.count()).toBe(0);
    await postWebhook(app, textWebhook("573001", "hola", { phoneNumberId: "PNID" }));
    expect(await prisma.message.count()).toBe(1);
  });

  it("no responde automáticamente mensajes reentregados con horas de retraso", async () => {
    await postWebhook(app, textWebhook("573001", "viejo", { ts: Math.floor(Date.now() / 1000) - 13 * 3600 }));
    await drain();
    const m = await prisma.message.findFirstOrThrow({ where: { direction: "INBOUND" } });
    expect(m.replyState).toBe("SKIPPED");
    expect(await prisma.message.count({ where: { direction: "OUTBOUND" } })).toBe(0);
  });

  it("actualiza estados sin retroceder y registra fallos", async () => {
    const contact = await prisma.contact.create({ data: { waId: "57300" } });
    await prisma.message.create({
      data: { contactId: contact.id, direction: "OUTBOUND", author: "AI", text: "x", status: "SENT", waMessageId: "wamid.OUT1" },
    });
    await postWebhook(app, statusWebhook("wamid.OUT1", "read"));
    await postWebhook(app, statusWebhook("wamid.OUT1", "delivered", { pricing: { billable: false, category: "service" } }));
    let m = await prisma.message.findUniqueOrThrow({ where: { waMessageId: "wamid.OUT1" } });
    expect(m.status).toBe("READ");
    expect(m.pricingCategory).toBe("service");

    await prisma.message.create({
      data: { contactId: contact.id, direction: "OUTBOUND", author: "AI", text: "y", status: "SENT", waMessageId: "wamid.OUT2" },
    });
    await postWebhook(app, statusWebhook("wamid.OUT2", "failed", { errors: [{ code: 131047, title: "Re-engagement message" }] }));
    m = await prisma.message.findUniqueOrThrow({ where: { waMessageId: "wamid.OUT2" } });
    expect(m.status).toBe("FAILED");
    expect(m.errorMessage).toContain("24 horas");
    expect(await prisma.errorLog.count({ where: { source: "WHATSAPP" } })).toBe(1);
  });

  it("responde 400 a JSON inválido", async () => {
    const raw = "{no es json";
    const { signMetaPayload } = await import("../../src/utils/crypto.js");
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/whatsapp",
      headers: { "content-type": "application/json", "x-hub-signature-256": signMetaPayload(raw, "test_app_secret") },
      payload: raw,
    });
    expect(res.statusCode).toBe(400);
  });
});
