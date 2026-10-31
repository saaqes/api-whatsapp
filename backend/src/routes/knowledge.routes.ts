import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma, type Prisma } from "../database/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { badRequest, notFound } from "../utils/errors.js";
import {
  createDocument,
  deleteDocument,
  extractFileText,
  searchKnowledge,
  updateDocument,
} from "../knowledge/knowledge.service.js";

const IdParams = z.object({ id: z.string().min(1).max(40) });
const tags = z.array(z.string().trim().min(1).max(40)).max(20);
const MAX_UPLOAD = 10 * 1024 * 1024;

export async function knowledgeRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);
  app.addHook("preHandler", requireRole("OWNER", "ADMIN"));

  app.get("/api/knowledge", async (req) => {
    const q = z
      .object({ search: z.string().trim().max(200).optional(), kind: z.enum(["NOTE", "FAQ", "FILE"]).optional() })
      .parse(req.query);
    const where: Prisma.KnowledgeDocumentWhereInput = {};
    if (q.kind) where.kind = q.kind;
    if (q.search) {
      where.OR = [
        { title: { contains: q.search, mode: "insensitive" } },
        { content: { contains: q.search, mode: "insensitive" } },
      ];
    }
    const items = await prisma.knowledgeDocument.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        kind: true,
        question: true,
        answer: true,
        fileName: true,
        tags: true,
        enabled: true,
        chunkCount: true,
        createdAt: true,
        updatedAt: true,
        content: true,
      },
      take: 500,
    });
    return { items: items.map((d) => ({ ...d, content: d.content.slice(0, 300), contentLength: d.content.length })) };
  });

  app.get("/api/knowledge/:id", async (req) => {
    const { id } = IdParams.parse(req.params);
    const doc = await prisma.knowledgeDocument.findUnique({ where: { id } });
    if (!doc) throw notFound("Documento no encontrado");
    return doc;
  });

  app.post("/api/knowledge", async (req) => {
    const body = z
      .object({
        title: z.string().trim().min(1).max(200),
        kind: z.enum(["NOTE", "FAQ"]),
        content: z.string().max(400_000).optional(),
        question: z.string().max(2000).optional(),
        answer: z.string().max(20_000).optional(),
        tags: tags.default([]),
        enabled: z.boolean().default(true),
      })
      .parse(req.body);
    return createDocument(body);
  });

  app.patch("/api/knowledge/:id", async (req) => {
    const { id } = IdParams.parse(req.params);
    const body = z
      .object({
        title: z.string().trim().min(1).max(200).optional(),
        content: z.string().max(400_000).optional(),
        question: z.string().max(2000).optional(),
        answer: z.string().max(20_000).optional(),
        tags: tags.optional(),
        enabled: z.boolean().optional(),
      })
      .parse(req.body);
    return updateDocument(id, body);
  });

  app.delete("/api/knowledge/:id", async (req) => {
    const { id } = IdParams.parse(req.params);
    await deleteDocument(id);
    return { ok: true };
  });

  // Subida de PDF o TXT (multipart/form-data, campo "file"; campo opcional "title").
  app.post("/api/knowledge/upload", async (req) => {
    const file = await req.file({ limits: { fileSize: MAX_UPLOAD, files: 1 } });
    if (!file) throw badRequest("No se recibió ningún archivo.");
    const data = await file.toBuffer();
    if (file.file.truncated) throw badRequest("El archivo supera el máximo de 10 MB.");
    const titleField = file.fields.title as { value?: string } | undefined;
    const title = (titleField?.value ?? "").trim() || file.filename.replace(/\.[^.]+$/, "");
    const text = await extractFileText(data, file.mimetype, file.filename);
    return createDocument({
      title: title.slice(0, 200),
      kind: "FILE",
      content: text,
      fileName: file.filename.slice(0, 200),
      mimeType: file.mimetype,
    });
  });

  // Probar la búsqueda tal como la usa la IA.
  app.get("/api/knowledge-search", async (req) => {
    const { q } = z.object({ q: z.string().trim().min(1).max(500) }).parse(req.query);
    return { results: await searchKnowledge(q, 8) };
  });
}
