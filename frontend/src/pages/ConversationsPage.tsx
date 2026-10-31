import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Bot, CheckCircle2, MessagesSquare, Search, UserRound } from "lucide-react";
import { api, errorText } from "../services/api";
import type { Contact } from "../services/types";
import { Avatar, Badge, Button, EmptyState, Input, Loading, Switch, cx, useToast } from "../components/ui";
import { ChatView } from "../components/ChatView";
import { contactName, formatPhone, shortTime, windowRemaining } from "../lib/format";

const FILTERS = [
  { value: "all", label: "Todas" },
  { value: "needs_human", label: "Requieren atención" },
  { value: "unread", label: "No leídas" },
  { value: "paused", label: "IA pausada" },
  { value: "blocked", label: "Bloqueadas" },
] as const;

function ConversationHeader({ contact }: { contact: Contact }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["conversation", contact.id] });
    qc.invalidateQueries({ queryKey: ["conversations"] });
    qc.invalidateQueries({ queryKey: ["messages", contact.id] });
  };
  const toggleAi = useMutation({
    mutationFn: (paused: boolean) => api.patch(`/api/conversations/${contact.id}/ai`, { paused }),
    onSuccess: (_d, paused) => {
      refresh();
      toast(paused ? "IA pausada: ahora respondes tú" : "IA reactivada para este contacto");
    },
    onError: (e) => toast(errorText(e), "critical"),
  });
  const resolve = useMutation({
    mutationFn: () => api.post(`/api/conversations/${contact.id}/resolve`),
    onSuccess: refresh,
  });
  const left = windowRemaining(contact.lastInboundAt);
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-3">
      <button className="text-ink-2 lg:hidden" onClick={() => navigate("/conversaciones")} aria-label="Volver">
        <ArrowLeft className="size-5" />
      </button>
      <Avatar name={contactName(contact)} className="hidden sm:flex" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-ink">{contactName(contact)}</p>
        <p className="truncate text-[12px] text-ink-3">
          {formatPhone(contact.waId)}
          {!contact.isSimulated &&
            (left ? <span className="hidden sm:inline"> · Ventana abierta ({left} restantes)</span> : <span className="text-warning"> · Ventana cerrada</span>)}
        </p>
      </div>
      {contact.needsHuman && (
        <Button size="sm" variant="secondary" className="order-last sm:order-none" icon={<CheckCircle2 className="size-4" />} loading={resolve.isPending} onClick={() => resolve.mutate()}>
          Marcar atendido
        </Button>
      )}
      <div className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 sm:px-3">
        <Bot className={cx("size-4", contact.aiPaused ? "text-ink-3" : "text-accent")} />
        <span className="text-[12px] font-medium text-ink">{contact.aiPaused ? "IA pausada" : "IA activa"}</span>
        <Switch size="sm" checked={!contact.aiPaused} onChange={(on) => toggleAi.mutate(!on)} disabled={toggleAi.isPending} />
      </div>
      <Link to={`/contactos/${contact.id}`} className="inline-flex size-8 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-2" title="Ver ficha del contacto">
        <UserRound className="size-4" />
      </Link>
      {contact.needsHuman && contact.needsHumanReason && (
        <p className="w-full rounded-lg bg-critical-soft px-3 py-1.5 text-[12px] text-critical">Requiere atención: {contact.needsHumanReason}</p>
      )}
    </div>
  );
}

export default function ConversationsPage() {
  const { id } = useParams();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["value"]>("all");

  const list = useQuery({
    queryKey: ["conversations", filter, search],
    queryFn: () => api.get<{ items: Contact[] }>(`/api/conversations?filter=${filter}&search=${encodeURIComponent(search)}`),
    refetchInterval: 5000,
  });
  const current = useQuery({
    queryKey: ["conversation", id],
    queryFn: () => api.get<Contact>(`/api/conversations/${id}`),
    enabled: Boolean(id),
    refetchInterval: 5000,
  });

  return (
    <div className="flex h-full min-h-0">
      <section className={cx("flex w-full min-w-0 flex-col border-r border-line bg-surface lg:w-[360px] lg:shrink-0", id && "hidden lg:flex")}>
        <div className="space-y-3 border-b border-line p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
            <Input placeholder="Buscar nombre, número o mensaje…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <div className="scrollbar-thin -mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={cx(
                  "h-7 shrink-0 rounded-full px-3 text-[12px] font-medium transition-colors",
                  filter === f.value ? "bg-ink text-surface" : "bg-surface-2 text-ink-2 hover:text-ink",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
          {list.isLoading ? (
            <Loading />
          ) : !list.data?.items.length ? (
            <EmptyState
              icon={<MessagesSquare className="size-5" />}
              title={search ? "Sin resultados" : "No hay conversaciones"}
              description={search ? "Prueba con otro término." : "Cuando alguien escriba a tu WhatsApp aparecerá aquí. Mientras tanto, puedes usar el Simulador."}
            />
          ) : (
            <ul>
              {list.data.items.map((c) => (
                <li key={c.id}>
                  <Link
                    to={`/conversaciones/${c.id}`}
                    className={cx(
                      "flex items-start gap-3 border-b border-line/60 px-3 py-3 transition-colors hover:bg-surface-2",
                      c.id === id && "bg-surface-2",
                    )}
                  >
                    <Avatar name={contactName(c)} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className={cx("truncate text-[13px] text-ink", c.unreadCount > 0 ? "font-semibold" : "font-medium")}>{contactName(c)}</p>
                        <span className="shrink-0 text-[11px] text-ink-3">{shortTime(c.lastMessageAt)}</span>
                      </div>
                      <p className="truncate text-[12px] text-ink-3">{c.lastMessagePreview ?? ""}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {c.needsHuman && <Badge tone="critical">Atención</Badge>}
                        {c.aiPaused && <Badge tone="warning">IA pausada</Badge>}
                        {c.blocked && <Badge>Bloqueado</Badge>}
                        {c.unreadCount > 0 && <Badge tone="accent">{c.unreadCount} nuevo(s)</Badge>}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className={cx("min-w-0 flex-1 flex-col", id ? "flex" : "hidden lg:flex")}>
        {!id ? (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState icon={<MessagesSquare className="size-5" />} title="Elige una conversación" description="Verás el historial completo y podrás responder o pausar la IA." />
          </div>
        ) : current.isLoading ? (
          <Loading />
        ) : current.data ? (
          <>
            <ConversationHeader contact={current.data} />
            <div className="min-h-0 flex-1">
              <ChatView contact={current.data} />
            </div>
          </>
        ) : (
          <EmptyState title="Conversación no encontrada" />
        )}
      </section>
    </div>
  );
}
