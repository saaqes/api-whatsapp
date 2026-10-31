import type { FastifyReply, FastifyRequest } from "fastify";
import type { AdminRole, AdminUser } from "../database/prisma.js";
import { SESSION_COOKIE, validateSession } from "../services/auth.service.js";
import { env } from "../config/env.js";
import { forbidden, unauthorized } from "../utils/errors.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: AdminUser;
  }
}

export async function requireAuth(req: FastifyRequest, _reply: FastifyReply) {
  const raw = req.cookies[SESSION_COOKIE];
  const unsigned = raw ? req.unsignCookie(raw) : null;
  const session = unsigned?.valid ? await validateSession(unsigned.value ?? undefined) : null;
  if (!session) throw unauthorized();
  req.user = session.user;
}

export function requireRole(...roles: AdminRole[]) {
  return async (req: FastifyRequest) => {
    if (!req.user || !roles.includes(req.user.role)) throw forbidden();
  };
}

/**
 * Defensa contra CSRF (además de la cookie SameSite=Strict): las peticiones que modifican datos
 * deben venir del mismo origen que el panel.
 */
export async function checkOrigin(req: FastifyRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const origin = req.headers.origin;
  const fetchSite = req.headers["sec-fetch-site"];
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") throw forbidden("Origen no permitido");
  if (origin) {
    const host = req.headers["x-forwarded-host"] ?? req.headers.host;
    let allowed = false;
    try {
      const o = new URL(origin);
      allowed = o.host === host || (env.PUBLIC_URL ? o.origin === new URL(env.PUBLIC_URL).origin : false);
      // En desarrollo el panel corre en Vite (otro puerto) con proxy.
      if (!allowed && env.NODE_ENV !== "production") allowed = ["localhost", "127.0.0.1"].includes(o.hostname);
    } catch {
      allowed = false;
    }
    if (!allowed) throw forbidden("Origen no permitido");
  }
}
