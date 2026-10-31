import type { FastifyInstance, FastifyRequest } from "fastify";
import { getWhatsAppConfig } from "../services/settings.service.js";
import { verifyMetaSignature, safeEqual } from "../utils/crypto.js";
import { parseWebhook } from "../whatsapp/webhook-parser.js";
import { handleInbound, handleStatus } from "../pipeline/inbound.js";
import { logError } from "../services/errorlog.service.js";
import { isProduction } from "../config/env.js";

/** Estado en memoria para mostrar en el panel ("último webhook recibido"). */
export const webhookStats = {
  lastReceivedAt: null as Date | null,
  lastVerifiedAt: null as Date | null,
  lastSignatureFailureAt: null as Date | null,
  lastIgnoredPhoneNumberId: null as string | null,
  received: 0,
};

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

/**
 * Webhook de WhatsApp Cloud API.
 *  GET  /webhooks/whatsapp → verificación (hub.challenge)
 *  POST /webhooks/whatsapp → mensajes y estados, con firma X-Hub-Signature-256
 */
export async function whatsappWebhookRoutes(app: FastifyInstance) {
  // En este contexto el cuerpo JSON se conserva en bruto: la firma se calcula sobre los bytes exactos.
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "buffer", bodyLimit: 2 * 1024 * 1024 }, (req, body, done) => {
    (req as FastifyRequest).rawBody = body as Buffer;
    try {
      done(null, JSON.parse((body as Buffer).toString("utf8")));
    } catch {
      const err = new Error("JSON no válido") as Error & { statusCode: number };
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  app.get("/webhooks/whatsapp", async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const cfg = await getWhatsAppConfig();
    const mode = q["hub.mode"];
    const token = q["hub.verify_token"] ?? "";
    const challenge = q["hub.challenge"] ?? "";
    if (mode === "subscribe" && cfg.verifyToken && safeEqual(token, cfg.verifyToken)) {
      webhookStats.lastVerifiedAt = new Date();
      return reply.type("text/plain").send(challenge);
    }
    await logError(
      "WEBHOOK",
      cfg.verifyToken ? "Verificación del webhook rechazada: el Verify Token no coincide" : "Verificación del webhook rechazada: falta configurar el Verify Token",
      { mode },
      null,
      "warn",
    );
    return reply.code(403).send("Forbidden");
  });

  app.post("/webhooks/whatsapp", async (req, reply) => {
    const cfg = await getWhatsAppConfig();
    const raw = req.rawBody ?? Buffer.from("");
    const signature = req.headers["x-hub-signature-256"] as string | undefined;

    if (cfg.appSecret) {
      if (!verifyMetaSignature(raw, signature, cfg.appSecret)) {
        webhookStats.lastSignatureFailureAt = new Date();
        await logError("WEBHOOK", "Firma del webhook no válida: revisa que el App Secret sea el de tu app de Meta", {}, null, "warn");
        return reply.code(401).send({ error: "invalid_signature" });
      }
    } else if (isProduction || cfg.mode === "live") {
      // Sin App Secret no se puede comprobar que el webhook venga de Meta: en producción
      // o en modo real se rechaza (solo se tolera en desarrollo con modo simulación).
      await logError("WEBHOOK", "Webhook rechazado: configura el App Secret de Meta para validar las firmas", {});
      return reply.code(401).send({ error: "app_secret_not_configured" });
    }

    webhookStats.lastReceivedAt = new Date();
    webhookStats.received++;
    const parsed = parseWebhook(req.body);
    try {
      for (const m of parsed.messages) {
        if (cfg.phoneNumberId && m.phoneNumberId !== cfg.phoneNumberId) {
          // Webhooks de otro número (o el botón "Probar" de Meta): se ignoran.
          webhookStats.lastIgnoredPhoneNumberId = m.phoneNumberId;
          continue;
        }
        await handleInbound(m);
      }
      for (const s of parsed.statuses) {
        if (cfg.phoneNumberId && s.phoneNumberId !== cfg.phoneNumberId) continue;
        await handleStatus(s);
      }
      for (const e of parsed.errors) {
        await logError("WEBHOOK", `Meta informó un error: ${e.title ?? e.message ?? "desconocido"}`, e as Record<string, unknown>);
      }
    } catch (err) {
      // 500 → Meta reintentará la entrega; los duplicados se descartan por waMessageId.
      await logError("WEBHOOK", err, { step: "process" });
      return reply.code(500).send({ error: "processing_failed" });
    }
    return reply.send({ ok: true });
  });
}
