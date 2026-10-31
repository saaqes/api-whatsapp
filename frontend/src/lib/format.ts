const rtf = new Intl.RelativeTimeFormat("es", { numeric: "auto" });

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return "ahora";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), "day");
  return new Date(iso).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" });
}

export function shortTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
  const y = new Date(Date.now() - 86400000);
  if (d.toDateString() === y.toDateString()) return "ayer";
  return d.toLocaleDateString("es", { day: "2-digit", month: "2-digit" });
}

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
}

export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Hoy";
  if (d.toDateString() === new Date(Date.now() - 86400000).toDateString()) return "Ayer";
  return d.toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" });
}

export function formatPhone(waId: string): string {
  if (waId.startsWith("sim-")) return "Contacto simulado";
  return `+${waId}`;
}

export function contactName(c: { displayName?: string | null; profileName?: string | null; waId: string }): string {
  return c.displayName || c.profileName || formatPhone(c.waId);
}

export function initials(name: string): string {
  const parts = name.replace(/^\+/, "").trim().split(/\s+/);
  if (/^\d/.test(parts[0] ?? "")) return "#";
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export const num = (n: number | null | undefined) => new Intl.NumberFormat("es").format(n ?? 0);
export const compact = (n: number) => new Intl.NumberFormat("es", { notation: "compact", maximumFractionDigits: 1 }).format(n);
export function usd(n: number | null | undefined, digits = 2): string {
  const v = n ?? 0;
  if (v > 0 && v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(digits)}`;
}
export function duration(ms: number): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60000)} min`;
  return `${(ms / 3_600_000).toFixed(1)} h`;
}
export function uptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
}

/** Horas restantes de la ventana de 24 h. */
export function windowRemaining(lastInboundAt: string | null): string | null {
  if (!lastInboundAt) return null;
  const left = new Date(lastInboundAt).getTime() + 24 * 3600_000 - Date.now();
  if (left <= 0) return null;
  const h = Math.floor(left / 3600_000);
  return h >= 1 ? `${h} h` : `${Math.max(1, Math.round(left / 60000))} min`;
}

export const CLASSIFICATION_LABELS: Record<string, string> = {
  prospecto: "Prospecto",
  cliente: "Cliente",
  soporte: "Soporte",
  otro: "Otro",
};

export const MEMORY_CATEGORY_LABELS: Record<string, string> = {
  PERSONAL: "Personal",
  PREFERENCE: "Preferencia",
  BUSINESS: "Negocio",
  OTHER: "Otro",
};
