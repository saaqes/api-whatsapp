import { getWhatsAppConfig } from "../services/settings.service.js";
import { WhatsAppClient } from "./client.js";

export { WhatsAppClient, WhatsAppApiError } from "./client.js";

type FetchLike = typeof fetch;
let fetchImpl: FetchLike = fetch;

/** Para pruebas: sustituye las llamadas HTTP a Meta. */
export function setWhatsAppFetch(f: FetchLike) {
  fetchImpl = f;
}

/** Cliente con la configuración vigente (panel o variables de entorno). */
export async function getWhatsAppClient(): Promise<WhatsAppClient> {
  return new WhatsAppClient(await getWhatsAppConfig(), fetchImpl);
}
