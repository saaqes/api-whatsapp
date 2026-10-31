import { env } from "./config/env.js";
import { buildApp } from "./app.js";
import { prisma } from "./database/prisma.js";
import { getQueue } from "./queue/index.js";
import { registerJobs } from "./queue/jobs.js";
import { ensureInitialAdmin } from "./services/auth.service.js";
import { checkClaude, checkWhatsApp } from "./services/health.service.js";
import { getWhatsAppConfig } from "./services/settings.service.js";
import { logger } from "./utils/logger.js";

async function main() {
  await prisma.$queryRaw`SELECT 1`.catch((err) => {
    logger.fatal({ err }, "No se pudo conectar a la base de datos. Revisa DATABASE_URL.");
    process.exit(1);
  });
  await ensureInitialAdmin();

  const app = await buildApp();
  registerJobs();
  await getQueue().start();
  await app.listen({ port: env.PORT, host: env.HOST });

  const wa = await getWhatsAppConfig();
  logger.info(
    `Servidor listo en http://localhost:${env.PORT} — WhatsApp: modo ${wa.mode === "live" ? "REAL" : "SIMULACIÓN"}` +
      (env.CLAUDE_MOCK ? " — Claude: MODO PRUEBA (respuestas simuladas)" : ""),
  );
  // Comprobaciones iniciales de conexión (no consumen tokens ni envían mensajes).
  void checkClaude().then((r) => logger.info(`Claude: ${r.message}`));
  void checkWhatsApp().then((r) => logger.info(`WhatsApp: ${r.message}`));

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    logger.info(`${signal} recibido: cerrando de forma ordenada…`);
    await app.close().catch(() => undefined);
    await getQueue().stop();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("unhandledRejection", (err) => logger.error({ err }, "Promesa rechazada sin manejar"));
}

void main();
