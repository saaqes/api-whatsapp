import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Copy, Database, Download, KeyRound, MessageCircle, Plus, ShieldCheck, Trash2, Users, Wallet, Webhook } from "lucide-react";
import { api, errorText } from "../services/api";
import type { BudgetSettings, CheckResult, ErrorLog, SecretStatus, User, WhatsAppSettings } from "../services/types";
import { useSaveSection, useSettings } from "../hooks/useSettings";
import { useAuth } from "../hooks/useAuth";
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Loading,
  Modal,
  PageHeader,
  Select,
  StatusPill,
  Textarea,
  cx,
  useConfirm,
  useToast,
} from "../components/ui";
import { timeAgo, usd } from "../lib/format";

const TABS = [
  { id: "conexiones", label: "Conexiones" },
  { id: "presupuesto", label: "Presupuesto" },
  { id: "usuarios", label: "Usuarios", owner: true },
  { id: "errores", label: "Errores" },
  { id: "copias", label: "Copias de seguridad", owner: true },
];

/** Campo de credencial: solo se escribe; nunca se muestra el valor guardado. */
function SecretField({ secret, hint }: { secret: SecretStatus; hint?: React.ReactNode }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const [value, setValue] = useState("");
  const save = useMutation({
    mutationFn: () => api.put(`/api/settings/secrets/${secret.key}`, { value }),
    onSuccess: () => {
      setValue("");
      toast(`${secret.label} guardada de forma cifrada`);
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e) => toast(errorText(e), "critical"),
  });
  const del = useMutation({
    mutationFn: () => api.del(`/api/settings/secrets/${secret.key}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });
  return (
    <Field
      label={
        <span className="flex flex-wrap items-center gap-2">
          {secret.label}
          {secret.configured ? (
            <Badge tone="good">{secret.source === "panel" ? `Guardada ${secret.hint}` : `Desde .env (${secret.envVar}) ${secret.hint}`}</Badge>
          ) : (
            <Badge tone="warning">Sin configurar</Badge>
          )}
          {secret.decryptError && <Badge tone="critical">No se puede descifrar (cambió ENCRYPTION_KEY)</Badge>}
        </span>
      }
      hint={hint}
    >
      {can("OWNER") ? (
        <div className="flex gap-2">
          <Input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={secret.configured ? "Escribe para reemplazar…" : "Pega aquí el valor"}
          />
          <Button onClick={() => save.mutate()} disabled={value.trim().length < 4} loading={save.isPending}>
            Guardar
          </Button>
          {secret.source === "panel" && (
            <Button variant="ghost" onClick={() => del.mutate()} title="Quitar del panel (se usará el .env si existe)">
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
      ) : (
        <p className="text-[12px] text-ink-3">Solo el propietario puede cambiar credenciales.</p>
      )}
    </Field>
  );
}

function CheckButton({ kind }: { kind: "whatsapp" | "claude" }) {
  const [res, setRes] = useState<CheckResult | null>(null);
  const m = useMutation({ mutationFn: () => api.post<CheckResult>(`/api/system/check/${kind}`), onSuccess: setRes, onError: (e) => setRes({ ok: false, message: errorText(e), checkedAt: new Date().toISOString() }) });
  return (
    <div className="space-y-2">
      <Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>
        Probar conexión
      </Button>
      {res && (
        <div className="flex items-start gap-2 text-[13px]">
          <StatusPill ok={res.ok} label={res.ok ? "Correcto" : "Error"} />
          <span className="text-ink-2">{res.message}</span>
        </div>
      )}
    </div>
  );
}

function Connections() {
  const q = useSettings();
  const save = useSaveSection("whatsapp");
  const toast = useToast();
  const [wa, setWa] = useState<WhatsAppSettings | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [pin, setPin] = useState("");
  useEffect(() => {
    if (q.data) setWa(q.data.settings.whatsapp);
  }, [q.data]);
  const subscribe = useMutation({
    mutationFn: () => api.post<{ ok: boolean }>("/api/system/whatsapp/subscribe"),
    onSuccess: (r) => toast(r.ok ? "App suscrita a la cuenta de WhatsApp: los webhooks de este número llegarán aquí." : "Meta no confirmó la suscripción", r.ok ? "good" : "critical"),
    onError: (e) => toast(errorText(e), "critical"),
  });
  const register = useMutation({
    mutationFn: () => api.post<{ success: boolean }>("/api/system/whatsapp/register", { pin }),
    onSuccess: () => {
      toast("Número registrado en la Cloud API");
      setPinOpen(false);
      setPin("");
    },
    onError: (e) => toast(errorText(e), "critical"),
  });
  if (!q.data || !wa) return <Loading />;
  const sec = (k: string) => q.data!.secrets.find((s) => s.key === k)!;
  const effectiveMode = wa.mode || q.data.env.whatsappMode;
  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(() => toast("Copiado"));
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="WhatsApp Business Platform (Cloud API de Meta)"
          description="Datos de tu app en developers.facebook.com. Sigue la guía docs/INSTALACION.md (pasos 5 a 10)."
          icon={<MessageCircle className="size-4" />}
          actions={effectiveMode === "live" ? <Badge tone="good">Modo real</Badge> : <Badge tone="warning">Modo simulación</Badge>}
        />
        <div className="space-y-5 p-5">
          <Field label="Modo de envío" hint="En simulación nunca se envía nada a WhatsApp (ideal para pruebas). En modo real se envían mensajes a los clientes.">
            <Select value={wa.mode} onChange={(e) => setWa({ ...wa, mode: e.target.value as WhatsAppSettings["mode"] })}>
              <option value="">Usar el valor del .env ({q.data.env.whatsappMode})</option>
              <option value="simulation">Simulación (no envía)</option>
              <option value="live">Real (envía mensajes)</option>
            </Select>
          </Field>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Meta App ID" hint="Panel de la app → Configuración → Básica → Identificador de la app.">
              <Input value={wa.appId} onChange={(e) => setWa({ ...wa, appId: e.target.value })} placeholder="Ej.: 1234567890123456" />
            </Field>
            <Field label="WhatsApp Business Account ID (WABA)" hint="WhatsApp → Configuración de la API.">
              <Input value={wa.wabaId} onChange={(e) => setWa({ ...wa, wabaId: e.target.value })} />
            </Field>
            <Field label="Phone Number ID" hint="WhatsApp → Configuración de la API, debajo del número «De».">
              <Input value={wa.phoneNumberId} onChange={(e) => setWa({ ...wa, phoneNumberId: e.target.value })} />
            </Field>
            <Field label="Versión de la Graph API" hint={`Vacío = ${q.data.env.graphVersion} (del .env).`}>
              <Input value={wa.graphVersion} onChange={(e) => setWa({ ...wa, graphVersion: e.target.value })} placeholder={q.data.env.graphVersion} />
            </Field>
          </div>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(wa)}>
            Guardar datos de WhatsApp
          </Button>

          <div className="space-y-4 border-t border-line pt-5">
            <SecretField secret={sec("whatsapp_access_token")} hint="Usa un token PERMANENTE de un usuario del sistema (el temporal caduca en 24 h)." />
            <SecretField secret={sec("meta_app_secret")} hint="Configuración → Básica → Clave secreta de la app. Se usa para verificar que los webhooks vienen de Meta." />
            <SecretField secret={sec("whatsapp_verify_token")} hint="Una frase secreta que inventas tú. Escribe la MISMA en Meta al configurar el webhook." />
          </div>

          <div className="space-y-2 border-t border-line pt-5">
            <p className="flex items-center gap-2 text-[13px] font-medium text-ink">
              <Webhook className="size-4 text-ink-3" /> URL de devolución de llamada (webhook)
            </p>
            {q.data.webhookUrl ? (
              <div className="flex gap-2">
                <Input readOnly value={q.data.webhookUrl} className="font-mono text-[12px]" />
                <Button onClick={() => copy(q.data!.webhookUrl!)} aria-label="Copiar">
                  <Copy className="size-4" />
                </Button>
              </div>
            ) : (
              <p className="text-[12px] text-ink-3">Define PUBLIC_URL en el .env para ver la URL.</p>
            )}
            {q.data.webhookUrl?.startsWith("http://") && (
              <Callout tone="warning">Meta exige HTTPS. En tu PC usa un túnel (cloudflared) o despliega en Render (ver la guía).</Callout>
            )}
            {q.data.privacyUrl && (
              <p className="text-[12px] text-ink-3">
                Política de privacidad pública (Meta la pide para publicar la app):{" "}
                <a className="font-medium text-accent hover:underline" href="/privacy" target="_blank" rel="noreferrer">
                  {q.data.privacyUrl}
                </a>
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-3 border-t border-line pt-5">
            <CheckButton kind="whatsapp" />
            <div className="flex flex-wrap gap-2 self-start">
              <Button loading={subscribe.isPending} onClick={() => subscribe.mutate()} title="POST /{WABA_ID}/subscribed_apps">
                Suscribir app a la WABA
              </Button>
              <Button onClick={() => setPinOpen(true)} title="POST /{PHONE_NUMBER_ID}/register">
                Registrar número (PIN)
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Claude (Anthropic)" description="La API Key se guarda cifrada en el servidor y nunca se envía al navegador." icon={<Bot className="size-4" />} />
        <div className="space-y-5 p-5">
          {q.data.env.claudeMock && <Callout tone="warning" title="CLAUDE_MOCK=true">El servidor está en modo prueba y no usa Claude. Cámbialo a false en el .env y reinicia.</Callout>}
          <SecretField secret={sec("anthropic_api_key")} hint="Créala en console.anthropic.com → Settings → API Keys. Empieza por sk-ant-." />
          <CheckButton kind="claude" />
        </div>
      </Card>

      <Card>
        <CardHeader title="Transcripción de audio (opcional)" description="Servicio externo con costo propio. El proveedor y el modelo se eligen en Configuración de la IA." icon={<KeyRound className="size-4" />} />
        <div className="p-5">
          <SecretField secret={sec("transcription_api_key")} hint="API Key de OpenAI o de Groq (u otro servicio compatible)." />
        </div>
      </Card>

      <Modal
        open={pinOpen}
        onClose={() => setPinOpen(false)}
        size="sm"
        title="Registrar número en la Cloud API"
        description="Solo hace falta para números reales nuevos. El PIN de 6 dígitos activa la verificación en dos pasos del número: guárdalo bien."
        footer={
          <Button variant="primary" disabled={!/^\d{6}$/.test(pin)} loading={register.isPending} onClick={() => register.mutate()}>
            Registrar
          </Button>
        }
      >
        <Field label="PIN de 6 dígitos">
          <Input inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
        </Field>
      </Modal>
    </div>
  );
}

function Budget() {
  const q = useSettings();
  const save = useSaveSection("budget");
  const dash = useQuery({ queryKey: ["dashboard"], queryFn: () => api.get<{ today: { costUsd: number }; monthCostUsd: number }>("/api/dashboard") });
  const [b, setB] = useState<BudgetSettings | null>(null);
  useEffect(() => {
    if (q.data) setB(q.data.settings.budget);
  }, [q.data]);
  if (!b) return <Loading />;
  return (
    <Card>
      <CardHeader title="Límites de gasto y uso" description="Protegen tu presupuesto y evitan abusos. 0 = sin límite." icon={<Wallet className="size-4" />} />
      <div className="grid gap-5 p-5 md:grid-cols-2">
        <Field label="Límite diario estimado (USD)" hint={`Gastado hoy: ${usd(dash.data?.today.costUsd)}`}>
          <Input type="number" min={0} step={0.5} value={b.dailyUsdLimit} onChange={(e) => setB({ ...b, dailyUsdLimit: Number(e.target.value) })} />
        </Field>
        <Field label="Límite mensual estimado (USD)" hint={`Gastado este mes: ${usd(dash.data?.monthCostUsd)}`}>
          <Input type="number" min={0} step={1} value={b.monthlyUsdLimit} onChange={(e) => setB({ ...b, monthlyUsdLimit: Number(e.target.value) })} />
        </Field>
        <Field label="Respuestas de IA por contacto y hora">
          <Input type="number" min={0} value={b.perContactRepliesPerHour} onChange={(e) => setB({ ...b, perContactRepliesPerHour: Number(e.target.value) })} />
        </Field>
        <Field label="Respuestas de IA por contacto y día">
          <Input type="number" min={0} value={b.perContactRepliesPerDay} onChange={(e) => setB({ ...b, perContactRepliesPerDay: Number(e.target.value) })} />
        </Field>
        <Field label="Longitud máxima de un mensaje entrante (caracteres)" hint="Textos más largos se recortan antes de enviarlos a la IA.">
          <Input type="number" min={200} max={20000} value={b.maxInboundChars} onChange={(e) => setB({ ...b, maxInboundChars: Number(e.target.value) })} />
        </Field>
        <div className="md:col-span-2">
          <Field label="Mensaje cuando se alcanza un límite" hint="Se envía una vez y el contacto queda marcado como «requiere atención». Déjalo vacío para no enviar nada.">
            <Textarea rows={2} value={b.limitMessage} onChange={(e) => setB({ ...b, limitMessage: e.target.value })} />
          </Field>
        </div>
        <div>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(b)}>
            Guardar límites
          </Button>
        </div>
        <div className="md:col-span-2">
          <Callout title="Además, pon un límite en Anthropic">
            En console.anthropic.com → Settings → Limits puedes fijar un tope de gasto mensual de la cuenta. Es la protección definitiva: Anthropic deja de
            aceptar solicitudes al alcanzarlo. Los costos de este panel son estimaciones.
          </Callout>
        </div>
      </div>
    </Card>
  );
}

function UsersTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const { user: me } = useAuth();
  const q = useQuery({ queryKey: ["users"], queryFn: () => api.get<{ items: User[] }>("/api/users") });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ email: "", name: "", password: "", role: "AGENT" });
  const create = useMutation({
    mutationFn: () => api.post("/api/users", form),
    onSuccess: () => {
      toast("Usuario creado");
      setOpen(false);
      setForm({ email: "", name: "", password: "", role: "AGENT" });
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e) => toast(errorText(e), "critical"),
  });
  const update = useMutation({
    mutationFn: (p: { id: string; patch: Record<string, unknown> }) => api.patch(`/api/users/${p.id}`, p.patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
    onError: (e) => toast(errorText(e), "critical"),
  });
  const del = useMutation({ mutationFn: (id: string) => api.del(`/api/users/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }) });
  const ROLE: Record<string, string> = { OWNER: "Propietario", ADMIN: "Administrador", AGENT: "Agente" };
  return (
    <Card>
      <CardHeader
        title="Usuarios del panel"
        description="Propietario: todo. Administrador: todo menos credenciales y usuarios. Agente: conversaciones, contactos y estadísticas."
        icon={<Users className="size-4" />}
        actions={
          <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>
            Nuevo usuario
          </Button>
        }
      />
      {q.isLoading ? (
        <Loading />
      ) : (
        <ul className="divide-y divide-line">
          {q.data?.items.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink">
                  {u.name} {u.id === me?.id && <span className="text-[12px] text-ink-3">(tú)</span>}
                </p>
                <p className="text-[12px] text-ink-3">
                  {u.email} · último acceso {timeAgo(u.lastLoginAt)}
                </p>
              </div>
              {!u.active && <Badge tone="warning">Desactivado</Badge>}
              <Select className="w-40" value={u.role} disabled={u.id === me?.id} onChange={(e) => update.mutate({ id: u.id, patch: { role: e.target.value } })}>
                {Object.entries(ROLE).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
              {u.id !== me?.id && (
                <>
                  <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: u.id, patch: { active: !u.active } })}>
                    {u.active ? "Desactivar" : "Activar"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      if (await confirm({ title: "¿Eliminar usuario?", message: u.email, danger: true, confirmLabel: "Eliminar" })) del.mutate(u.id);
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Nuevo usuario"
        size="sm"
        footer={
          <Button variant="primary" loading={create.isPending} onClick={() => create.mutate()}>
            Crear
          </Button>
        }
      >
        <div className="space-y-4">
          <Field label="Nombre">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Correo">
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Contraseña inicial" hint="Mínimo 10 caracteres con letras y números. Pídele que la cambie al entrar.">
            <Input type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
          <Field label="Rol">
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {Object.entries(ROLE).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Modal>
    </Card>
  );
}

function ErrorsTab() {
  const qc = useQueryClient();
  const [source, setSource] = useState("");
  const q = useQuery({
    queryKey: ["errors", source],
    queryFn: () => api.get<{ items: ErrorLog[] }>(`/api/system/errors?limit=200${source ? `&source=${source}` : ""}`),
    refetchInterval: 15_000,
  });
  const clear = useMutation({ mutationFn: () => api.del("/api/system/errors"), onSuccess: () => qc.invalidateQueries({ queryKey: ["errors"] }) });
  return (
    <Card>
      <CardHeader
        title="Registro de errores"
        description="Se conservan 30 días."
        actions={
          <>
            <Select className="w-40" value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">Todos</option>
              {["WEBHOOK", "WHATSAPP", "CLAUDE", "MEMORY", "QUEUE", "SYSTEM", "TRANSCRIPTION"].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
            <Button size="sm" variant="ghost" onClick={() => clear.mutate()}>
              Vaciar
            </Button>
          </>
        }
      />
      {q.isLoading ? (
        <Loading />
      ) : !q.data?.items.length ? (
        <EmptyState icon={<ShieldCheck className="size-5" />} title="Sin errores" />
      ) : (
        <ul className="divide-y divide-line">
          {q.data.items.map((e) => (
            <li key={e.id} className="px-5 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={e.level === "warn" ? "warning" : "critical"}>{e.source}</Badge>
                <span className="text-[11px] text-ink-3">{new Date(e.createdAt).toLocaleString("es")}</span>
              </div>
              <p className="mt-1 text-[13px] text-ink">{e.message}</p>
              {e.details != null && Object.keys(e.details as object).length > 0 && (
                <pre className="mt-1 overflow-x-auto rounded-lg bg-surface-2 p-2 font-mono text-[11px] text-ink-3">{JSON.stringify(e.details)}</pre>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function BackupTab() {
  return (
    <Card>
      <CardHeader title="Copias de seguridad" icon={<Database className="size-4" />} />
      <div className="space-y-4 p-5 text-[13px] leading-relaxed text-ink-2">
        <p>
          Descarga un archivo JSON con contactos, mensajes, memoria, base de conocimientos, reglas y configuración. Por seguridad <strong>no incluye</strong>{" "}
          credenciales ni contraseñas.
        </p>
        <a href="/api/system/backup" download>
          <Button variant="primary" icon={<Download className="size-4" />}>
            Descargar copia ahora
          </Button>
        </a>
        <Callout title="Restaurar">
          En una base de datos vacía, ejecuta en la carpeta del proyecto: <code className="font-mono">npm run backup:restore -w backend -- ruta\al\archivo.json</code>.
          Además, Neon y Render guardan copias automáticas de la base de datos (consulta la guía).
        </Callout>
      </div>
    </Card>
  );
}

export default function SystemPage() {
  const [params, setParams] = useSearchParams();
  const { can } = useAuth();
  const tabs = TABS.filter((t) => !t.owner || can("OWNER"));
  const tab = tabs.find((t) => t.id === params.get("tab"))?.id ?? "conexiones";
  return (
    <div className="mx-auto max-w-5xl p-4 lg:p-6">
      <PageHeader title="Conexiones y sistema" description="Credenciales, límites de gasto, usuarios, errores y copias de seguridad." />
      <div className="scrollbar-thin mb-4 flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setParams({ tab: t.id })}
            className={cx(
              "-mb-px shrink-0 border-b-2 px-3 py-2 text-[13px] font-medium transition-colors",
              tab === t.id ? "border-accent text-ink" : "border-transparent text-ink-3 hover:text-ink",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "conexiones" && <Connections />}
      {tab === "presupuesto" && <Budget />}
      {tab === "usuarios" && <UsersTab />}
      {tab === "errores" && <ErrorsTab />}
      {tab === "copias" && <BackupTab />}
    </div>
  );
}
