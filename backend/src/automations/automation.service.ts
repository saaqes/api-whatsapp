import { prisma, type AutomationRule, type Contact } from "../database/prisma.js";
import type { AutomationSettings } from "../services/settings.service.js";
import { isWithinSchedule } from "../utils/time.js";
import { normalizeForSearch } from "../utils/text.js";

/** Texto normalizado con espacios en los bordes para comparar palabras completas. */
function normalizeWords(text: string): string {
  return ` ${normalizeForSearch(text).replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
}

export function ruleMatches(rule: Pick<AutomationRule, "matchType" | "keywords">, text: string): boolean {
  if (rule.matchType === "ANY_MESSAGE") return true;
  const t = normalizeWords(text);
  if (t.trim() === "") return false;
  return rule.keywords.some((kw) => {
    const k = normalizeWords(kw);
    if (k.trim() === "") return false;
    switch (rule.matchType) {
      case "EXACT":
        return t === k;
      case "STARTS_WITH":
        return t.startsWith(k);
      case "CONTAINS":
      default:
        return t.includes(k);
    }
  });
}

/** Primera regla activa (por prioridad) que coincide con alguno de los textos, respetando su "cooldown". */
export async function findMatchingRule(contactId: string, texts: string[], now = new Date()): Promise<AutomationRule | null> {
  const rules = await prisma.automationRule.findMany({ where: { enabled: true }, orderBy: [{ priority: "asc" }, { createdAt: "asc" }] });
  for (const rule of rules) {
    if (!texts.some((t) => ruleMatches(rule, t))) continue;
    if (rule.cooldownMinutes > 0) {
      const recent = await prisma.automationHit.findFirst({
        where: { ruleId: rule.id, contactId, createdAt: { gte: new Date(now.getTime() - rule.cooldownMinutes * 60_000) } },
      });
      if (recent) continue;
    }
    return rule;
  }
  return null;
}

export async function recordRuleHit(ruleId: string, contactId: string) {
  await prisma.$transaction([
    prisma.automationHit.create({ data: { ruleId, contactId } }),
    prisma.automationRule.update({ where: { id: ruleId }, data: { timesTriggered: { increment: 1 } } }),
  ]);
}

export function isOutOfHours(settings: AutomationSettings, timezone: string, now = new Date()): boolean {
  if (!settings.outOfHours.enabled) return false;
  return !isWithinSchedule(now, settings.outOfHours.schedule, timezone);
}

export function shouldSendOutOfHoursNotice(settings: AutomationSettings, contact: Pick<Contact, "outOfHoursSentAt">, now = new Date()) {
  if (!contact.outOfHoursSentAt) return true;
  return now.getTime() - contact.outOfHoursSentAt.getTime() > settings.outOfHours.cooldownHours * 60 * 60_000;
}

/** "STOP", "baja"… (comparación exacta del mensaje completo, sin tildes ni mayúsculas). */
export function matchesKeywordExactly(text: string | null | undefined, keywords: string[]): boolean {
  if (!text) return false;
  const t = normalizeWords(text).trim();
  return keywords.some((k) => normalizeWords(k).trim() === t);
}
