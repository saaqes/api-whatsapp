import { extractText } from "unpdf";
import { prisma, type KnowledgeKind } from "../database/prisma.js";
import { chunkText, normalizeForSearch, queryTerms } from "../utils/text.js";
import { badRequest, notFound } from "../utils/errors.js";
import type { KnowledgeHit } from "../ai/prompt.js";

/**
 * Base de conocimientos: documentos, notas y preguntas frecuentes.
 * La búsqueda usa el motor de texto completo de PostgreSQL (configuración "spanish"),
 * sin servicios externos ni costos adicionales. Arquitectura preparada para añadir
 * búsqueda semántica con embeddings (requeriría un proveedor externo, p. ej. Voyage AI).
 */

export interface KnowledgeInput {
  title: string;
  kind: KnowledgeKind;
  content?: string;
  question?: string;
  answer?: string;
  tags?: string[];
  enabled?: boolean;
  fileName?: string | null;
  mimeType?: string | null;
}

export const MAX_DOCUMENT_CHARS = 400_000;

function composeContent(input: KnowledgeInput): string {
  if (input.kind === "FAQ") {
    const q = (input.question ?? "").trim();
    const a = (input.answer ?? "").trim();
    if (!q || !a) throw badRequest("Una pregunta frecuente necesita pregunta y respuesta.");
    return `Pregunta: ${q}\nRespuesta: ${a}`;
  }
  const c = (input.content ?? "").trim();
  if (!c) throw badRequest("El contenido no puede estar vacío.");
  return c;
}

function buildChunks(title: string, content: string) {
  // El título se incluye en el texto indexado para que también se pueda encontrar por él.
  return chunkText(content).map((chunk, ordinal) => ({
    ordinal,
    content: chunk,
    searchText: normalizeForSearch(`${title}\n${chunk}`),
  }));
}

export async function createDocument(input: KnowledgeInput) {
  const content = composeContent(input);
  if (content.length > MAX_DOCUMENT_CHARS) throw badRequest("El documento es demasiado largo (máx. 400.000 caracteres).");
  const chunks = buildChunks(input.title, content);
  return prisma.knowledgeDocument.create({
    data: {
      title: input.title.trim(),
      kind: input.kind,
      content,
      question: input.kind === "FAQ" ? input.question?.trim() : null,
      answer: input.kind === "FAQ" ? input.answer?.trim() : null,
      tags: input.tags ?? [],
      enabled: input.enabled ?? true,
      fileName: input.fileName ?? null,
      mimeType: input.mimeType ?? null,
      chunkCount: chunks.length,
      chunks: { create: chunks },
    },
  });
}

export async function updateDocument(id: string, patch: Partial<KnowledgeInput>) {
  const doc = await prisma.knowledgeDocument.findUnique({ where: { id } });
  if (!doc) throw notFound("Documento no encontrado");
  const merged: KnowledgeInput = {
    title: patch.title ?? doc.title,
    kind: doc.kind,
    content: patch.content ?? doc.content,
    question: patch.question ?? doc.question ?? undefined,
    answer: patch.answer ?? doc.answer ?? undefined,
    tags: patch.tags ?? doc.tags,
    enabled: patch.enabled ?? doc.enabled,
  };
  const content = composeContent(merged);
  if (content.length > MAX_DOCUMENT_CHARS) throw badRequest("El documento es demasiado largo.");
  const needsReindex = content !== doc.content || merged.title !== doc.title;
  return prisma.$transaction(async (tx) => {
    if (needsReindex) {
      await tx.knowledgeChunk.deleteMany({ where: { documentId: id } });
      const chunks = buildChunks(merged.title, content);
      await tx.knowledgeChunk.createMany({ data: chunks.map((c) => ({ ...c, documentId: id })) });
    }
    return tx.knowledgeDocument.update({
      where: { id },
      data: {
        title: merged.title.trim(),
        content,
        question: doc.kind === "FAQ" ? merged.question?.trim() : null,
        answer: doc.kind === "FAQ" ? merged.answer?.trim() : null,
        tags: merged.tags,
        enabled: merged.enabled,
        ...(needsReindex ? { chunkCount: chunkText(content).length } : {}),
      },
    });
  });
}

export async function deleteDocument(id: string) {
  await prisma.knowledgeDocument.delete({ where: { id } }).catch(() => {
    throw notFound("Documento no encontrado");
  });
}

/** Extrae texto de un archivo subido (PDF o texto plano). */
export async function extractFileText(data: Buffer, mime: string, fileName: string): Promise<string> {
  const lower = fileName.toLowerCase();
  if (mime === "application/pdf" || lower.endsWith(".pdf")) {
    const { text, totalPages } = await extractText(new Uint8Array(data), { mergePages: true });
    const clean = text.replace(/[ \t]+/g, " ").trim();
    if (clean.length < 20) {
      throw badRequest(
        `No se encontró texto en el PDF (${totalPages} páginas). Probablemente es un escaneo o imagen: conviértelo a texto (OCR) antes de subirlo.`,
      );
    }
    return clean;
  }
  if (mime.startsWith("text/") || /\.(txt|md|csv)$/.test(lower)) {
    const text = data.toString("utf8").replace(/^﻿/, "");
    if (!text.trim()) throw badRequest("El archivo está vacío.");
    return text;
  }
  throw badRequest("Formato no admitido. Sube un archivo PDF o TXT.");
}

/**
 * Busca los fragmentos más relevantes. Une las palabras de la consulta con OR y ordena por
 * relevancia, para que una pregunta natural encuentre documentos aunque no use las mismas palabras exactas.
 */
export async function searchKnowledge(query: string, limit = 4): Promise<KnowledgeHit[]> {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];
  const tsquery = terms.join(" | ");
  const rows = await prisma.$queryRaw<Array<{ documentId: string; title: string; content: string; rank: number }>>`
    SELECT d.id AS "documentId", d.title, c.content, ts_rank_cd(c.tsv, q)::float AS rank
    FROM "KnowledgeChunk" c
    JOIN "KnowledgeDocument" d ON d.id = c."documentId",
         to_tsquery('spanish', ${tsquery}) q
    WHERE d.enabled = true AND c.tsv @@ q
    ORDER BY rank DESC, c.ordinal ASC
    LIMIT ${limit}`;
  return rows.map((r) => ({ ...r, rank: Number(r.rank) }));
}
