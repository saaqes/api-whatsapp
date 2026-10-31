import { prisma } from "../src/database/prisma.js";
import { clearSecretCache, clearSettingsCache, setSecret, updateSection } from "../src/services/settings.service.js";
import { signMetaPayload } from "../src/utils/crypto.js";
import { MockGateway, setClaude } from "../src/ai/claude.js";
import { setWhatsAppFetch } from "../src/whatsapp/index.js";
import { registerJobs } from "../src/queue/jobs.js";
import { getQueue } from "../src/queue/index.js";
import { createUser } from "../src/services/auth.service.js";
import type { FastifyInstance } from "fastify";

registerJobs();

export async function resetDb() {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  clearSettingsCache();
  clearSecretCache();
  setWhatsAppFetch(fetch);
  // Respuesta inmediata en pruebas (sin espera de agrupación).
  await updateSection("ai", { replyDelaySeconds: 0 });
}

export function useMockClaude() {
  const mock = new MockGateway();
  setClaude(mock);
  return mock;
}

/** Procesa todos los trabajos listos de la cola y espera a que terminen. */
export async function drain() {
  await getQueue().drain();
}

let counter = 0;
export function textWebhook(
  from: string,
  text: string,
  opts: { id?: string; name?: string; phoneNumberId?: string; ts?: number } = {},
) {
  counter++;
  return messageWebhook(from, { type: "text", text: { body: text } }, opts);
}

export function messageWebhook(
  from: string,
  message: Record<string, unknown>,
  opts: { id?: string; name?: string; phoneNumberId?: string; ts?: number } = {},
) {
  counter++;
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15550000000", phone_number_id: opts.phoneNumberId ?? "PNID" },
              contacts: [{ profile: { name: opts.name ?? "Cliente" }, wa_id: from }],
              messages: [
                {
                  from,
                  id: opts.id ?? `wamid.test.${Date.now()}.${counter}`,
                  timestamp: String(opts.ts ?? Math.floor(Date.now() / 1000)),
                  ...message,
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

export function statusWebhook(waMessageId: string, status: string, extra: Record<string, unknown> = {}) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: "PNID" },
              statuses: [{ id: waMessageId, status, timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: "57300", ...extra }],
            },
          },
        ],
      },
    ],
  };
}

export async function postWebhook(app: FastifyInstance, body: unknown, secret = "test_app_secret") {
  const raw = JSON.stringify(body);
  return app.inject({
    method: "POST",
    url: "/webhooks/whatsapp",
    headers: { "content-type": "application/json", "x-hub-signature-256": signMetaPayload(raw, secret) },
    payload: raw,
  });
}

export interface FakeCall {
  url: string;
  method: string;
  body: any;
  headers: Record<string, string>;
}

type FakeResponse = { status?: number; json?: unknown; body?: Buffer; contentType?: string } | undefined;

/** Simula la Graph API de Meta. `handler` decide la respuesta según la llamada. */
export function fakeMeta(handler?: (call: FakeCall) => FakeResponse) {
  const calls: FakeCall[] = [];
  let n = 0;
  const f = async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const call: FakeCall = {
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
      headers: (init?.headers ?? {}) as Record<string, string>,
    };
    calls.push(call);
    const custom = handler?.(call);
    if (custom?.body) {
      return new Response(new Uint8Array(custom.body), {
        status: custom.status ?? 200,
        headers: { "content-type": custom.contentType ?? "application/octet-stream" },
      });
    }
    if (custom) return new Response(JSON.stringify(custom.json ?? {}), { status: custom.status ?? 200 });
    if (url.endsWith("/messages") && call.body?.type) {
      n++;
      return new Response(JSON.stringify({ messages: [{ id: `wamid.out.${n}` }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  };
  setWhatsAppFetch(f as typeof fetch);
  return calls;
}

/** Modo real de WhatsApp (con la Graph API sustituida por `fakeMeta`). */
export async function liveMode() {
  await updateSection("whatsapp", { mode: "live", phoneNumberId: "PNID", wabaId: "WABA" });
  await setSecret("whatsapp_access_token", "EAAtesttoken");
}

/** IP distinta por prueba: el límite de intentos de inicio de sesión es por IP. */
export function randomIp() {
  return `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`;
}

export async function loginAs(app: FastifyInstance, role: "OWNER" | "ADMIN" | "AGENT" = "OWNER") {
  const email = `${role.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}@test.com`;
  await createUser({ email, name: role, password: "ClaveSegura2026", role });
  const res = await app.inject({ method: "POST", url: "/api/auth/login", remoteAddress: randomIp(), payload: { email, password: "ClaveSegura2026" } });
  const cookie = res.cookies.find((c) => c.name === "wa_ai_session");
  if (!cookie) throw new Error(`Login falló: ${res.body}`);
  return { cookie: `${cookie.name}=${cookie.value}`, email };
}

/** Texto de todo lo que se envió a Claude (sistema + mensajes). */
export function allText(params: any): string {
  return JSON.stringify({ system: params.system, messages: params.messages });
}

export function lastUserText(params: any): string {
  const m = params.messages[params.messages.length - 1];
  if (typeof m.content === "string") return m.content;
  return m.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n");
}
