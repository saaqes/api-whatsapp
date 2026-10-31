import { prisma } from "../database/prisma.js";
import { getSection } from "./settings.service.js";
import { localParts } from "../utils/time.js";

/** Medianoche local (en la zona horaria del negocio) del día de `date`, en UTC. */
export function startOfLocalDay(date: Date, timeZone: string): Date {
  const { minutes } = localParts(date, timeZone);
  const seconds = date.getUTCSeconds();
  return new Date(date.getTime() - minutes * 60_000 - seconds * 1000 - date.getUTCMilliseconds());
}

export function startOfLocalMonth(date: Date, timeZone: string): Date {
  const { dateKey } = localParts(date, timeZone);
  const day = Number(dateKey.slice(8, 10));
  const dayStart = startOfLocalDay(date, timeZone);
  // Retrocede (día-1) días; un cambio de horario en medio del mes desplaza como mucho 1 hora.
  return new Date(dayStart.getTime() - (day - 1) * 24 * 60 * 60_000);
}

export async function spendSince(from: Date): Promise<number> {
  const r = await prisma.aiUsage.aggregate({ where: { createdAt: { gte: from } }, _sum: { costUsd: true } });
  return r._sum.costUsd ?? 0;
}

export type BudgetBlock =
  | { blocked: false }
  | { blocked: true; scope: "global" | "contact"; reason: string };

/**
 * Comprueba los límites de gasto antes de llamar a Claude:
 * gasto diario y mensual estimado, y número de respuestas por contacto (anti-abuso).
 */
export async function checkBudget(contactId: string, now = new Date()): Promise<BudgetBlock> {
  const budget = await getSection("budget");
  const { timezone } = await getSection("general");

  if (budget.dailyUsdLimit > 0) {
    const today = await spendSince(startOfLocalDay(now, timezone));
    if (today >= budget.dailyUsdLimit) {
      return { blocked: true, scope: "global", reason: `Límite diario alcanzado ($${today.toFixed(2)} de $${budget.dailyUsdLimit})` };
    }
  }
  if (budget.monthlyUsdLimit > 0) {
    const month = await spendSince(startOfLocalMonth(now, timezone));
    if (month >= budget.monthlyUsdLimit) {
      return { blocked: true, scope: "global", reason: `Límite mensual alcanzado ($${month.toFixed(2)} de $${budget.monthlyUsdLimit})` };
    }
  }
  if (budget.perContactRepliesPerHour > 0) {
    const n = await prisma.aiUsage.count({
      where: { contactId, kind: "REPLY", createdAt: { gte: new Date(now.getTime() - 60 * 60_000) } },
    });
    if (n >= budget.perContactRepliesPerHour) {
      return { blocked: true, scope: "contact", reason: `Este contacto superó ${budget.perContactRepliesPerHour} respuestas por hora` };
    }
  }
  if (budget.perContactRepliesPerDay > 0) {
    const n = await prisma.aiUsage.count({
      where: { contactId, kind: "REPLY", createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60_000) } },
    });
    if (n >= budget.perContactRepliesPerDay) {
      return { blocked: true, scope: "contact", reason: `Este contacto superó ${budget.perContactRepliesPerDay} respuestas en 24 h` };
    }
  }
  return { blocked: false };
}
