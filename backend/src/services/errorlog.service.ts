import { prisma } from "../database/prisma.js";
import { logger } from "../utils/logger.js";
import { errorMessage } from "../utils/errors.js";

export type ErrorSource =
  | "WEBHOOK"
  | "WHATSAPP"
  | "CLAUDE"
  | "QUEUE"
  | "MEMORY"
  | "KNOWLEDGE"
  | "TRANSCRIPTION"
  | "AUTOMATION"
  | "SYSTEM";

/** Guarda un error visible en el panel (sección Inicio → Errores recientes). Nunca lanza. */
export async function logError(
  source: ErrorSource,
  error: unknown,
  details?: Record<string, unknown>,
  contactId?: string | null,
  level: "error" | "warn" = "error",
): Promise<void> {
  const message = errorMessage(error).slice(0, 2000);
  logger[level]({ source, details, contactId, err: error instanceof Error ? error : undefined }, message);
  try {
    await prisma.errorLog.create({
      data: { source, level, message, details: (details ?? undefined) as object | undefined, contactId: contactId ?? null },
    });
  } catch (dbErr) {
    logger.error({ err: dbErr }, "No se pudo guardar el registro de error");
  }
}
