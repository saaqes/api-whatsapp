import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Bot, Check, CheckCheck, Clock, FileText, Mic, RotateCw, Send, User, Workflow, FileSignature } from "lucide-react";
import { api, errorText } from "../services/api";
import type { Contact, Message } from "../services/types";
import { Button, Callout, Field, Input, Modal, Select, Spinner, Textarea, cx, useToast } from "./ui";
import { clock, dayLabel } from "../lib/format";

function StatusIcon({ m }: { m: Message }) {
  if (m.direction === "INBOUND") return null;
  const map = {
    QUEUED: <Clock className="size-3.5" aria-label="En cola" />,
    SENT: <Check className="size-3.5" aria-label="Enviado" />,
    DELIVERED: <CheckCheck className="size-3.5" aria-label="Entregado" />,
    READ: <CheckCheck className="size-3.5 text-[#2a78d6]" aria-label="Leído" />,
    FAILED: <AlertCircle className="size-3.5 text-critical" aria-label="Fallido" />,
    SIMULATED: <span className="text-[10px] font-medium uppercase tracking-wide">simulado</span>,
    RECEIVED: null,
  } as const;
  return <span className="inline-flex items-center text-ink-3">{map[m.status]}</span>;
}

function AuthorTag({ m }: { m: Message }) {
  if (m.direction === "INBOUND") return null;
  const cfg = {
    AI: { icon: <Bot className="size-3" />, label: "IA" },
    HUMAN: { icon: <User className="size-3" />, label: m.authorName ?? "Equipo" },
    AUTOMATION: { icon: <Workflow className="size-3" />, label: "Automático" },
    CONTACT: { icon: null, label: "" },
  }[m.author];
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-ink-3">
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

function MediaPreview({ m, allowMedia }: { m: Message; allowMedia: boolean }) {
  if (!m.mediaId || !allowMedia) {
    if (m.type === "IMAGE" || m.type === "STICKER") return <p className="text-[12px] italic text-ink-3">[Imagen]</p>;
    if (m.type === "AUDIO") return <p className="flex items-center gap-1 text-[12px] italic text-ink-3"><Mic className="size-3.5" /> Nota de voz</p>;
    if (m.type === "DOCUMENT") return <p className="flex items-center gap-1 text-[12px] italic text-ink-3"><FileText className="size-3.5" /> {m.mediaFilename ?? "Documento"}</p>;
    if (m.type === "VIDEO") return <p className="text-[12px] italic text-ink-3">[Video]</p>;
    return null;
  }
  const src = `/api/media/${m.id}`;
  if (m.type === "IMAGE" || m.type === "STICKER") {
    return (
      <a href={src} target="_blank" rel="noreferrer">
        <img src={src} alt={m.text ?? "Imagen del cliente"} loading="lazy" className="mb-1 max-h-64 rounded-lg object-cover" />
      </a>
    );
  }
  if (m.type === "AUDIO") return <audio controls preload="none" src={src} className="mb-1 h-10 max-w-full" />;
  if (m.type === "VIDEO") return <video controls preload="none" src={src} className="mb-1 max-h-64 rounded-lg" />;
  return (
    <a href={src} target="_blank" rel="noreferrer" className="mb-1 flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-ink hover:underline">
      <FileText className="size-4 shrink-0" /> {m.mediaFilename ?? "Documento"}
    </a>
  );
}

function Bubble({ m, allowMedia, onRetry }: { m: Message; allowMedia: boolean; onRetry: (id: string) => void }) {
  const out = m.direction === "OUTBOUND";
  const showText = m.text && !(m.type === "AUDIO" && !m.transcription);
  return (
    <div data-msg-id={m.id} className={cx("animate-in flex", out ? "justify-end" : "justify-start")}>
      <div
        className={cx(
          "max-w-[85%] rounded-2xl px-3 py-2 shadow-sm sm:max-w-[70%]",
          out ? "rounded-br-md bg-bubble-out" : "rounded-bl-md bg-bubble-in",
          m.status === "FAILED" && "ring-1 ring-critical/50",
        )}
      >
        {out && (
          <div className="mb-0.5">
            <AuthorTag m={m} />
          </div>
        )}
        {m.type === "TEMPLATE" && (
          <p className="mb-1 flex items-center gap-1 text-[11px] font-medium text-ink-3">
            <FileSignature className="size-3" /> Plantilla «{m.templateName}»
          </p>
        )}
        <MediaPreview m={m} allowMedia={allowMedia} />
        {m.type === "REACTION" ? (
          <p className="text-[13px] text-ink-2">Reaccionó {m.text}</p>
        ) : (
          showText && <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-ink">{m.text}</p>
        )}
        {m.transcription && (
          <p className="mt-1 border-l-2 border-line-strong pl-2 text-[12px] italic text-ink-2">Transcripción: {m.transcription}</p>
        )}
        <div className="mt-1 flex items-center justify-end gap-1.5 text-[11px] text-ink-3">
          {m.responseTimeMs != null && m.author === "AI" && <span title="Tiempo de respuesta">{(m.responseTimeMs / 1000).toFixed(1)} s ·</span>}
          <span>{clock(m.createdAt)}</span>
          <StatusIcon m={m} />
        </div>
        {m.status === "FAILED" && (
          <div className="mt-1.5 flex items-start gap-2 rounded-lg bg-critical-soft px-2 py-1.5 text-[12px] text-critical">
            <span className="flex-1">{m.errorMessage ?? "No se pudo enviar"}</span>
            {m.type !== "TEMPLATE" && (
              <button className="inline-flex items-center gap-1 font-medium hover:underline" onClick={() => onRetry(m.id)}>
                <RotateCw className="size-3" /> Reintentar
              </button>
            )}
          </div>
        )}
        {!out && m.replyState === "SKIPPED" && m.skipReason && (
          <p className="mt-1 text-[11px] italic text-ink-3">Sin respuesta automática: {m.skipReason}</p>
        )}
      </div>
    </div>
  );
}

interface Template {
  name: string;
  language: string;
  status: string;
  category: string;
  components: Array<{ type: string; text?: string }>;
}

function TemplateModal({ open, onClose, contactId }: { open: boolean; onClose: () => void; contactId: string }) {
  const toast = useToast();
  const qc = useQueryClient();
  const templates = useQuery({
    queryKey: ["templates"],
    queryFn: () => api.get<{ items: Template[]; simulated: boolean }>("/api/system/whatsapp/templates"),
    enabled: open,
  });
  const approved = (templates.data?.items ?? []).filter((t) => t.status === "APPROVED");
  const [selected, setSelected] = useState("");
  const tpl = approved.find((t) => `${t.name}|${t.language}` === selected);
  const body = tpl?.components.find((c) => c.type === "BODY")?.text ?? "";
  const paramCount = (body.match(/\{\{\d+\}\}/g) ?? []).length;
  const [params, setParams] = useState<string[]>([]);
  useEffect(() => setParams(Array(paramCount).fill("")), [paramCount, selected]);
  const preview = body.replace(/\{\{(\d+)\}\}/g, (_, i) => params[Number(i) - 1] || `{{${i}}}`);
  const send = useMutation({
    mutationFn: () =>
      api.post(`/api/conversations/${contactId}/template`, { name: tpl!.name, language: tpl!.language, bodyParams: params, previewText: preview }),
    onSuccess: () => {
      toast("Plantilla en cola de envío");
      qc.invalidateQueries({ queryKey: ["messages", contactId] });
      onClose();
    },
    onError: (e) => toast(errorText(e), "critical"),
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Enviar plantilla aprobada"
      description="Fuera de la ventana de 24 h, WhatsApp solo permite plantillas aprobadas por Meta (pueden tener costo)."
      footer={
        <Button variant="primary" disabled={!tpl || params.some((p) => !p.trim())} loading={send.isPending} onClick={() => send.mutate()}>
          Enviar plantilla
        </Button>
      }
    >
      {templates.isLoading ? (
        <Spinner />
      ) : templates.error ? (
        <Callout tone="critical">{errorText(templates.error)}</Callout>
      ) : templates.data?.simulated ? (
        <Callout tone="warning">En modo simulación no se cargan plantillas de Meta.</Callout>
      ) : approved.length === 0 ? (
        <Callout tone="warning" title="No hay plantillas aprobadas">
          Créalas en WhatsApp Manager → Plantillas de mensajes, espera la aprobación de Meta y vuelve aquí.
        </Callout>
      ) : (
        <div className="space-y-4">
          <Field label="Plantilla">
            <Select value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="">Elige una plantilla…</option>
              {approved.map((t) => (
                <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>
                  {t.name} ({t.language}) · {t.category.toLowerCase()}
                </option>
              ))}
            </Select>
          </Field>
          {params.map((p, i) => (
            <Field key={i} label={`Variable {{${i + 1}}}`}>
              <Input value={p} onChange={(e) => setParams(params.map((x, j) => (j === i ? e.target.value : x)))} />
            </Field>
          ))}
          {tpl && <div className="whitespace-pre-wrap rounded-xl bg-bubble-out px-3 py-2 text-[13px] text-ink">{preview || "(sin texto)"}</div>}
        </div>
      )}
    </Modal>
  );
}

/**
 * Historial + redactor. `mode="simulator"` envía como si fueras el cliente.
 */
export function ChatView({ contact, mode = "real" }: { contact: Contact; mode?: "real" | "simulator" }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState("");
  const [tplOpen, setTplOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const messages = useQuery({
    queryKey: ["messages", contact.id],
    queryFn: () => api.get<{ items: Message[]; hasMore: boolean }>(`/api/conversations/${contact.id}/messages?limit=100`),
    refetchInterval: mode === "simulator" ? 1500 : 3000,
  });
  const items = messages.data?.items ?? [];
  const lastId = items[items.length - 1]?.id;
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lastId]);

  useEffect(() => {
    if (mode === "real" && contact.unreadCount > 0) {
      void api.post(`/api/conversations/${contact.id}/read`).then(() => qc.invalidateQueries({ queryKey: ["conversations"] }));
    }
  }, [contact.id, contact.unreadCount, mode, qc]);

  const send = useMutation({
    mutationFn: (t: string) =>
      mode === "simulator"
        ? api.post(`/api/simulator/contacts/${contact.id}/messages`, { text: t })
        : api.post(`/api/conversations/${contact.id}/messages`, { text: t }),
    onSuccess: () => {
      setText("");
      qc.invalidateQueries({ queryKey: ["messages", contact.id] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["conversation", contact.id] });
    },
    onError: (e) => toast(errorText(e), "critical"),
  });
  const retry = useMutation({
    mutationFn: (id: string) => api.post(`/api/messages/${id}/retry`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["messages", contact.id] }),
    onError: (e) => toast(errorText(e), "critical"),
  });

  const pendingReply = useMemo(() => items.some((m) => m.direction === "INBOUND" && m.replyState === "PENDING"), [items]);
  const canWrite = mode === "simulator" || contact.isSimulated || contact.windowOpen;
  const submit = () => {
    const t = text.trim();
    if (t && !send.isPending) send.mutate(t);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="scrollbar-thin min-h-0 flex-1 space-y-2 overflow-y-auto bg-chat px-3 py-4 sm:px-6">
        {messages.isLoading && <Spinner className="mx-auto" />}
        {!messages.isLoading && items.length === 0 && (
          <p className="py-10 text-center text-[13px] text-ink-3">
            {mode === "simulator" ? "Escribe un mensaje como si fueras el cliente para probar la IA." : "Aún no hay mensajes."}
          </p>
        )}
        {items.map((m, i) => {
          const showDay = i === 0 || new Date(items[i - 1].createdAt).toDateString() !== new Date(m.createdAt).toDateString();
          return (
            <Fragment key={m.id}>
              {showDay && (
                <div className="flex justify-center py-2">
                  <span className="rounded-full bg-surface px-3 py-0.5 text-[11px] font-medium text-ink-3 shadow-sm">{dayLabel(m.createdAt)}</span>
                </div>
              )}
              <Bubble m={m} allowMedia={!contact.isSimulated} onRetry={(id) => retry.mutate(id)} />
            </Fragment>
          );
        })}
        {pendingReply && !contact.aiPaused && (
          <div className="flex justify-end">
            <div className="flex items-center gap-1 rounded-2xl rounded-br-md bg-bubble-out px-4 py-3" aria-label="La IA está escribiendo">
              <span className="typing-dot size-1.5 rounded-full bg-ink-3" />
              <span className="typing-dot size-1.5 rounded-full bg-ink-3" />
              <span className="typing-dot size-1.5 rounded-full bg-ink-3" />
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t border-line bg-surface p-3">
        {!canWrite ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-warning-soft px-4 py-3 text-[13px] text-ink-2">
            <span>Pasaron más de 24 h desde el último mensaje del cliente: solo puedes escribirle con una plantilla aprobada.</span>
            <Button size="sm" variant="primary" onClick={() => setTplOpen(true)}>
              Enviar plantilla
            </Button>
          </div>
        ) : (
          <div className="flex items-end gap-2">
            <Textarea
              rows={1}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={mode === "simulator" ? "Escribe como cliente…" : "Escribe una respuesta…"}
              className="max-h-40 min-h-10 resize-none"
              maxLength={4096}
            />
            <Button variant="primary" className="h-10 shrink-0" onClick={submit} loading={send.isPending} aria-label="Enviar">
              <Send className="size-4" />
            </Button>
          </div>
        )}
        {canWrite && (
          <p className="mt-2 text-[11px] text-ink-3">
            <span className="hidden sm:inline">Enter para enviar · Shift+Enter salto de línea. </span>
            {mode === "real" && !contact.aiPaused && !contact.isSimulated && "Al responder manualmente, la IA se pausa para este contacto (configurable)."}
          </p>
        )}
      </div>
      {mode === "real" && <TemplateModal open={tplOpen} onClose={() => setTplOpen(false)} contactId={contact.id} />}
    </div>
  );
}
