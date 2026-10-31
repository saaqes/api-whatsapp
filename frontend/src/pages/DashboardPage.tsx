import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Bot, Coins, Inbox, MessageCircle, Send, Server, Users, Webhook } from "lucide-react";
import { api, errorText } from "../services/api";
import type { CheckResult, DayStat, ErrorLog } from "../services/types";
import { Badge, Button, Card, CardHeader, EmptyState, Loading, PageHeader, Stat, StatusPill, useToast } from "../components/ui";
import { DailyBars } from "../components/charts";
import { compact, contactName, num, timeAgo, uptime, usd } from "../lib/format";

interface Dashboard {
  assistantEnabled: boolean;
  claudeMock: boolean;
  whatsappMode: "live" | "simulation";
  checks: { whatsapp: CheckResult | null; claude: CheckResult | null };
  server: {
    version: string;
    uptimeSeconds: number;
    memoryMb: number;
    node: string;
    environment: string;
    queue: { running: number; byStatus: Record<string, number> };
    webhook: { lastReceivedAt: string | null; lastVerifiedAt: string | null; lastSignatureFailureAt: string | null; received: number };
  };
  today: { inbound: number; outbound: number; activeConversations: number; aiCalls: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; costUsd: number };
  monthCostUsd: number;
  budget: { dailyUsdLimit: number; monthlyUsdLimit: number };
  needsHuman: Array<{ id: string; waId: string; profileName: string | null; displayName: string | null; needsHumanReason: string | null; lastMessageAt: string | null }>;
  errors: ErrorLog[];
  week: DayStat[];
}

function ConnectionCard({ title, icon, check, kind, extra }: { title: string; icon: React.ReactNode; check: CheckResult | null; kind: "whatsapp" | "claude"; extra?: React.ReactNode }) {
  const qc = useQueryClient();
  const toast = useToast();
  const m = useMutation({
    mutationFn: () => api.post<CheckResult>(`/api/system/check/${kind}`),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast(r.message, r.ok ? "good" : "critical");
    },
    onError: (e) => toast(errorText(e), "critical"),
  });
  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[13px] font-medium text-ink">
          <span className="text-ink-3">{icon}</span>
          {title}
        </div>
        {check ? <StatusPill ok={check.ok} label={check.ok ? "Conectado" : "Sin conexión"} /> : <Badge>Comprobando…</Badge>}
      </div>
      <p className="mt-3 line-clamp-2 min-h-9 text-[12px] leading-relaxed text-ink-2">{check?.message ?? "—"}</p>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-[11px] text-ink-3">{extra ?? (check ? `Comprobado ${timeAgo(check.checkedAt)}` : "")}</span>
        <Button size="sm" variant="ghost" loading={m.isPending} onClick={() => m.mutate()}>
          Probar
        </Button>
      </div>
    </Card>
  );
}

export default function DashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.get<Dashboard>("/api/dashboard"),
    refetchInterval: 15_000,
  });
  if (isLoading) return <Loading />;
  if (error || !data) return <div className="p-6"><EmptyState title="No se pudo cargar el inicio" description={errorText(error)} /></div>;

  const t = data.today;
  const dailyPct = data.budget.dailyUsdLimit > 0 ? Math.min(100, (t.costUsd / data.budget.dailyUsdLimit) * 100) : null;
  const wh = data.server.webhook;
  const week = data.week.map((d) => ({ day: d.day, inbound: d.inbound, outbound: d.outboundAi + d.outboundHuman + d.outboundAutomation }));

  return (
    <div className="mx-auto max-w-7xl p-4 lg:p-6">
      <PageHeader
        title="Inicio"
        description={
          data.whatsappMode === "simulation"
            ? "WhatsApp está en modo simulación: las respuestas no se envían a números reales."
            : "Resumen en tiempo real de tu asistente."
        }
        actions={data.whatsappMode === "simulation" ? <Badge tone="warning">Modo simulación</Badge> : <Badge tone="good">WhatsApp real</Badge>}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <ConnectionCard title="WhatsApp" icon={<MessageCircle className="size-4" />} check={data.checks.whatsapp} kind="whatsapp" />
        <ConnectionCard title="Claude (IA)" icon={<Bot className="size-4" />} check={data.checks.claude} kind="claude" />
        <Card className="p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[13px] font-medium text-ink">
              <Server className="size-4 text-ink-3" /> Servidor
            </div>
            <StatusPill ok label="En línea" />
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-y-1 text-[12px]">
            <dt className="text-ink-3">Activo desde hace</dt>
            <dd className="text-right text-ink tabular-nums">{uptime(data.server.uptimeSeconds)}</dd>
            <dt className="text-ink-3">Memoria</dt>
            <dd className="text-right text-ink tabular-nums">{data.server.memoryMb} MB</dd>
            <dt className="text-ink-3">Tareas en cola</dt>
            <dd className="text-right text-ink tabular-nums">{(data.server.queue.byStatus.PENDING ?? 0) + data.server.queue.running}</dd>
            <dt className="text-ink-3">Tareas fallidas</dt>
            <dd className="text-right text-ink tabular-nums">{data.server.queue.byStatus.FAILED ?? 0}</dd>
          </dl>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[13px] font-medium text-ink">
              <Webhook className="size-4 text-ink-3" /> Webhook de Meta
            </div>
            {wh.lastSignatureFailureAt && (!wh.lastReceivedAt || wh.lastSignatureFailureAt > wh.lastReceivedAt) ? (
              <StatusPill ok={false} label="Firma inválida" />
            ) : wh.lastReceivedAt ? (
              <StatusPill ok label="Recibiendo" />
            ) : (
              <StatusPill ok={false} warn label="Sin datos" />
            )}
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-y-1 text-[12px]">
            <dt className="text-ink-3">Último evento</dt>
            <dd className="text-right text-ink">{timeAgo(wh.lastReceivedAt)}</dd>
            <dt className="text-ink-3">Verificado</dt>
            <dd className="text-right text-ink">{timeAgo(wh.lastVerifiedAt)}</dd>
            <dt className="text-ink-3">Eventos (desde inicio)</dt>
            <dd className="text-right text-ink tabular-nums">{num(wh.received)}</dd>
          </dl>
        </Card>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Mensajes recibidos hoy" value={num(t.inbound)} icon={<Inbox className="size-4" />} />
        <Stat label="Mensajes enviados hoy" value={num(t.outbound)} icon={<Send className="size-4" />} />
        <Stat label="Conversaciones activas" value={num(t.activeConversations)} hint="Con mensaje del cliente en las últimas 24 h" icon={<Users className="size-4" />} />
        <Stat
          label="Tokens hoy"
          value={compact(t.inputTokens + t.outputTokens)}
          hint={`${compact(t.inputTokens)} entrada · ${compact(t.outputTokens)} salida · ${compact(t.cacheReadTokens)} caché`}
          icon={<Bot className="size-4" />}
        />
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-[12px] font-medium text-ink-3">Costo estimado de IA hoy</p>
            <Coins className="size-4 text-ink-3" />
          </div>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-ink tabular-nums">{usd(t.costUsd)}</p>
          {dailyPct !== null && (
            <div className="mt-2">
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                <div className={dailyPct >= 90 ? "h-full bg-critical" : "h-full bg-accent"} style={{ width: `${dailyPct}%` }} />
              </div>
              <p className="mt-1 text-[11px] text-ink-3">
                Límite diario {usd(data.budget.dailyUsdLimit)} · Mes {usd(data.monthCostUsd)}
              </p>
            </div>
          )}
        </Card>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Mensajes de los últimos 7 días" description="Recibidos de clientes y enviados (IA, equipo y automatizaciones)" />
          <div className="p-5">
            <DailyBars
              data={week}
              series={[
                { key: "inbound", label: "Recibidos", slot: 0 },
                { key: "outbound", label: "Enviados", slot: 1 },
              ]}
            />
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Requieren atención"
            description="Derivados a una persona o con incidencias"
            icon={<AlertTriangle className="size-4" />}
          />
          {data.needsHuman.length === 0 ? (
            <EmptyState title="Todo en orden" description="Ningún contacto espera a una persona." />
          ) : (
            <ul className="divide-y divide-line">
              {data.needsHuman.map((c) => (
                <li key={c.id}>
                  <Link to={`/conversaciones/${c.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-ink">{contactName(c)}</p>
                      <p className="truncate text-[12px] text-ink-3">{c.needsHumanReason ?? "—"}</p>
                    </div>
                    <span className="text-[11px] text-ink-3">{timeAgo(c.lastMessageAt)}</span>
                    <ArrowRight className="size-4 text-ink-3" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-3">
        <CardHeader
          title="Errores recientes"
          actions={
            <Link to="/sistema?tab=errores" className="text-[13px] font-medium text-accent hover:underline">
              Ver todos
            </Link>
          }
        />
        {data.errors.length === 0 ? (
          <EmptyState title="Sin errores registrados" />
        ) : (
          <ul className="divide-y divide-line">
            {data.errors.map((e) => (
              <li key={e.id} className="flex items-start gap-3 px-5 py-3">
                <Badge tone={e.level === "warn" ? "warning" : "critical"}>{e.source}</Badge>
                <p className="min-w-0 flex-1 text-[13px] text-ink-2">{e.message}</p>
                <span className="shrink-0 text-[11px] text-ink-3">{timeAgo(e.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
