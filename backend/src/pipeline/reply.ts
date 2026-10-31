import Anthropic from "@anthropic-ai/sdk";
import { prisma, type Contact, type Message, type ReplyState } from "../database/prisma.js";
import { getClaude, ClaudeNotConfiguredError } from "../ai/claude.js";
import { generateReply } from "../ai/responder.js";
import { buildDynamicContext, buildStableSystemPrompt } from "../ai/prompt.js";
import { getSecret, getSection } from "../services/settings.service.js";
import { logError } from "../services/errorlog.service.js";
import { queueText } from "../services/outbound.service.js";
import { checkBudget } from "../services/budget.service.js";
import {
  findMatchingRule,
  isOutOfHours,
  matchesKeywordExactly,
  recordRuleHit,
  shouldSendOutOfHoursNotice,
} from "../automations/automation.service.js";
import { loadHistory, loadMemories, mergeTurns } from "../memory/memory.service.js";
import { prepareInboundContent } from "../media/media.service.js";
import { searchKnowledge } from "../knowledge/knowledge.service.js";
import { getWhatsAppClient } from "../whatsapp/index.js";
import { getQueue } from "../queue/index.js";
import { markdownToWhatsApp, splitForWhatsApp } from "../utils/text.js";

const MAX_REGENERATIONS = 2;

/** Mensaje claro para el panel según el tipo de error de Claude. */
export function describeClaudeError(err: unknown): { message: string; retryable: boolean } {
  if (err instanceof ClaudeNotConfiguredError) return { message: err.message, retryable: false };
  if (err instanceof Anthropic.AuthenticationError) {
    return { message: "La API Key de Claude no es válida o fue revocada. Revísala en Sistema → Conexiones.", retryable: false };
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return { message: "La API Key de Claude no tiene permiso para este modelo.", retryable: false };
  }
  if (err instanceof Anthropic.NotFoundError) {
    return { message: "El modelo configurado no existe o no está disponible para tu cuenta. Elige otro en Configuración de la IA.", retryable: false };
  }
  if (err instanceof Anthropic.RateLimitError) {
    return { message: "Claude respondió con límite de uso (429). Se reintentará automáticamente.", retryable: true };
  }
  if (err instanceof Anthropic.BadRequestError) {
    const m = err.message.toLowerCase();
    if (m.includes("credit balance") || m.includes("billing")) {
      return { message: "Tu cuenta de Anthropic no tiene saldo. Recarga créditos en console.anthropic.com → Billing.", retryable: false };
    }
    return { message: `Solicitud rechazada por Claude: ${err.message}`, retryable: false };
  }
  if (err instanceof Anthropic.InternalServerError || err instanceof Anthropic.APIConnectionError) {
    return { message: "Claude no está disponible temporalmente. Se reintentará automáticamente.", retryable: true };
  }
  if (err instanceof Anthropic.APIError) {
    const status = err.status ?? 0;
    return { message: `Error de Claude (${status}): ${err.message}`, retryable: status >= 500 || status === 429 };
  }
  return { message: err instanceof Error ? err.message : String(err), retryable: false };
}

async function mark(messages: Message[], replyState: ReplyState, skipReason: string | null) {
  if (!messages.length) return;
  await prisma.message.updateMany({
    where: { id: { in: messages.map((m) => m.id) }, replyState: "PENDING" },
    data: { replyState, skipReason },
  });
}

async function flagHuman(contact: Contact, reason: string, pauseAi: boolean) {
  await prisma.contact.update({
    where: { id: contact.id },
    data: { needsHuman: true, needsHumanReason: reason.slice(0, 300), ...(pauseAi ? { aiPaused: true, aiPausedAt: new Date() } : {}) },
  });
}

/**
 * Trabajo "reply": decide si responder y cómo. Orden de decisión:
 * bloqueo → baja (STOP) → botón general → IA pausada → bienvenida → horario → reglas → presupuesto → Claude.
 * Antes de enviar vuelve a comprobar pausas y si llegaron mensajes nuevos (en ese caso regenera),
 * de modo que nunca se envían respuestas duplicadas ni desactualizadas.
 */
export async function handleReplyJob(payload: { contactId: string }, job: { attempts: number; maxAttempts: number }) {
  const { contactId } = payload;

  for (let pass = 0; pass <= MAX_REGENERATIONS; pass++) {
    const contact = await prisma.contact.findUnique({ where: { id: contactId } });
    if (!contact) return;
    const pending = await prisma.message.findMany({
      where: { contactId, direction: "INBOUND", replyState: "PENDING" },
      orderBy: { createdAt: "asc" },
    });
    if (!pending.length) return;

    const [general, ai, automation, budgetSettings] = await Promise.all([
      getSection("general"),
      getSection("ai"),
      getSection("automation"),
      getSection("budget"),
    ]);
    const now = new Date();
    const texts = pending.map((m) => m.text ?? "");

    // 1. Contacto bloqueado o excluido
    if (contact.blocked) return mark(pending, "SKIPPED", "Contacto bloqueado");

    // 2. Baja voluntaria (STOP) y reactivación
    if (automation.optOut.enabled) {
      if (!contact.optedOut && texts.some((t) => matchesKeywordExactly(t, automation.optOut.keywords))) {
        await prisma.contact.update({ where: { id: contactId }, data: { optedOut: true } });
        if (general.assistantEnabled) await queueText(contact, automation.optOut.confirmationText, { author: "AUTOMATION" });
        return mark(pending, "ANSWERED", "El contacto pidió la baja");
      }
      if (contact.optedOut && texts.some((t) => matchesKeywordExactly(t, automation.optOut.resumeKeywords))) {
        await prisma.contact.update({ where: { id: contactId }, data: { optedOut: false } });
        if (general.assistantEnabled) await queueText(contact, automation.optOut.resumeText, { author: "AUTOMATION" });
        return mark(pending, "ANSWERED", "El contacto se reactivó");
      }
    }
    if (contact.optedOut) return mark(pending, "SKIPPED", "El contacto pidió no recibir mensajes automáticos");

    // 3. Botón general y 4. IA pausada para este contacto (control humano)
    if (!general.assistantEnabled) return mark(pending, "SKIPPED", "Respuestas automáticas detenidas (botón general)");
    if (contact.aiPaused) return mark(pending, "SKIPPED", "IA pausada para este contacto");

    // 5. Bienvenida (solo al primer mensaje de un contacto nuevo)
    let automatedReply = false;
    if (!contact.welcomeSentAt) {
      const olderInbound = await prisma.message.count({
        where: { contactId, direction: "INBOUND", id: { notIn: pending.map((m) => m.id) } },
      });
      await prisma.contact.update({ where: { id: contactId }, data: { welcomeSentAt: now } });
      if (automation.welcome.enabled && olderInbound === 0) {
        await queueText(contact, automation.welcome.text, { author: "AUTOMATION" });
        automatedReply = true;
        if (!automation.welcome.thenAiReplies) return mark(pending, "ANSWERED", "Mensaje de bienvenida");
      }
    }

    // 6. Fuera de horario
    const outOfHours = isOutOfHours(automation, general.timezone, now);
    if (outOfHours) {
      if (shouldSendOutOfHoursNotice(automation, contact, now)) {
        await queueText(contact, automation.outOfHours.text, { author: "AUTOMATION" });
        await prisma.contact.update({ where: { id: contactId }, data: { outOfHoursSentAt: now } });
        automatedReply = true;
      }
      if (!automation.outOfHours.aiRespondsOutOfHours) {
        return mark(pending, automatedReply ? "ANSWERED" : "SKIPPED", "Fuera de horario");
      }
    }

    // 7. Reglas por palabra clave
    const rule = await findMatchingRule(contactId, texts, now);
    if (rule) {
      await recordRuleHit(rule.id, contactId);
      if (rule.addTags.length) {
        await prisma.contact.update({
          where: { id: contactId },
          data: { tags: [...new Set([...contact.tags, ...rule.addTags])] },
        });
      }
      if (rule.replyText) await queueText(contact, rule.replyText, { author: "AUTOMATION" });
      if (rule.handoff) {
        await flagHuman(contact, `Regla «${rule.name}»`, true);
        if (!rule.replyText) await queueText(contact, automation.handoff.message, { author: "AUTOMATION" });
        return mark(pending, "ANSWERED", `Regla «${rule.name}»: derivado a una persona`);
      }
      if (rule.replyText || rule.stopAi) return mark(pending, "ANSWERED", `Regla «${rule.name}»`);
    }

    // 8. Presupuesto y límites anti-abuso
    const budget = await checkBudget(contactId, now);
    if (budget.blocked) {
      await logError("SYSTEM", budget.reason, { contactId }, contactId, "warn");
      if (!contact.needsHuman && budgetSettings.limitMessage) {
        await queueText(contact, budgetSettings.limitMessage, { author: "AUTOMATION" });
      }
      await flagHuman(contact, budget.reason, false);
      return mark(pending, "SKIPPED", budget.reason);
    }

    // 9. Claude
    const claude = getClaude();
    if (!claude.mock && !(await getSecret("anthropic_api_key"))) {
      await logError("CLAUDE", new ClaudeNotConfiguredError(), {}, contactId);
      return mark(pending, "SKIPPED", "Claude no está configurado");
    }

    const last = pending[pending.length - 1];
    if (!contact.isSimulated && last.waMessageId && (general.markAsRead || general.typingIndicator)) {
      try {
        const wa = await getWhatsAppClient();
        if (wa.configured) await wa.markRead(last.waMessageId, general.typingIndicator);
      } catch (err) {
        await logError("WHATSAPP", err, { step: "markRead" }, contactId, "warn");
      }
    }

    const [{ turns, humanRepliesInHistory }, prepared, memories] = await Promise.all([
      loadHistory(contactId, pending[0].createdAt, ai.historyMessages),
      prepareInboundContent(pending, contact.isSimulated),
      ai.memoryEnabled ? loadMemories(contactId, ai.maxMemoryFacts) : Promise.resolve([]),
    ]);
    const knowledgeQuery = pending
      .map((m) => [m.text, m.transcription].filter(Boolean).join(" "))
      .join(" ")
      .slice(0, 1000);
    const knowledge =
      ai.knowledgeEnabled && knowledgeQuery.trim().length >= 3 ? await searchKnowledge(knowledgeQuery, ai.knowledgeResults) : [];

    const messages = mergeTurns([...turns, { role: "user", content: prepared.blocks }]);
    if (!messages.length || messages[messages.length - 1].role !== "user") {
      return mark(pending, "SKIPPED", "Mensaje sin contenido para responder");
    }

    const stableSystem = buildStableSystemPrompt(ai, {
      knowledgeTool: ai.knowledgeEnabled && ai.toolKnowledgeSearch,
      handoffTool: ai.toolHandoff,
    });
    const dynamicContext = buildDynamicContext({
      now,
      timezone: general.timezone,
      contact,
      memories,
      memoryEnabled: ai.memoryEnabled,
      knowledgeEnabled: ai.knowledgeEnabled,
      knowledge,
      outOfHours,
      humanRepliesInHistory,
      unsupportedMedia: prepared.notes,
    });

    let result;
    try {
      result = await generateReply({ settings: ai, stableSystem, dynamicContext, messages, contactRef: contactId }, claude);
    } catch (err) {
      const { message, retryable } = describeClaudeError(err);
      await logError("CLAUDE", message, { attempt: job.attempts }, contactId);
      if (retryable && job.attempts < job.maxAttempts) throw err; // la cola reintenta; los mensajes siguen pendientes
      await flagHuman(contact, `La IA no pudo responder: ${message}`, false);
      return mark(pending, "SKIPPED", message.slice(0, 300));
    }

    const usage = await prisma.aiUsage.create({
      data: {
        contactId,
        kind: contact.isSimulated ? "TEST" : "REPLY",
        model: result.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        cacheReadTokens: result.usage.cacheReadTokens,
        cacheWriteTokens: result.usage.cacheWriteTokens,
        costUsd: result.costUsd,
        latencyMs: result.latencyMs,
        stopReason: result.stopReason,
      },
    });

    // 10. Comprobaciones finales: ¿se pausó mientras se generaba? ¿llegaron mensajes nuevos?
    const fresh = await prisma.contact.findUnique({ where: { id: contactId } });
    const generalNow = await getSection("general");
    if (!fresh || fresh.blocked || fresh.aiPaused || fresh.optedOut || !generalNow.assistantEnabled) {
      return mark(pending, "SKIPPED", "Se pausó la IA mientras se generaba la respuesta");
    }
    // Si una persona respondió mientras tanto, los mensajes ya no están pendientes: no enviar nada.
    const stillPending = await prisma.message.count({
      where: { id: { in: pending.map((m) => m.id) }, replyState: "PENDING" },
    });
    if (stillPending < pending.length) return mark(pending, "SKIPPED", "Respondido por otra vía mientras se generaba");
    const newer = await prisma.message.count({
      where: { contactId, direction: "INBOUND", replyState: "PENDING", id: { notIn: pending.map((m) => m.id) } },
    });
    if (newer > 0 && pass < MAX_REGENERATIONS) continue; // regenerar teniendo en cuenta los mensajes nuevos

    // 11. Rechazo por filtros de seguridad (incluso tras el reintento en el modelo de respaldo)
    if (result.refusal) {
      await logError("CLAUDE", `Claude no respondió por sus filtros de seguridad (${result.refusal.category ?? "sin categoría"})`, {}, contactId, "warn");
      await flagHuman(fresh, "La IA no pudo responder a este mensaje (filtro de seguridad)", false);
      return mark(pending, "SKIPPED", "Rechazado por los filtros de seguridad de Claude");
    }

    // 12. Envío
    const text = markdownToWhatsApp(result.text);
    if (!text) return mark(pending, "SKIPPED", "La IA devolvió una respuesta vacía");
    const bubbles = splitForWhatsApp(text, ai.splitParagraphs);
    const responseTimeMs = Date.now() - pending[pending.length - 1].createdAt.getTime();
    for (let i = 0; i < bubbles.length; i++) {
      await queueText(fresh, bubbles[i], {
        author: "AI",
        aiUsageId: usage.id,
        responseTimeMs: i === 0 ? responseTimeMs : null,
      });
    }
    await mark(pending, "ANSWERED", null);

    // 13. Derivación pedida por la IA (herramienta request_human_agent)
    if (result.handoffReason) await flagHuman(fresh, `La IA derivó: ${result.handoffReason}`, true);

    // 14. Memoria a largo plazo: se actualiza cada N mensajes
    if (ai.memoryEnabled) {
      const updated = await prisma.contact.update({
        where: { id: contactId },
        data: { messagesSinceMemoryUpdate: { increment: pending.length + bubbles.length } },
      });
      if (updated.messagesSinceMemoryUpdate >= ai.memoryUpdateEvery) {
        await getQueue().enqueue("memory_update", { contactId }, { dedupeKey: `memory:${contactId}`, delayMs: 5_000, maxAttempts: 2 });
      }
    }
    return;
  }
}
