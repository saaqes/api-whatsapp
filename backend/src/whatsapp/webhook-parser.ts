import type { MessageType, MessageStatus } from "../database/prisma.js";

/**
 * Normaliza el webhook de la Cloud API a estructuras simples.
 * Es tolerante: campos desconocidos se ignoran y tipos nuevos se marcan como UNSUPPORTED
 * para no perder nunca un mensaje.
 */

export interface InboundMessage {
  phoneNumberId: string;
  waMessageId: string;
  from: string;
  profileName: string | null;
  timestamp: Date;
  type: MessageType;
  text: string | null;
  mediaId: string | null;
  mediaMime: string | null;
  mediaFilename: string | null;
  mediaSha256: string | null;
  replyToWaId: string | null;
  isVoice: boolean;
  reactionToWaId: string | null;
  rawType: string;
}

export interface StatusUpdate {
  phoneNumberId: string;
  waMessageId: string;
  status: MessageStatus;
  timestamp: Date;
  recipientId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  pricingCategory: string | null;
  billable: boolean | null;
}

export interface ParsedWebhook {
  messages: InboundMessage[];
  statuses: StatusUpdate[];
  errors: Array<{ code?: number; title?: string; message?: string }>;
}

const STATUS_MAP: Record<string, MessageStatus> = {
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
  failed: "FAILED",
};

function tsToDate(ts: unknown): Date {
  const n = Number(ts);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : new Date();
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function describeMessage(m: any): { type: MessageType; text: string | null; media: any } {
  switch (m.type) {
    case "text":
      return { type: "TEXT", text: str(m.text?.body), media: null };
    case "image":
      return { type: "IMAGE", text: str(m.image?.caption), media: m.image };
    case "audio":
      return { type: "AUDIO", text: null, media: m.audio };
    case "video":
      return { type: "VIDEO", text: str(m.video?.caption), media: m.video };
    case "document":
      return { type: "DOCUMENT", text: str(m.document?.caption), media: m.document };
    case "sticker":
      return { type: "STICKER", text: null, media: m.sticker };
    case "location": {
      const l = m.location ?? {};
      const label = [l.name, l.address].filter(Boolean).join(", ");
      return {
        type: "LOCATION",
        text: `📍 Ubicación compartida${label ? `: ${label}` : ""} (${l.latitude}, ${l.longitude})`,
        media: null,
      };
    }
    case "contacts": {
      const list = (m.contacts ?? [])
        .map((c: any) => {
          const name = c.name?.formatted_name ?? "";
          const phones = (c.phones ?? []).map((p: any) => p.phone).join(", ");
          return [name, phones].filter(Boolean).join(" ");
        })
        .join("; ");
      return { type: "CONTACTS", text: `Contacto compartido: ${list}`, media: null };
    }
    case "interactive": {
      const i = m.interactive ?? {};
      const reply = i.button_reply ?? i.list_reply ?? i.nfm_reply;
      const text = reply ? [reply.title, reply.description].filter(Boolean).join(" — ") : null;
      return { type: "INTERACTIVE", text: str(text) ?? "[Respuesta interactiva]", media: null };
    }
    case "button":
      return { type: "BUTTON", text: str(m.button?.text) ?? str(m.button?.payload), media: null };
    case "reaction":
      return { type: "REACTION", text: str(m.reaction?.emoji), media: null };
    case "order": {
      const items = m.order?.product_items?.length ?? 0;
      return { type: "UNSUPPORTED", text: `🛒 Pedido del catálogo con ${items} producto(s)`, media: null };
    }
    default:
      return { type: "UNSUPPORTED", text: null, media: null };
  }
}

export function parseWebhook(body: unknown): ParsedWebhook {
  const result: ParsedWebhook = { messages: [], statuses: [], errors: [] };
  const b = body as any;
  if (!b || b.object !== "whatsapp_business_account" || !Array.isArray(b.entry)) return result;

  for (const entry of b.entry) {
    for (const change of entry?.changes ?? []) {
      if (change?.field !== "messages") continue;
      const value = change.value ?? {};
      const phoneNumberId = String(value.metadata?.phone_number_id ?? "");
      const names = new Map<string, string>();
      for (const c of value.contacts ?? []) {
        const id = c.wa_id ?? c.user_id;
        if (id && c.profile?.name) names.set(String(id), String(c.profile.name));
      }

      for (const m of value.messages ?? []) {
        if (!m?.id) continue;
        // Mensajes de sistema (p. ej. cambio de número) no se responden.
        if (m.type === "system" || m.type === "ephemeral") continue;
        const from = str(m.from) ?? str(m.from_user_id) ?? str(m.user_id);
        if (!from) continue;
        const d = describeMessage(m);
        result.messages.push({
          phoneNumberId,
          waMessageId: String(m.id),
          from,
          profileName: names.get(from) ?? null,
          timestamp: tsToDate(m.timestamp),
          type: d.type,
          text: d.text,
          mediaId: str(d.media?.id),
          mediaMime: str(d.media?.mime_type),
          mediaFilename: str(d.media?.filename),
          mediaSha256: str(d.media?.sha256),
          replyToWaId: str(m.context?.id),
          isVoice: Boolean(m.audio?.voice),
          reactionToWaId: str(m.reaction?.message_id),
          rawType: String(m.type ?? "unknown"),
        });
      }

      for (const s of value.statuses ?? []) {
        const status = STATUS_MAP[s?.status];
        if (!s?.id || !status) continue;
        const err = s.errors?.[0];
        result.statuses.push({
          phoneNumberId,
          waMessageId: String(s.id),
          status,
          timestamp: tsToDate(s.timestamp),
          recipientId: str(s.recipient_id),
          errorCode: err?.code != null ? String(err.code) : null,
          errorMessage: err ? [err.title, err.message, err.error_data?.details].filter(Boolean).join(" — ") : null,
          pricingCategory: str(s.pricing?.category),
          billable: typeof s.pricing?.billable === "boolean" ? s.pricing.billable : null,
        });
      }

      for (const e of value.errors ?? []) result.errors.push(e);
    }
  }
  return result;
}

/** Orden de los estados para no "retroceder" (p. ej. un "delivered" que llega después de "read"). */
export const STATUS_RANK: Record<MessageStatus, number> = {
  RECEIVED: 0,
  QUEUED: 1,
  SIMULATED: 2,
  SENT: 2,
  DELIVERED: 3,
  READ: 4,
  FAILED: 5,
};
