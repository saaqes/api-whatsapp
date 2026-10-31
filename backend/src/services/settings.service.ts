import { z } from "zod";
import { env } from "../config/env.js";
import { prisma } from "../database/prisma.js";
import { decrypt, deriveKey, encrypt, maskSecret } from "../utils/crypto.js";
import { isValidTimeZone } from "../utils/time.js";

// ───────────────────────────── Esquemas y valores por defecto ─────────────────────────────

const timeHHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Formato HH:MM");

export const AiSettingsSchema = z.object({
  assistantName: z.string().trim().min(1).max(60).default("Sofía"),
  businessName: z.string().trim().max(120).default(""),
  businessDescription: z.string().trim().max(2000).default(""),
  personality: z
    .string()
    .trim()
    .max(2000)
    .default("Cálida, cercana y profesional. Habla como una persona real del equipo, con frases naturales y sin sonar robótica."),
  tone: z.string().trim().max(200).default("Amigable y respetuoso; tutea salvo que el cliente prefiera el usted."),
  language: z.string().trim().min(2).max(40).default("español"),
  replyInUserLanguage: z.boolean().default(true),
  instructions: z.string().max(8000).default(""),
  model: z.string().trim().min(1).max(100).default("claude-opus-5-5"),
  auxModel: z.string().trim().min(1).max(100).default("claude-opus-5-5"),
  effort: z.enum(["low", "medium", "high"]).default("low"),
  maxTokens: z.number().int().min(512).max(32000).default(8000),
  responseLength: z.enum(["short", "medium", "long"]).default("short"),
  historyMessages: z.number().int().min(2).max(100).default(20),
  memoryEnabled: z.boolean().default(true),
  memoryUpdateEvery: z.number().int().min(2).max(50).default(6),
  maxMemoryFacts: z.number().int().min(5).max(200).default(40),
  knowledgeEnabled: z.boolean().default(true),
  knowledgeResults: z.number().int().min(1).max(10).default(4),
  toolKnowledgeSearch: z.boolean().default(true),
  toolHandoff: z.boolean().default(true),
  replyDelaySeconds: z.number().int().min(0).max(60).default(3),
  splitParagraphs: z.boolean().default(false),
});
export type AiSettings = z.infer<typeof AiSettingsSchema>;

export const GeneralSettingsSchema = z.object({
  // Botón general: si es false no se envía NINGUNA respuesta automática.
  assistantEnabled: z.boolean().default(true),
  timezone: z.string().refine(isValidTimeZone, "Zona horaria no válida").default("America/Bogota"),
  autoPauseOnHumanReply: z.boolean().default(true),
  markAsRead: z.boolean().default(true),
  typingIndicator: z.boolean().default(true),
});
export type GeneralSettings = z.infer<typeof GeneralSettingsSchema>;

const DayScheduleSchema = z.object({ enabled: z.boolean(), start: timeHHMM, end: timeHHMM });
const defaultSchedule = [0, 1, 2, 3, 4, 5, 6].map((d) => ({
  enabled: d >= 1 && d <= 5,
  start: "09:00",
  end: "18:00",
}));

export const AutomationSettingsSchema = z.object({
  welcome: z
    .object({
      enabled: z.boolean().default(false),
      text: z.string().max(1000).default("¡Hola! 👋 Gracias por escribirnos. En un momento te respondemos."),
      // Si es false, la IA no responde al primer mensaje (solo se envía la bienvenida).
      thenAiReplies: z.boolean().default(true),
    })
    .default({ enabled: false, text: "¡Hola! 👋 Gracias por escribirnos. En un momento te respondemos.", thenAiReplies: true }),
  outOfHours: z
    .object({
      enabled: z.boolean().default(false),
      text: z.string().max(1000).default("Ahora mismo estamos fuera de horario. Te responderemos lo antes posible."),
      schedule: z.array(DayScheduleSchema).length(7).default(defaultSchedule),
      aiRespondsOutOfHours: z.boolean().default(true),
      cooldownHours: z.number().int().min(1).max(168).default(12),
    })
    .default({
      enabled: false,
      text: "Ahora mismo estamos fuera de horario. Te responderemos lo antes posible.",
      schedule: defaultSchedule,
      aiRespondsOutOfHours: true,
      cooldownHours: 12,
    }),
  handoff: z
    .object({
      message: z.string().max(1000).default("Te comunico con una persona de nuestro equipo. Te responderá en breve. 🙌"),
    })
    .default({ message: "Te comunico con una persona de nuestro equipo. Te responderá en breve. 🙌" }),
  optOut: z
    .object({
      enabled: z.boolean().default(true),
      keywords: z.array(z.string().trim().min(1).max(40)).max(20).default(["STOP", "BAJA", "CANCELAR SUSCRIPCION"]),
      confirmationText: z
        .string()
        .max(1000)
        .default("Listo, no te enviaremos más mensajes automáticos. Si quieres volver a hablar con el asistente escribe ALTA."),
      resumeKeywords: z.array(z.string().trim().min(1).max(40)).max(20).default(["ALTA", "START"]),
      resumeText: z.string().max(1000).default("¡Bienvenido de nuevo! El asistente vuelve a estar disponible para ti."),
    })
    .default({
      enabled: true,
      keywords: ["STOP", "BAJA", "CANCELAR SUSCRIPCION"],
      confirmationText:
        "Listo, no te enviaremos más mensajes automáticos. Si quieres volver a hablar con el asistente escribe ALTA.",
      resumeKeywords: ["ALTA", "START"],
      resumeText: "¡Bienvenido de nuevo! El asistente vuelve a estar disponible para ti.",
    }),
});
export type AutomationSettings = z.infer<typeof AutomationSettingsSchema>;

export const BudgetSettingsSchema = z.object({
  // 0 = sin límite
  dailyUsdLimit: z.number().min(0).max(100000).default(5),
  monthlyUsdLimit: z.number().min(0).max(1000000).default(50),
  perContactRepliesPerHour: z.number().int().min(0).max(1000).default(30),
  perContactRepliesPerDay: z.number().int().min(0).max(10000).default(150),
  maxInboundChars: z.number().int().min(200).max(20000).default(4000),
  limitMessage: z
    .string()
    .max(1000)
    .default("Ahora mismo no puedo responder automáticamente. Una persona del equipo te contestará pronto."),
});
export type BudgetSettings = z.infer<typeof BudgetSettingsSchema>;

export const MediaSettingsSchema = z.object({
  images: z.boolean().default(true),
  documents: z.boolean().default(true),
  maxDocumentMb: z.number().min(1).max(30).default(10),
  audio: z
    .object({
      provider: z.enum(["none", "openai_compatible"]).default("none"),
      baseUrl: z.string().url().default("https://api.openai.com/v1"),
      model: z.string().trim().min(1).max(100).default("whisper-1"),
      language: z.string().trim().max(10).default("es"),
    })
    .default({ provider: "none", baseUrl: "https://api.openai.com/v1", model: "whisper-1", language: "es" }),
});
export type MediaSettings = z.infer<typeof MediaSettingsSchema>;

export const WhatsAppSettingsSchema = z.object({
  appId: z.string().trim().max(40).default(""),
  wabaId: z.string().trim().max(40).default(""),
  phoneNumberId: z.string().trim().max(40).default(""),
  graphVersion: z.string().regex(/^(v\d+\.\d+)?$/).default(""),
  mode: z.enum(["", "live", "simulation"]).default(""),
});
export type WhatsAppSettings = z.infer<typeof WhatsAppSettingsSchema>;

const sections = {
  ai: AiSettingsSchema,
  general: GeneralSettingsSchema,
  automation: AutomationSettingsSchema,
  budget: BudgetSettingsSchema,
  media: MediaSettingsSchema,
  whatsapp: WhatsAppSettingsSchema,
} as const;

export type SectionName = keyof typeof sections;
type SectionValue<K extends SectionName> = z.infer<(typeof sections)[K]>;
export const SECTION_NAMES = Object.keys(sections) as SectionName[];

// ───────────────────────────── Lectura/escritura con caché ─────────────────────────────

const cache = new Map<string, { value: unknown; at: number }>();
const CACHE_MS = 10_000;

export function clearSettingsCache() {
  cache.clear();
}

export async function getSection<K extends SectionName>(name: K): Promise<SectionValue<K>> {
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as SectionValue<K>;
  const row = await prisma.setting.findUnique({ where: { key: name } });
  const schema = sections[name];
  // Los valores guardados se combinan con los valores por defecto (campos nuevos en futuras versiones).
  const parsed = schema.safeParse(row?.value ?? {});
  const value = (parsed.success ? parsed.data : schema.parse({})) as SectionValue<K>;
  cache.set(name, { value, at: Date.now() });
  return value;
}

/** Actualización parcial: valida el resultado completo antes de guardar. */
export async function updateSection<K extends SectionName>(name: K, patch: unknown): Promise<SectionValue<K>> {
  const current = await getSection(name);
  const merged = { ...(current as object), ...((patch ?? {}) as object) };
  const value = sections[name].parse(merged) as SectionValue<K>;
  await prisma.setting.upsert({
    where: { key: name },
    create: { key: name, value: value as object },
    update: { value: value as object },
  });
  cache.delete(name);
  return value;
}

export async function getAllSettings() {
  const entries = await Promise.all(SECTION_NAMES.map(async (n) => [n, await getSection(n)] as const));
  return Object.fromEntries(entries) as { [K in SectionName]: SectionValue<K> };
}

// ───────────────────────────── Credenciales cifradas ─────────────────────────────

export const SECRET_KEYS = {
  anthropic_api_key: { env: "ANTHROPIC_API_KEY", label: "API Key de Claude (Anthropic)" },
  whatsapp_access_token: { env: "WHATSAPP_ACCESS_TOKEN", label: "Access Token de WhatsApp" },
  meta_app_secret: { env: "META_APP_SECRET", label: "App Secret de Meta" },
  whatsapp_verify_token: { env: "WHATSAPP_VERIFY_TOKEN", label: "Verify Token del webhook" },
  transcription_api_key: { env: "TRANSCRIPTION_API_KEY", label: "API Key de transcripción de audio" },
} as const;
export type SecretKey = keyof typeof SECRET_KEYS;

const encKey = deriveKey(env.ENCRYPTION_KEY);
const secretCache = new Map<string, { value: string | null; at: number }>();

export async function setSecret(key: SecretKey, value: string): Promise<void> {
  const trimmed = value.trim();
  const enc = encrypt(trimmed, encKey);
  await prisma.secret.upsert({
    where: { key },
    create: { key, ...enc, hint: maskSecret(trimmed) },
    update: { ...enc, hint: maskSecret(trimmed) },
  });
  secretCache.delete(key);
}

export async function deleteSecret(key: SecretKey): Promise<void> {
  await prisma.secret.deleteMany({ where: { key } });
  secretCache.delete(key);
}

/** Valor efectivo: primero el panel (cifrado en BD), luego la variable de entorno. */
export async function getSecret(key: SecretKey): Promise<string | null> {
  const hit = secretCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  let value: string | null = null;
  const row = await prisma.secret.findUnique({ where: { key } });
  if (row) {
    try {
      value = decrypt(row, encKey);
    } catch {
      // Si ENCRYPTION_KEY cambió no se puede descifrar: se ignora el valor del panel.
      value = null;
    }
  }
  if (!value) {
    const envValue = (env as Record<string, unknown>)[SECRET_KEYS[key].env];
    value = typeof envValue === "string" && envValue.trim() ? envValue.trim() : null;
  }
  secretCache.set(key, { value, at: Date.now() });
  return value;
}

/** Estado de las credenciales para el panel (nunca devuelve el valor). */
export async function secretsStatus() {
  const rows = await prisma.secret.findMany();
  return Object.entries(SECRET_KEYS).map(([key, meta]) => {
    const row = rows.find((r) => r.key === key);
    let decryptable = true;
    if (row) {
      try {
        decrypt(row, encKey);
      } catch {
        decryptable = false;
      }
    }
    const envValue = (env as Record<string, unknown>)[meta.env];
    const fromEnv = typeof envValue === "string" && envValue.trim().length > 0;
    return {
      key,
      label: meta.label,
      envVar: meta.env,
      configured: Boolean((row && decryptable) || fromEnv),
      source: row && decryptable ? "panel" : fromEnv ? "env" : null,
      hint: row && decryptable ? row.hint : fromEnv ? maskSecret(String(envValue)) : null,
      decryptError: row ? !decryptable : false,
      updatedAt: row?.updatedAt ?? null,
    };
  });
}

export function clearSecretCache() {
  secretCache.clear();
}

// ───────────────────────────── Configuración efectiva de WhatsApp ─────────────────────────────

export interface WhatsAppConfig {
  appId: string;
  wabaId: string;
  phoneNumberId: string;
  graphVersion: string;
  baseUrl: string;
  mode: "live" | "simulation";
  accessToken: string | null;
  appSecret: string | null;
  verifyToken: string | null;
}

export async function getWhatsAppConfig(): Promise<WhatsAppConfig> {
  const s = await getSection("whatsapp");
  return {
    appId: s.appId || env.META_APP_ID || "",
    wabaId: s.wabaId || env.WHATSAPP_BUSINESS_ACCOUNT_ID || "",
    phoneNumberId: s.phoneNumberId || env.WHATSAPP_PHONE_NUMBER_ID || "",
    graphVersion: s.graphVersion || env.WHATSAPP_GRAPH_VERSION,
    baseUrl: env.WHATSAPP_API_BASE_URL,
    mode: (s.mode || env.WHATSAPP_MODE) as "live" | "simulation",
    accessToken: await getSecret("whatsapp_access_token"),
    appSecret: await getSecret("meta_app_secret"),
    verifyToken: await getSecret("whatsapp_verify_token"),
  };
}
