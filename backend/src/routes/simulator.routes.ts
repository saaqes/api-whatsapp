import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { prisma } from "../database/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { handleInbound } from "../pipeline/inbound.js";
import { notFound } from "../utils/errors.js";

/**
 * Simulador: conversa con la IA como si fueras un cliente, sin WhatsApp ni Meta.
 * Usa exactamente el mismo flujo que los mensajes reales (automatizaciones, memoria,
 * conocimiento y Claude), pero las respuestas nunca se envían a WhatsApp.
 */
export async function simulatorRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);
  app.addHook("preHandler", requireRole("OWNER", "ADMIN"));

  app.get("/api/simulator/contacts", async () => {
    const items = await prisma.contact.findMany({ where: { isSimulated: true }, orderBy: { createdAt: "desc" } });
    return { items };
  });

  app.post("/api/simulator/contacts", async (req) => {
    const { name } = z.object({ name: z.string().trim().min(1).max(60) }).parse(req.body);
    const waId = `sim-${randomBytes(5).toString("hex")}`;
    return prisma.contact.create({ data: { waId, profileName: name, isSimulated: true } });
  });

  app.post("/api/simulator/contacts/:id/messages", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const { id } = z.object({ id: z.string().min(1).max(40) }).parse(req.params);
    const { text } = z.object({ text: z.string().trim().min(1).max(4000) }).parse(req.body);
    const contact = await prisma.contact.findUnique({ where: { id } });
    if (!contact?.isSimulated) throw notFound("Contacto simulado no encontrado");
    return handleInbound(
      {
        phoneNumberId: "simulator",
        waMessageId: `sim.in.${randomBytes(10).toString("hex")}`,
        from: contact.waId,
        profileName: contact.profileName,
        timestamp: new Date(),
        type: "TEXT",
        text,
        mediaId: null,
        mediaMime: null,
        mediaFilename: null,
        mediaSha256: null,
        replyToWaId: null,
        isVoice: false,
        reactionToWaId: null,
        rawType: "text",
      },
      { simulated: true },
    );
  });

  // Ver lo que la IA "sabe" de este contacto y el costo de la última respuesta.
  app.get("/api/simulator/contacts/:id/debug", async (req) => {
    const { id } = z.object({ id: z.string().min(1).max(40) }).parse(req.params);
    const contact = await prisma.contact.findUnique({ where: { id }, include: { memories: true } });
    if (!contact?.isSimulated) throw notFound();
    const usage = await prisma.aiUsage.findMany({ where: { contactId: id }, orderBy: { createdAt: "desc" }, take: 10 });
    const pendingJobs = await prisma.job.count({ where: { groupKey: `contact:${id}`, status: { in: ["PENDING", "RUNNING"] } } });
    return { contact, usage, pendingJobs };
  });

  app.delete("/api/simulator/contacts/:id", async (req) => {
    const { id } = z.object({ id: z.string().min(1).max(40) }).parse(req.params);
    const contact = await prisma.contact.findUnique({ where: { id } });
    if (!contact?.isSimulated) throw notFound();
    await prisma.job.deleteMany({ where: { groupKey: `contact:${id}`, status: "PENDING" } });
    await prisma.contact.delete({ where: { id } });
    return { ok: true };
  });
}
