/** Minúsculas y sin tildes: "Envío" → "envio". Se usa para indexar y buscar. */
export function normalizeForSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** Palabras útiles de una consulta (letras/números, 2+ caracteres), sin duplicados. */
export function queryTerms(text: string, max = 24): string[] {
  const words = normalizeForSearch(text).match(/[\p{L}\p{N}]{2,}/gu) ?? [];
  return [...new Set(words)].slice(0, max);
}

/**
 * Divide un texto en fragmentos de ~maxChars respetando párrafos y frases,
 * con un pequeño solapamiento para no perder contexto en los bordes.
 */
export function chunkText(text: string, maxChars = 1200, overlap = 150): string[] {
  const clean = text.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const pieces = clean.split(/(?<=\n\n)|(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces) {
    if ((current + piece).length > maxChars && current.length > 0) {
      chunks.push(current.trim());
      current = current.slice(Math.max(0, current.length - overlap));
    }
    if (piece.length > maxChars) {
      // Frase gigante: cortar a la fuerza.
      for (let i = 0; i < piece.length; i += maxChars - overlap) {
        chunks.push(piece.slice(i, i + maxChars).trim());
      }
      current = "";
      continue;
    }
    current += (current && !current.endsWith("\n") ? " " : "") + piece;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter((c) => c.length > 0);
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + "…";
}

/**
 * Convierte el Markdown habitual de los modelos al formato de WhatsApp:
 * **negrita** → *negrita*, encabezados → *texto*, [texto](url) → texto (url), listas "* " → "• ".
 */
export function markdownToWhatsApp(md: string): string {
  let out = md.replace(/\r\n/g, "\n");
  // Bloques de código: WhatsApp usa ``` igual; los dejamos.
  out = out.replace(/^#{1,6}\s+(.+)$/gm, "*$1*");
  out = out.replace(/\*\*(.+?)\*\*/g, "*$1*");
  out = out.replace(/__(.+?)__/g, "_$1_");
  out = out.replace(/~~(.+?)~~/g, "~$1~");
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1 ($2)");
  out = out.replace(/^(\s*)[*-]\s+/gm, "$1• ");
  out = out.replace(/^\s*---+\s*$/gm, "");
  out = out.replace(/\n{3,}/g, "\n\n");
  return out.trim();
}

/** WhatsApp admite hasta 4096 caracteres por mensaje de texto. */
export const WHATSAPP_TEXT_LIMIT = 4096;

/**
 * Divide una respuesta en burbujas. Si `byParagraph` es true, separa por párrafos
 * (máximo `maxBubbles`) para un estilo más natural; siempre respeta el límite de WhatsApp.
 */
export function splitForWhatsApp(text: string, byParagraph = false, maxBubbles = 3, limit = WHATSAPP_TEXT_LIMIT): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  let parts: string[] = [trimmed];
  if (byParagraph) {
    const paragraphs = trimmed.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    if (paragraphs.length > 1) {
      // Agrupar párrafos para no superar maxBubbles.
      const perBubble = Math.ceil(paragraphs.length / maxBubbles);
      parts = [];
      for (let i = 0; i < paragraphs.length; i += perBubble) {
        parts.push(paragraphs.slice(i, i + perBubble).join("\n\n"));
      }
    }
  }
  const result: string[] = [];
  for (const part of parts) {
    if (part.length <= limit) {
      result.push(part);
      continue;
    }
    let rest = part;
    while (rest.length > limit) {
      let cut = rest.lastIndexOf("\n", limit);
      if (cut < limit * 0.5) cut = rest.lastIndexOf(". ", limit);
      if (cut < limit * 0.5) cut = rest.lastIndexOf(" ", limit);
      // Sin un buen punto de corte (p. ej. una palabra enorme): cortar justo en el límite.
      if (cut < limit * 0.5) cut = limit - 1;
      result.push(rest.slice(0, cut + 1).trim());
      rest = rest.slice(cut + 1).trim();
    }
    if (rest) result.push(rest);
  }
  return result;
}
