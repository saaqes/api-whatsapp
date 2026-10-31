import type { BetaTool } from "./claude.js";
import { searchKnowledge } from "../knowledge/knowledge.service.js";
import { sanitizeData } from "./prompt.js";
import { truncate } from "../utils/text.js";

/**
 * Herramientas que la IA puede usar. Cada ejecución está ligada al contacto de la
 * conversación actual en el servidor: el modelo NO puede elegir otro contacto.
 * Para añadir una herramienta nueva: define su esquema aquí y su ejecución en `executeTool`.
 */

export const TOOL_SEARCH_KNOWLEDGE: BetaTool = {
  name: "search_knowledge_base",
  description:
    "Busca en la base de conocimientos del negocio (productos, precios, horarios, envíos, políticas, preguntas frecuentes). " +
    "Úsala cuando el cliente pregunte algo específico del negocio que no esté ya en <conocimiento_relevante>. " +
    "Escribe la consulta con palabras clave en español.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Palabras clave a buscar, p. ej. «precio envío Medellín»" },
    },
    required: ["query"],
    additionalProperties: false,
  },
};

export const TOOL_REQUEST_HUMAN: BetaTool = {
  name: "request_human_agent",
  description:
    "Deriva la conversación a una persona del equipo y pausa al asistente para este cliente. " +
    "Úsala si el cliente pide hablar con una persona, ante quejas serias, o cuando el caso requiere a alguien del equipo.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      reason: { type: "string", description: "Motivo breve de la derivación, para el equipo" },
    },
    required: ["reason"],
    additionalProperties: false,
  },
};

export function buildTools(opts: { knowledge: boolean; handoff: boolean }): BetaTool[] {
  const tools: BetaTool[] = [];
  if (opts.knowledge) tools.push(TOOL_SEARCH_KNOWLEDGE);
  if (opts.handoff) tools.push(TOOL_REQUEST_HUMAN);
  return tools;
}

export interface ToolRunState {
  handoffReason: string | null;
  knowledgeQueries: string[];
}

export async function executeTool(name: string, input: unknown, state: ToolRunState): Promise<{ content: string; isError?: boolean }> {
  const args = (input ?? {}) as Record<string, unknown>;
  switch (name) {
    case "search_knowledge_base": {
      const query = typeof args.query === "string" ? args.query.slice(0, 300) : "";
      if (!query.trim()) return { content: "Consulta vacía.", isError: true };
      state.knowledgeQueries.push(query);
      const hits = await searchKnowledge(query, 5);
      if (!hits.length) return { content: "Sin resultados en la base de conocimientos para esa búsqueda." };
      return {
        content: hits.map((h, i) => `[${i + 1}] ${sanitizeData(h.title)}\n${sanitizeData(truncate(h.content, 1500))}`).join("\n\n"),
      };
    }
    case "request_human_agent": {
      const reason = typeof args.reason === "string" ? args.reason.slice(0, 300) : "Solicitud del cliente";
      state.handoffReason = reason || "Solicitud del cliente";
      return {
        content:
          "Hecho: el equipo fue notificado y el asistente quedará en pausa para este cliente. Despídete brevemente y dile que una persona le responderá pronto.",
      };
    }
    default:
      return { content: `Herramienta desconocida: ${name}`, isError: true };
  }
}
