import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../database/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { badRequest, notFound } from "../utils/errors.js";
import { checkClaude, checkWhatsApp, cachedChecks } from "../services/health.service.js";
import { getSection, getWhatsAppConfig } from "../services/settings.service.js";
import { getWhatsAppClient, WhatsAppApiError } from "../whatsapp/index.js";
import { getQueue } from "../queue/index.js";
import { webhookStats } from "../webhooks/whatsapp.routes.js";
import { startOfLocalDay, startOfLocalMonth, spendSince } from "../services/budget.service.js";
import { getStats } from "../services/stats.service.js";
import { createUser, toPublicUser } from "../services/auth.service.js";
import { hashPassword, passwordPolicyError } from "../utils/crypto.js";
import { exportBackup } from "../services/backup.service.js";
import { getClaude } from "../ai/claude.js";
import { env } from "../config/env.js";

const started = new Date();
const SAFE_INLINE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/3gpp", "application/pdf"]);
const VERSION = "1.0.0";

function waError(err: unknown): never {
  if (err instanceof WhatsAppApiError) throw badRequest(err.friendly);
  throw err;
}

export async function systemRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  // ───── Inicio (dashboard) ─────
  app.get("/api/dashboard", async () => {
    const { timezone } = await getSection("general");
    const now = new Date();
    const today = startOfLocalDay(now, timezone);
    const notSim = { contact: { isSimulated: false } };
    const [inboundToday, outboundToday, activeConversations, needsHuman, errors, usageToday, monthCost, jobs, cfg, general] =
      await Promise.all([
        prisma.message.count({ where: { direction: "INBOUND", createdAt: { gte: today }, ...notSim } }),
        prisma.message.count({ where: { direction: "OUTBOUND", createdAt: { gte: today }, ...notSim } }),
        prisma.contact.count({ where: { isSimulated: false, lastInboundAt: { gte: new Date(now.getTime() - 24 * 3600_000) } } }),
        prisma.contact.findMany({
          where: { needsHuman: true, isSimulated: false },
          select: { id: true, waId: true, profileName: true, displayName: true, needsHumanReason: true, lastMessageAt: true },
          orderBy: { lastMessageAt: "desc" },
          take: 10,
        }),
        prisma.errorLog.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
        prisma.aiUsage.aggregate({
          where: { createdAt: { gte: today } },
          _sum: { inputTokens: true, outputTokens: true, cacheReadTokens: true, costUsd: true },
          _count: true,
        }),
        spendSince(startOfLocalMonth(now, timezone)),
        prisma.job.groupBy({ by: ["status"], _count: true }),
        getWhatsAppConfig(),
        getSection("general"),
      ]);
    const stats = await getStats(7, timezone);
    return {
      assistantEnabled: general.assistantEnabled,
      claudeMock: getClaude().mock,
      whatsappMode: cfg.mode,
      checks: cachedChecks(),
      server: {
        ok: true,
        version: VERSION,
        startedAt: started,
        uptimeSeconds: Math.round(process.uptime()),
        memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        node: process.version,
        environment: env.NODE_ENV,
        queue: { ...getQueue().stats(), byStatus: Object.fromEntries(jobs.map((j) => [j.status, j._count])) },
        webhook: webhookStats,
      },
      today: {
        inbound: inboundToday,
        outbound: outboundToday,
        activeConversations,
        aiCalls: usageToday._count,
        inputTokens: usageToday._sum.inputTokens ?? 0,
        outputTokens: usageToday._sum.outputTokens ?? 0,
        cacheReadTokens: usageToday._sum.cacheReadTokens ?? 0,
        costUsd: usageToday._sum.costUsd ?? 0,
      },
      monthCostUsd: monthCost,
      budget: await getSection("budget"),
      needsHuman,
      errors,
      week: stats.series,
    };
  });

  app.get("/api/stats", async (req) => {
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }).parse(req.query);
    const { timezone } = await getSection("general");
    return getStats(days, timezone);
  });

  // ───── Conexiones ─────
  app.post("/api/system/check/whatsapp", async () => checkWhatsApp());
  app.post("/api/system/check/claude", async () => checkClaude());

  app.post("/api/system/whatsapp/subscribe", { preHandler: requireRole("OWNER", "ADMIN") }, async () => {
    const wa = await getWhatsAppClient();
    try {
      const r = await wa.subscribeApp();
      const apps = await wa.getSubscribedApps();
      return { ok: r.success, subscribedApps: apps.data };
    } catch (err) {
      waError(err);
    }
  });

  app.post("/api/system/whatsapp/register", { preHandler: requireRole("OWNER") }, async (req) => {
    const { pin } = z.object({ pin: z.string().regex(/^\d{6}$/, "El PIN debe tener 6 dígitos") }).parse(req.body);
    const wa = await getWhatsAppClient();
    try {
      return await wa.registerNumber(pin);
    } catch (err) {
      waError(err);
    }
  });

  app.get("/api/system/whatsapp/templates", async () => {
    const wa = await getWhatsAppClient();
    if (wa.simulated) return { items: [], simulated: true };
    try {
      return { items: await wa.listTemplates(), simulated: false };
    } catch (err) {
      waError(err);
    }
  });

  // ───── Errores ─────
  app.get("/api/system/errors", async (req) => {
    const q = z.object({ source: z.string().max(30).optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(req.query);
    return { items: await prisma.errorLog.findMany({ where: q.source ? { source: q.source } : {}, orderBy: { createdAt: "desc" }, take: q.limit }) };
  });

  app.delete("/api/system/errors", { preHandler: requireRole("OWNER", "ADMIN") }, async () => {
    await prisma.errorLog.deleteMany({});
    return { ok: true };
  });

  // ───── Copias de seguridad ─────
  app.get("/api/system/backup", { preHandler: requireRole("OWNER") }, async (_req, reply) => {
    const data = await exportBackup();
    const name = `whatsapp-ai-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
    reply.header("Content-Type", "application/json; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="${name}"`);
    return JSON.stringify(data);
  });

  // ───── Archivos multimedia (proxy autenticado hacia Meta) ─────
  app.get("/api/media/:messageId", async (req, reply) => {
    const { messageId } = z.object({ messageId: z.string().min(1).max(40) }).parse(req.params);
    const msg = await prisma.message.findUnique({ where: { id: messageId }, include: { contact: { select: { isSimulated: true } } } });
    if (!msg?.mediaId || msg.contact.isSimulated) throw notFound("Archivo no disponible");
    const wa = await getWhatsAppClient();
    if (wa.simulated) throw notFound("En modo simulación no se descargan archivos de Meta");
    try {
      const { data, mime } = await wa.downloadMedia(msg.mediaId, 25 * 1024 * 1024);
      const type = mime.split(";")[0].trim().toLowerCase();
      // Los archivos vienen de terceros (clientes de WhatsApp): solo se muestran en línea los tipos
      // seguros. El resto (HTML, SVG, JS…) se descarga como binario para que nunca se ejecute en el panel.
      const inline = SAFE_INLINE_TYPES.has(type) || /^audio\//.test(type);
      const filename = (msg.mediaFilename ?? "archivo").replace(/[^\w.\- ]/g, "_");
      reply.header("Content-Type", inline ? type : "application/octet-stream");
      reply.header("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${filename}"`);
      reply.header("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self'; media-src 'self'");
      reply.header("X-Content-Type-Options", "nosniff");
      reply.header("Cache-Control", "private, max-age=3600");
      return reply.send(data);
    } catch (err) {
      waError(err);
    }
  });

  // ───── Usuarios del panel (solo propietario) ─────
  app.get("/api/users", { preHandler: requireRole("OWNER") }, async () => {
    const users = await prisma.adminUser.findMany({ orderBy: { createdAt: "asc" } });
    return { items: users.map(toPublicUser) };
  });

  app.post("/api/users", { preHandler: requireRole("OWNER") }, async (req) => {
    const body = z
      .object({
        email: z.string().email().max(200),
        name: z.string().trim().min(1).max(100),
        password: z.string().min(1).max(200),
        role: z.enum(["OWNER", "ADMIN", "AGENT"]),
      })
      .parse(req.body);
    return createUser(body);
  });

  app.patch("/api/users/:id", { preHandler: requireRole("OWNER") }, async (req) => {
    const { id } = z.object({ id: z.string().min(1).max(40) }).parse(req.params);
    const body = z
      .object({
        name: z.string().trim().min(1).max(100).optional(),
        role: z.enum(["OWNER", "ADMIN", "AGENT"]).optional(),
        active: z.boolean().optional(),
        password: z.string().min(1).max(200).optional(),
      })
      .parse(req.body);
    if (id === req.user!.id && (body.active === false || (body.role && body.role !== "OWNER"))) {
      throw badRequest("No puedes desactivarte ni quitarte el rol de propietario a ti mismo.");
    }
    if (body.password) {
      const policy = passwordPolicyError(body.password);
      if (policy) throw badRequest(policy);
    }
    const { password, ...rest } = body;
    const user = await prisma.adminUser.update({
      where: { id },
      data: { ...rest, ...(password ? { passwordHash: await hashPassword(password) } : {}) },
    });
    if (body.active === false || password) await prisma.session.deleteMany({ where: { userId: id } });
    return toPublicUser(user);
  });

  app.delete("/api/users/:id", { preHandler: requireRole("OWNER") }, async (req) => {
    const { id } = z.object({ id: z.string().min(1).max(40) }).parse(req.params);
    if (id === req.user!.id) throw badRequest("No puedes eliminar tu propio usuario.");
    await prisma.adminUser.delete({ where: { id } }).catch(() => {
      throw notFound("Usuario no encontrado");
    });
    return { ok: true };
  });
}
