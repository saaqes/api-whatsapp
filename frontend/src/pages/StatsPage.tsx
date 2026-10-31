import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Table2 } from "lucide-react";
import { api } from "../services/api";
import type { DayStat } from "../services/types";
import { Button, Callout, Card, CardHeader, Loading, PageHeader, Segmented, Stat } from "../components/ui";
import { DailyBars, DailyLines, dayTick } from "../components/charts";
import { compact, duration, num, usd } from "../lib/format";

interface StatsResponse {
  series: DayStat[];
  totals: {
    inbound: number;
    outboundAi: number;
    outboundHuman: number;
    outboundAutomation: number;
    newContacts: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    costUsd: number;
    aiCalls: number;
    avgAiResponseMs: number;
    uniqueContacts: number;
  };
  byModel: Array<{ model: string; kind: string; inputTokens: number; outputTokens: number; costUsd: number; calls: number }>;
  whatsappBillable: Array<{ category: string; count: number }>;
}

const KIND_LABEL: Record<string, string> = { REPLY: "Respuestas", MEMORY: "Memoria", TEST: "Simulador" };

export default function StatsPage() {
  const [days, setDays] = useState("30");
  const [table, setTable] = useState(false);
  const q = useQuery({ queryKey: ["stats", days], queryFn: () => api.get<StatsResponse>(`/api/stats?days=${days}`), placeholderData: (p) => p });
  if (!q.data) return <Loading />;
  const { series, totals } = q.data;
  const s = series.map((d) => ({ ...d, outbound: d.outboundAi + d.outboundHuman + d.outboundAutomation, aiSeconds: d.avgAiResponseMs / 1000, tokens: d.inputTokens + d.outputTokens }));

  return (
    <div className="mx-auto max-w-7xl p-4 lg:p-6">
      <PageHeader
        title="Estadísticas"
        description="Actividad y consumo (no incluye conversaciones del simulador en los mensajes). Los costos son estimaciones según los precios públicos."
        actions={
          <>
            <Segmented
              value={days}
              onChange={setDays}
              options={[
                { value: "7", label: "7 días" },
                { value: "30", label: "30 días" },
                { value: "90", label: "90 días" },
              ]}
            />
            <Button size="sm" variant="ghost" icon={table ? <BarChart3 className="size-4" /> : <Table2 className="size-4" />} onClick={() => setTable(!table)}>
              {table ? "Ver gráficos" : "Ver tabla"}
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Mensajes recibidos" value={num(totals.inbound)} hint={`${num(totals.uniqueContacts)} personas distintas`} />
        <Stat label="Mensajes enviados" value={num(totals.outboundAi + totals.outboundHuman + totals.outboundAutomation)} hint={`${num(totals.outboundAi)} IA · ${num(totals.outboundHuman)} equipo · ${num(totals.outboundAutomation)} automáticos`} />
        <Stat label="Tiempo medio de respuesta de la IA" value={duration(totals.avgAiResponseMs)} hint="Desde el último mensaje del cliente" />
        <Stat label="Costo estimado de Claude" value={usd(totals.costUsd)} hint={`${num(totals.aiCalls)} llamadas · ${compact(totals.inputTokens + totals.outputTokens)} tokens`} />
      </div>

      {table ? (
        <Card className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-right text-[13px] tabular-nums">
            <thead className="text-[12px] text-ink-3">
              <tr className="border-b border-line">
                <th className="px-4 py-2.5 text-left font-medium">Día</th>
                <th className="px-3 py-2.5 font-medium">Recibidos</th>
                <th className="px-3 py-2.5 font-medium">IA</th>
                <th className="px-3 py-2.5 font-medium">Equipo</th>
                <th className="px-3 py-2.5 font-medium">Automáticos</th>
                <th className="px-3 py-2.5 font-medium">Conversaciones</th>
                <th className="px-3 py-2.5 font-medium">Contactos nuevos</th>
                <th className="px-3 py-2.5 font-medium">Resp. IA</th>
                <th className="px-3 py-2.5 font-medium">Tokens</th>
                <th className="px-4 py-2.5 font-medium">Costo</th>
              </tr>
            </thead>
            <tbody>
              {[...s].reverse().map((d) => (
                <tr key={d.day} className="border-b border-line/60">
                  <td className="px-4 py-2 text-left text-ink">{dayTick(d.day)}</td>
                  <td className="px-3 py-2">{d.inbound}</td>
                  <td className="px-3 py-2">{d.outboundAi}</td>
                  <td className="px-3 py-2">{d.outboundHuman}</td>
                  <td className="px-3 py-2">{d.outboundAutomation}</td>
                  <td className="px-3 py-2">{d.conversations}</td>
                  <td className="px-3 py-2">{d.newContacts}</td>
                  <td className="px-3 py-2">{duration(d.avgAiResponseMs)}</td>
                  <td className="px-3 py-2">{num(d.tokens)}</td>
                  <td className="px-4 py-2">{usd(d.costUsd, 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Mensajes por día" />
            <div className="p-5">
              <DailyLines data={s} series={[{ key: "inbound", label: "Recibidos", slot: 0 }, { key: "outbound", label: "Enviados", slot: 1 }]} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Mensajes enviados por origen" />
            <div className="p-5">
              <DailyBars
                stacked
                data={s}
                series={[
                  { key: "outboundAi", label: "IA", slot: 0 },
                  { key: "outboundHuman", label: "Equipo", slot: 1 },
                  { key: "outboundAutomation", label: "Automáticos", slot: 2 },
                ]}
              />
            </div>
          </Card>
          <Card>
            <CardHeader title="Conversaciones por día" description="Personas distintas que escribieron cada día" />
            <div className="p-5">
              <DailyBars data={s} series={[{ key: "conversations", label: "Conversaciones", slot: 0 }]} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Contactos nuevos por día" />
            <div className="p-5">
              <DailyBars data={s} series={[{ key: "newContacts", label: "Contactos nuevos", slot: 0 }]} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Tiempo medio de respuesta de la IA (segundos)" />
            <div className="p-5">
              <DailyLines data={s} series={[{ key: "aiSeconds", label: "Segundos", slot: 0 }]} format={(v) => `${v.toFixed(1)} s`} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Costo estimado de Claude por día (USD)" />
            <div className="p-5">
              <DailyBars data={s} series={[{ key: "costUsd", label: "Costo", slot: 0 }]} format={(v) => usd(v, v < 1 ? 3 : 2)} />
            </div>
          </Card>
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Consumo de la API de Claude por modelo" />
          {q.data.byModel.length === 0 ? (
            <p className="px-5 py-6 text-[13px] text-ink-3">Sin consumo en el periodo.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-[13px] tabular-nums">
                <thead className="text-[12px] text-ink-3">
                  <tr className="border-b border-line">
                    <th className="px-5 py-2.5 text-left font-medium">Modelo</th>
                    <th className="px-3 py-2.5 text-left font-medium">Uso</th>
                    <th className="px-3 py-2.5 font-medium">Llamadas</th>
                    <th className="px-3 py-2.5 font-medium">Entrada</th>
                    <th className="px-3 py-2.5 font-medium">Salida</th>
                    <th className="px-5 py-2.5 font-medium">Costo</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.byModel.map((m, i) => (
                    <tr key={i} className="border-b border-line/60">
                      <td className="px-5 py-2 text-left font-mono text-[12px] text-ink">{m.model}</td>
                      <td className="px-3 py-2 text-left text-ink-2">{KIND_LABEL[m.kind] ?? m.kind}</td>
                      <td className="px-3 py-2">{num(m.calls)}</td>
                      <td className="px-3 py-2">{compact(m.inputTokens)}</td>
                      <td className="px-3 py-2">{compact(m.outputTokens)}</td>
                      <td className="px-5 py-2 font-medium text-ink">{usd(m.costUsd, 4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card>
          <CardHeader title="Mensajes facturables de WhatsApp" description="Según los estados que informa Meta" />
          <div className="p-5">
            {q.data.whatsappBillable.length === 0 ? (
              <Callout tone="good">Sin mensajes facturables en el periodo. Las respuestas dentro de la ventana de 24 h no se cobran.</Callout>
            ) : (
              <ul className="space-y-2 text-[13px]">
                {q.data.whatsappBillable.map((b) => (
                  <li key={b.category} className="flex justify-between">
                    <span className="capitalize text-ink-2">{b.category}</span>
                    <span className="font-medium tabular-nums text-ink">{num(b.count)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
