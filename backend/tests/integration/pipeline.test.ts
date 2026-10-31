import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { prisma } from "../../src/database/prisma.js";
import { setSecret, updateSection } from "../../src/services/settings.service.js";
import { createDocument } from "../../src/knowledge/knowledge.service.js";
import { applyMemoryUpdate } from "../../src/memory/memory.service.js";
import { handleInbound } from "../../src/pipeline/inbound.js";
import { setTranscriptionFetch } from "../../src/media/transcription.js";
import type { MockGateway } from "../../src/ai/claude.js";
import { allText, drain, fakeMeta, lastUserText, liveMode, loginAs, messageWebhook, postWebhook, resetDb, textWebhook, useMockClaude } from "../helpers.js";

let app: FastifyInstance;
let claude: MockGateway;

beforeAll(async () => {
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await resetDb();
  claude = useMockClaude();
});

const send = (from: string, text: string, opts = {}) => postWebhook(app, textWebhook(from, text, opts));
const replies = (waId: string) =>
  prisma.message.findMany({ where: { contact: { waId }, direction: "OUTBOUND" }, orderBy: { createdAt: "asc" } });

function toolUse(name: string, input: unknown, id = "tu_1") {
  return {
    stop_reason: "tool_use" as const,
    content: [{ type: "tool_use", id, name, input }] as any,
  };
}

describe("respuestas de la IA", () => {
  it("responde con el historial de la conversación y mantiene separados los contactos", async () => {
    claude.responder = (p) => (lastUserText(p).includes("Andrés") ? "¡Hola Andrés!" : "¡Hola!");
    await send("573001", "Me llamo Andrés y tengo una tienda de ropa");
    await drain();
    await applyMemoryUpdate(
      (await prisma.contact.findUniqueOrThrow({ where: { waId: "573001" } })).id,
      { summary: "Andrés tiene una tienda de ropa.", add: [{ category: "PERSONAL", content: "Se llama Andrés" }], update: [], remove: [], classification: "prospecto", intent: null },
      40,
    );
    await send("573001", "¿Recuerdas cómo me llamo?");
    await send("573999", "Hola, ¿qué sabes de mí?");
    await drain();

    const callA = claude.calls.find((c) => lastUserText(c).includes("Recuerdas"))!;
    const callB = claude.calls.find((c) => lastUserText(c).includes("qué sabes de mí"))!;
    // Contacto A: historial previo + memoria propia
    expect(allText(callA)).toContain("Me llamo Andrés y tengo una tienda de ropa");
    expect(allText(callA)).toContain("Se llama Andrés");
    expect(callA.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    // Contacto B: NINGÚN dato del contacto A
    expect(allText(callB)).not.toContain("Andrés");
    expect(allText(callB)).not.toContain("tienda de ropa");
    expect(allText(callB)).toContain("No hay datos guardados de este cliente");
    expect((await replies("573001")).map((m) => m.text)).toEqual(["¡Hola Andrés!", "¡Hola!"]);
    expect((await replies("573999")).map((m) => m.text)).toEqual(["¡Hola!"]);
  });

  it("usa caché del prompt estable, esfuerzo configurado y respaldo de seguridad", async () => {
    await updateSection("ai", { effort: "medium", maxTokens: 6000 });
    await send("573001", "Hola");
    await drain();
    const p = claude.calls[0] as any;
    expect(p.model).toBe("claude-opus-5-5");
    expect(p.max_tokens).toBe(6000);
    expect(p.output_config).toEqual({ effort: "medium" });
    expect(p.thinking).toEqual({ type: "adaptive" });
    expect(p.temperature).toBeUndefined(); // la API 2026-10-21 rechaza temperature
    expect(p.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(p.system[1].cache_control).toBeUndefined();
    expect(p.metadata.user_id).not.toContain("573001"); // id opaco, nunca el teléfono
  });

  it("agrupa varios mensajes seguidos en una sola respuesta", async () => {
    await updateSection("ai", { replyDelaySeconds: 2 });
    await send("573001", "Hola");
    await send("573001", "quería preguntar");
    await send("573001", "¿tienen envíos?");
    expect(await prisma.job.count({ where: { type: "reply", status: "PENDING" } })).toBe(1);
    await prisma.job.updateMany({ data: { runAt: new Date() } }); // adelantar el temporizador
    await drain();
    expect(claude.calls).toHaveLength(1);
    expect(lastUserText(claude.calls[0])).toBe("Hola\nquería preguntar\n¿tienen envíos?");
    expect(await replies("573001")).toHaveLength(1);
  });

  it("regenera si llegan mensajes nuevos mientras se generaba (sin respuestas duplicadas)", async () => {
    let first = true;
    claude.responder = async (p) => {
      if (first) {
        first = false;
        // Simula que el cliente escribe justo mientras Claude responde.
        await handleInbound({
          phoneNumberId: "PNID",
          waMessageId: "wamid.mid",
          from: "573001",
          profileName: null,
          timestamp: new Date(),
          type: "TEXT",
          text: "¡y otra cosa!",
          mediaId: null,
          mediaMime: null,
          mediaFilename: null,
          mediaSha256: null,
          replyToWaId: null,
          isVoice: false,
          reactionToWaId: null,
          rawType: "text",
        });
        return "respuesta desactualizada";
      }
      return `respuesta a: ${lastUserText(p).replace(/\n/g, " | ")}`;
    };
    await send("573001", "primera pregunta");
    await drain();
    const out = await replies("573001");
    expect(out.map((m) => m.text)).toEqual(["respuesta a: primera pregunta | ¡y otra cosa!"]);
    expect(await prisma.message.count({ where: { direction: "INBOUND", replyState: "ANSWERED" } })).toBe(2);
  });

  it("convierte el formato Markdown y divide mensajes largos", async () => {
    claude.responder = () => "**Hola** " + "x".repeat(5000);
    await send("573001", "hola");
    await drain();
    const out = await replies("573001");
    expect(out.length).toBe(2);
    expect(out[0].text!.startsWith("*Hola*")).toBe(true);
    expect(out[0].responseTimeMs).not.toBeNull();
    expect(out[1].responseTimeMs).toBeNull();
  });
});

describe("control humano", () => {
  it("con la IA pausada no responde, pero guarda los mensajes; al reactivar no responde lo antiguo", async () => {
    await send("573001", "hola");
    await drain();
    const contact = await prisma.contact.findUniqueOrThrow({ where: { waId: "573001" } });
    const { cookie } = await loginAs(app);
    await app.inject({ method: "PATCH", url: `/api/conversations/${contact.id}/ai`, headers: { cookie }, payload: { paused: true } });

    await send("573001", "¿hay alguien?");
    await drain();
    expect(claude.calls).toHaveLength(1);
    const skipped = await prisma.message.findFirstOrThrow({ where: { text: "¿hay alguien?" } });
    expect(skipped.replyState).toBe("SKIPPED");

    await app.inject({ method: "PATCH", url: `/api/conversations/${contact.id}/ai`, headers: { cookie }, payload: { paused: false } });
    await drain();
    expect(claude.calls).toHaveLength(1); // nada antiguo se responde al reactivar

    await send("573001", "nueva pregunta");
    await drain();
    expect(claude.calls).toHaveLength(2);
    expect(allText(claude.calls[1])).toContain("¿hay alguien?"); // pero sí forma parte del contexto
  });

  it("la respuesta manual cancela la respuesta automática pendiente y pausa la IA", async () => {
    await updateSection("ai", { replyDelaySeconds: 30 });
    await send("573001", "necesito ayuda");
    const contact = await prisma.contact.findUniqueOrThrow({ where: { waId: "573001" } });
    const { cookie } = await loginAs(app, "AGENT");
    const res = await app.inject({
      method: "POST",
      url: `/api/conversations/${contact.id}/messages`,
      headers: { cookie },
      payload: { text: "Hola, soy Marta del equipo" },
    });
    expect(res.statusCode).toBe(200);
    await prisma.job.updateMany({ data: { runAt: new Date() } });
    await drain();
    expect(claude.calls).toHaveLength(0);
    const out = await replies("573001");
    expect(out.map((m) => [m.author, m.text, m.status])).toEqual([["HUMAN", "Hola, soy Marta del equipo", "SIMULATED"]]);
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } })).aiPaused).toBe(true);
  });

  it("descarta la respuesta de la IA si una persona responde mientras se generaba", async () => {
    let contactId = "";
    claude.responder = async () => {
      // Durante la generación, una persona responde (y la pausa automática está desactivada).
      await prisma.message.updateMany({ where: { contactId, replyState: "PENDING" }, data: { replyState: "SKIPPED" } });
      return "respuesta de la IA";
    };
    await updateSection("general", { autoPauseOnHumanReply: false });
    const r = await handleInbound({
      phoneNumberId: "PNID", waMessageId: "wamid.race", from: "573001", profileName: null, timestamp: new Date(), type: "TEXT", text: "hola",
      mediaId: null, mediaMime: null, mediaFilename: null, mediaSha256: null, replyToWaId: null, isVoice: false, reactionToWaId: null, rawType: "text",
    });
    contactId = r.contactId!;
    await drain();
    expect(await prisma.message.count({ where: { author: "AI" } })).toBe(0);
  });

  it("el botón general detiene todas las respuestas automáticas", async () => {
    const { cookie } = await loginAs(app, "AGENT");
    const res = await app.inject({ method: "POST", url: "/api/settings/assistant", headers: { cookie }, payload: { enabled: false } });
    expect(res.json()).toEqual({ assistantEnabled: false });
    await updateSection("automation", { welcome: { enabled: true, text: "Bienvenido", thenAiReplies: true } });
    await send("573001", "hola");
    await drain();
    expect(claude.calls).toHaveLength(0);
    expect(await prisma.message.count({ where: { direction: "OUTBOUND" } })).toBe(0);
    expect((await prisma.message.findFirstOrThrow({ where: { direction: "INBOUND" } })).skipReason).toContain("botón general");
  });

  it("la IA puede derivar a una persona con la herramienta request_human_agent", async () => {
    let n = 0;
    claude.responder = () => (n++ === 0 ? toolUse("request_human_agent", { reason: "Quiere un reembolso" }) : "Te paso con una persona 🙌");
    await send("573001", "quiero que me devuelvan el dinero YA");
    await drain();
    const contact = await prisma.contact.findUniqueOrThrow({ where: { waId: "573001" } });
    expect(contact.aiPaused).toBe(true);
    expect(contact.needsHuman).toBe(true);
    expect(contact.needsHumanReason).toContain("reembolso");
    expect((await replies("573001")).map((m) => m.text)).toEqual(["Te paso con una persona 🙌"]);
    // Segundo turno: el resultado de la herramienta vuelve en un mensaje de usuario
    const second = claude.calls[1] as any;
    expect(second.messages.at(-1).content[0]).toMatchObject({ type: "tool_result", tool_use_id: "tu_1" });
  });
});

describe("base de conocimientos", () => {
  it("incluye automáticamente la información relevante y permite buscar con la herramienta", async () => {
    await createDocument({ title: "Envíos", kind: "FAQ", question: "¿Hacen envíos a Medellín?", answer: "Sí, el envío a Medellín cuesta $12.000 y tarda 2 días." });
    await createDocument({ title: "Horario", kind: "NOTE", content: "Atendemos de lunes a viernes de 9 a 18 h." });
    let n = 0;
    claude.responder = () => (n++ === 0 ? toolUse("search_knowledge_base", { query: "horario atención" }) : "Abrimos de 9 a 18 h.");
    await send("573001", "¿Cuánto cuesta el envío a Medellin?");
    await drain();
    expect(allText(claude.calls[0])).toContain("$12.000"); // recuperación automática (sin tilde en la pregunta)
    const toolResult = (claude.calls[1] as any).messages.at(-1).content[0].content;
    expect(toolResult).toContain("lunes a viernes");
  });

  it("indica cuando no hay información relevante", async () => {
    await send("573001", "¿venden bicicletas?");
    await drain();
    expect(allText(claude.calls[0])).toContain("No se encontró información de la base de conocimientos");
  });
});

describe("automatizaciones", () => {
  it("envía bienvenida solo al primer mensaje de un contacto nuevo", async () => {
    await updateSection("automation", { welcome: { enabled: true, text: "¡Bienvenido!", thenAiReplies: true } });
    claude.responder = () => "respuesta IA";
    await send("573001", "hola");
    await drain();
    await send("573001", "otra");
    await drain();
    expect((await replies("573001")).map((m) => [m.author, m.text])).toEqual([
      ["AUTOMATION", "¡Bienvenido!"],
      ["AI", "respuesta IA"],
      ["AI", "respuesta IA"],
    ]);
  });

  it("fuera de horario envía el aviso una vez y opcionalmente no responde con IA", async () => {
    const closed = [0, 1, 2, 3, 4, 5, 6].map(() => ({ enabled: false, start: "09:00", end: "18:00" }));
    await updateSection("automation", {
      outOfHours: { enabled: true, text: "Estamos cerrados", schedule: closed, aiRespondsOutOfHours: false, cooldownHours: 12 },
    });
    await send("573001", "hola");
    await drain();
    await send("573001", "¿hola?");
    await drain();
    expect(claude.calls).toHaveLength(0);
    expect((await replies("573001")).map((m) => m.text)).toEqual(["Estamos cerrados"]);
  });

  it("aplica reglas por palabra clave con derivación y etiquetas", async () => {
    await prisma.automationRule.create({
      data: { name: "Asesor", keywords: ["asesor"], handoff: true, addTags: ["quiere-asesor"], replyText: "Un asesor te escribirá pronto." },
    });
    await send("573001", "quiero hablar con un ASESOR");
    await drain();
    const contact = await prisma.contact.findUniqueOrThrow({ where: { waId: "573001" } });
    expect(claude.calls).toHaveLength(0);
    expect(contact.tags).toEqual(["quiere-asesor"]);
    expect(contact.aiPaused && contact.needsHuman).toBe(true);
    expect((await replies("573001")).map((m) => m.text)).toEqual(["Un asesor te escribirá pronto."]);
  });

  it("respeta la baja (STOP) y la reactivación (ALTA)", async () => {
    await send("573001", "STOP");
    await drain();
    await send("573001", "hola?");
    await drain();
    expect(claude.calls).toHaveLength(0);
    expect((await prisma.contact.findUniqueOrThrow({ where: { waId: "573001" } })).optedOut).toBe(true);
    await send("573001", "alta");
    await drain();
    await send("573001", "hola de nuevo");
    await drain();
    expect(claude.calls).toHaveLength(1);
    const texts = (await replies("573001")).map((m) => m.author);
    expect(texts).toEqual(["AUTOMATION", "AUTOMATION", "AI"]);
  });
});

describe("presupuesto y errores", () => {
  it("detiene la IA al superar el límite diario y avisa una sola vez", async () => {
    await updateSection("budget", { dailyUsdLimit: 0.5 });
    const c = await prisma.contact.create({ data: { waId: "573777" } });
    await prisma.aiUsage.create({ data: { kind: "REPLY", model: "claude-opus-5-5", costUsd: 0.6, contactId: c.id } });
    await send("573001", "hola");
    await drain();
    await send("573001", "¿hola?");
    await drain();
    expect(claude.calls).toHaveLength(0);
    const out = await replies("573001");
    expect(out).toHaveLength(1);
    expect(out[0].author).toBe("AUTOMATION");
    expect((await prisma.contact.findUniqueOrThrow({ where: { waId: "573001" } })).needsHuman).toBe(true);
  });

  it("limita las respuestas por contacto por hora (anti-abuso)", async () => {
    await updateSection("budget", { perContactRepliesPerHour: 2, limitMessage: "" });
    for (const t of ["a", "b", "c", "d"]) {
      await send("573001", t);
      await drain();
    }
    expect(claude.calls).toHaveLength(2);
  });

  it("si Claude rechaza por filtros de seguridad, no envía nada y marca para revisión humana", async () => {
    claude.responder = () => ({ stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber", explanation: null }, content: [] }) as any;
    await send("573001", "algo");
    await drain();
    expect(await replies("573001")).toHaveLength(0);
    const contact = await prisma.contact.findUniqueOrThrow({ where: { waId: "573001" } });
    expect(contact.needsHuman).toBe(true);
  });

  it("errores no recuperables de Claude (API key inválida) se registran sin reintentar", async () => {
    claude.responder = () => {
      throw new Anthropic.AuthenticationError(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, "invalid x-api-key", new Headers());
    };
    await send("573001", "hola");
    await drain();
    const job = await prisma.job.findFirstOrThrow({ where: { type: "reply" } });
    expect(job.status).toBe("DONE");
    const err = await prisma.errorLog.findFirstOrThrow({ where: { source: "CLAUDE" } });
    expect(err.message).toContain("API Key de Claude no es válida");
    expect((await prisma.message.findFirstOrThrow({ where: { direction: "INBOUND" } })).replyState).toBe("SKIPPED");
  });

  it("errores temporales de Claude (500) se reintentan con espera", async () => {
    claude.responder = () => {
      throw new Anthropic.InternalServerError(529, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, "Overloaded", new Headers());
    };
    await send("573001", "hola");
    await drain();
    const job = await prisma.job.findFirstOrThrow({ where: { type: "reply" } });
    expect(job.status).toBe("PENDING");
    expect(job.attempts).toBe(1);
    expect(job.runAt.getTime()).toBeGreaterThan(Date.now());
    expect((await prisma.message.findFirstOrThrow({ where: { direction: "INBOUND" } })).replyState).toBe("PENDING");
  });
});

describe("modo real (Graph API simulada)", () => {
  it("marca como leído, muestra 'escribiendo…' y envía la respuesta", async () => {
    await liveMode();
    const calls = fakeMeta();
    claude.responder = () => "¡Hola!";
    await send("573001", "hola", { id: "wamid.IN1" });
    await drain();
    const read = calls.find((c) => c.body?.status === "read");
    expect(read?.body).toMatchObject({ message_id: "wamid.IN1", typing_indicator: { type: "text" } });
    const sent = calls.find((c) => c.body?.type === "text");
    expect(sent?.body).toMatchObject({ to: "573001", text: { body: "¡Hola!" } });
    const out = await replies("573001");
    expect(out[0]).toMatchObject({ status: "SENT", waMessageId: "wamid.out.1" });
  });

  it("un error 131047 (fuera de 24 h) marca el mensaje como fallido sin reintentar", async () => {
    await liveMode();
    fakeMeta((c) => (c.body?.type === "text" ? { status: 400, json: { error: { message: "Re-engagement message", code: 131047 } } } : undefined));
    await send("573001", "hola");
    await drain();
    const out = await replies("573001");
    expect(out[0].status).toBe("FAILED");
    expect(out[0].errorMessage).toContain("24 horas");
    const job = await prisma.job.findFirstOrThrow({ where: { type: "send_message" } });
    expect(job.status).toBe("FAILED");
  });

  it("un error 500 de Meta se reintenta", async () => {
    await liveMode();
    fakeMeta((c) => (c.body?.type === "text" ? { status: 500, json: { error: { message: "Temporary", code: 1 } } } : undefined));
    await send("573001", "hola");
    await drain();
    const job = await prisma.job.findFirstOrThrow({ where: { type: "send_message" } });
    expect(job.status).toBe("PENDING");
    expect((await replies("573001"))[0].status).toBe("QUEUED");
  });

  it("descarga imágenes y se las envía a Claude (visión)", async () => {
    await liveMode();
    fakeMeta((c) => {
      if (c.url.endsWith("/IMG1")) return { json: { id: "IMG1", url: "https://lookaside.fbsbx.com/img", mime_type: "image/jpeg", file_size: 4 } };
      if (c.url === "https://lookaside.fbsbx.com/img") return { body: Buffer.from([0xff, 0xd8, 0xff, 0xe0]) };
      return undefined;
    });
    await postWebhook(app, messageWebhook("573001", { type: "image", image: { id: "IMG1", mime_type: "image/jpeg", caption: "¿Tienen esta camisa?" } }));
    await drain();
    const blocks = (claude.calls[0] as any).messages.at(-1).content;
    expect(blocks[0]).toMatchObject({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "/9j/4A==" } });
    expect(blocks[1].text).toContain("¿Tienen esta camisa?");
  });

  it("transcribe notas de voz con el servicio configurado", async () => {
    await liveMode();
    await updateSection("media", { audio: { provider: "openai_compatible", baseUrl: "https://api.groq.com/openai/v1", model: "whisper-large-v3-turbo", language: "es" } });
    await setSecret("transcription_api_key", "gsk_test");
    fakeMeta((c) => {
      if (c.url.endsWith("/AUD1")) return { json: { id: "AUD1", url: "https://lookaside.fbsbx.com/aud", mime_type: "audio/ogg; codecs=opus" } };
      if (c.url === "https://lookaside.fbsbx.com/aud") return { body: Buffer.from("OggS") };
      return undefined;
    });
    const tCalls: string[] = [];
    setTranscriptionFetch((async (url: unknown, init: RequestInit) => {
      tCalls.push(String(url));
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer gsk_test");
      expect(init.body).toBeInstanceOf(FormData);
      return new Response(JSON.stringify({ text: "Quiero dos camisetas talla M" }), { status: 200 });
    }) as typeof fetch);
    await postWebhook(app, messageWebhook("573001", { type: "audio", audio: { id: "AUD1", mime_type: "audio/ogg; codecs=opus", voice: true } }));
    await drain();
    expect(tCalls).toEqual(["https://api.groq.com/openai/v1/audio/transcriptions"]);
    expect(lastUserText(claude.calls[0])).toContain("Quiero dos camisetas talla M");
    const m = await prisma.message.findFirstOrThrow({ where: { type: "AUDIO" } });
    expect(m.transcription).toBe("Quiero dos camisetas talla M");
  });

  it("sin transcripción configurada pide al cliente que escriba (no inventa el contenido)", async () => {
    await liveMode();
    fakeMeta();
    await postWebhook(app, messageWebhook("573001", { type: "audio", audio: { id: "AUD2", mime_type: "audio/ogg", voice: true } }));
    await drain();
    expect(allText(claude.calls[0])).toContain("nota de voz que no puedes escuchar");
  });
});

describe("memoria a largo plazo", () => {
  it("solo modifica recuerdos del propio contacto y respeta los manuales", async () => {
    const a = await prisma.contact.create({ data: { waId: "A" } });
    const b = await prisma.contact.create({ data: { waId: "B" } });
    const manual = await prisma.contactMemory.create({ data: { contactId: a.id, content: "Cliente VIP", source: "MANUAL" } });
    const auto = await prisma.contactMemory.create({ data: { contactId: a.id, content: "Vive en Cali" } });
    const other = await prisma.contactMemory.create({ data: { contactId: b.id, content: "Dato de B" } });
    await applyMemoryUpdate(
      a.id,
      {
        summary: "Resumen",
        add: [{ category: "PERSONAL", content: "Se mudó a Bogotá" }, { category: "OTHER", content: "Cliente VIP" }],
        update: [{ id: other.id, content: "hackeado" }, { id: manual.id, content: "cambiado" }],
        remove: [auto.id, other.id, manual.id],
        classification: "cliente",
        intent: "comprar",
      },
      40,
    );
    const memA = (await prisma.contactMemory.findMany({ where: { contactId: a.id } })).map((m) => m.content).sort();
    expect(memA).toEqual(["Cliente VIP", "Se mudó a Bogotá"]);
    expect((await prisma.contactMemory.findUniqueOrThrow({ where: { id: other.id } })).content).toBe("Dato de B");
    const ca = await prisma.contact.findUniqueOrThrow({ where: { id: a.id } });
    expect(ca).toMatchObject({ summary: "Resumen", classification: "cliente", lastIntent: "comprar" });
  });

  it("programa la actualización de memoria cada N mensajes", async () => {
    await updateSection("ai", { memoryUpdateEvery: 4 });
    claude.parser = () => ({ summary: "Habló de zapatos", add: [{ category: "BUSINESS", content: "Vende zapatos" }], update: [], remove: [], classification: "prospecto", intent: "info" });
    await send("573001", "hola");
    await drain();
    expect(await prisma.contactMemory.count()).toBe(0);
    await send("573001", "vendo zapatos");
    await drain();
    // 2 entrantes + 2 respuestas = 4 → se ejecuta la actualización
    await prisma.job.updateMany({ where: { type: "memory_update" }, data: { runAt: new Date() } });
    await drain();
    const c = await prisma.contact.findUniqueOrThrow({ where: { waId: "573001" }, include: { memories: true } });
    expect(c.memories.map((m) => m.content)).toEqual(["Vende zapatos"]);
    expect(c.summary).toBe("Habló de zapatos");
    expect(c.messagesSinceMemoryUpdate).toBe(0);
    expect(await prisma.aiUsage.count({ where: { kind: "MEMORY" } })).toBe(1);
  });
});
