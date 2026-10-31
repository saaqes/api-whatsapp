import { prisma } from "../database/prisma.js";
import type { InboundMessage, StatusUpdate } from "../whatsapp/webhook-parser.js";
import { STATUS_RANK } from "../whatsapp/webhook-parser.js";
import { getQueue } from "../queue/index.js";
import { getSection } from "../services/settings.service.js";
import { logError } from "../services/errorlog.service.js";
import { messagePlaceholder } from "../media/media.service.js";
import { truncate } from "../utils/text.js";
import { WhatsAppApiError } from "../whatsapp/client.js";

/** Mensajes reentregados con mucho retraso (p. ej. tras una caída larga) no se responden automáticamente. */
export const STALE_MESSAGE_MS = 12 * 60 * 60 * 1000;

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === "P2002";
}

export interface InboundResult {
  duplicate: boolean;
  contactId?: string;
  messageId?: string;
}

/**
 * Guarda un mensaje entrante y programa la respuesta. Idempotente: Meta puede reenviar el
 * mismo webhook varias veces y el `waMessageId` único evita procesarlo dos veces.
 */
export async function handleInbound(msg: InboundMessage, opts: { simulated?: boolean } = {}): Promise<InboundResult> {
  const existing = await prisma.message.findUnique({ where: { waMessageId: msg.waMessageId }, select: { id: true } });
  if (existing) return { duplicate: true, messageId: existing.id };

  const contact = await prisma.contact.upsert({
    where: { waId: msg.from },
    create: { waId: msg.from, profileName: msg.profileName, isSimulated: Boolean(opts.simulated) },
    update: msg.profileName ? { profileName: msg.profileName } : {},
  });

  const budget = await getSection("budget");
  const text = msg.text ? msg.text.slice(0, budget.maxInboundChars) : null;
  const isReaction = msg.type === "REACTION";
  const stale = Date.now() - msg.timestamp.getTime() > STALE_MESSAGE_MS;

  let created;
  try {
    created = await prisma.message.create({
      data: {
        contactId: contact.id,
        direction: "INBOUND",
        author: "CONTACT",
        type: msg.type,
        text,
        mediaId: msg.mediaId,
        mediaMime: msg.mediaMime,
        mediaFilename: msg.mediaFilename,
        mediaSha256: msg.mediaSha256,
        waMessageId: msg.waMessageId,
        replyToWaId: msg.replyToWaId ?? msg.reactionToWaId,
        status: "RECEIVED",
        replyState: isReaction ? "NOT_APPLICABLE" : stale ? "SKIPPED" : "PENDING",
        skipReason: stale && !isReaction ? "Mensaje reentregado con mucho retraso" : null,
        waTimestamp: msg.timestamp,
      },
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { duplicate: true, contactId: contact.id };
    throw err;
  }

  const newer = !contact.lastInboundAt || msg.timestamp > contact.lastInboundAt;
  await prisma.contact.update({
    where: { id: contact.id },
    data: {
      ...(newer ? { lastInboundAt: msg.timestamp } : {}),
      lastMessageAt: created.createdAt,
      lastMessagePreview: truncate(isReaction ? `Reaccionó ${text ?? ""}` : messagePlaceholder(created) || "[Mensaje]", 120),
      unreadCount: { increment: 1 },
    },
  });

  if (created.replyState === "PENDING") {
    const ai = await getSection("ai");
    // "Debounce": si el cliente envía varios mensajes seguidos, se responde una sola vez a todos.
    await getQueue().enqueue(
      "reply",
      { contactId: contact.id },
      {
        groupKey: `contact:${contact.id}`,
        dedupeKey: `reply:${contact.id}`,
        debounce: true,
        delayMs: ai.replyDelaySeconds * 1000,
        maxAttempts: 3,
      },
    );
  }
  return { duplicate: false, contactId: contact.id, messageId: created.id };
}

/** Actualiza el estado de un mensaje enviado (enviado → entregado → leído, o fallido). */
export async function handleStatus(s: StatusUpdate) {
  const msg = await prisma.message.findUnique({ where: { waMessageId: s.waMessageId } });
  if (!msg) return;
  const advance = s.status === "FAILED" || STATUS_RANK[s.status] > STATUS_RANK[msg.status];
  const pricing = {
    ...(s.pricingCategory ? { pricingCategory: s.pricingCategory } : {}),
    ...(s.billable != null ? { billable: s.billable } : {}),
  };
  if (!advance && !Object.keys(pricing).length) return;

  let errorMessage = s.errorMessage;
  if (s.status === "FAILED" && s.errorCode) {
    errorMessage = new WhatsAppApiError(s.errorMessage ?? "Error", 400, Number(s.errorCode), undefined, s.errorMessage ?? undefined).friendly;
  }
  await prisma.message.update({
    where: { id: msg.id },
    data: {
      ...(advance ? { status: s.status } : {}),
      ...(s.status === "FAILED" ? { errorCode: s.errorCode, errorMessage: errorMessage?.slice(0, 1000) ?? null } : {}),
      ...pricing,
    },
  });
  if (s.status === "FAILED") {
    await logError("WHATSAPP", `Mensaje no entregado: ${errorMessage ?? "error desconocido"}`, { waMessageId: s.waMessageId, code: s.errorCode }, msg.contactId);
  }
}
