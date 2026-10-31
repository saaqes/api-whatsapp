import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { env } from "../config/env.js";
import { getSecret } from "../services/settings.service.js";

export type BetaMessage = Anthropic.Beta.BetaMessage;
export type BetaMessageParam = Anthropic.Beta.BetaMessageParam;
export type BetaContentBlockParam = Anthropic.Beta.BetaContentBlockParam;
export type BetaTool = Anthropic.Beta.BetaTool;
export type BetaTextBlockParam = Anthropic.Beta.BetaTextBlockParam;
export type CreateParams = Anthropic.Beta.MessageCreateParamsNonStreaming;

/**
 * Reintento automático en otro modelo si el modelo principal rechaza una solicitud por sus
 * clasificadores de seguridad (falsos positivos). Con "default" Anthropic elige el modelo
 * de respaldo según la categoría; en modelos que no lo admiten la solicitud corre igual.
 */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export class ClaudeNotConfiguredError extends Error {
  constructor() {
    super("Falta la API Key de Claude. Configúrala en Sistema → Conexiones o en la variable ANTHROPIC_API_KEY.");
  }
}

/** Interfaz mínima que usa la aplicación; permite sustituir Claude por un simulador en pruebas. */
export interface ClaudeGateway {
  readonly mock: boolean;
  create(params: CreateParams): Promise<BetaMessage>;
  parse<T>(params: Omit<CreateParams, "output_config"> & { effort?: "low" | "medium" | "high" }, schema: z.ZodType<T>): Promise<{
    message: BetaMessage;
    parsed: T | null;
  }>;
  checkModel(model: string): Promise<{ id: string; displayName: string }>;
}

// ───────────────────────────── Implementación real ─────────────────────────────

class AnthropicGateway implements ClaudeGateway {
  readonly mock = false;
  private client: Anthropic | null = null;
  private clientKey: string | null = null;

  private async getClient(): Promise<Anthropic> {
    const key = await getSecret("anthropic_api_key");
    if (!key) throw new ClaudeNotConfiguredError();
    if (!this.client || this.clientKey !== key) {
      // La clave solo vive en el servidor; nunca se envía al navegador.
      this.client = new Anthropic({ apiKey: key, maxRetries: 3, timeout: 120_000 });
      this.clientKey = key;
    }
    return this.client;
  }

  async create(params: CreateParams): Promise<BetaMessage> {
    const client = await this.getClient();
    return client.beta.messages.create({
      ...params,
      betas: [...new Set([...(params.betas ?? []), FALLBACK_BETA])],
      fallbacks: "default",
    });
  }

  async parse<T>(
    params: Omit<CreateParams, "output_config"> & { effort?: "low" | "medium" | "high" },
    schema: z.ZodType<T>,
  ) {
    const client = await this.getClient();
    const { effort, ...rest } = params;
    const message = await client.beta.messages.parse({
      ...rest,
      betas: [...new Set([...(rest.betas ?? []), FALLBACK_BETA])],
      fallbacks: "default",
      output_config: {
        format: betaZodOutputFormat(schema as any),
        ...(effort ? { effort } : {}),
      },
    });
    return { message: message as unknown as BetaMessage, parsed: (message.parsed_output ?? null) as T | null };
  }

  async checkModel(model: string) {
    const client = await this.getClient();
    const m = await client.models.retrieve(model);
    return { id: m.id, displayName: m.display_name };
  }
}

// ───────────────────────────── Simulador (solo pruebas / demostración) ─────────────────────────────

function lastUserText(params: CreateParams): string {
  for (let i = params.messages.length - 1; i >= 0; i--) {
    const m = params.messages[i];
    if (m.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    const texts = m.content.filter((b) => b.type === "text").map((b) => (b as BetaTextBlockParam).text);
    if (texts.length) return texts.join(" ");
  }
  return "";
}

/**
 * Respuestas deterministas sin llamar a Anthropic. Se activa con CLAUDE_MOCK=true.
 * El panel muestra un aviso visible cuando está activo; NO es inteligencia real.
 */
export class MockGateway implements ClaudeGateway {
  readonly mock = true;
  calls: CreateParams[] = [];
  /** Permite a las pruebas definir la respuesta. */
  responder: ((params: CreateParams) => Partial<BetaMessage> | string | Promise<Partial<BetaMessage> | string>) | null = null;
  parser: ((params: any) => unknown) | null = null;

  async create(params: CreateParams): Promise<BetaMessage> {
    this.calls.push(params);
    const custom = await this.responder?.(params);
    const base: BetaMessage = {
      id: `msg_mock_${this.calls.length}`,
      type: "message",
      role: "assistant",
      model: params.model,
      content: [{ type: "text", text: `[Modo prueba] Recibí tu mensaje: "${lastUserText(params).slice(0, 200)}"`, citations: null }],
      stop_reason: "end_turn",
      stop_sequence: null,
      stop_details: null,
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    } as unknown as BetaMessage;
    if (typeof custom === "string") {
      base.content = [{ type: "text", text: custom, citations: null } as any];
      return base;
    }
    return { ...base, ...(custom ?? {}) } as BetaMessage;
  }

  async parse<T>(params: any, schema: z.ZodType<T>) {
    this.calls.push(params);
    let raw: unknown = this.parser?.(params);
    if (raw === undefined) {
      // Extracción muy simple de "me llamo X" para poder demostrar la memoria sin Claude.
      const text = JSON.stringify(params.messages);
      const name = /me llamo ([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)/.exec(text)?.[1];
      raw = {
        summary: "Conversación de prueba (modo simulado).",
        add: name ? [{ category: "PERSONAL", content: `Se llama ${name}` }] : [],
        update: [],
        remove: [],
        classification: null,
        intent: null,
      };
    }
    const parsed = schema.parse(raw);
    const message = await this.create({ ...params, messages: params.messages });
    return { message, parsed };
  }

  async checkModel(model: string) {
    return { id: model, displayName: `${model} (simulado)` };
  }
}

// ───────────────────────────── Selección ─────────────────────────────

let gateway: ClaudeGateway | null = null;

export function getClaude(): ClaudeGateway {
  if (!gateway) gateway = env.CLAUDE_MOCK ? new MockGateway() : new AnthropicGateway();
  return gateway;
}

/** Para pruebas automatizadas. */
export function setClaude(g: ClaudeGateway | null) {
  gateway = g;
}
