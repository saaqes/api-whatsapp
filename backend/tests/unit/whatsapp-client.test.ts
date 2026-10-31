import { describe, expect, it } from "vitest";
import { WhatsAppApiError, WhatsAppClient } from "../../src/whatsapp/client.js";
import type { WhatsAppConfig } from "../../src/services/settings.service.js";

const cfg = (over: Partial<WhatsAppConfig> = {}): WhatsAppConfig => ({
  appId: "APP",
  wabaId: "WABA",
  phoneNumberId: "PNID",
  graphVersion: "v26.0",
  baseUrl: "https://graph.facebook.com",
  mode: "live",
  accessToken: "EAAtoken",
  appSecret: "secret",
  verifyToken: "verify",
  ...over,
});

function recorder(responses: Array<{ status: number; json?: unknown; bytes?: Buffer }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const f = async (url: unknown, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const r = responses.shift() ?? { status: 200, json: {} };
    if (r.bytes) return new Response(new Uint8Array(r.bytes), { status: r.status });
    return new Response(JSON.stringify(r.json ?? {}), { status: r.status });
  };
  return { calls, fetch: f as typeof fetch };
}

describe("WhatsAppClient", () => {
  it("envía texto con el formato de la Cloud API", async () => {
    const r = recorder([{ status: 200, json: { messages: [{ id: "wamid.OUT" }] } }]);
    const res = await new WhatsAppClient(cfg(), r.fetch).sendText("573001112233", "Hola https://x.com", "wamid.IN");
    expect(res).toEqual({ messageId: "wamid.OUT", simulated: false });
    expect(r.calls[0].url).toBe("https://graph.facebook.com/v26.0/PNID/messages");
    expect(r.calls[0].init.method).toBe("POST");
    expect((r.calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer EAAtoken");
    expect(JSON.parse(String(r.calls[0].init.body))).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "573001112233",
      type: "text",
      text: { body: "Hola https://x.com", preview_url: true },
      context: { message_id: "wamid.IN" },
    });
  });

  it("marca como leído y muestra 'escribiendo…'", async () => {
    const r = recorder([{ status: 200, json: { success: true } }]);
    await new WhatsAppClient(cfg(), r.fetch).markRead("wamid.IN", true);
    expect(JSON.parse(String(r.calls[0].init.body))).toEqual({
      messaging_product: "whatsapp",
      status: "read",
      message_id: "wamid.IN",
      typing_indicator: { type: "text" },
    });
  });

  it("envía plantillas con parámetros", async () => {
    const r = recorder([{ status: 200, json: { messages: [{ id: "wamid.T" }] } }]);
    await new WhatsAppClient(cfg(), r.fetch).sendTemplate("57300", "seguimiento", "es", [
      { type: "body", parameters: [{ type: "text", text: "Andrés" }] },
    ]);
    const body = JSON.parse(String(r.calls[0].init.body));
    expect(body.type).toBe("template");
    expect(body.template).toEqual({
      name: "seguimiento",
      language: { code: "es" },
      components: [{ type: "body", parameters: [{ type: "text", text: "Andrés" }] }],
    });
  });

  it("en modo simulación nunca llama a Meta", async () => {
    const r = recorder([]);
    const client = new WhatsAppClient(cfg({ mode: "simulation" }), r.fetch);
    const res = await client.sendText("57300", "hola");
    await client.markRead("wamid.x", true);
    expect(res.simulated).toBe(true);
    expect(res.messageId.startsWith("sim.")).toBe(true);
    expect(r.calls).toHaveLength(0);
  });

  it("descarga archivos en dos pasos (metadatos + URL firmada)", async () => {
    const r = recorder([
      { status: 200, json: { id: "M1", url: "https://lookaside.fbsbx.com/x", mime_type: "image/jpeg", file_size: 3 } },
      { status: 200, bytes: Buffer.from([1, 2, 3]) },
    ]);
    const { data, mime } = await new WhatsAppClient(cfg(), r.fetch).downloadMedia("M1");
    expect(mime).toBe("image/jpeg");
    expect([...data]).toEqual([1, 2, 3]);
    expect(r.calls[0].url).toBe("https://graph.facebook.com/v26.0/M1");
    expect(r.calls[1].url).toBe("https://lookaside.fbsbx.com/x");
    expect((r.calls[1].init.headers as Record<string, string>).Authorization).toBe("Bearer EAAtoken");
  });

  it("rechaza archivos demasiado grandes antes de descargarlos", async () => {
    const r = recorder([{ status: 200, json: { id: "M1", url: "https://x", mime_type: "video/mp4", file_size: 99 * 1024 * 1024 } }]);
    await expect(new WhatsAppClient(cfg(), r.fetch).downloadMedia("M1", 1024)).rejects.toThrow(/demasiado grande/);
    expect(r.calls).toHaveLength(1);
  });

  it("traduce los errores de Meta y decide si se reintentan", async () => {
    const r = recorder([
      { status: 400, json: { error: { message: "Re-engagement", code: 131047, fbtrace_id: "T" } } },
      { status: 401, json: { error: { message: "Invalid OAuth", code: 190 } } },
      { status: 429, json: { error: { message: "Too many", code: 130429 } } },
      { status: 503, json: {} },
    ]);
    const c = new WhatsAppClient(cfg(), r.fetch);
    const e1 = await c.sendText("1", "a").catch((e) => e);
    expect(e1).toBeInstanceOf(WhatsAppApiError);
    expect(e1.retryable).toBe(false);
    expect(e1.friendly).toContain("24 horas");
    const e2 = await c.sendText("1", "a").catch((e) => e);
    expect(e2.retryable).toBe(false);
    expect(e2.friendly).toContain("Access Token");
    expect((await c.sendText("1", "a").catch((e) => e)).retryable).toBe(true);
    expect((await c.sendText("1", "a").catch((e) => e)).retryable).toBe(true);
  });

  it("los errores de red se reintentan", async () => {
    const failing = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const e = await new WhatsAppClient(cfg(), failing).sendText("1", "a").catch((x) => x);
    expect(e).toBeInstanceOf(WhatsAppApiError);
    expect(e.status).toBe(0);
    expect(e.retryable).toBe(true);
  });
});
