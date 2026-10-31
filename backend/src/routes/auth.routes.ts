import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { SESSION_COOKIE, changePassword, login, logout, toPublicUser, validateSession } from "../services/auth.service.js";
import { requireAuth } from "../middleware/auth.js";
import { env, isProduction } from "../config/env.js";

export async function authRoutes(app: FastifyInstance) {
  app.post(
    "/api/auth/login",
    // Límite estricto por IP contra ataques de fuerza bruta (además del bloqueo por usuario).
    { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } },
    async (req, reply) => {
      const body = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) }).parse(req.body);
      const { token, user } = await login(body.email, body.password, { ip: req.ip, userAgent: req.headers["user-agent"] });
      reply.setCookie(SESSION_COOKIE, token, {
        httpOnly: true,
        secure: isProduction,
        sameSite: "strict",
        path: "/",
        signed: true,
        maxAge: env.SESSION_TTL_HOURS * 3600,
      });
      return { user };
    },
  );

  app.post("/api/auth/logout", async (req, reply) => {
    const raw = req.cookies[SESSION_COOKIE];
    const unsigned = raw ? req.unsignCookie(raw) : null;
    if (unsigned?.valid) await logout(unsigned.value ?? undefined);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/auth/me", { preHandler: requireAuth }, async (req) => ({ user: toPublicUser(req.user!) }));

  // Sondeo de sesión para el panel al cargar: responde 200 con user=null si no hay sesión.
  app.get("/api/auth/session", async (req) => {
    const raw = req.cookies[SESSION_COOKIE];
    const unsigned = raw ? req.unsignCookie(raw) : null;
    const session = unsigned?.valid ? await validateSession(unsigned.value ?? undefined) : null;
    return { user: session ? toPublicUser(session.user) : null };
  });

  app.post("/api/auth/password", { preHandler: requireAuth, config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } }, async (req) => {
    const body = z.object({ current: z.string().min(1).max(200), next: z.string().min(1).max(200) }).parse(req.body);
    const raw = req.cookies[SESSION_COOKIE];
    const unsigned = raw ? req.unsignCookie(raw) : null;
    await changePassword(req.user!.id, body.current, body.next, unsigned?.valid ? (unsigned.value ?? undefined) : undefined);
    return { ok: true };
  });
}
