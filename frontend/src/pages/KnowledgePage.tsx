import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, FileQuestion, FileText, Pencil, Plus, Search, StickyNote, Trash2, Upload } from "lucide-react";
import { api, errorText } from "../services/api";
import type { KnowledgeDoc } from "../services/types";
import {
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
  Modal,
  PageHeader,
  Select,
  Switch,
  TagInput,
  Textarea,
  useConfirm,
  useToast,
} from "../components/ui";
import { timeAgo } from "../lib/format";

const KIND = {
  NOTE: { label: "Nota", icon: StickyNote },
  FAQ: { label: "Pregunta frecuente", icon: FileQuestion },
  FILE: { label: "Archivo", icon: FileText },
} as const;

interface Draft {
  id?: string;
  kind: KnowledgeDoc["kind"];
  title: string;
  content: string;
  question: string;
  answer: string;
  tags: string[];
}

function Editor({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [d, setD] = useState<Draft>(draft);
  // La lista solo trae un extracto: al editar se carga el contenido completo.
  const full = useQuery({
    queryKey: ["knowledge-doc", draft.id],
    queryFn: () => api.get<KnowledgeDoc>(`/api/knowledge/${draft.id}`),
    enabled: Boolean(draft.id),
  });
  useEffect(() => {
    if (full.data) setD((cur) => ({ ...cur, content: full.data.content }));
  }, [full.data]);
  const save = useMutation({
    mutationFn: () => {
      const body =
        d.kind === "FAQ"
          ? { title: d.title, question: d.question, answer: d.answer, tags: d.tags }
          : { title: d.title, content: d.content, tags: d.tags };
      return d.id ? api.patch(`/api/knowledge/${d.id}`, body) : api.post("/api/knowledge", { ...body, kind: d.kind });
    },
    onSuccess: () => {
      toast("Guardado. La IA ya puede usar esta información.");
      qc.invalidateQueries({ queryKey: ["knowledge"] });
      onClose();
    },
    onError: (e) => toast(errorText(e), "critical"),
  });
  const valid = d.title.trim() && (d.kind === "FAQ" ? d.question.trim() && d.answer.trim() : d.content.trim());
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`${d.id ? "Editar" : "Nueva"} ${KIND[d.kind].label.toLowerCase()}`}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Título">
          <Input value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} maxLength={200} placeholder="Ej.: Política de envíos" />
        </Field>
        {d.kind === "FAQ" ? (
          <>
            <Field label="Pregunta">
              <Input value={d.question} onChange={(e) => setD({ ...d, question: e.target.value })} placeholder="¿Hacen envíos a todo el país?" />
            </Field>
            <Field label="Respuesta">
              <Textarea rows={5} value={d.answer} onChange={(e) => setD({ ...d, answer: e.target.value })} />
            </Field>
          </>
        ) : (
          <Field label="Contenido" hint="Escribe la información tal como quieres que la IA la conozca: precios, horarios, políticas, productos…">
            {d.id && full.isLoading ? <Loading /> : <Textarea rows={14} value={d.content} onChange={(e) => setD({ ...d, content: e.target.value })} />}
          </Field>
        )}
        <Field label="Etiquetas (opcional)">
          <TagInput value={d.tags} onChange={(tags) => setD({ ...d, tags })} />
        </Field>
      </div>
    </Modal>
  );
}

export default function KnowledgePage() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [testQuery, setTestQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const list = useQuery({
    queryKey: ["knowledge", search, kind],
    queryFn: () => api.get<{ items: KnowledgeDoc[] }>(`/api/knowledge?search=${encodeURIComponent(search)}${kind ? `&kind=${kind}` : ""}`),
    placeholderData: (p) => p,
  });
  const test = useQuery({
    queryKey: ["knowledge-search", submittedQuery],
    queryFn: () => api.get<{ results: Array<{ documentId: string; title: string; content: string; rank: number }> }>(`/api/knowledge-search?q=${encodeURIComponent(submittedQuery)}`),
    enabled: submittedQuery.length > 0,
  });
  const toggle = useMutation({
    mutationFn: (d: KnowledgeDoc) => api.patch(`/api/knowledge/${d.id}`, { enabled: !d.enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["knowledge"] }),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.del(`/api/knowledge/${id}`),
    onSuccess: () => {
      toast("Eliminado");
      qc.invalidateQueries({ queryKey: ["knowledge"] });
    },
  });
  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("title", file.name.replace(/\.[^.]+$/, ""));
      form.append("file", file);
      return api.upload<KnowledgeDoc>("/api/knowledge/upload", form);
    },
    onSuccess: (d) => {
      toast(`«${d.title}» añadido (${d.chunkCount} fragmentos indexados)`);
      qc.invalidateQueries({ queryKey: ["knowledge"] });
    },
    onError: (e) => toast(errorText(e), "critical"),
  });
  const blank = (k: Draft["kind"]): Draft => ({ kind: k, title: "", content: "", question: "", answer: "", tags: [] });

  return (
    <div className="mx-auto max-w-6xl p-4 lg:p-6">
      <PageHeader
        title="Base de conocimientos"
        description="Información de tu negocio que la IA consulta antes de responder. Si algo no está aquí, la IA dirá que no tiene ese dato en lugar de inventarlo."
        actions={
          <>
            <Button icon={<Plus className="size-4" />} onClick={() => setDraft(blank("NOTE"))}>
              Nota
            </Button>
            <Button icon={<Plus className="size-4" />} onClick={() => setDraft(blank("FAQ"))}>
              Pregunta frecuente
            </Button>
            <Button variant="primary" icon={<Upload className="size-4" />} loading={upload.isPending} onClick={() => fileRef.current?.click()}>
              Subir PDF o TXT
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.txt,.md,.csv,application/pdf,text/plain"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload.mutate(f);
                e.target.value = "";
              }}
            />
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="flex flex-wrap gap-2 border-b border-line p-3">
            <div className="relative min-w-48 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
              <Input className="pl-9" placeholder="Buscar en títulos y contenido…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select className="w-auto" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">Todos los tipos</option>
              <option value="NOTE">Notas</option>
              <option value="FAQ">Preguntas frecuentes</option>
              <option value="FILE">Archivos</option>
            </Select>
          </div>
          {list.isLoading ? (
            <Loading />
          ) : !list.data?.items.length ? (
            <EmptyState
              icon={<BookOpen className="size-5" />}
              title="Tu base de conocimientos está vacía"
              description="Empieza por lo que más te preguntan: horarios, precios, envíos, formas de pago y devoluciones."
              action={<Button variant="primary" onClick={() => setDraft(blank("FAQ"))}>Crear la primera pregunta frecuente</Button>}
            />
          ) : (
            <ul className="divide-y divide-line">
              {list.data.items.map((d) => {
                const Icon = KIND[d.kind].icon;
                return (
                  <li key={d.id} className="flex items-start gap-3 px-4 py-3">
                    <Icon className="mt-0.5 size-4 shrink-0 text-ink-3" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-ink">{d.title}</p>
                        <Badge>{KIND[d.kind].label}</Badge>
                        {!d.enabled && <Badge tone="warning">Desactivado</Badge>}
                        {d.tags.map((t) => (
                          <Badge key={t} tone="accent">
                            {t}
                          </Badge>
                        ))}
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-[12px] text-ink-3">{d.kind === "FAQ" ? d.answer : d.content}</p>
                      <p className="mt-1 text-[11px] text-ink-3">
                        {d.fileName ? `${d.fileName} · ` : ""}
                        {(d.contentLength ?? 0).toLocaleString("es")} caracteres · {d.chunkCount} fragmentos · editado {timeAgo(d.updatedAt)}
                      </p>
                    </div>
                    <Switch size="sm" checked={d.enabled} onChange={() => toggle.mutate(d)} />
                    <IconButton
                      label="Editar"
                      onClick={() => setDraft({ id: d.id, kind: d.kind, title: d.title, content: d.content, question: d.question ?? "", answer: d.answer ?? "", tags: d.tags })}
                    >
                      <Pencil className="size-3.5" />
                    </IconButton>
                    <IconButton
                      label="Eliminar"
                      onClick={async () => {
                        if (await confirm({ title: "¿Eliminar este contenido?", message: `«${d.title}» dejará de estar disponible para la IA.`, danger: true, confirmLabel: "Eliminar" }))
                          del.mutate(d.id);
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </IconButton>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Probar la búsqueda" description="Escribe una pregunta como lo haría un cliente y mira qué encontraría la IA." />
            <div className="space-y-3 p-4">
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  setSubmittedQuery(testQuery.trim());
                }}
              >
                <Input value={testQuery} onChange={(e) => setTestQuery(e.target.value)} placeholder="¿Cuánto cuesta el envío?" />
                <Button type="submit" aria-label="Buscar">
                  <Search className="size-4" />
                </Button>
              </form>
              {test.isFetching && <Loading label="Buscando…" />}
              {test.data &&
                (test.data.results.length === 0 ? (
                  <Callout tone="warning">Sin resultados: la IA respondería que no tiene esa información.</Callout>
                ) : (
                  <ol className="space-y-2">
                    {test.data.results.map((r, i) => (
                      <li key={i} className="rounded-lg bg-surface-2 p-3">
                        <p className="text-[12px] font-medium text-ink">
                          {i + 1}. {r.title}
                        </p>
                        <p className="mt-1 line-clamp-4 text-[12px] text-ink-2">{r.content}</p>
                      </li>
                    ))}
                  </ol>
                ))}
            </div>
          </Card>
          <Callout tone="neutral" title="Consejos">
            <ul className="mt-1 list-disc space-y-1 pl-4">
              <li>Una pregunta frecuente por tema funciona mejor que un documento enorme.</li>
              <li>Los PDF escaneados (imágenes) no tienen texto: conviértelos con OCR primero.</li>
              <li>La búsqueda es por palabras (sin costo extra). Usa los términos que usan tus clientes.</li>
            </ul>
          </Callout>
        </div>
      </div>
      {draft && <Editor key={draft.id ?? `nuevo-${draft.kind}`} draft={draft} onClose={() => setDraft(null)} />}
    </div>
  );
}
