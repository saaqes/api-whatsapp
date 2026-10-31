import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Brain, Check, MessagesSquare, Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { api, errorText } from "../services/api";
import type { Contact, Memory } from "../services/types";
import {
  Avatar,
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  Field,
  IconButton,
  Input,
  Loading,
  Select,
  Switch,
  TagInput,
  Textarea,
  useConfirm,
  useToast,
} from "../components/ui";
import { CLASSIFICATION_LABELS, MEMORY_CATEGORY_LABELS, contactName, formatPhone, timeAgo, usd } from "../lib/format";
import { useAuth } from "../hooks/useAuth";

function MemoryRow({ m, contactId }: { m: Memory; contactId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(m.content);
  const refresh = () => qc.invalidateQueries({ queryKey: ["contact", contactId] });
  const save = useMutation({
    mutationFn: () => api.patch(`/api/contacts/${contactId}/memories/${m.id}`, { content }),
    onSuccess: () => {
      setEditing(false);
      refresh();
    },
    onError: (e) => toast(errorText(e), "critical"),
  });
  const del = useMutation({ mutationFn: () => api.del(`/api/contacts/${contactId}/memories/${m.id}`), onSuccess: refresh });
  return (
    <li className="flex items-start gap-3 px-5 py-3">
      <Badge tone={m.source === "MANUAL" ? "accent" : "neutral"} className="mt-0.5">
        {MEMORY_CATEGORY_LABELS[m.category]}
      </Badge>
      {editing ? (
        <div className="flex flex-1 gap-2">
          <Input value={content} onChange={(e) => setContent(e.target.value)} maxLength={300} autoFocus />
          <IconButton label="Guardar" onClick={() => save.mutate()}>
            <Check className="size-4" />
          </IconButton>
          <IconButton label="Cancelar" onClick={() => setEditing(false)}>
            <X className="size-4" />
          </IconButton>
        </div>
      ) : (
        <>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] text-ink">{m.content}</p>
            <p className="text-[11px] text-ink-3">
              {m.source === "MANUAL" ? "Añadido por el equipo" : "Aprendido de la conversación"} · {timeAgo(m.updatedAt)}
            </p>
          </div>
          <IconButton label="Editar" onClick={() => setEditing(true)}>
            <Pencil className="size-3.5" />
          </IconButton>
          <IconButton label="Eliminar" onClick={() => del.mutate()}>
            <Trash2 className="size-3.5" />
          </IconButton>
        </>
      )}
    </li>
  );
}

export default function ContactDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ["contact", id], queryFn: () => api.get<Contact>(`/api/contacts/${id}`) });
  const c = q.data;

  const [form, setForm] = useState({ displayName: "", tags: [] as string[], notes: "", summary: "", classification: "" });
  useEffect(() => {
    if (c) setForm({ displayName: c.displayName ?? "", tags: c.tags, notes: c.notes, summary: c.summary, classification: c.classification ?? "" });
  }, [c]);
  const [newFact, setNewFact] = useState("");
  const [newCat, setNewCat] = useState<Memory["category"]>("OTHER");

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["contact", id] });
    qc.invalidateQueries({ queryKey: ["contacts"] });
    qc.invalidateQueries({ queryKey: ["conversations"] });
  };
  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.patch(`/api/contacts/${id}`, patch),
    onSuccess: () => {
      toast("Contacto actualizado");
      refresh();
    },
    onError: (e) => toast(errorText(e), "critical"),
  });
  const aiToggle = useMutation({
    mutationFn: (paused: boolean) => api.patch(`/api/conversations/${id}/ai`, { paused }),
    onSuccess: refresh,
  });
  const addFact = useMutation({
    mutationFn: () => api.post(`/api/contacts/${id}/memories`, { content: newFact, category: newCat }),
    onSuccess: () => {
      setNewFact("");
      refresh();
    },
    onError: (e) => toast(errorText(e), "critical"),
  });
  const refreshMemory = useMutation({
    mutationFn: () => api.post<{ applied: boolean; reason?: string }>(`/api/contacts/${id}/memories/refresh`),
    onSuccess: (r) => {
      toast(r.applied ? "Memoria actualizada con la conversación" : `Sin cambios: ${r.reason}`, r.applied ? "good" : "neutral");
      refresh();
    },
    onError: (e) => toast(errorText(e), "critical"),
  });
  const wipeMemory = useMutation({ mutationFn: () => api.del(`/api/contacts/${id}/memories`), onSuccess: refresh });
  const remove = useMutation({
    mutationFn: () => api.del(`/api/contacts/${id}`),
    onSuccess: () => {
      toast("Contacto y todos sus datos eliminados");
      navigate("/contactos");
    },
    onError: (e) => toast(errorText(e), "critical"),
  });

  if (q.isLoading) return <Loading />;
  if (!c) return <EmptyState title="Contacto no encontrado" />;

  return (
    <div className="mx-auto max-w-6xl p-4 lg:p-6">
      <Link to="/contactos" className="mb-4 inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink">
        <ArrowLeft className="size-4" /> Contactos
      </Link>
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <Avatar name={contactName(c)} className="size-12 text-base" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold text-ink">{contactName(c)}</h1>
          <p className="text-[13px] text-ink-3">
            {formatPhone(c.waId)} · desde {new Date(c.createdAt).toLocaleDateString("es")} · {c._count?.messages ?? 0} mensajes · costo IA {usd(c.usage?.costUsd)}
          </p>
        </div>
        <Link to={`/conversaciones/${c.id}`}>
          <Button icon={<MessagesSquare className="size-4" />}>Ver conversación</Button>
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="Información" />
            <div className="space-y-4 p-5">
              <Field label="Nombre" hint={c.profileName ? `Nombre en WhatsApp: ${c.profileName}` : undefined}>
                <Input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} placeholder={c.profileName ?? "Sin nombre"} />
              </Field>
              <Field label="Etiquetas" hint="Enter o coma para añadir.">
                <TagInput value={form.tags} onChange={(tags) => setForm({ ...form, tags })} placeholder="vip, mayorista…" />
              </Field>
              <Field label="Clasificación">
                <Select value={form.classification} onChange={(e) => setForm({ ...form, classification: e.target.value })}>
                  <option value="">Sin clasificar</option>
                  {Object.entries(CLASSIFICATION_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Notas internas" hint="Solo las ve el equipo; la IA no las usa.">
                <Textarea rows={4} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </Field>
              {c.lastIntent && <p className="text-[12px] text-ink-3">Última intención detectada: <span className="text-ink-2">{c.lastIntent}</span></p>}
              <Button
                variant="primary"
                loading={save.isPending}
                onClick={() =>
                  save.mutate({ displayName: form.displayName || null, tags: form.tags, notes: form.notes, classification: form.classification || null })
                }
              >
                Guardar cambios
              </Button>
            </div>
          </Card>

          <Card>
            <CardHeader title="Control" />
            <div className="space-y-4 p-5">
              <Switch
                label="IA activa para este contacto"
                description="Si la pausas, la IA no le responderá y tú podrás contestar manualmente."
                checked={!c.aiPaused}
                onChange={(on) => aiToggle.mutate(!on)}
              />
              <Switch
                label="Bloquear / excluir"
                description="No recibirá ninguna respuesta automática. Sus mensajes se siguen guardando."
                checked={c.blocked}
                onChange={(v) => save.mutate({ blocked: v })}
              />
              {c.optedOut && <Callout tone="warning">Este contacto escribió STOP: no recibe mensajes automáticos ni plantillas.</Callout>}
            </div>
          </Card>

          {can("OWNER", "ADMIN") && (
            <Card className="border-critical/30">
              <CardHeader title="Zona peligrosa" />
              <div className="p-5">
                <p className="mb-3 text-[13px] text-ink-2">Elimina el contacto con todos sus mensajes, memoria y registros de uso. No se puede deshacer.</p>
                <Button
                  variant="danger"
                  icon={<Trash2 className="size-4" />}
                  onClick={async () => {
                    if (await confirm({ title: "¿Eliminar contacto?", message: "Se borrarán todos sus datos de forma permanente.", danger: true, confirmLabel: "Eliminar" }))
                      remove.mutate();
                  }}
                >
                  Eliminar contacto y datos
                </Button>
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-4 lg:col-span-3">
          <Card>
            <CardHeader
              title="Memoria de la IA"
              description="Lo que la IA recuerda de esta persona. Solo se usa en SUS conversaciones."
              icon={<Brain className="size-4" />}
              actions={
                <Button size="sm" variant="ghost" icon={<RefreshCw className="size-3.5" />} loading={refreshMemory.isPending} onClick={() => refreshMemory.mutate()} title="Analiza los mensajes recientes con Claude (pequeño costo)">
                  Actualizar ahora
                </Button>
              }
            />
            {c.memories?.length ? (
              <ul className="divide-y divide-line">
                {c.memories.map((m) => (
                  <MemoryRow key={m.id} m={m} contactId={c.id} />
                ))}
              </ul>
            ) : (
              <p className="px-5 py-6 text-center text-[13px] text-ink-3">Todavía no hay datos guardados.</p>
            )}
            <div className="flex flex-wrap gap-2 border-t border-line p-4">
              <Select className="w-36" value={newCat} onChange={(e) => setNewCat(e.target.value as Memory["category"])}>
                {Object.entries(MEMORY_CATEGORY_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
              <Input
                className="min-w-48 flex-1"
                value={newFact}
                maxLength={300}
                onChange={(e) => setNewFact(e.target.value)}
                placeholder="Ej.: Prefiere que le hablen de usted"
                onKeyDown={(e) => e.key === "Enter" && newFact.trim() && addFact.mutate()}
              />
              <Button icon={<Plus className="size-4" />} disabled={!newFact.trim()} loading={addFact.isPending} onClick={() => addFact.mutate()}>
                Añadir
              </Button>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Resumen de conversaciones"
              description={c.summaryUpdatedAt ? `Actualizado ${timeAgo(c.summaryUpdatedAt)}` : "Se genera automáticamente cada pocos mensajes"}
            />
            <div className="space-y-3 p-5">
              <Textarea rows={6} value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} placeholder="Sin resumen todavía." />
              <div className="flex flex-wrap gap-2">
                <Button loading={save.isPending} onClick={() => save.mutate({ summary: form.summary })}>
                  Guardar resumen
                </Button>
                <Button
                  variant="ghost"
                  onClick={async () => {
                    if (await confirm({ title: "¿Borrar toda la memoria?", message: "Se eliminarán los datos recordados y el resumen de este contacto. Los mensajes no se borran.", danger: true, confirmLabel: "Borrar memoria" }))
                      wipeMemory.mutate();
                  }}
                >
                  Borrar toda la memoria
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
