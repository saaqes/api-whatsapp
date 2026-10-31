/**
 * Catálogo de modelos de Claude con precios de lista (USD por millón de tokens).
 * Fuente: precios publicados por Anthropic (consultados en octubre de 2026).
 * Los precios pueden cambiar: verifica en https://claude.com/pricing antes de presupuestar.
 * Los costos que muestra el panel son ESTIMACIONES calculadas con esta tabla.
 */
export interface ModelInfo {
  id: string;
  label: string;
  description: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number; // escritura de caché de 5 minutos
  /** Acepta `output_config.effort`. */
  effort: boolean;
  /** Acepta `thinking: {type: "adaptive"}`. */
  adaptiveThinking: boolean;
  vision: boolean;
  pdf: boolean;
}

export const MODELS: ModelInfo[] = [
  {
    id: "claude-opus-5-5",
    label: "Claude Opus 5.5",
    description: "Modelo recomendado: máxima calidad en conversación, razonamiento y lectura de imágenes.",
    input: 4,
    output: 20,
    cacheRead: 0.2,
    cacheWrite: 5,
    effort: true,
    adaptiveThinking: true,
    vision: true,
    pdf: true,
  },
  {
    id: "claude-sonnet-5-5",
    label: "Claude Sonnet 5.5",
    description: "Equilibrio entre calidad, velocidad y costo.",
    input: 2,
    output: 10,
    cacheRead: 0.2,
    cacheWrite: 2.5,
    effort: true,
    adaptiveThinking: true,
    vision: true,
    pdf: true,
  },
  {
    id: "claude-haiku-5-5",
    label: "Claude Haiku 5.5",
    description: "El más económico y rápido. Ideal para alto volumen o tareas auxiliares (memoria).",
    input: 0.1, // hasta 100K tokens de entrada por solicitud (0,50 / 2,50 por encima)
    output: 0.5,
    cacheRead: 0.01, // estimado (0,1× la entrada, proporción habitual)
    cacheWrite: 0.125,
    effort: true,
    adaptiveThinking: true,
    vision: true,
    pdf: true,
  },
  {
    id: "claude-fable-5-1",
    label: "Claude Fable 5.1",
    description: "El modelo más capaz de Anthropic. Mucho más caro; rara vez necesario para un chat.",
    input: 10,
    output: 50,
    cacheRead: 0.25,
    cacheWrite: 12.5,
    effort: true,
    adaptiveThinking: true,
    vision: true,
    pdf: true,
  },
  {
    id: "claude-opus-5",
    label: "Claude Opus 5 (anterior)",
    description: "Generación anterior de Opus.",
    input: 5,
    output: 25,
    cacheRead: 0.5,
    cacheWrite: 6.25,
    effort: true,
    adaptiveThinking: true,
    vision: true,
    pdf: true,
  },
  {
    id: "claude-sonnet-5",
    label: "Claude Sonnet 5 (anterior)",
    description: "Generación anterior de Sonnet.",
    input: 2,
    output: 10,
    cacheRead: 0.2,
    cacheWrite: 2.5,
    effort: true,
    adaptiveThinking: true,
    vision: true,
    pdf: true,
  },
  {
    id: "claude-haiku-4-5",
    label: "Claude Haiku 4.5 (anterior)",
    description: "Generación anterior de Haiku. No admite el ajuste de esfuerzo.",
    input: 1,
    output: 5,
    cacheRead: 0.1,
    cacheWrite: 1.25,
    effort: false,
    adaptiveThinking: false,
    vision: true,
    pdf: true,
  },
];

const FALLBACK: Omit<ModelInfo, "id" | "label" | "description"> = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  effort: true,
  adaptiveThinking: true,
  vision: true,
  pdf: true,
};

export function getModelInfo(id: string): ModelInfo & { known: boolean } {
  const m = MODELS.find((x) => x.id === id);
  if (m) return { ...m, known: true };
  // Un modelo personalizado: se intenta igual, pero el costo no se puede estimar.
  return { id, label: id, description: "Modelo personalizado (costo no estimado)", ...FALLBACK, known: false };
}

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export function estimateCostUsd(modelId: string, u: UsageTotals): number {
  const m = getModelInfo(modelId);
  // Haiku 5.5 cuesta 5x más por encima de 100K tokens de entrada por solicitud; aquí no aplica
  // en la práctica (los mensajes de chat son mucho más cortos), así que usamos la tarifa base.
  const cost =
    (u.inputTokens * m.input + u.outputTokens * m.output + u.cacheReadTokens * m.cacheRead + u.cacheWriteTokens * m.cacheWrite) /
    1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
