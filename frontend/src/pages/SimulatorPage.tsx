import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Brain, FlaskConical, Plus, Trash2 } from "lucide-react";
import { api, errorText } from "../services/api";
import type { Contact, Memory } from "../services/types";
import { Badge, Button, Callout, Card, CardHeader, EmptyState, Input, Loading, PageHeader, cx, useConfirm, useToast } from "../components/ui";
import { ChatView } from "../components/ChatView";
import { compact, timeAgo, usd } from "../lib/format";

interface Debug {
  contact: Contact & { memories: Memory[] };
  usage: Array<{ id: string; kind: string; model: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; costUsd: number; latencyMs: number; createdAt: string }>;
  pendingJobs: number;
}

export default function SimulatorPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const contacts = useQuery({ queryKey: ["sim-contacts"], queryFn: () => api.get<{ items: Contact[] }>("/api/simulator/contacts") });
  const current = contacts.data?.items.find((c) => c.id === selected) ?? contacts.data?.items[0] ?? null;
  const conv = useQuery({
    queryKey: ["conversation", current?.id],
    queryFn: () => api.get<Contact>(`/api/conversations/${current!.id}`),
    enabled: Boolean(current),
    refetchInterval: 3000,
  });
  const debug = useQuery({
    queryKey: ["sim-debug", current?.id],
    queryFn: () => api.get<Debug>(`/api/simulator/contacts/${current!.id}/debug`),
    enabled: Boolean(current),
    refetchInterval: 2500,
  });
  const create = useMutation({
    mutationFn: () => api.post<Contact>("/api/simulator/contacts", { name: name.trim() || "Cliente de prueba" }),
    onSuccess: (c) => {
      setName("");
      setSelected(c.id);
      qc.invalidateQueries({ queryKey: ["sim-contacts"] });
    },
    onError: (e) => toast(errorText(e), "critical"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/simulator/contacts/${id}`),
    onSuccess: () => {
      setSelected(null);
      qc.invalidateQueries({ queryKey: ["sim-contacts"] });
    },
  });

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col p-4 lg:p-6">
      <PageHeader
        title="Simulador"
        description="Conversa con tu IA como si fueras un cliente. Usa exactamente la misma configuración, memoria, conocimiento y automatizaciones que WhatsApp, pero nada se envía a números reales."
      />
      <Callout tone="neutral">
        Cada respuesta usa Claude de verdad y tiene costo (se registra como «Simulador» en Estadísticas). Las automatizaciones y la bienvenida también se aplican aquí.
      </Callout>

      <div className="mt-4 grid min-h-0 flex-1 gap-4 lg:grid-cols-[240px_1fr_300px]">
        <Card className="flex flex-col">
          <CardHeader title="Clientes simulados" />
          <form
            className="flex gap-2 border-b border-line p-3"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre" maxLength={60} />
            <Button type="submit" variant="primary" loading={create.isPending} aria-label="Crear cliente simulado">
              <Plus className="size-4" />
            </Button>
          </form>
          {contacts.isLoading ? (
            <Loading />
          ) : !contacts.data?.items.length ? (
            <EmptyState icon={<FlaskConical className="size-5" />} title="Crea un cliente de prueba" />
          ) : (
            <ul className="scrollbar-thin flex-1 overflow-y-auto">
              {contacts.data.items.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => setSelected(c.id)}
                    className={cx("flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-[13px] hover:bg-surface-2", current?.id === c.id && "bg-surface-2 font-medium")}
                  >
                    <span className="truncate text-ink">{c.profileName}</span>
                    <span className="text-[11px] text-ink-3">{timeAgo(c.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="flex min-h-[480px] flex-col overflow-hidden">
          {current && conv.data ? (
            <>
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <div>
                  <p className="font-semibold text-ink">{current.profileName}</p>
                  <p className="text-[12px] text-ink-3">Contacto simulado {conv.data.aiPaused && "· IA pausada"}</p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Trash2 className="size-4" />}
                  onClick={async () => {
                    if (await confirm({ title: "¿Borrar este cliente simulado?", message: "Se eliminan sus mensajes y su memoria.", danger: true, confirmLabel: "Borrar" }))
                      remove.mutate(current.id);
                  }}
                >
                  Borrar
                </Button>
              </div>
              <div className="min-h-0 flex-1">
                <ChatView contact={conv.data} mode="simulator" />
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <EmptyState icon={<FlaskConical className="size-5" />} title="Elige o crea un cliente simulado" />
            </div>
          )}
        </Card>

        <Card className="flex flex-col">
          <CardHeader title="Lo que sabe la IA" icon={<Brain className="size-4" />} />
          <div className="scrollbar-thin flex-1 space-y-4 overflow-y-auto p-4 text-[13px]">
            {!debug.data ? (
              <p className="text-ink-3">—</p>
            ) : (
              <>
                {debug.data.pendingJobs > 0 && <Badge tone="accent">Procesando respuesta…</Badge>}
                <div>
                  <p className="mb-1 text-[12px] font-medium text-ink-3">Datos recordados</p>
                  {debug.data.contact.memories.length ? (
                    <ul className="list-disc space-y-1 pl-4 text-ink-2">
                      {debug.data.contact.memories.map((m) => (
                        <li key={m.id}>{m.content}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-ink-3">Nada aún (se actualiza cada pocos mensajes).</p>
                  )}
                </div>
                <div>
                  <p className="mb-1 text-[12px] font-medium text-ink-3">Resumen</p>
                  <p className="text-ink-2">{debug.data.contact.summary || "—"}</p>
                </div>
                <div>
                  <p className="mb-1 text-[12px] font-medium text-ink-3">Últimas llamadas a Claude</p>
                  {debug.data.usage.length === 0 ? (
                    <p className="text-ink-3">—</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {debug.data.usage.map((u) => (
                        <li key={u.id} className="rounded-lg bg-surface-2 px-2.5 py-1.5 text-[12px]">
                          <div className="flex justify-between">
                            <span className="text-ink">{u.kind === "MEMORY" ? "Memoria" : "Respuesta"}</span>
                            <span className="font-medium tabular-nums text-ink">{usd(u.costUsd, 4)}</span>
                          </div>
                          <p className="text-ink-3 tabular-nums">
                            {compact(u.inputTokens)} ent. · {compact(u.outputTokens)} sal. · {compact(u.cacheReadTokens)} caché · {(u.latencyMs / 1000).toFixed(1)} s
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
