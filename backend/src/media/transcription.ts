import { getSecret, getSection } from "../services/settings.service.js";

/**
 * Transcripción de notas de voz. Claude no procesa audio directamente, así que se usa un
 * servicio EXTERNO compatible con la API de OpenAI (/audio/transcriptions):
 *  - OpenAI:  baseUrl https://api.openai.com/v1, modelo "whisper-1" o "gpt-4o-mini-transcribe"
 *  - Groq:    baseUrl https://api.groq.com/openai/v1, modelo "whisper-large-v3-turbo"
 * Tiene costo adicional según el proveedor. Desactivado por defecto.
 */
export class TranscriptionUnavailableError extends Error {}

export interface Transcriber {
  transcribe(audio: Buffer, mime: string): Promise<string>;
}

type FetchLike = typeof fetch;
let fetchImpl: FetchLike = fetch;
export function setTranscriptionFetch(f: FetchLike) {
  fetchImpl = f;
}

function extensionFor(mime: string): string {
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac")) return "m4a";
  if (mime.includes("amr")) return "amr";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("webm")) return "webm";
  return "ogg";
}

export async function isTranscriptionEnabled(): Promise<boolean> {
  const media = await getSection("media");
  return media.audio.provider !== "none" && Boolean(await getSecret("transcription_api_key"));
}

export async function transcribeAudio(audio: Buffer, mime: string): Promise<string> {
  const media = await getSection("media");
  if (media.audio.provider === "none") throw new TranscriptionUnavailableError("Transcripción desactivada");
  const apiKey = await getSecret("transcription_api_key");
  if (!apiKey) throw new TranscriptionUnavailableError("Falta la API Key del servicio de transcripción");

  const form = new FormData();
  const cleanMime = mime.split(";")[0].trim() || "audio/ogg";
  form.append("file", new Blob([new Uint8Array(audio)], { type: cleanMime }), `audio.${extensionFor(cleanMime)}`);
  form.append("model", media.audio.model);
  if (media.audio.language) form.append("language", media.audio.language);
  form.append("response_format", "json");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const res = await fetchImpl(`${media.audio.baseUrl.replace(/\/$/, "")}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`Servicio de transcripción respondió ${res.status}: ${body.slice(0, 300)}`);
    const json = JSON.parse(body) as { text?: string };
    return (json.text ?? "").trim();
  } finally {
    clearTimeout(timer);
  }
}
