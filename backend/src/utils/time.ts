export interface DaySchedule {
  enabled: boolean;
  start: string; // "09:00"
  end: string; // "18:00"
}

/** Horario semanal; índice 0 = domingo … 6 = sábado. */
export type WeeklySchedule = DaySchedule[];

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Día de la semana (0-6) y minutos desde medianoche en la zona horaria indicada. */
export function localParts(date: Date, timeZone: string): { weekday: number; minutes: number; dateKey: string } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    weekday: weekdays.indexOf(parts.weekday),
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

/** ¿Está `date` dentro del horario de atención? Admite horarios que cruzan medianoche. */
export function isWithinSchedule(date: Date, schedule: WeeklySchedule, timeZone: string): boolean {
  const { weekday, minutes } = localParts(date, timeZone);
  const today = schedule[weekday];
  if (today?.enabled) {
    const start = toMinutes(today.start);
    const end = toMinutes(today.end);
    if (start <= end ? minutes >= start && minutes < end : minutes >= start) return true;
  }
  // Tramo posterior a medianoche de un horario nocturno del día anterior.
  const yesterday = schedule[(weekday + 6) % 7];
  if (yesterday?.enabled) {
    const start = toMinutes(yesterday.start);
    const end = toMinutes(yesterday.end);
    if (start > end && minutes < end) return true;
  }
  return false;
}

/** Fecha y hora legible para el contexto de la IA, p. ej. "viernes, 31 de octubre de 2026, 15:04". */
export function humanDateTime(date: Date, timeZone: string, locale = "es"): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
