import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma, type Prisma } from "../database/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { notFound } from "../utils/errors.js";
import { runMemoryUpdate } from "../memory/memory.service.js";
import { cancelPendingAutoReplies, serializeContact } from "./conversations.routes.js";
import { describeClaudeError } from "../pipeline/reply.js";
import { badRequest } from "../utils/errors.js";

const IdParams = z.object({ id: z.string().min(1).max(40) });
const MemParams = z.object({ id: z.string().min(1).max(40), memoryId: z.string().min(1).max(40) });
const tag = z.string().trim().min(1).max(40);
const Category = z.enum(["PERSONAL", "PREFERENCE", "BUSINESS", "OTHER"]);

export async function contactsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get("/api/contacts", async (req) => {
    const q = z
      .object({
        search: z.string().trim().max(100).optional(),
        tag: tag.optional(),
        filter: z.enum(["all", "blocked", "paused", "needs_human", "opted_out"]).default("all"),
        page: z.coerce.number().int().min(1).max(10000).default(1),
      })
      .parse(req.query);
    const where: Prisma.ContactWhereInput = { isSimulated: false };
    if (q.tag) where.tags = { has: q.tag };
    if (q.filter === "blocked") where.blocked = true;
    if (q.filter === "paused") where.aiPaused = true;
    if (q.filter === "needs_human") where.needsHuman = true;
    if (q.filter === "opted_out") where.optedOut = true;
    if (q.search) {
      where.OR = [
        { waId: { contains: q.search.replace(/\D/g, "") || q.search } },
        { profileName: { contains: q.search, mode: "insensitive" } },
        { displayName: { contains: q.search, mode: "insensitive" } },
        { notes: { contains: q.search, mode: "insensitive" } },
      ];
    }
    const [items, total, tagRows] = await Promise.all([
      prisma.contact.findMany({
        where,
        orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }],
        skip: (q.page - 1) * 50,
        take: 50,
        include: { _count: { select: { messages: true, memories: true } } },
      }),
      prisma.contact.count({ where }),
      prisma.$queryRaw<Array<{ tag: string }>>`SELECT DISTINCT unnest(tags) AS tag FROM "Contact" WHERE "isSimulated" = false ORDER BY 1 LIMIT 200`,
    ]);
    return { items: items.map(serializeContact), total, page: q.page, pageSize: 50, tags: tagRows.map((r) => r.tag) };
  });

  app.get("/api/contacts/:id", async (req) => {
    const { id } = IdParams.parse(req.params);
    const contact = await prisma.contact.findUnique({
      where: { id },
      include: {
        memories: { orderBy: { createdAt: "asc" } },
        _count: { select: { messages: true } },
      },
    });
    if (!contact) throw notFound("Contacto no encontrado");
    const usage = await prisma.aiUsage.aggregate({
      where: { contactId: id },
      _sum: { costUsd: true, inputTokens: true, outputTokens: true },
    });
    return { ...serializeContact(contact), usage: usage._sum };
  });

  app.patch("/api/contacts/:id", async (req) => {
    const { id } = IdParams.parse(req.params);
    const body = z
      .object({
        displayName: z.string().trim().max(100).nullable().optional(),
        tags: z.array(tag).max(30).optional(),
        notes: z.string().max(5000).optional(),
        blocked: z.boolean().optional(),
        summary: z.string().max(4000).optional(),
        classification: z.string().trim().max(40).nullable().optional(),
      })
      .parse(req.body);
    const contact = await prisma.contact.findUnique({ where: { id } });
    if (!contact) throw notFound("Contacto no encontrado");
    if (body.blocked === true && !contact.blocked) await cancelPendingAutoReplies(id, "Contacto bloqueado");
    const updated = await prisma.contact.update({
      where: { id },
      data: {
        ...body,
        tags: body.tags ? [...new Set(body.tags)] : undefined,
        ...(body.summary !== undefined ? { summaryUpdatedAt: contact.summaryUpdatedAt ?? new Date() } : {}),
      },
    });
    return serializeContact(updated);
  });

  // Elimina al contacto y TODOS sus datos (mensajes, memoria, uso) — derecho de supresión.
  app.delete("/api/contacts/:id", { preHandler: requireRole("OWNER", "ADMIN") }, async (req) => {
    const { id } = IdParams.parse(req.params);
    await prisma.job.deleteMany({ where: { groupKey: `contact:${id}`, status: "PENDING" } });
    await prisma.contact.delete({ where: { id } }).catch(() => {
      throw notFound("Contacto no encontrado");
    });
    return { ok: true };
  });

  // ───── Memoria ─────
  app.post("/api/contacts/:id/memories", async (req) => {
    const { id } = IdParams.parse(req.params);
    const body = z.object({ content: z.string().trim().min(1).max(300), category: Category.default("OTHER") }).parse(req.body);
    const contact = await prisma.contact.findUnique({ where: { id }, select: { id: true } });
    if (!contact) throw notFound("Contacto no encontrado");
    return prisma.contactMemory.create({ data: { contactId: id, content: body.content, category: body.category, source: "MANUAL" } });
  });

  app.patch("/api/contacts/:id/memories/:memoryId", async (req) => {
    const { id, memoryId } = MemParams.parse(req.params);
    const body = z.object({ content: z.string().trim().min(1).max(300).optional(), category: Category.optional() }).parse(req.body);
    // Se filtra por contactId además del id: un recuerdo nunca se edita desde otro contacto.
    const r = await prisma.contactMemory.updateMany({ where: { id: memoryId, contactId: id }, data: { ...body, source: "MANUAL" } });
    if (r.count === 0) throw notFound("Recuerdo no encontrado");
    return prisma.contactMemory.findUnique({ where: { id: memoryId } });
  });

  app.delete("/api/contacts/:id/memories/:memoryId", async (req) => {
    const { id, memoryId } = MemParams.parse(req.params);
    const r = await prisma.contactMemory.deleteMany({ where: { id: memoryId, contactId: id } });
    if (r.count === 0) throw notFound("Recuerdo no encontrado");
    return { ok: true };
  });

  app.delete("/api/contacts/:id/memories", async (req) => {
    const { id } = IdParams.parse(req.params);
    await prisma.contactMemory.deleteMany({ where: { contactId: id } });
    await prisma.contact.update({ where: { id }, data: { summary: "", summaryUpdatedAt: null, messagesSinceMemoryUpdate: 0 } });
    return { ok: true };
  });

  // Actualizar la memoria ahora (usa Claude: tiene un pequeño costo).
  app.post("/api/contacts/:id/memories/refresh", async (req) => {
    const { id } = IdParams.parse(req.params);
    try {
      return await runMemoryUpdate(id);
    } catch (err) {
      throw badRequest(describeClaudeError(err).message);
    }
  });
}
