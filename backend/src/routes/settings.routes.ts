import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  SECRET_KEYS,
  SECTION_NAMES,
  deleteSecret,
  getAllSettings,
  getSection,
  secretsStatus,
  setSecret,
  updateSection,
  type SectionName,
  type SecretKey,
} from "../services/settings.service.js";
import { MODELS } from "../ai/models.js";
import { buildStableSystemPrompt } from "../ai/prompt.js";
import { env } from "../config/env.js";
import { getClaude } from "../ai/claude.js";
import { badRequest } from "../utils/errors.js";

export function publicBaseUrl(reqHost?: string, proto = "https"): string {
  if (env.PUBLIC_URL) return env.PUBLIC_URL.replace(/\/$/, "");
  return reqHost ? `${proto}://${reqHost}` : "";
}

export async function settingsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get("/api/settings", { preHandler: requireRole("OWNER", "ADMIN") }, async (req) => {
    const base = publicBaseUrl(req.headers.host, req.protocol);
    return {
      settings: await getAllSettings(),
      secrets: await secretsStatus(),
      models: MODELS,
      webhookUrl: base ? `${base}/webhooks/whatsapp` : null,
      privacyUrl: base ? `${base}/privacy` : null,
      env: {
        whatsappMode: env.WHATSAPP_MODE,
        graphVersion: env.WHATSAPP_GRAPH_VERSION,
        appIdFromEnv: Boolean(env.META_APP_ID),
        wabaIdFromEnv: Boolean(env.WHATSAPP_BUSINESS_ACCOUNT_ID),
        phoneNumberIdFromEnv: Boolean(env.WHATSAPP_PHONE_NUMBER_ID),
        claudeMock: getClaude().mock,
      },
      // La temperatura no se puede enviar: la versión actual de la API de Anthropic (2026-10-21)
      // rechaza `temperature` en todos los modelos. El "esfuerzo" es el control disponible.
      temperatureSupported: false,
    };
  });

  app.put("/api/settings/:section", { preHandler: requireRole("OWNER", "ADMIN") }, async (req) => {
    const { section } = z.object({ section: z.enum(SECTION_NAMES as [SectionName, ...SectionName[]]) }).parse(req.params);
    return updateSection(section, req.body);
  });

  // Botón general para detener / reanudar TODAS las respuestas automáticas (cualquier rol).
  app.post("/api/settings/assistant", async (req) => {
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    const general = await updateSection("general", { assistantEnabled: enabled });
    return { assistantEnabled: general.assistantEnabled };
  });

  app.get("/api/settings/assistant", async () => {
    const general = await getSection("general");
    return { assistantEnabled: general.assistantEnabled, claudeMock: getClaude().mock };
  });

  // Las credenciales solo se pueden escribir o borrar; nunca leer desde el navegador.
  app.put("/api/settings/secrets/:key", { preHandler: requireRole("OWNER") }, async (req) => {
    const { key } = z.object({ key: z.enum(Object.keys(SECRET_KEYS) as [SecretKey, ...SecretKey[]]) }).parse(req.params);
    const { value } = z.object({ value: z.string().trim().min(4).max(4000) }).parse(req.body);
    if (/\s/.test(value)) throw badRequest("La credencial no debe contener espacios ni saltos de línea.");
    if (key === "anthropic_api_key" && !value.startsWith("sk-ant-")) {
      throw badRequest("Una API Key de Anthropic empieza por «sk-ant-». Revisa que la copiaste completa.");
    }
    await setSecret(key, value);
    return { ok: true, secrets: await secretsStatus() };
  });

  app.delete("/api/settings/secrets/:key", { preHandler: requireRole("OWNER") }, async (req) => {
    const { key } = z.object({ key: z.enum(Object.keys(SECRET_KEYS) as [SecretKey, ...SecretKey[]]) }).parse(req.params);
    await deleteSecret(key);
    return { ok: true, secrets: await secretsStatus() };
  });

  app.get("/api/settings/prompt-preview", { preHandler: requireRole("OWNER", "ADMIN") }, async () => {
    const ai = await getSection("ai");
    return {
      prompt: buildStableSystemPrompt(ai, {
        knowledgeTool: ai.knowledgeEnabled && ai.toolKnowledgeSearch,
        handoffTool: ai.toolHandoff,
      }),
    };
  });
}
