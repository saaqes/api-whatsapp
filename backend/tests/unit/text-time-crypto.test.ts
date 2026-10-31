import { describe, expect, it } from "vitest";
import { chunkText, markdownToWhatsApp, normalizeForSearch, queryTerms, splitForWhatsApp } from "../../src/utils/text.js";
import { isWithinSchedule, localParts } from "../../src/utils/time.js";
import {
  decrypt,
  deriveKey,
  encrypt,
  hashPassword,
  maskSecret,
  passwordPolicyError,
  signMetaPayload,
  verifyMetaSignature,
  verifyPassword,
} from "../../src/utils/crypto.js";
import { startOfLocalDay } from "../../src/services/budget.service.js";

describe("texto", () => {
  it("normaliza tildes y mayúsculas para la búsqueda", () => {
    expect(normalizeForSearch("Envío a MEDELLÍN")).toBe("envio a medellin");
    expect(queryTerms("¿Cuánto cuesta el envío? envío")).toEqual(["cuanto", "cuesta", "el", "envio"]);
  });

  it("convierte Markdown al formato de WhatsApp", () => {
    const out = markdownToWhatsApp("## Precios\n**Camiseta**: $20\n- Talla M\n[Web](https://x.com)");
    expect(out).toBe("*Precios*\n*Camiseta*: $20\n• Talla M\nWeb (https://x.com)");
  });

  it("divide respuestas largas respetando el límite de WhatsApp", () => {
    const long = "Frase de prueba. ".repeat(400).trim();
    const parts = splitForWhatsApp(long);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(4096);
    expect(parts.join(" ").replace(/\s+/g, " ")).toBe(long);
  });

  it("puede separar por párrafos en varias burbujas", () => {
    expect(splitForWhatsApp("Hola\n\nSegundo\n\nTercero", true)).toEqual(["Hola", "Segundo", "Tercero"]);
    expect(splitForWhatsApp("a\n\nb\n\nc\n\nd", true, 2)).toEqual(["a\n\nb", "c\n\nd"]);
  });

  it("fragmenta documentos con solapamiento", () => {
    const text = Array.from({ length: 50 }, (_, i) => `Párrafo número ${i} con información útil.`).join("\n\n");
    const chunks = chunkText(text, 300, 50);
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(400);
    expect(chunkText("corto")).toEqual(["corto"]);
    expect(chunkText("   ")).toEqual([]);
  });
});

describe("horarios", () => {
  const week = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ enabled: d >= 1 && d <= 5, start: "09:00", end: "18:00" }));

  it("respeta la zona horaria del negocio", () => {
    // Miércoles 2026-10-28 14:00 UTC = 09:00 en Bogotá (UTC-5)
    expect(isWithinSchedule(new Date("2026-10-28T14:00:00Z"), week, "America/Bogota")).toBe(true);
    expect(isWithinSchedule(new Date("2026-10-28T13:59:00Z"), week, "America/Bogota")).toBe(false);
    // Sábado
    expect(isWithinSchedule(new Date("2026-10-31T16:00:00Z"), week, "America/Bogota")).toBe(false);
  });

  it("admite horarios nocturnos que cruzan la medianoche", () => {
    const night = [0, 1, 2, 3, 4, 5, 6].map(() => ({ enabled: true, start: "22:00", end: "02:00" }));
    expect(isWithinSchedule(new Date("2026-10-28T23:30:00Z"), night, "UTC")).toBe(true);
    expect(isWithinSchedule(new Date("2026-10-29T01:30:00Z"), night, "UTC")).toBe(true);
    expect(isWithinSchedule(new Date("2026-10-29T03:00:00Z"), night, "UTC")).toBe(false);
  });

  it("calcula la medianoche local", () => {
    const d = new Date("2026-10-28T03:30:00Z"); // 22:30 del 27 en Bogotá
    expect(startOfLocalDay(d, "America/Bogota").toISOString()).toBe("2026-10-27T05:00:00.000Z");
    expect(localParts(d, "America/Bogota").dateKey).toBe("2026-10-27");
  });
});

describe("criptografía", () => {
  it("guarda contraseñas con hash y las verifica", async () => {
    const h = await hashPassword("ClaveSegura2026");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(h).not.toContain("ClaveSegura2026");
    expect(await verifyPassword("ClaveSegura2026", h)).toBe(true);
    expect(await verifyPassword("otra", h)).toBe(false);
    expect(passwordPolicyError("corta1")).not.toBeNull();
    expect(passwordPolicyError("solamenteletras")).not.toBeNull();
    expect(passwordPolicyError("ClaveSegura2026")).toBeNull();
  });

  it("cifra credenciales con AES-256-GCM y detecta manipulación", () => {
    const key = deriveKey("a".repeat(64));
    const enc = encrypt("sk-ant-secreto", key);
    expect(enc.ciphertext).not.toContain("secreto");
    expect(decrypt(enc, key)).toBe("sk-ant-secreto");
    expect(() => decrypt({ ...enc, authTag: Buffer.alloc(16).toString("base64") }, key)).toThrow();
    expect(() => decrypt(enc, deriveKey("b".repeat(64)))).toThrow();
    expect(maskSecret("sk-ant-api03-abcdefgh1234")).toMatch(/…1234$/);
  });

  it("valida la firma X-Hub-Signature-256 de Meta", () => {
    const body = Buffer.from('{"a":1}');
    const sig = signMetaPayload(body, "secreto");
    expect(verifyMetaSignature(body, sig, "secreto")).toBe(true);
    expect(verifyMetaSignature(body, sig, "otro")).toBe(false);
    expect(verifyMetaSignature(Buffer.from('{"a":2}'), sig, "secreto")).toBe(false);
    expect(verifyMetaSignature(body, undefined, "secreto")).toBe(false);
    expect(verifyMetaSignature(body, "sha1=abc", "secreto")).toBe(false);
  });
});
