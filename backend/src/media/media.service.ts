import type { Message } from "../database/prisma.js";
import { prisma } from "../database/prisma.js";
import type { BetaContentBlockParam } from "../ai/claude.js";
import { getSection } from "../services/settings.service.js";
import { getWhatsAppClient } from "../whatsapp/index.js";
import { isTranscriptionEnabled, transcribeAudio } from "./transcription.js";
import { logError } from "../services/errorlog.service.js";
import { truncate } from "../utils/text.js";

const CLAUDE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const TEXT_DOC_TYPES = new Set(["text/plain", "text/csv", "text/markdown", "application/json"]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Texto que representa un mensaje en el historial (sin volver a enviar el archivo). */
export function messagePlaceholder(m: Pick<Message, "type" | "text" | "transcription" | "mediaFilename" | "templateName">): string {
  const caption = m.text?.trim();
  switch (m.type) {
    case "IMAGE":
      return caption ? `[Imagen] ${caption}` : "[Imagen]";
    case "STICKER":
      return "[Sticker]";
    case "VIDEO":
      return caption ? `[Video] ${caption}` : "[Video]";
    case "AUDIO":
      return m.transcription ? `[Nota de voz, transcripción]: ${m.transcription}` : "[Nota de voz sin transcribir]";
    case "DOCUMENT":
      return `[Documento${m.mediaFilename ? `: ${m.mediaFilename}` : ""}]${caption ? ` ${caption}` : ""}`;
    case "TEMPLATE":
      return `[Plantilla ${m.templateName ?? ""}] ${caption ?? ""}`.trim();
    case "UNSUPPORTED":
      return caption ?? "[Tipo de mensaje no compatible]";
    default:
      return caption ?? "";
  }
}

export interface PreparedContent {
  blocks: BetaContentBlockParam[];
  notes: string[]; // avisos para el contexto (p. ej. "no pude escuchar el audio")
}

/**
 * Convierte los mensajes pendientes del contacto en bloques para Claude:
 * texto, imágenes (visión), PDF (documentos) y audios transcritos (si hay servicio configurado).
 */
export async function prepareInboundContent(messages: Message[], isSimulated: boolean): Promise<PreparedContent> {
  const media = await getSection("media");
  const blocks: BetaContentBlockParam[] = [];
  const notes: string[] = [];
  const wa = await getWhatsAppClient();

  for (const m of messages) {
    const canDownload = Boolean(m.mediaId) && !isSimulated && !wa.simulated;
    try {
      if ((m.type === "IMAGE" || m.type === "STICKER") && media.images && canDownload) {
        const { data, mime } = await wa.downloadMedia(m.mediaId!, MAX_IMAGE_BYTES);
        const type = mime.split(";")[0];
        if (CLAUDE_IMAGE_TYPES.has(type) && data.length <= MAX_IMAGE_BYTES) {
          blocks.push({ type: "image", source: { type: "base64", media_type: type as any, data: data.toString("base64") } });
          blocks.push({ type: "text", text: m.text?.trim() ? `[Imagen enviada por el cliente] ${m.text}` : "[Imagen enviada por el cliente]" });
          continue;
        }
      }
      if (m.type === "DOCUMENT" && media.documents && canDownload) {
        const maxBytes = media.maxDocumentMb * 1024 * 1024;
        const { data, mime } = await wa.downloadMedia(m.mediaId!, maxBytes);
        const type = mime.split(";")[0];
        if (type === "application/pdf") {
          blocks.push({
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: data.toString("base64") },
            title: m.mediaFilename ?? "documento.pdf",
          });
          blocks.push({ type: "text", text: `[Documento PDF enviado por el cliente: ${m.mediaFilename ?? "sin nombre"}]${m.text ? ` ${m.text}` : ""}` });
          continue;
        }
        if (TEXT_DOC_TYPES.has(type)) {
          const text = truncate(data.toString("utf8"), 30_000);
          blocks.push({
            type: "text",
            text: `[Documento de texto enviado por el cliente: ${m.mediaFilename ?? "archivo"}]\n<documento_cliente>\n${text}\n</documento_cliente>`,
          });
          continue;
        }
        notes.push(
          `El cliente envió un archivo (${m.mediaFilename ?? type}) en un formato que no puedes leer. Pídele, si hace falta, que lo envíe en PDF o como texto.`,
        );
      }
      if (m.type === "AUDIO") {
        let transcription = m.transcription;
        if (!transcription && canDownload && (await isTranscriptionEnabled())) {
          const { data, mime } = await wa.downloadMedia(m.mediaId!, 25 * 1024 * 1024);
          transcription = await transcribeAudio(data, mime);
          await prisma.message.update({ where: { id: m.id }, data: { transcription } });
          m.transcription = transcription;
        }
        if (!transcription) {
          notes.push(
            "El cliente envió una nota de voz que no puedes escuchar (la transcripción de audio no está activada). Pídele con amabilidad que te lo escriba.",
          );
        }
      }
      if (m.type === "VIDEO") notes.push("El cliente envió un video. No puedes ver videos; si es necesario, pide que lo describa.");
      if (m.type === "IMAGE") {
        notes.push(
          media.images
            ? "El cliente envió una imagen que no pudiste ver (no estaba disponible). Si es importante, pídele que la describa."
            : "El cliente envió una imagen, pero el análisis de imágenes está desactivado. Si es importante, pídele que la describa.",
        );
      }
    } catch (err) {
      await logError("WHATSAPP", err, { messageId: m.id, type: m.type, step: "media" }, m.contactId, "warn");
      if (m.type === "AUDIO") {
        notes.push("No se pudo procesar la nota de voz del cliente. Pídele con amabilidad que te lo escriba.");
      } else {
        notes.push(`No se pudo abrir un archivo que envió el cliente (${m.type.toLowerCase()}). Pídele que lo reenvíe si es importante.`);
      }
    }
    const text = messagePlaceholder(m);
    if (text) blocks.push({ type: "text", text });
  }
  return { blocks, notes };
}
