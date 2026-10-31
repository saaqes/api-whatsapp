import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../database/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { badRequest, notFound } from "../utils/errors.js";
import { ruleMatches } from "../automations/automation.service.js";

const IdParams = z.object({ id: z.string().min(1).max(40) });

const RuleBody = z.object({
  name: z.string().trim().min(1).max(100),
  enabled: z.boolean().default(true),
  priority: z.number().int().min(0).max(10000).default(100),
  matchType: z.enum(["CONTAINS", "EXACT", "STARTS_WITH", "ANY_MESSAGE"]).default("CONTAINS"),
  keywords: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  replyText: z.string().trim().max(4096).nullable().default(null),
  addTags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  handoff: z.boolean().default(false),
  stopAi: z.boolean().default(false),
  cooldownMinutes: z.number().int().min(0).max(100000).default(0),
});

function validateRule(r: z.infer<typeof RuleBody>) {
  if (r.matchType !== "ANY_MESSAGE" && r.keywords.length === 0) throw badRequest("Agrega al menos una palabra clave.");
  if (!r.replyText && !r.handoff && !r.stopAi && r.addTags.length === 0) {
    throw badRequest("La regla no hace nada: define una respuesta, una etiqueta, derivar a una persona o detener la IA.");
  }
}

export async function automationsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);
  app.addHook("preHandler", requireRole("OWNER", "ADMIN"));

  app.get("/api/automations/rules", async () => {
    return { items: await prisma.automationRule.findMany({ orderBy: [{ priority: "asc" }, { createdAt: "asc" }] }) };
  });

  app.post("/api/automations/rules", async (req) => {
    const body = RuleBody.parse(req.body);
    validateRule(body);
    return prisma.automationRule.create({ data: body });
  });

  app.put("/api/automations/rules/:id", async (req) => {
    const { id } = IdParams.parse(req.params);
    const body = RuleBody.parse(req.body);
    validateRule(body);
    return prisma.automationRule.update({ where: { id }, data: body }).catch(() => {
      throw notFound("Regla no encontrada");
    });
  });

  app.delete("/api/automations/rules/:id", async (req) => {
    const { id } = IdParams.parse(req.params);
    await prisma.automationHit.deleteMany({ where: { ruleId: id } });
    await prisma.automationRule.delete({ where: { id } }).catch(() => {
      throw notFound("Regla no encontrada");
    });
    return { ok: true };
  });

  // Probar qué regla se activaría con un mensaje de ejemplo.
  app.post("/api/automations/test", async (req) => {
    const { text } = z.object({ text: z.string().max(4096) }).parse(req.body);
    const rules = await prisma.automationRule.findMany({ where: { enabled: true }, orderBy: [{ priority: "asc" }, { createdAt: "asc" }] });
    const match = rules.find((r) => ruleMatches(r, text)) ?? null;
    return { match };
  });
}
