import { prisma, type Contact, type MessageAuthor } from "../database/prisma.js";
import { getQueue } from "../queue/index.js";
import { NonRetryableError } from "../queue/job-queue.js";
import { getWhatsAppClient, WhatsAppApiError } from "../whatsapp/index.js";
import type { TemplateComponentParam } from "../whatsapp/client.js";
import { logError } from "./errorlog.service.js";
import { truncate } from "../utils/text.js";

export const WINDOW_MS = 24 * 60 * 60 * 1000;

/** Ventana de atención de 24 h: solo dentro de ella se pueden enviar mensajes libres (no plantillas). */
export function isWindowOpen(contact: Pick<Contact, "lastInboundAt">, now = new Date()): boolean {
  return Boolean(contact.lastInboundAt && now.getTime() - contact.lastInboundAt.getTime() < WINDOW_MS);
}

export interface QueueTextOptions {
  author: MessageAuthor;
  authorUserId?: string | null;
  replyToWaId?: string | null;
  responseTimeMs?: number | null;
  aiUsageId?: string | null;
}

/**
 * Crea el mensaje saliente (estado QUEUED) y lo encola. Todos los envíos de un contacto
 * comparten grupo en la cola, así se entregan en orden y nunca en paralelo.
 */
export async function queueText(contact: Contact, text: string, opts: QueueTextOptions) {
  const msg = await prisma.message.create({
    data: {
      contactId: contact.id,
      direction: "OUTBOUND",
      author: opts.author,
      authorUserId: opts.authorUserId ?? null,
      type: "TEXT",
      text,
      status: "QUEUED",
      replyToWaId: opts.replyToWaId ?? null,
      responseTimeMs: opts.responseTimeMs ?? null,
      aiUsageId: opts.aiUsageId ?? null,
    },
  });
  await prisma.contact.update({
    where: { id: contact.id },
    data: { lastMessageAt: msg.createdAt, lastMessagePreview: truncate(text, 120) },
  });
  await getQueue().enqueue("send_message", { messageId: msg.id }, { groupKey: `contact:${contact.id}`, maxAttempts: 5 });
  return msg;
}

export async function queueTemplate(
  contact: Contact,
  template: { name: string; language: string; components?: TemplateComponentParam[]; previewText?: string },
  authorUserId: string | null,
) {
  const msg = await prisma.message.create({
    data: {
      contactId: contact.id,
      direction: "OUTBOUND",
      author: "HUMAN",
      authorUserId,
      type: "TEMPLATE",
      templateName: template.name,
      text: template.previewText ?? null,
      status: "QUEUED",
    },
  });
  await getQueue().enqueue(
    "send_message",
    { messageId: msg.id, template: { name: template.name, language: template.language, components: template.components ?? [] } },
    { groupKey: `contact:${contact.id}`, maxAttempts: 5 },
  );
  return msg;
}

/** Manejador del trabajo "send_message": envía a Meta (o simula) y actualiza el estado. */
export async function handleSendMessage(
  payload: { messageId: string; template?: { name: string; language: string; components: TemplateComponentParam[] } },
  job: { attempts: number; maxAttempts: number },
) {
  const msg = await prisma.message.findUnique({ where: { id: payload.messageId }, include: { contact: true } });
  if (!msg || msg.status !== "QUEUED") return; // ya enviado o cancelado: nunca duplicar
  const wa = await getWhatsAppClient();
  const simulate = msg.contact.isSimulated || wa.simulated;

  try {
    let messageId: string;
    if (simulate) {
      messageId = `sim.${msg.id}`;
    } else if (payload.template) {
      messageId = (await wa.sendTemplate(msg.contact.waId, payload.template.name, payload.template.language, payload.template.components))
        .messageId;
    } else {
      messageId = (await wa.sendText(msg.contact.waId, msg.text ?? "", msg.replyToWaId)).messageId;
    }
    const now = new Date();
    await prisma.$transaction([
      prisma.message.update({
        where: { id: msg.id },
        data: { waMessageId: messageId, status: simulate ? "SIMULATED" : "SENT", errorCode: null, errorMessage: null },
      }),
      prisma.contact.update({ where: { id: msg.contactId }, data: { lastOutboundAt: now } }),
    ]);
  } catch (err) {
    const isApi = err instanceof WhatsAppApiError;
    const finalAttempt = job.attempts >= job.maxAttempts;
    if (!finalAttempt && (!isApi || err.retryable)) throw err; // error temporal: la cola reintentará
    const friendly = isApi ? err.friendly : (err as Error).message;
    await prisma.message.update({
      where: { id: msg.id },
      data: { status: "FAILED", errorCode: isApi && err.code != null ? String(err.code) : null, errorMessage: friendly.slice(0, 1000) },
    });
    await logError("WHATSAPP", friendly, { messageId: msg.id, code: isApi ? err.code : undefined }, msg.contactId);
    throw new NonRetryableError(friendly);
  }
}
