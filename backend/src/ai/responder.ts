import type { AiSettings } from "../services/settings.service.js";
import { getModelInfo, estimateCostUsd, type UsageTotals } from "./models.js";
import { buildTools, executeTool, type ToolRunState } from "./tools.js";
import type { BetaMessage, BetaMessageParam, ClaudeGateway, CreateParams } from "./claude.js";

const MAX_TOOL_ROUNDS = 4;

export interface ReplyResult {
  text: string;
  model: string;
  usage: UsageTotals;
  costUsd: number;
  latencyMs: number;
  stopReason: string | null;
  refusal: { category: string | null } | null;
  handoffReason: string | null;
  knowledgeQueries: string[];
  rounds: number;
}

export interface GenerateReplyInput {
  settings: AiSettings;
  stableSystem: string;
  dynamicContext: string;
  messages: BetaMessageParam[];
  /** Id opaco del contacto (no el teléfono) para la detección de abusos de Anthropic. */
  contactRef: string;
}

function addUsage(total: UsageTotals, msg: BetaMessage) {
  total.inputTokens += msg.usage.input_tokens ?? 0;
  total.outputTokens += msg.usage.output_tokens ?? 0;
  total.cacheReadTokens += msg.usage.cache_read_input_tokens ?? 0;
  total.cacheWriteTokens += msg.usage.cache_creation_input_tokens ?? 0;
}

function textOf(msg: BetaMessage): string {
  return msg.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("\n\n")
    .trim();
}

/**
 * Genera la respuesta para un contacto. El historial se envía como texto (sin bloques de
 * razonamiento de turnos anteriores), lo que mantiene válido el prefijo en cada solicitud.
 * Dentro de un mismo turno, si la IA usa herramientas, se devuelven sus bloques sin modificar.
 */
export async function generateReply(input: GenerateReplyInput, claude: ClaudeGateway): Promise<ReplyResult> {
  const { settings } = input;
  const info = getModelInfo(settings.model);
  const tools = buildTools({
    knowledge: settings.knowledgeEnabled && settings.toolKnowledgeSearch,
    handoff: settings.toolHandoff,
  });
  const state: ToolRunState = { handoffReason: null, knowledgeQueries: [] };
  const usage: UsageTotals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  const messages: BetaMessageParam[] = [...input.messages];
  const started = Date.now();
  let costUsd = 0;
  let last: BetaMessage | null = null;
  const interimTexts: string[] = [];
  let rounds = 0;

  for (let round = 1; round <= MAX_TOOL_ROUNDS; round++) {
    rounds = round;
    const finalRound = round === MAX_TOOL_ROUNDS;
    const params: CreateParams = {
      model: settings.model,
      max_tokens: settings.maxTokens,
      system: [
        // Bloque estable en caché (las solicitudes siguientes lo leen a ~5-10 % del precio).
        { type: "text", text: input.stableSystem, cache_control: { type: "ephemeral" } },
        { type: "text", text: input.dynamicContext },
      ],
      messages,
      metadata: { user_id: input.contactRef },
      ...(tools.length ? { tools, tool_choice: { type: finalRound ? "none" : "auto" } as const } : {}),
      ...(info.effort ? { output_config: { effort: settings.effort } } : {}),
      ...(info.adaptiveThinking ? { thinking: { type: "adaptive" } as const } : {}),
    };

    const msg = await claude.create(params);
    last = msg;
    addUsage(usage, msg);
    costUsd += estimateCostUsd(msg.model || settings.model, {
      inputTokens: msg.usage.input_tokens ?? 0,
      outputTokens: msg.usage.output_tokens ?? 0,
      cacheReadTokens: msg.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: msg.usage.cache_creation_input_tokens ?? 0,
    });

    if (msg.stop_reason === "refusal") {
      return {
        text: "",
        model: msg.model,
        usage,
        costUsd,
        latencyMs: Date.now() - started,
        stopReason: msg.stop_reason,
        refusal: { category: msg.stop_details?.category ?? null },
        handoffReason: state.handoffReason,
        knowledgeQueries: state.knowledgeQueries,
        rounds,
      };
    }

    const toolUses = msg.content.filter((b) => b.type === "tool_use") as Array<{ id: string; name: string; input: unknown }>;
    if (msg.stop_reason === "tool_use" && toolUses.length > 0 && !finalRound) {
      const t = textOf(msg);
      if (t) interimTexts.push(t);
      // Se devuelve el contenido completo (incluidos bloques de razonamiento) sin modificar.
      messages.push({ role: "assistant", content: msg.content as any });
      const results = [];
      for (const tu of toolUses) {
        const r = await executeTool(tu.name, tu.input, state);
        results.push({ type: "tool_result" as const, tool_use_id: tu.id, content: r.content, ...(r.isError ? { is_error: true } : {}) });
      }
      // Todos los resultados en un único mensaje de usuario.
      messages.push({ role: "user", content: results });
      continue;
    }
    if (msg.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: msg.content as any });
      continue;
    }
    break;
  }

  const finalText = last ? textOf(last) : "";
  return {
    text: finalText || interimTexts.join("\n\n"),
    model: last?.model ?? settings.model,
    usage,
    costUsd,
    latencyMs: Date.now() - started,
    stopReason: last?.stop_reason ?? null,
    refusal: null,
    handoffReason: state.handoffReason,
    knowledgeQueries: state.knowledgeQueries,
    rounds,
  };
}
