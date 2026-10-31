import type { FastifyInstance } from "fastify";
import { getSection } from "../services/settings.service.js";

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function page(title: string, body: string) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>body{font-family:system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 16px;line-height:1.6;color:#1f2937;background:#fff}h1{font-size:1.6rem}h2{font-size:1.1rem;margin-top:1.6rem}@media (prefers-color-scheme:dark){body{background:#0b0f14;color:#e5e7eb}}</style></head><body>${body}</body></html>`;
}

/**
 * Páginas públicas que Meta exige para publicar la app (modo "Live"):
 * política de privacidad e instrucciones de eliminación de datos.
 * Revisa y adapta el texto a tu negocio y a la legislación de tu país.
 */
export async function publicRoutes(app: FastifyInstance) {
  app.get("/privacy", async (_req, reply) => {
    const ai = await getSection("ai");
    const name = esc(ai.businessName || "Este negocio");
    reply.type("text/html; charset=utf-8");
    return page(
      `Política de privacidad — ${ai.businessName || "Asistente de WhatsApp"}`,
      `<h1>Política de privacidad</h1>
<p>${name} usa la plataforma oficial WhatsApp Business de Meta para atender a sus clientes, con la ayuda de un asistente de inteligencia artificial.</p>
<h2>Qué datos tratamos</h2><p>Tu número de teléfono, el nombre de tu perfil de WhatsApp, los mensajes y archivos que nos envías, y datos que compartas voluntariamente en la conversación (por ejemplo, tu nombre o tus preferencias).</p>
<h2>Para qué</h2><p>Para responder tus consultas, recordar el contexto de conversaciones anteriores y mejorar la atención. No vendemos tus datos.</p>
<h2>Proveedores</h2><p>Los mensajes se procesan mediante Meta (WhatsApp Business Platform) y Anthropic (modelo de IA Claude) para generar las respuestas, y se almacenan en nuestro proveedor de base de datos.</p>
<h2>Conservación</h2><p>Conservamos la conversación mientras sea necesaria para atenderte o hasta que solicites su eliminación.</p>
<h2>Tus derechos</h2><p>Puedes pedir acceso, corrección o eliminación de tus datos escribiéndonos por WhatsApp. Si escribes <b>STOP</b> dejaremos de enviarte mensajes automáticos.</p>
<p><a href="/data-deletion">Instrucciones para eliminar tus datos</a></p>`,
    );
  });

  app.get("/data-deletion", async (_req, reply) => {
    const ai = await getSection("ai");
    reply.type("text/html; charset=utf-8");
    return page(
      "Eliminación de datos",
      `<h1>Eliminación de datos</h1><p>Para eliminar todos los datos asociados a tu número (mensajes, memoria del asistente y notas), escríbenos por WhatsApp pidiendo la eliminación de tus datos. ${esc(
        ai.businessName || "El equipo",
      )} los eliminará y te confirmará cuando esté hecho.</p>`,
    );
  });
}
