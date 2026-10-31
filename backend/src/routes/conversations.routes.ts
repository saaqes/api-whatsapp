import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma, type Prisma } from "../database/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { badRequest, notFound } from "../utils/errors.js";
import { getSection } from "../services/settings.service.js";
import { isWindowOpen, queueTemplate, queueText } from "../services/outbound.service.js";
import { getQueue } from "../queue/index.js";

const IdParams = z.object({ id: z.string().min(1).max(40) });

export function serializeContact<T extends { lastInboundAt: Date | null }>(c: T) {
  return { ...c, windowOpen: isWindowOpen(c) };
}

/** Cancela respuestas automáticas pendientes de un contacto (al pausar o al responder un humano). */
export async function cancelPendingAutoReplies(contactId: string, reason: string) {
  await prisma.message.updateMany({
    where: { contactId, direction: "INBOUND", replyState: "PENDING" },
    data: { replyState: "SKIPPED", skipReason: reason },
  });
  await prisma.job.deleteMany({ where: { dedupeKey: `reply:${contactId}`, status: "PENDING" } });
}

export async function conversationsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get("/api/conversations", async (req) => {
    const q = z
      .object({
        search: z.string().trim().max(100).optional(),
        filter: z.enum(["all", "needs_human", "paused", "unread", "blocked", "simulated"]).default("all"),
        cursor: z.string().datetime().optional(),
      })
      .parse(req.query);
    const where: Prisma.ContactWhereInput = { lastMessageAt: { not: null } };
    if (q.filter === "simulated") where.isSimulated = true;
    else where.isSimulated = false;
    if (q.filter === "needs_human") where.needsHuman = true;
    if (q.filter === "paused") where.aiPaused = true;
    if (q.filter === "unread") where.unreadCount = { gt: 0 };
    if (q.filter === "blocked") where.blocked = true;
    else if (q.filter !== "simulated") where.blocked = false;
    if (q.search) {
      const s = q.search;
      where.OR = [
        { waId: { contains: s.replace(/\D/g, "") || s } },
        { profileName: { contains: s, mode: "insensitive" } },
        { displayName: { contains: s, mode: "insensitive" } },
        { messages: { some: { text: { contains: s, mode: "insensitive" } } } },
      ];
    }
    if (q.cursor) where.lastMessageAt = { lt: new Date(q.cursor) };
    const items = await prisma.contact.findMany({
      where,
      orderBy: { lastMessageAt: "desc" },
      take: 50,
      select: {
        id: true,
        waId: true,
        profileName: true,
        displayName: true,
        lastMessageAt: true,
        lastMessagePreview: true,
        lastInboundAt: true,
        unreadCount: true,
        aiPaused: true,
        needsHuman: true,
        blocked: true,
        isSimulated: true,
        tags: true,
        classification: true,
      },
    });
    return { items: items.map(serializeContact), nextCursor: items.length === 50 ? items[49].lastMessageAt : null };
  });

  app.get("/api/conversations/:id", async (req) => {
    const { id } = IdParams.parse(req.params);
    const contact = await prisma.contact.findUnique({ where: { id } });
    if (!contact) throw notFound("Conversación no encontrada");
    return serializeContact(contact);
  });

  app.get("/api/conversations/:id/messages", async (req) => {
    const { id } = IdParams.parse(req.params);
    const q = z.object({ before: z.string().datetime().optional(), limit: z.coerce.number().int().min(1).max(200).default(60) }).parse(req.query);
    const rows = await prisma.message.findMany({
      where: { contactId: id, ...(q.before ? { createdAt: { lt: new Date(q.before) } } : {}) },
      orderBy: { createdAt: "desc" },
      take: q.limit,
    });
    const users = await prisma.adminUser.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.authorUserId).filter(Boolean) as string[])] } },
      select: { id: true, name: true },
    });
    const names = new Map(users.map((u) => [u.id, u.name]));
    return {
      items: rows.reverse().map((m) => ({ ...m, authorName: m.authorUserId ? names.get(m.authorUserId) ?? null : null })),
      hasMore: rows.length === q.limit,
    };
  });

  app.post("/api/conversations/:id/read", async (req) => {
    const { id } = IdParams.parse(req.params);
    await prisma.contact.update({ where: { id }, data: { unreadCount: 0 } }).catch(() => {
      throw notFound();
    });
    return { ok: true };
  });

  // Respuesta manual de una persona del equipo.
  app.post("/api/conversations/:id/messages", async (req) => {
    const { id } = IdParams.parse(req.params);
    const body = z.object({ text: z.string().trim().min(1).max(4096) }).parse(req.body);
    const contact = await prisma.contact.findUnique({ where: { id } });
    if (!contact) throw notFound("Conversación no encontrada");
    if (!contact.isSimulated && !isWindowOpen(contact)) {
      throw badRequest(
        "Pasaron más de 24 horas desde el último mensaje del cliente. WhatsApp solo permite escribirle con una plantilla aprobada.",
      );
    }
    const general = await getSection("general");
    if (general.autoPauseOnHumanReply && !contact.aiPaused) {
      await prisma.contact.update({ where: { id }, data: { aiPaused: true, aiPausedAt: new Date() } });
    }
    await cancelPendingAutoReplies(id, "Respondido por una persona del equipo");
    const msg = await queueText(contact, body.text, { author: "HUMAN", authorUserId: req.user!.id });
    await prisma.contact.update({ where: { id }, data: { unreadCount: 0 } });
    return msg;
  });

  app.post("/api/conversations/:id/template", async (req) => {
    const { id } = IdParams.parse(req.params);
    const body = z
      .object({
        name: z.string().trim().min(1).max(512),
        language: z.string().trim().min(2).max(15),
        bodyParams: z.array(z.string().max(1000)).max(20).default([]),
        previewText: z.string().max(4096).optional(),
      })
      .parse(req.body);
    const contact = await prisma.contact.findUnique({ where: { id } });
    if (!contact) throw notFound("Conversación no encontrada");
    if (contact.optedOut) throw badRequest("Este contacto pidió no recibir mensajes. No se le pueden enviar plantillas.");
    const components = body.bodyParams.length
      ? [{ type: "body" as const, parameters: body.bodyParams.map((t) => ({ type: "text" as const, text: t })) }]
      : [];
    return queueTemplate(contact, { name: body.name, language: body.language, components, previewText: body.previewText }, req.user!.id);
  });

  // Pausar / reactivar la IA para un contacto (control humano).
  app.patch("/api/conversations/:id/ai", async (req) => {
    const { id } = IdParams.parse(req.params);
    const body = z.object({ paused: z.boolean() }).parse(req.body);
    const contact = await prisma.contact.findUnique({ where: { id } });
    if (!contact) throw notFound();
    // Tanto al pausar como al reactivar, los mensajes que estaban pendientes no se responden
    // automáticamente: así nunca hay respuestas duplicadas ni fuera de contexto.
    await cancelPendingAutoReplies(id, body.paused ? "IA pausada por el equipo" : "Pendiente antes de reactivar la IA");
    const updated = await prisma.contact.update({
      where: { id },
      data: body.paused
        ? { aiPaused: true, aiPausedAt: new Date() }
        : { aiPaused: false, aiPausedAt: null, needsHuman: false, needsHumanReason: null },
    });
    return serializeContact(updated);
  });

  app.post("/api/conversations/:id/resolve", async (req) => {
    const { id } = IdParams.parse(req.params);
    const updated = await prisma.contact.update({ where: { id }, data: { needsHuman: false, needsHumanReason: null } });
    return serializeContact(updated);
  });

  // Reintentar un mensaje saliente fallido.
  app.post("/api/messages/:id/retry", async (req) => {
    const { id } = IdParams.parse(req.params);
    const msg = await prisma.message.findUnique({ where: { id } });
    if (!msg || msg.direction !== "OUTBOUND") throw notFound("Mensaje no encontrado");
    if (msg.status !== "FAILED") throw badRequest("Solo se pueden reintentar mensajes fallidos.");
    if (msg.type === "TEMPLATE") throw badRequest("Para reintentar una plantilla, envíala de nuevo.");
    await prisma.message.update({ where: { id }, data: { status: "QUEUED", errorCode: null, errorMessage: null } });
    await getQueue().enqueue("send_message", { messageId: id }, { groupKey: `contact:${msg.contactId}` });
    return { ok: true };
  });
}
