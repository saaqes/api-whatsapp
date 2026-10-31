import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

// Un único archivo .env en la raíz del proyecto (o en backend/ si se prefiere).
for (const file of [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "../.env")]) {
  if (existsSync(file)) {
    loadDotenv({ path: file, quiet: true });
    break;
  }
}

/**
 * Variables de entorno. Las credenciales sensibles pueden venir de aquí o del
 * panel (cifradas en la base de datos). El panel tiene prioridad si se configuran ahí.
 */
const boolish = z
  .enum(["true", "false", "1", "0", "yes", "no", ""])
  .optional()
  .transform((v) => v === "true" || v === "1" || v === "yes");

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default("0.0.0.0"),
  // URL pública del servidor (https://tu-app.onrender.com). Se usa para mostrar la URL del webhook.
  PUBLIC_URL: z.string().url().optional().or(z.literal("")),
  DATABASE_URL: z.string().min(1, "DATABASE_URL es obligatoria"),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(5),

  // Clave de 32 bytes (hex o base64) para cifrar las credenciales guardadas desde el panel.
  ENCRYPTION_KEY: z.string().min(32, "ENCRYPTION_KEY debe tener al menos 32 caracteres"),
  // Secreto para firmar cookies de sesión.
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET debe tener al menos 32 caracteres"),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24 * 7),

  // Primer administrador (se crea solo si no existe ningún usuario).
  ADMIN_EMAIL: z.string().email().optional().or(z.literal("")),
  ADMIN_PASSWORD: z.string().optional(),
  ADMIN_NAME: z.string().default("Administrador"),

  // Claude
  ANTHROPIC_API_KEY: z.string().optional(),
  // Solo para pruebas y demostraciones: respuestas simuladas sin llamar a Claude.
  CLAUDE_MOCK: boolish,

  // WhatsApp Cloud API (Meta)
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v26.0"),
  WHATSAPP_API_BASE_URL: z.string().url().default("https://graph.facebook.com"),
  // "live" envía mensajes reales; "simulation" nunca llama a Meta para enviar.
  WHATSAPP_MODE: z.enum(["live", "simulation"]).default("simulation"),

  // Transcripción de audio (opcional, servicio externo compatible con la API de OpenAI)
  TRANSCRIPTION_API_KEY: z.string().optional(),

  // Cola de trabajos
  JOB_CONCURRENCY: z.coerce.number().int().positive().max(20).default(4),

  // Archivos estáticos del panel (frontend compilado)
  FRONTEND_DIST: z.string().optional(),
  TRUST_PROXY: boolish,
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    // Mensaje claro para usuarios que configuran por primera vez.
    console.error(
      `\n❌ Configuración inválida. Revisa tu archivo .env (puedes generarlo con "npm run setup").\n${issues}\n`,
    );
    process.exit(1);
  }
  const env = parsed.data;
  if (env.NODE_ENV === "production" && env.CLAUDE_MOCK) {
    console.warn("⚠️  CLAUDE_MOCK está activo en producción: la IA NO usará Claude.");
  }
  return env;
}

export const env = loadEnv();
export const isProduction = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";
