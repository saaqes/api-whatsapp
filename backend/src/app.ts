import Fastify, { type FastifyError } from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";
import { env, isProduction, isTest } from "./config/env.js";
import { prisma } from "./database/prisma.js";
import { redactPaths } from "./utils/logger.js";
import { HttpError } from "./utils/errors.js";
import { checkOrigin } from "./middleware/auth.js";
import { whatsappWebhookRoutes } from "./webhooks/whatsapp.routes.js";
import { authRoutes } from "./routes/auth.routes.js";
import { conversationsRoutes } from "./routes/conversations.routes.js";
import { contactsRoutes } from "./routes/contacts.routes.js";
import { settingsRoutes } from "./routes/settings.routes.js";
import { knowledgeRoutes } from "./routes/knowledge.routes.js";
import { automationsRoutes } from "./routes/automations.routes.js";
import { simulatorRoutes } from "./routes/simulator.routes.js";
import { systemRoutes } from "./routes/system.routes.js";
import { publicRoutes } from "./routes/public.routes.js";

const here = path.dirname(fileURLToPath(import.meta.url));

function frontendDir(): string | null {
  const candidates = [env.FRONTEND_DIST, path.resolve(here, "../../frontend/dist"), path.resolve(process.cwd(), "../frontend/dist")];
  for (const c of candidates) if (c && existsSync(path.join(c, "index.html"))) return path.resolve(c);
  return null;
}

export async function buildApp() {
  const app = Fastify({
    logger: isTest ? false : { level: env.LOG_LEVEL, redact: { paths: redactPaths, censor: "[oculto]" } },
    trustProxy: env.TRUST_PROXY || isProduction, // Render y similares ponen un proxy delante
    bodyLimit: 2 * 1024 * 1024,
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        mediaSrc: ["'self'", "blob:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: isProduction ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: isProduction ? { maxAge: 15552000, includeSubDomains: true } : false,
  });
  await app.register(cookie, { secret: env.SESSION_SECRET });
  await app.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: "1 minute",
    // El webhook de Meta puede llegar en ráfagas: no se limita (va protegido por firma).
    allowList: (req) => req.url.startsWith("/webhooks/"),
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      error: "too_many_requests",
      message: `Demasiadas solicitudes. Espera ${Math.ceil(ctx.ttl / 1000)} s e inténtalo de nuevo.`,
    }),
  });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 5 } });

  app.setErrorHandler((err: FastifyError | Error, req, reply) => {
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return reply.code(400).send({
        error: "validation_error",
        message: first ? `${first.path.join(".") || "datos"}: ${first.message}` : "Datos no válidos",
        issues: err.issues,
      });
    }
    if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.code ?? "error", message: err.message });
    const status = (err as FastifyError).statusCode ?? 500;
    if (status >= 500) req.log.error({ err }, "Error no controlado");
    return reply.code(status).send({
      error: status >= 500 ? "internal_error" : "request_error",
      message: status >= 500 ? "Error interno del servidor" : err.message,
    });
  });

  // Salud: /api/health no toca la base de datos (para monitores frecuentes); /api/health/ready sí.
  app.get("/api/health", async () => ({ ok: true, uptime: Math.round(process.uptime()) }));
  app.get("/api/health/ready", async (_req, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { ok: true, database: "ok" };
    } catch {
      return reply.code(503).send({ ok: false, database: "error" });
    }
  });

  await app.register(whatsappWebhookRoutes);
  await app.register(publicRoutes);
  await app.register(async (api) => {
    api.addHook("onRequest", checkOrigin);
    await api.register(authRoutes);
    await api.register(conversationsRoutes);
    await api.register(contactsRoutes);
    await api.register(settingsRoutes);
    await api.register(knowledgeRoutes);
    await api.register(automationsRoutes);
    await api.register(simulatorRoutes);
    await api.register(systemRoutes);
  });

  // Panel web compilado (frontend/dist) servido desde el mismo servidor.
  const dist = frontendDir();
  if (dist) {
    await app.register(fastifyStatic, { root: dist, wildcard: false, index: false, maxAge: isProduction ? "1h" : 0 });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api") && !req.url.startsWith("/webhooks")) {
        const file = req.url.split("?")[0];
        if (file.startsWith("/assets/")) return reply.code(404).send({ error: "not_found" });
        reply.header("Cache-Control", "no-cache");
        return reply.sendFile("index.html");
      }
      return reply.code(404).send({ error: "not_found", message: "Ruta no encontrada" });
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: "not_found", message: "Ruta no encontrada" }));
  }

  return app;
}
