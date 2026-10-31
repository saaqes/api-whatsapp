import { randomBytes } from "node:crypto";
import type { WhatsAppConfig } from "../services/settings.service.js";

/**
 * Cliente de la API oficial WhatsApp Business Platform (Cloud API) de Meta.
 * Documentación: https://developers.facebook.com/docs/whatsapp/cloud-api
 */

export class WhatsAppApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: number,
    public subcode?: number,
    public details?: string,
    public fbtraceId?: string,
  ) {
    super(message);
  }

  /** Errores temporales que vale la pena reintentar. */
  get retryable(): boolean {
    if (this.status === 0 || this.status >= 500 || this.status === 429) return true;
    // 4: límite de la app, 80007: límite de la WABA, 130429: rendimiento, 131056: par emisor/receptor,
    // 131000: error genérico, 131016: servicio no disponible, 2: servicio temporalmente no disponible
    return [2, 4, 80007, 130429, 131000, 131016, 131056].includes(this.code ?? -1);
  }

  /** Explicación en español para el panel. */
  get friendly(): string {
    switch (this.code) {
      case 190:
        return "El Access Token de WhatsApp no es válido o caducó. Genera un token permanente (usuario del sistema) y actualízalo en Configuración → Conexiones.";
      case 131047:
        return "Han pasado más de 24 horas desde el último mensaje del cliente. Solo puedes escribirle con una plantilla aprobada.";
      case 131030:
        return "El número de destino no está en la lista de destinatarios permitidos del número de prueba. Agrégalo en Meta → WhatsApp → Configuración de la API.";
      case 131026:
        return "No se pudo entregar el mensaje (el número no tiene WhatsApp, o no aceptó los términos recientes).";
      case 133010:
        return "El número de teléfono no está registrado en la Cloud API. Usa el botón «Registrar número» en Conexiones.";
      case 100:
        return `Parámetro no válido: ${this.details ?? this.message}`;
      case 10:
      case 200:
        return "Permisos insuficientes. El token necesita whatsapp_business_messaging y whatsapp_business_management.";
      case 368:
        return "Meta restringió temporalmente la cuenta por incumplir políticas.";
      default:
        return this.details ? `${this.message} — ${this.details}` : this.message;
    }
  }
}

export interface SendResult {
  messageId: string;
  simulated: boolean;
}

export interface MediaInfo {
  url: string;
  mime_type: string;
  sha256?: string;
  file_size?: number;
  id: string;
}

export interface TemplateComponentParam {
  type: "body" | "header" | "button";
  sub_type?: string;
  index?: string;
  parameters: Array<{ type: "text"; text: string }>;
}

type FetchLike = typeof fetch;

export class WhatsAppClient {
  constructor(
    private config: WhatsAppConfig,
    private fetchImpl: FetchLike = fetch,
    private timeoutMs = 20_000,
  ) {}

  get simulated(): boolean {
    return this.config.mode === "simulation";
  }

  get configured(): boolean {
    return Boolean(this.config.phoneNumberId && this.config.accessToken);
  }

  private url(path: string): string {
    return `${this.config.baseUrl.replace(/\/$/, "")}/${this.config.graphVersion}/${path.replace(/^\//, "")}`;
  }

  private async request<T>(method: string, path: string, body?: unknown, absoluteUrl?: string): Promise<T> {
    if (!this.config.accessToken) throw new WhatsAppApiError("Falta el Access Token de WhatsApp", 401, 190);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(absoluteUrl ?? this.url(path), {
        method,
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      throw new WhatsAppApiError(`No se pudo conectar con Meta: ${(err as Error).message}`, 0);
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok || json?.error) {
      const e = json?.error ?? {};
      throw new WhatsAppApiError(
        e.message ?? `Error HTTP ${res.status}`,
        res.status,
        e.code,
        e.error_subcode,
        e.error_data?.details,
        e.fbtrace_id,
      );
    }
    return json as T;
  }

  private simulatedResult(): SendResult {
    return { messageId: `sim.${randomBytes(12).toString("hex")}`, simulated: true };
  }

  private requirePhone() {
    if (!this.config.phoneNumberId) throw new WhatsAppApiError("Falta el Phone Number ID de WhatsApp", 400, 100);
  }

  async sendText(to: string, text: string, replyToWaId?: string | null): Promise<SendResult> {
    if (this.simulated) return this.simulatedResult();
    this.requirePhone();
    const body: Record<string, unknown> = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { body: text, preview_url: /https?:\/\//.test(text) },
    };
    if (replyToWaId) body.context = { message_id: replyToWaId };
    const res = await this.request<{ messages: Array<{ id: string }> }>("POST", `${this.config.phoneNumberId}/messages`, body);
    return { messageId: res.messages[0].id, simulated: false };
  }

  async sendTemplate(
    to: string,
    name: string,
    languageCode: string,
    components: TemplateComponentParam[] = [],
  ): Promise<SendResult> {
    if (this.simulated) return this.simulatedResult();
    this.requirePhone();
    const res = await this.request<{ messages: Array<{ id: string }> }>("POST", `${this.config.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "template",
      template: { name, language: { code: languageCode }, ...(components.length ? { components } : {}) },
    });
    return { messageId: res.messages[0].id, simulated: false };
  }

  /** Marca como leído (doble check azul) y opcionalmente muestra "escribiendo…" (hasta ~25 s). */
  async markRead(waMessageId: string, typing = false): Promise<void> {
    if (this.simulated) return;
    this.requirePhone();
    await this.request("POST", `${this.config.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      status: "read",
      message_id: waMessageId,
      ...(typing ? { typing_indicator: { type: "text" } } : {}),
    });
  }

  async getMediaInfo(mediaId: string): Promise<MediaInfo> {
    return this.request<MediaInfo>("GET", `${mediaId}`);
  }

  /** Descarga un archivo multimedia (la URL de Meta caduca a los pocos minutos). */
  async downloadMedia(mediaId: string, maxBytes = 25 * 1024 * 1024): Promise<{ data: Buffer; mime: string }> {
    const info = await this.getMediaInfo(mediaId);
    if (info.file_size && info.file_size > maxBytes) {
      throw new WhatsAppApiError(`Archivo demasiado grande (${Math.round(info.file_size / 1024 / 1024)} MB)`, 413);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      const res = await this.fetchImpl(info.url, {
        headers: { Authorization: `Bearer ${this.config.accessToken}` },
        signal: controller.signal,
      });
      if (!res.ok) throw new WhatsAppApiError(`No se pudo descargar el archivo (HTTP ${res.status})`, res.status);
      const data = Buffer.from(await res.arrayBuffer());
      if (data.length > maxBytes) throw new WhatsAppApiError("Archivo demasiado grande", 413);
      return { data, mime: info.mime_type };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Datos del número (sirve para comprobar que token e ID son correctos). */
  async getPhoneNumberInfo() {
    this.requirePhone();
    return this.request<{
      id: string;
      display_phone_number?: string;
      verified_name?: string;
      quality_rating?: string;
      code_verification_status?: string;
      platform_type?: string;
      throughput?: { level: string };
    }>(
      "GET",
      `${this.config.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,code_verification_status,platform_type,throughput`,
    );
  }

  async listTemplates() {
    if (!this.config.wabaId) throw new WhatsAppApiError("Falta el WhatsApp Business Account ID", 400, 100);
    const res = await this.request<{
      data: Array<{ name: string; language: string; status: string; category: string; components: unknown[] }>;
    }>("GET", `${this.config.wabaId}/message_templates?fields=name,language,status,category,components&limit=100`);
    return res.data;
  }

  /** Suscribe la app a la WABA para recibir webhooks de ese número (necesario con números reales). */
  async subscribeApp() {
    if (!this.config.wabaId) throw new WhatsAppApiError("Falta el WhatsApp Business Account ID", 400, 100);
    return this.request<{ success: boolean }>("POST", `${this.config.wabaId}/subscribed_apps`);
  }

  async getSubscribedApps() {
    if (!this.config.wabaId) throw new WhatsAppApiError("Falta el WhatsApp Business Account ID", 400, 100);
    return this.request<{ data: Array<{ whatsapp_business_api_data?: { id: string; name: string } }> }>(
      "GET",
      `${this.config.wabaId}/subscribed_apps`,
    );
  }

  /** Registra el número en la Cloud API con un PIN de verificación en dos pasos de 6 dígitos. */
  async registerNumber(pin: string) {
    this.requirePhone();
    return this.request<{ success: boolean }>("POST", `${this.config.phoneNumberId}/register`, {
      messaging_product: "whatsapp",
      pin,
    });
  }
}
