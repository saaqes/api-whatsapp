import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, HandHelping, MessageSquareHeart, Pencil, Plus, ShieldOff, Trash2, Workflow, Zap } from "lucide-react";
import { api, errorText } from "../services/api";
import type { AutomationSettings, Rule } from "../services/types";
import { useSaveSection, useSettings } from "../hooks/useSettings";
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

const DAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const MATCH_LABELS: Record<Rule["matchType"], string> = {
  CONTAINS: "Contiene la palabra",
  EXACT: "Mensaje exacto",
  STARTS_WITH: "Empieza por",
  ANY_MESSAGE: "Cualquier mensaje",
};

type RuleDraft = Omit<Rule, "id" | "timesTriggered"> & { id?: string };
const emptyRule: RuleDraft = {
  name: "",
  enabled: true,
  priority: 100,
  matchType: "CONTAINS",
  keywords: [],
  replyText: "",
  addTags: [],
  handoff: false,
  stopAi: false,
  cooldownMinutes: 0,
};

function RuleEditor({ initial, onClose }: { initial: RuleDraft; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [r, setR] = useState<RuleDraft>(initial);
  const save = useMutation({
    mutationFn: () => {
      const { id, ...body } = r;
      const payload = { ...body, replyText: body.replyText?.trim() ? body.replyText : null };
      return id ? api.put(`/api/automations/rules/${id}`, payload) : api.post("/api/automations/rules", payload);
    },
    onSuccess: () => {
      toast("Regla guardada");
      qc.invalidateQueries({ queryKey: ["rules"] });
      onClose();
    },
    onError: (e) => toast(errorText(e), "critical"),
  });
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={r.id ? "Editar regla" : "Nueva regla"}
      description="Las reglas se evalúan antes que la IA, en orden de prioridad (número menor primero)."
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={save.isPending} disabled={!r.name.trim()} onClick={() => save.mutate()}>
            Guardar regla
          </Button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Nombre">
          <Input value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} placeholder="Ej.: Pedir asesor" />
        </Field>
        <Field label="Prioridad" hint="Menor número = se evalúa primero.">
          <Input type="number" min={0} value={r.priority} onChange={(e) => setR({ ...r, priority: Number(e.target.value) })} />
        </Field>
        <Field label="Cuándo se activa">
          <Select value={r.matchType} onChange={(e) => setR({ ...r, matchType: e.target.value as Rule["matchType"] })}>
            {Object.entries(MATCH_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Palabras clave" hint="Sin distinguir mayúsculas ni tildes. Palabras completas.">
          <TagInput value={r.keywords} onChange={(keywords) => setR({ ...r, keywords })} placeholder="asesor, humano, persona" />
        </Field>
        <div className="md:col-span-2">
          <Field label="Respuesta automática (opcional)" hint="Si defines una respuesta, la IA no contestará a ese mensaje.">
            <Textarea rows={3} value={r.replyText ?? ""} onChange={(e) => setR({ ...r, replyText: e.target.value })} />
          </Field>
        </div>
        <Field label="Añadir etiquetas al contacto">
          <TagInput value={r.addTags} onChange={(addTags) => setR({ ...r, addTags })} />
        </Field>
        <Field label="No repetir durante (minutos)" hint="0 = siempre.">
          <Input type="number" min={0} value={r.cooldownMinutes} onChange={(e) => setR({ ...r, cooldownMinutes: Number(e.target.value) })} />
        </Field>
        <Switch label="Derivar a una persona" description="Pausa la IA para este contacto y lo marca como «requiere atención»." checked={r.handoff} onChange={(handoff) => setR({ ...r, handoff })} />
        <Switch label="La IA no responde a este mensaje" description="Útil para reglas que solo etiquetan o para silenciar temas." checked={r.stopAi} onChange={(stopAi) => setR({ ...r, stopAi })} />
        <Switch label="Regla activa" checked={r.enabled} onChange={(enabled) => setR({ ...r, enabled })} />
      </div>
    </Modal>
  );
}

export default function AutomationsPage() {
  const q = useSettings();
  const save = useSaveSection("automation");
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [a, setA] = useState<AutomationSettings | null>(null);
  const [editing, setEditing] = useState<RuleDraft | null>(null);
  const [testText, setTestText] = useState("");
  const rules = useQuery({ queryKey: ["rules"], queryFn: () => api.get<{ items: Rule[] }>("/api/automations/rules") });
  const test = useMutation({ mutationFn: (text: string) => api.post<{ match: Rule | null }>("/api/automations/test", { text }) });
  const del = useMutation({ mutationFn: (id: string) => api.del(`/api/automations/rules/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["rules"] }) });
  const toggle = useMutation({
    mutationFn: (r: Rule) => {
      const { id, timesTriggered: _t, ...body } = r;
      return api.put(`/api/automations/rules/${id}`, { ...body, enabled: !r.enabled });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rules"] }),
  });
  useEffect(() => {
    if (q.data) setA(q.data.settings.automation);
  }, [q.data]);
  if (!a) return <Loading />;

  const setSchedule = (i: number, patch: Partial<AutomationSettings["outOfHours"]["schedule"][number]>) =>
    setA({ ...a, outOfHours: { ...a.outOfHours, schedule: a.outOfHours.schedule.map((d, j) => (j === i ? { ...d, ...patch } : d)) } });

  return (
    <div className="mx-auto max-w-5xl p-4 lg:p-6">
      <PageHeader
        title="Automatizaciones"
        description="Mensajes automáticos y reglas que actúan antes que la IA. El botón general «IA activa» también las detiene."
      />
      <div className="space-y-4">
        <Card>
          <CardHeader
            title="Mensaje de bienvenida"
            description="Se envía una sola vez, al primer mensaje de cada contacto nuevo."
            icon={<MessageSquareHeart className="size-4" />}
            actions={<Switch checked={a.welcome.enabled} onChange={(enabled) => setA({ ...a, welcome: { ...a.welcome, enabled } })} />}
          />
          <div className="space-y-4 p-5">
            <Textarea rows={2} value={a.welcome.text} onChange={(e) => setA({ ...a, welcome: { ...a.welcome, text: e.target.value } })} />
            <Switch
              label="Después, la IA también responde"
              description="Si lo desactivas, el primer mensaje solo recibe la bienvenida."
              checked={a.welcome.thenAiReplies}
              onChange={(thenAiReplies) => setA({ ...a, welcome: { ...a.welcome, thenAiReplies } })}
            />
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Horario de atención"
            description={`Zona horaria: ${q.data?.settings.general.timezone}. Fuera de horario se envía un aviso (como máximo una vez cada pocas horas por contacto).`}
            icon={<Clock className="size-4" />}
            actions={<Switch checked={a.outOfHours.enabled} onChange={(enabled) => setA({ ...a, outOfHours: { ...a.outOfHours, enabled } })} />}
          />
          <div className="space-y-4 p-5">
            <div className="grid gap-2">
              {a.outOfHours.schedule.map((d, i) => (
                <div key={i} className="flex flex-wrap items-center gap-3 rounded-lg bg-surface-2 px-3 py-2">
                  <Switch size="sm" checked={d.enabled} onChange={(enabled) => setSchedule(i, { enabled })} />
                  <span className="w-24 text-[13px] font-medium text-ink">{DAYS[i]}</span>
                  {d.enabled ? (
                    <div className="flex items-center gap-2 text-[13px] text-ink-2">
                      <Input type="time" className="h-8 w-28" value={d.start} onChange={(e) => setSchedule(i, { start: e.target.value })} />
                      a
                      <Input type="time" className="h-8 w-28" value={d.end} onChange={(e) => setSchedule(i, { end: e.target.value })} />
                    </div>
                  ) : (
                    <span className="text-[13px] text-ink-3">Cerrado</span>
                  )}
                </div>
              ))}
            </div>
            <Field label="Mensaje fuera de horario">
              <Textarea rows={2} value={a.outOfHours.text} onChange={(e) => setA({ ...a, outOfHours: { ...a.outOfHours, text: e.target.value } })} />
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Switch
                label="La IA responde fuera de horario"
                description="Si lo desactivas, fuera de horario solo se envía el aviso."
                checked={a.outOfHours.aiRespondsOutOfHours}
                onChange={(aiRespondsOutOfHours) => setA({ ...a, outOfHours: { ...a.outOfHours, aiRespondsOutOfHours } })}
              />
              <Field label="Repetir el aviso como máximo cada (horas)">
                <Input type="number" min={1} max={168} value={a.outOfHours.cooldownHours} onChange={(e) => setA({ ...a, outOfHours: { ...a.outOfHours, cooldownHours: Number(e.target.value) } })} />
              </Field>
            </div>
          </div>
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader title="Derivación a una persona" icon={<HandHelping className="size-4" />} />
            <div className="p-5">
              <Field label="Mensaje al derivar" hint="Se envía cuando una regla deriva al contacto (si la regla no tiene respuesta propia).">
                <Textarea rows={3} value={a.handoff.message} onChange={(e) => setA({ ...a, handoff: { message: e.target.value } })} />
              </Field>
            </div>
          </Card>
          <Card>
            <CardHeader
              title="Baja de mensajes automáticos"
              description="Respeta a quien no quiere hablar con el bot."
              icon={<ShieldOff className="size-4" />}
              actions={<Switch checked={a.optOut.enabled} onChange={(enabled) => setA({ ...a, optOut: { ...a.optOut, enabled } })} />}
            />
            <div className="space-y-3 p-5">
              <Field label="Palabras para darse de baja (mensaje exacto)">
                <TagInput value={a.optOut.keywords} onChange={(keywords) => setA({ ...a, optOut: { ...a.optOut, keywords } })} />
              </Field>
              <Field label="Confirmación de baja">
                <Textarea rows={2} value={a.optOut.confirmationText} onChange={(e) => setA({ ...a, optOut: { ...a.optOut, confirmationText: e.target.value } })} />
              </Field>
              <Field label="Palabras para volver">
                <TagInput value={a.optOut.resumeKeywords} onChange={(resumeKeywords) => setA({ ...a, optOut: { ...a.optOut, resumeKeywords } })} />
              </Field>
            </div>
          </Card>
        </div>

        <div className="flex justify-end">
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(a)}>
            Guardar mensajes automáticos
          </Button>
        </div>

        <Card>
          <CardHeader
            title="Reglas por palabra clave"
            description="Respuestas fijas, etiquetas y derivaciones según lo que escribe el cliente."
            icon={<Zap className="size-4" />}
            actions={
              <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing({ ...emptyRule })}>
                Nueva regla
              </Button>
            }
          />
          {rules.isLoading ? (
            <Loading />
          ) : !rules.data?.items.length ? (
            <EmptyState
              icon={<Workflow className="size-5" />}
              title="Sin reglas"
              description="Ejemplo útil: si el cliente escribe «asesor», derivar a una persona y responder «Te comunico con alguien del equipo»."
            />
          ) : (
            <ul className="divide-y divide-line">
              {rules.data.items.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <span className="w-8 text-center text-[12px] tabular-nums text-ink-3" title="Prioridad">
                    {r.priority}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink">{r.name}</p>
                    <p className="text-[12px] text-ink-3">
                      {MATCH_LABELS[r.matchType]}
                      {r.keywords.length ? `: ${r.keywords.join(", ")}` : ""} · activada {r.timesTriggered} veces
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {r.replyText && <Badge>Responde</Badge>}
                      {r.handoff && <Badge tone="warning">Deriva a persona</Badge>}
                      {r.stopAi && <Badge>Detiene la IA</Badge>}
                      {r.addTags.map((t) => (
                        <Badge key={t} tone="accent">
                          +{t}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <Switch size="sm" checked={r.enabled} onChange={() => toggle.mutate(r)} />
                  <IconButton label="Editar" onClick={() => setEditing({ ...r, replyText: r.replyText ?? "" })}>
                    <Pencil className="size-3.5" />
                  </IconButton>
                  <IconButton
                    label="Eliminar"
                    onClick={async () => {
                      if (await confirm({ title: "¿Eliminar regla?", message: `«${r.name}»`, danger: true, confirmLabel: "Eliminar" })) del.mutate(r.id);
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-line p-4">
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (testText.trim()) test.mutate(testText);
              }}
            >
              <Input className="min-w-56 flex-1" value={testText} onChange={(e) => setTestText(e.target.value)} placeholder="Probar un mensaje de ejemplo…" />
              <Button type="submit" loading={test.isPending}>
                Probar
              </Button>
            </form>
            {test.data && (
              <div className="mt-3">
                {test.data.match ? (
                  <Callout tone="good">Se activaría la regla «{test.data.match.name}».</Callout>
                ) : (
                  <Callout>Ninguna regla coincide: respondería la IA.</Callout>
                )}
              </div>
            )}
          </div>
        </Card>
      </div>
      {editing && <RuleEditor initial={editing} onClose={() => setEditing(null)} />}
      {test.error && <p className="mt-2 text-critical">{errorText(test.error)}</p>}
    </div>
  );
}
