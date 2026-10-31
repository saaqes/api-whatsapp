import { prisma } from "../database/prisma.js";
import { localParts } from "../utils/time.js";
import { startOfLocalDay } from "./budget.service.js";

type Row = Record<string, unknown>;
const num = (v: unknown) => Number(v ?? 0);

/** Estadísticas diarias en la zona horaria del negocio (excluye contactos del simulador). */
export async function getStats(days: number, timeZone: string) {
  const now = new Date();
  const from = new Date(startOfLocalDay(now, timeZone).getTime() - (days - 1) * 24 * 60 * 60_000);

  const [messages, conversations, newContacts, responseTimes, usage, byModel, billable] = await Promise.all([
    prisma.$queryRaw<Row[]>`
      SELECT to_char((m."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS day,
             m.direction::text AS direction, m.author::text AS author, count(*)::int AS n
      FROM "Message" m JOIN "Contact" c ON c.id = m."contactId"
      WHERE m."createdAt" >= ${from} AND c."isSimulated" = false
      GROUP BY 1, 2, 3`,
    prisma.$queryRaw<Row[]>`
      SELECT to_char((m."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS day,
             count(DISTINCT m."contactId")::int AS n
      FROM "Message" m JOIN "Contact" c ON c.id = m."contactId"
      WHERE m."createdAt" >= ${from} AND c."isSimulated" = false AND m.direction = 'INBOUND'
      GROUP BY 1`,
    prisma.$queryRaw<Row[]>`
      SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS day, count(*)::int AS n
      FROM "Contact" WHERE "createdAt" >= ${from} AND "isSimulated" = false GROUP BY 1`,
    prisma.$queryRaw<Row[]>`
      SELECT to_char((m."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS day,
             m.author::text AS author, avg(m."responseTimeMs")::float AS avg_ms, count(*)::int AS n
      FROM "Message" m JOIN "Contact" c ON c.id = m."contactId"
      WHERE m."createdAt" >= ${from} AND c."isSimulated" = false AND m."responseTimeMs" IS NOT NULL
      GROUP BY 1, 2`,
    prisma.$queryRaw<Row[]>`
      SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS day,
             sum("inputTokens")::bigint AS input, sum("outputTokens")::bigint AS output,
             sum("cacheReadTokens")::bigint AS cache_read, sum("cacheWriteTokens")::bigint AS cache_write,
             sum("costUsd")::float AS cost, count(*)::int AS calls
      FROM "AiUsage" WHERE "createdAt" >= ${from}
      GROUP BY 1`,
    prisma.$queryRaw<Row[]>`
      SELECT model, kind::text AS kind, sum("inputTokens")::bigint AS input, sum("outputTokens")::bigint AS output,
             sum("costUsd")::float AS cost, count(*)::int AS calls
      FROM "AiUsage" WHERE "createdAt" >= ${from} GROUP BY 1, 2 ORDER BY cost DESC`,
    prisma.$queryRaw<Row[]>`
      SELECT coalesce("pricingCategory", 'desconocida') AS category, count(*)::int AS n
      FROM "Message" WHERE "createdAt" >= ${from} AND billable = true GROUP BY 1`,
  ]);

  const series: Array<Record<string, number | string>> = [];
  for (let i = 0; i < days; i++) {
    const d = localParts(new Date(from.getTime() + i * 24 * 60 * 60_000 + 12 * 60 * 60_000), timeZone).dateKey;
    series.push({
      day: d,
      inbound: 0,
      outboundAi: 0,
      outboundHuman: 0,
      outboundAutomation: 0,
      conversations: 0,
      newContacts: 0,
      avgAiResponseMs: 0,
      avgHumanResponseMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      costUsd: 0,
      aiCalls: 0,
    });
  }
  const byDay = new Map(series.map((s) => [s.day as string, s]));
  for (const r of messages) {
    const s = byDay.get(r.day as string);
    if (!s) continue;
    if (r.direction === "INBOUND") s.inbound = num(s.inbound) + num(r.n);
    else if (r.author === "AI") s.outboundAi = num(s.outboundAi) + num(r.n);
    else if (r.author === "HUMAN") s.outboundHuman = num(s.outboundHuman) + num(r.n);
    else s.outboundAutomation = num(s.outboundAutomation) + num(r.n);
  }
  for (const r of conversations) {
    const s = byDay.get(r.day as string);
    if (s) s.conversations = num(r.n);
  }
  for (const r of newContacts) {
    const s = byDay.get(r.day as string);
    if (s) s.newContacts = num(r.n);
  }
  for (const r of responseTimes) {
    const s = byDay.get(r.day as string);
    if (!s) continue;
    if (r.author === "AI") s.avgAiResponseMs = Math.round(num(r.avg_ms));
    if (r.author === "HUMAN") s.avgHumanResponseMs = Math.round(num(r.avg_ms));
  }
  for (const r of usage) {
    const s = byDay.get(r.day as string);
    if (!s) continue;
    s.inputTokens = num(r.input);
    s.outputTokens = num(r.output);
    s.cacheReadTokens = num(r.cache_read);
    s.costUsd = Math.round(num(r.cost) * 10000) / 10000;
    s.aiCalls = num(r.calls);
  }

  const sum = (k: string) => series.reduce((a, s) => a + num(s[k]), 0);
  const aiResponses = responseTimes.filter((r) => r.author === "AI");
  const aiN = aiResponses.reduce((a, r) => a + num(r.n), 0);
  const avgAi = aiN ? aiResponses.reduce((a, r) => a + num(r.avg_ms) * num(r.n), 0) / aiN : 0;

  return {
    from,
    days,
    series,
    totals: {
      inbound: sum("inbound"),
      outboundAi: sum("outboundAi"),
      outboundHuman: sum("outboundHuman"),
      outboundAutomation: sum("outboundAutomation"),
      newContacts: sum("newContacts"),
      inputTokens: sum("inputTokens"),
      outputTokens: sum("outputTokens"),
      cacheReadTokens: sum("cacheReadTokens"),
      costUsd: Math.round(sum("costUsd") * 10000) / 10000,
      aiCalls: sum("aiCalls"),
      avgAiResponseMs: Math.round(avgAi),
      uniqueContacts: num(
        (
          await prisma.$queryRaw<Row[]>`
            SELECT count(DISTINCT m."contactId")::int AS n FROM "Message" m JOIN "Contact" c ON c.id = m."contactId"
            WHERE m."createdAt" >= ${from} AND c."isSimulated" = false AND m.direction = 'INBOUND'`
        )[0]?.n,
      ),
    },
    byModel: byModel.map((r) => ({
      model: r.model,
      kind: r.kind,
      inputTokens: num(r.input),
      outputTokens: num(r.output),
      costUsd: num(r.cost),
      calls: num(r.calls),
    })),
    whatsappBillable: billable.map((r) => ({ category: r.category, count: num(r.n) })),
  };
}
