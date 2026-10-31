import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { Brain, Eye, FileText, Gauge, Image as ImageIcon, Languages, Mic, Save, Sparkles, Thermometer, Timer, UserRound } from "lucide-react";
import { api } from "../services/api";
import type { AiSettings, GeneralSettings, MediaSettings } from "../services/types";
import { useSaveSection, useSettings } from "../hooks/useSettings";
import { Badge, Button, Callout, Card, CardHeader, Field, Input, Loading, Modal, PageHeader, Segmented, Select, Switch, Textarea } from "../components/ui";

const EFFORT_HELP: Record<AiSettings["effort"], string> = {
  low: "Rápido y económico. Recomendado para conversaciones de chat.",
  medium: "Piensa más antes de responder. Útil para preguntas complejas; algo más lento y costoso.",
  high: "Máximo razonamiento. Más lento y caro; rara vez necesario en WhatsApp.",
};

export default function AiSettingsPage() {
  const q = useSettings();
  const saveAi = useSaveSection("ai");
  const saveGeneral = useSaveSection("general", { silent: true });
  const saveMedia = useSaveSection("media", { silent: true });
  const [ai, setAi] = useState<AiSettings | null>(null);
  const [general, setGeneral] = useState<GeneralSettings | null>(null);
  const [media, setMedia] = useState<MediaSettings | null>(null);
  const [preview, setPreview] = useState(false);
  const promptPreview = useQuery({
    queryKey: ["prompt-preview"],
    queryFn: () => api.get<{ prompt: string }>("/api/settings/prompt-preview"),
    enabled: preview,
  });

  useEffect(() => {
    if (q.data) {
      setAi(q.data.settings.ai);
      setGeneral(q.data.settings.general);
      setMedia(q.data.settings.media);
    }
  }, [q.data]);

  if (q.isLoading || !ai || !general || !media || !q.data) return <Loading />;
  const set = <K extends keyof AiSettings>(k: K, v: AiSettings[K]) => setAi({ ...ai, [k]: v });
  const models = q.data.models;
  const known = models.some((m) => m.id === ai.model);
  const selectedModel = models.find((m) => m.id === ai.model);
  const transcriptionKey = q.data.secrets.find((s) => s.key === "transcription_api_key");

  const saveAll = async () => {
    // Primero las secciones silenciosas; la de IA muestra el aviso final.
    await saveGeneral.mutateAsync(general);
    await saveMedia.mutateAsync(media);
    await saveAi.mutateAsync(ai);
  };
  const saving = saveAi.isPending || saveGeneral.isPending || saveMedia.isPending;

  return (
    <div className="mx-auto max-w-5xl p-4 pb-24 lg:p-6 lg:pb-24">
      <PageHeader
        title="Configuración de la IA"
        description="Personalidad, instrucciones, modelo de Claude, memoria y comportamiento. Los cambios se aplican al siguiente mensaje."
        actions={
          <Button variant="ghost" icon={<Eye className="size-4" />} onClick={() => setPreview(true)}>
            Ver prompt del sistema
          </Button>
        }
      />

      <div className="space-y-4">
        <Card>
          <CardHeader title="Identidad y personalidad" icon={<UserRound className="size-4" />} />
          <div className="grid gap-4 p-5 md:grid-cols-2">
            <Field label="Nombre del asistente">
              <Input value={ai.assistantName} onChange={(e) => set("assistantName", e.target.value)} maxLength={60} />
            </Field>
            <Field label="Nombre del negocio">
              <Input value={ai.businessName} onChange={(e) => set("businessName", e.target.value)} placeholder="Ej.: Moda Andina" maxLength={120} />
            </Field>
            <div className="md:col-span-2">
              <Field label="¿Qué hace tu negocio?" hint="Una o dos frases. La IA lo usa para presentarse y entender el contexto.">
                <Textarea rows={2} value={ai.businessDescription} onChange={(e) => set("businessDescription", e.target.value)} maxLength={2000} />
              </Field>
            </div>
            <div className="md:col-span-2">
              <Field label="Personalidad">
                <Textarea rows={3} value={ai.personality} onChange={(e) => set("personality", e.target.value)} maxLength={2000} />
              </Field>
            </div>
            <Field label="Tono de comunicación">
              <Input value={ai.tone} onChange={(e) => set("tone", e.target.value)} maxLength={200} />
            </Field>
            <Field label="Longitud de las respuestas">
              <Segmented
                value={ai.responseLength}
                onChange={(v) => set("responseLength", v)}
                options={[
                  { value: "short", label: "Cortas" },
                  { value: "medium", label: "Medias" },
                  { value: "long", label: "Detalladas" },
                ]}
              />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="Instrucciones del negocio" description="Reglas, información clave y cómo debe actuar la IA. Los clientes no pueden cambiarlas desde el chat." icon={<Sparkles className="size-4" />} />
          <div className="p-5">
            <Textarea
              rows={8}
              value={ai.instructions}
              onChange={(e) => set("instructions", e.target.value)}
              maxLength={8000}
              placeholder={"Ejemplos:\n- Ofrece siempre el catálogo cuando pregunten por productos.\n- No prometas fechas de entrega exactas.\n- Si preguntan por mayoreo, pide cantidad y ciudad."}
            />
            <p className="mt-1.5 text-right text-[11px] text-ink-3">{ai.instructions.length} / 8000</p>
          </div>
        </Card>

        <Card>
          <CardHeader title="Idioma" icon={<Languages className="size-4" />} />
          <div className="grid gap-4 p-5 md:grid-cols-2">
            <Field label="Idioma principal">
              <Input value={ai.language} onChange={(e) => set("language", e.target.value)} />
            </Field>
            <div className="pt-6">
              <Switch label="Responder en el idioma del cliente" description="Si te escriben en inglés, responde en inglés." checked={ai.replyInUserLanguage} onChange={(v) => set("replyInUserLanguage", v)} />
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Modelo de Claude y límites" icon={<Gauge className="size-4" />} />
          <div className="grid gap-5 p-5 md:grid-cols-2">
            <Field
              label="Modelo para responder"
              hint={selectedModel ? `${selectedModel.description} Precio: $${selectedModel.input} / $${selectedModel.output} por millón de tokens (entrada / salida).` : "Modelo personalizado: el costo no se puede estimar."}
            >
              <Select value={known ? ai.model : "__custom"} onChange={(e) => set("model", e.target.value === "__custom" ? "" : e.target.value)}>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
                <option value="__custom">Otro (escribir ID)…</option>
              </Select>
              {!known && <Input className="mt-2" placeholder="claude-…" value={ai.model} onChange={(e) => set("model", e.target.value)} />}
            </Field>
            <Field label="Modelo para memoria y resúmenes" hint="Tarea auxiliar en segundo plano. Un modelo económico (p. ej. Haiku 5.5) reduce costos.">
              <Select value={ai.auxModel} onChange={(e) => set("auxModel", e.target.value)}>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} (${m.input} / ${m.output})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Esfuerzo de razonamiento" hint={EFFORT_HELP[ai.effort]}>
              <Segmented
                value={ai.effort}
                onChange={(v) => set("effort", v)}
                options={[
                  { value: "low", label: "Bajo" },
                  { value: "medium", label: "Medio" },
                  { value: "high", label: "Alto" },
                ]}
              />
            </Field>
            <Field label="Límite de tokens por respuesta" hint="Incluye el razonamiento interno. Solo se cobra lo que realmente se usa; el límite evita respuestas desbocadas.">
              <Input type="number" min={512} max={32000} step={500} value={ai.maxTokens} onChange={(e) => set("maxTokens", Number(e.target.value))} />
            </Field>
            <div className="md:col-span-2">
              <Callout tone="neutral" icon={<Thermometer className="size-4" />} title="Temperatura: no disponible">
                La versión actual de la API de Anthropic (2026-10-21) ya no acepta el parámetro «temperature» en ningún modelo. Para controlar cuánto
                piensa y cuánto cuesta cada respuesta usa el <strong>esfuerzo</strong>, y para el estilo usa la personalidad y las instrucciones.
              </Callout>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Memoria y base de conocimientos" icon={<Brain className="size-4" />} />
          <div className="grid gap-5 p-5 md:grid-cols-2">
            <Switch label="Memoria por contacto" description="Recuerda datos de cada persona (nombre, negocio, preferencias) y resume la conversación." checked={ai.memoryEnabled} onChange={(v) => set("memoryEnabled", v)} />
            <Switch label="Usar base de conocimientos" description="Busca información de tu negocio antes de responder." checked={ai.knowledgeEnabled} onChange={(v) => set("knowledgeEnabled", v)} />
            <Field label="Mensajes recientes en contexto" hint="Memoria a corto plazo. Más mensajes = más contexto y más tokens.">
              <Input type="number" min={2} max={100} value={ai.historyMessages} onChange={(e) => set("historyMessages", Number(e.target.value))} />
            </Field>
            <Field label="Actualizar memoria cada N mensajes" hint="Cada actualización es una llamada pequeña a Claude.">
              <Input type="number" min={2} max={50} value={ai.memoryUpdateEvery} onChange={(e) => set("memoryUpdateEvery", Number(e.target.value))} />
            </Field>
            <Field label="Máximo de datos recordados por contacto">
              <Input type="number" min={5} max={200} value={ai.maxMemoryFacts} onChange={(e) => set("maxMemoryFacts", Number(e.target.value))} />
            </Field>
            <Field label="Fragmentos de conocimiento por respuesta">
              <Input type="number" min={1} max={10} value={ai.knowledgeResults} onChange={(e) => set("knowledgeResults", Number(e.target.value))} />
            </Field>
            <Switch label="Herramienta de búsqueda" description="Permite a la IA hacer búsquedas adicionales en la base de conocimientos." checked={ai.toolKnowledgeSearch} onChange={(v) => set("toolKnowledgeSearch", v)} />
            <Switch label="Derivar a una persona" description="La IA puede pausarse y avisar al equipo si el cliente lo pide o hay una queja." checked={ai.toolHandoff} onChange={(v) => set("toolHandoff", v)} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Comportamiento en WhatsApp" icon={<Timer className="size-4" />} />
          <div className="grid gap-5 p-5 md:grid-cols-2">
            <Field label="Espera antes de responder (segundos)" hint="Agrupa mensajes seguidos del cliente en una sola respuesta.">
              <Input type="number" min={0} max={60} value={ai.replyDelaySeconds} onChange={(e) => set("replyDelaySeconds", Number(e.target.value))} />
            </Field>
            <Field label="Zona horaria del negocio" hint={`Tu navegador: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`}>
              <div className="flex gap-2">
                <Input value={general.timezone} onChange={(e) => setGeneral({ ...general, timezone: e.target.value })} />
                <Button size="sm" className="h-9" onClick={() => setGeneral({ ...general, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })}>
                  Usar la mía
                </Button>
              </div>
            </Field>
            <Switch label="Dividir respuestas en varios mensajes" description="Envía cada párrafo como una burbuja (estilo más natural)." checked={ai.splitParagraphs} onChange={(v) => set("splitParagraphs", v)} />
            <Switch label="Marcar como leído" description="Muestra el doble check azul al cliente." checked={general.markAsRead} onChange={(v) => setGeneral({ ...general, markAsRead: v })} />
            <Switch label="Mostrar «escribiendo…»" description="Indicador de escritura mientras la IA prepara la respuesta." checked={general.typingIndicator} onChange={(v) => setGeneral({ ...general, typingIndicator: v })} />
            <Switch label="Pausar la IA al responder manualmente" description="Cuando alguien del equipo escribe, la IA deja de responder a ese contacto." checked={general.autoPauseOnHumanReply} onChange={(v) => setGeneral({ ...general, autoPauseOnHumanReply: v })} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Imágenes, documentos y audios" icon={<ImageIcon className="size-4" />} />
          <div className="grid gap-5 p-5 md:grid-cols-2">
            <Switch label="Analizar imágenes" description="La IA ve las fotos que envía el cliente (consume más tokens)." checked={media.images} onChange={(v) => setMedia({ ...media, images: v })} />
            <Switch label="Leer documentos PDF y de texto" description="Otros formatos (Word, Excel) no son compatibles: la IA pedirá un PDF." checked={media.documents} onChange={(v) => setMedia({ ...media, documents: v })} />
            <Field label="Tamaño máximo de documento (MB)">
              <Input type="number" min={1} max={30} value={media.maxDocumentMb} onChange={(e) => setMedia({ ...media, maxDocumentMb: Number(e.target.value) })} />
            </Field>
            <div />
            <div className="md:col-span-2">
              <div className="mb-3 flex items-center gap-2">
                <Mic className="size-4 text-ink-3" />
                <p className="text-[13px] font-medium text-ink">Transcripción de notas de voz</p>
                <Badge tone="warning">Servicio externo con costo</Badge>
              </div>
              <p className="mb-4 text-[12px] leading-relaxed text-ink-3">
                Claude no escucha audio. Para entender notas de voz se usa un servicio de transcripción compatible con la API de OpenAI: OpenAI (whisper-1,
                https://api.openai.com/v1) o Groq (whisper-large-v3-turbo, https://api.groq.com/openai/v1). Sin él, la IA pide amablemente al cliente que escriba.
              </p>
              <div className="grid gap-4 md:grid-cols-4">
                <Field label="Proveedor">
                  <Select value={media.audio.provider} onChange={(e) => setMedia({ ...media, audio: { ...media.audio, provider: e.target.value as MediaSettings["audio"]["provider"] } })}>
                    <option value="none">Desactivado</option>
                    <option value="openai_compatible">Compatible con OpenAI</option>
                  </Select>
                </Field>
                <Field label="URL base">
                  <Input value={media.audio.baseUrl} onChange={(e) => setMedia({ ...media, audio: { ...media.audio, baseUrl: e.target.value } })} />
                </Field>
                <Field label="Modelo">
                  <Input value={media.audio.model} onChange={(e) => setMedia({ ...media, audio: { ...media.audio, model: e.target.value } })} />
                </Field>
                <Field label="Idioma (código)">
                  <Input value={media.audio.language} onChange={(e) => setMedia({ ...media, audio: { ...media.audio, language: e.target.value } })} />
                </Field>
              </div>
              <p className="mt-3 text-[12px] text-ink-3">
                API Key del servicio: {transcriptionKey?.configured ? <Badge tone="good">configurada</Badge> : <Badge tone="warning">no configurada</Badge>} —{" "}
                <Link className="font-medium text-accent hover:underline" to="/sistema">
                  configúrala en Conexiones
                </Link>
              </p>
            </div>
          </div>
        </Card>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/90 px-4 py-3 backdrop-blur lg:left-64">
        <div className="mx-auto flex max-w-5xl items-center justify-end gap-3">
          <span className="hidden text-[12px] text-ink-3 sm:inline">Los cambios afectan a las próximas respuestas.</span>
          <Button variant="primary" icon={<Save className="size-4" />} loading={saving} onClick={() => void saveAll()}>
            Guardar configuración
          </Button>
        </div>
      </div>

      <Modal open={preview} onClose={() => setPreview(false)} title="Prompt del sistema (guardado)" description="Así se instruye a Claude. A esto se añade, en cada mensaje, la memoria del contacto y el conocimiento relevante." size="lg">
        {promptPreview.isLoading ? <Loading /> : <pre className="whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-ink-2">{promptPreview.data?.prompt}</pre>}
        <p className="mt-3 flex items-center gap-1.5 text-[12px] text-ink-3">
          <FileText className="size-3.5" /> Guarda la configuración para ver aquí los últimos cambios.
        </p>
      </Modal>
    </div>
  );
}
