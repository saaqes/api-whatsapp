import { getClaude } from "../ai/claude.js";
import { describeClaudeError } from "../pipeline/reply.js";
import { getSection, getSecret, getWhatsAppConfig } from "./settings.service.js";
import { getWhatsAppClient, WhatsAppApiError } from "../whatsapp/index.js";

export interface CheckResult {
  ok: boolean;
  checkedAt: string;
  message: string;
  details?: Record<string, unknown>;
}

const last: { whatsapp: CheckResult | null; claude: CheckResult | null } = { whatsapp: null, claude: null };
const STALE_MS = 10 * 60_000;

/** Comprueba credenciales de WhatsApp leyendo los datos del número (sin enviar mensajes). */
export async function checkWhatsApp(): Promise<CheckResult> {
  const cfg = await getWhatsAppConfig();
  const missing = [
    !cfg.phoneNumberId && "Phone Number ID",
    !cfg.accessToken && "Access Token",
    !cfg.verifyToken && "Verify Token",
    !cfg.appSecret && "App Secret",
  ].filter(Boolean);
  let result: CheckResult;
  if (!cfg.phoneNumberId || !cfg.accessToken) {
    result = { ok: false, checkedAt: new Date().toISOString(), message: `Faltan datos: ${missing.join(", ")}` };
  } else {
    try {
      const wa = await getWhatsAppClient();
      const info = await wa.getPhoneNumberInfo();
      result = {
        ok: true,
        checkedAt: new Date().toISOString(),
        message: `Conectado: ${info.verified_name ?? ""} ${info.display_phone_number ?? ""}`.trim(),
        details: { ...info, missing, mode: cfg.mode },
      };
    } catch (err) {
      result = {
        ok: false,
        checkedAt: new Date().toISOString(),
        message: err instanceof WhatsAppApiError ? err.friendly : (err as Error).message,
      };
    }
  }
  last.whatsapp = result;
  return result;
}

/** Comprueba la API Key de Claude consultando el modelo configurado (no consume tokens). */
export async function checkClaude(): Promise<CheckResult> {
  const ai = await getSection("ai");
  const claude = getClaude();
  let result: CheckResult;
  if (!claude.mock && !(await getSecret("anthropic_api_key"))) {
    result = { ok: false, checkedAt: new Date().toISOString(), message: "Falta la API Key de Claude" };
  } else {
    try {
      const m = await claude.checkModel(ai.model);
      result = {
        ok: true,
        checkedAt: new Date().toISOString(),
        message: claude.mock ? `MODO PRUEBA (sin Claude real): ${m.displayName}` : `Conectado: ${m.displayName}`,
        details: { model: m.id, mock: claude.mock },
      };
    } catch (err) {
      result = { ok: false, checkedAt: new Date().toISOString(), message: describeClaudeError(err).message };
    }
  }
  last.claude = result;
  return result;
}

/** Último resultado conocido; se refresca en segundo plano si es antiguo. */
export function cachedChecks() {
  const now = Date.now();
  if (!last.whatsapp || now - Date.parse(last.whatsapp.checkedAt) > STALE_MS) void checkWhatsApp().catch(() => undefined);
  if (!last.claude || now - Date.parse(last.claude.checkedAt) > STALE_MS) void checkClaude().catch(() => undefined);
  return { ...last };
}
