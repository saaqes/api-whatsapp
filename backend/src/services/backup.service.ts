import { prisma } from "../database/prisma.js";

export const BACKUP_FORMAT = "whatsapp-ai-backup/v1";

/**
 * Copia de seguridad en JSON con los datos del negocio. NO incluye credenciales,
 * sesiones ni contraseñas: tras restaurar hay que volver a configurar las credenciales.
 */
export async function exportBackup() {
  const [settings, contacts, messages, memories, knowledge, rules, usage] = await Promise.all([
    prisma.setting.findMany(),
    prisma.contact.findMany({ where: { isSimulated: false } }),
    prisma.message.findMany({ where: { contact: { isSimulated: false } }, orderBy: { createdAt: "asc" } }),
    prisma.contactMemory.findMany({ where: { contact: { isSimulated: false } } }),
    prisma.knowledgeDocument.findMany(),
    prisma.automationRule.findMany(),
    prisma.aiUsage.findMany({ where: { createdAt: { gte: new Date(Date.now() - 180 * 24 * 3600_000) } } }),
  ]);
  return {
    format: BACKUP_FORMAT,
    createdAt: new Date().toISOString(),
    counts: { contacts: contacts.length, messages: messages.length, memories: memories.length, knowledge: knowledge.length },
    settings,
    contacts,
    messages,
    memories,
    knowledge,
    rules,
    usage,
  };
}

type Backup = Awaited<ReturnType<typeof exportBackup>>;

/** Restaura una copia en una base de datos vacía (lo usa scripts/restore-backup.ts). */
export async function importBackup(data: Backup, opts: { force?: boolean } = {}) {
  if (data.format !== BACKUP_FORMAT) throw new Error("El archivo no es una copia de seguridad válida de este sistema.");
  const existing = await prisma.contact.count();
  if (existing > 0 && !opts.force) {
    throw new Error("La base de datos ya tiene contactos. Restaura sobre una base vacía o usa --force para combinar.");
  }
  const { createDocument } = await import("../knowledge/knowledge.service.js");
  await prisma.$transaction(
    async (tx) => {
      for (const s of data.settings) {
        await tx.setting.upsert({ where: { key: s.key }, create: { key: s.key, value: s.value as object }, update: { value: s.value as object } });
      }
      await tx.contact.createMany({ data: data.contacts, skipDuplicates: true });
      await tx.message.createMany({ data: data.messages as any, skipDuplicates: true });
      await tx.contactMemory.createMany({ data: data.memories, skipDuplicates: true });
      await tx.automationRule.createMany({ data: data.rules, skipDuplicates: true });
      await tx.aiUsage.createMany({ data: data.usage, skipDuplicates: true });
    },
    { timeout: 120_000 },
  );
  // Los documentos se recrean para regenerar el índice de búsqueda.
  for (const d of data.knowledge) {
    await createDocument({
      title: d.title,
      kind: d.kind,
      content: d.content,
      question: d.question ?? undefined,
      answer: d.answer ?? undefined,
      tags: d.tags,
      enabled: d.enabled,
      fileName: d.fileName,
      mimeType: d.mimeType,
    });
  }
}
