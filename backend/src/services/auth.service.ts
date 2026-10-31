import { prisma, type AdminRole, type AdminUser } from "../database/prisma.js";
import { env } from "../config/env.js";
import { hashPassword, passwordPolicyError, randomToken, sha256, verifyPassword } from "../utils/crypto.js";
import { badRequest, HttpError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

export const SESSION_COOKIE = "wa_ai_session";
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export type PublicUser = Pick<AdminUser, "id" | "email" | "name" | "role" | "active" | "lastLoginAt" | "createdAt">;

export function toPublicUser(u: AdminUser): PublicUser {
  return { id: u.id, email: u.email, name: u.name, role: u.role, active: u.active, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt };
}

// Hash ficticio para que el tiempo de respuesta no revele si el correo existe.
let dummyHash: string | null = null;

export async function login(email: string, password: string, meta: { ip?: string; userAgent?: string }) {
  const user = await prisma.adminUser.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user) {
    dummyHash ??= await hashPassword(randomToken());
    await verifyPassword(password, dummyHash);
    throw new HttpError(401, "Correo o contraseña incorrectos", "invalid_credentials");
  }
  if (!user.active) throw new HttpError(403, "Usuario desactivado", "inactive");
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new HttpError(429, "Demasiados intentos fallidos. Inténtalo de nuevo en unos minutos.", "locked");
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    const failed = user.failedLogins + 1;
    await prisma.adminUser.update({
      where: { id: user.id },
      data: {
        failedLogins: failed >= MAX_FAILED ? 0 : failed,
        lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
      },
    });
    throw new HttpError(401, "Correo o contraseña incorrectos", "invalid_credentials");
  }
  const token = randomToken(32);
  await prisma.$transaction([
    prisma.adminUser.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } }),
    prisma.session.create({
      data: {
        tokenHash: sha256(token),
        userId: user.id,
        expiresAt: new Date(Date.now() + env.SESSION_TTL_HOURS * 3600_000),
        ip: meta.ip?.slice(0, 100),
        userAgent: meta.userAgent?.slice(0, 300),
      },
    }),
  ]);
  return { token, user: toPublicUser(user) };
}

/** Valida el token de la cookie. Renueva la sesión cuando ya pasó la mitad de su duración. */
export async function validateSession(token: string | undefined) {
  if (!token || token.length > 200) return null;
  const session = await prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!session || session.expiresAt < new Date() || !session.user.active) return null;
  const ttl = env.SESSION_TTL_HOURS * 3600_000;
  if (session.expiresAt.getTime() - Date.now() < ttl / 2) {
    await prisma.session.update({ where: { id: session.id }, data: { expiresAt: new Date(Date.now() + ttl) } });
  }
  return { sessionId: session.id, user: session.user };
}

export async function logout(token: string | undefined) {
  if (!token) return;
  await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
}

export async function changePassword(userId: string, current: string, next: string, keepSessionToken?: string) {
  const user = await prisma.adminUser.findUniqueOrThrow({ where: { id: userId } });
  if (!(await verifyPassword(current, user.passwordHash))) throw badRequest("La contraseña actual no es correcta.");
  const policy = passwordPolicyError(next);
  if (policy) throw badRequest(policy);
  await prisma.adminUser.update({ where: { id: userId }, data: { passwordHash: await hashPassword(next) } });
  // Cierra las demás sesiones abiertas (otros dispositivos) por seguridad.
  await prisma.session.deleteMany({
    where: { userId, ...(keepSessionToken ? { tokenHash: { not: sha256(keepSessionToken) } } : {}) },
  });
}

export async function createUser(input: { email: string; name: string; password: string; role: AdminRole }) {
  const policy = passwordPolicyError(input.password);
  if (policy) throw badRequest(policy);
  const email = input.email.trim().toLowerCase();
  if (await prisma.adminUser.findUnique({ where: { email } })) throw badRequest("Ya existe un usuario con ese correo.");
  const user = await prisma.adminUser.create({
    data: { email, name: input.name.trim(), role: input.role, passwordHash: await hashPassword(input.password) },
  });
  return toPublicUser(user);
}

/** Crea el primer administrador a partir de ADMIN_EMAIL / ADMIN_PASSWORD si aún no hay usuarios. */
export async function ensureInitialAdmin() {
  const count = await prisma.adminUser.count();
  if (count > 0) return;
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
    logger.warn("No hay usuarios administradores. Define ADMIN_EMAIL y ADMIN_PASSWORD en .env y reinicia, o ejecuta: npm run admin:create");
    return;
  }
  const policy = passwordPolicyError(env.ADMIN_PASSWORD);
  if (policy) {
    logger.error(`ADMIN_PASSWORD no cumple la política: ${policy}`);
    return;
  }
  await createUser({ email: env.ADMIN_EMAIL, name: env.ADMIN_NAME, password: env.ADMIN_PASSWORD, role: "OWNER" });
  logger.info(`Administrador inicial creado: ${env.ADMIN_EMAIL}`);
}
