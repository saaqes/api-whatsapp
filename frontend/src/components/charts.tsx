import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useIsDark } from "../hooks/useTheme";
import { compact } from "../lib/format";

/**
 * Paleta categórica validada (daltonismo y contraste) para cada tema.
 * Orden fijo: el color sigue a la serie, nunca a su posición.
 */
const SERIES = {
  light: ["#2a78d6", "#eb6834", "#1baf7a"],
  dark: ["#3987e5", "#d95926", "#199e70"],
};
const CHROME = {
  light: { surface: "#fcfcfb", grid: "#e9e8e4", tick: "#7d7b75" },
  dark: { surface: "#1a1a19", grid: "#2c2c2a", tick: "#8f8e86" },
};

export interface SeriesDef {
  key: string;
  label: string;
  slot: 0 | 1 | 2;
}

function useChartColors() {
  const dark = useIsDark();
  return { series: dark ? SERIES.dark : SERIES.light, chrome: dark ? CHROME.dark : CHROME.light };
}

export function dayTick(day: string) {
  const [, m, d] = day.split("-").map(Number);
  return new Date(2000, m - 1, d).toLocaleDateString("es", { day: "numeric", month: "short" }).replace(".", "");
}

/** Leyenda HTML (texto en tinta normal; el color va en la marca de al lado). */
export function Legend({ series, kind = "box" }: { series: SeriesDef[]; kind?: "box" | "line" }) {
  const { series: colors } = useChartColors();
  if (series.length < 2) return null;
  return (
    <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={kind === "line" ? "h-0.5 w-3.5 rounded-full" : "size-2.5 rounded-[3px]"}
            style={{ background: colors[s.slot] }}
          />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
  series,
  format,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string | number; value?: number }>;
  label?: string;
  series: SeriesDef[];
  format: (v: number) => string;
}) {
  const { series: colors } = useChartColors();
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-[12px] shadow-lg">
      <p className="mb-1 text-ink-3">{label ? dayTick(String(label)) : ""}</p>
      {series.map((s) => {
        const p = payload.find((x) => x.dataKey === s.key);
        return (
          <p key={s.key} className="flex items-center gap-2 tabular-nums">
            <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: colors[s.slot] }} />
            <strong className="font-semibold text-ink">{format(Number(p?.value ?? 0))}</strong>
            <span className="text-ink-3">{s.label}</span>
          </p>
        );
      })}
    </div>
  );
}

interface ChartProps {
  data: Array<Record<string, number | string>>;
  series: SeriesDef[];
  format?: (v: number) => string;
  height?: number;
  stacked?: boolean;
}

/** Columnas por día (agrupadas o apiladas). */
export function DailyBars({ data, series, format = (v) => compact(v), height = 220, stacked }: ChartProps) {
  const { series: colors, chrome } = useChartColors();
  return (
    <div>
      <Legend series={series} />
      <div style={{ height }} role="img" aria-label={`Gráfico de columnas: ${series.map((s) => s.label).join(", ")}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -12 }} barGap={2} barCategoryGap="20%">
            <CartesianGrid vertical={false} stroke={chrome.grid} strokeWidth={1} />
            <XAxis dataKey="day" tickFormatter={dayTick} tick={{ fill: chrome.tick, fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={16} />
            <YAxis tickFormatter={(v) => format(Number(v))} tick={{ fill: chrome.tick, fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} width={56} />
            <Tooltip cursor={{ fill: chrome.grid, opacity: 0.5 }} content={<ChartTooltip series={series} format={format} />} />
            {series.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                fill={colors[s.slot]}
                maxBarSize={24}
                stackId={stacked ? "s" : undefined}
                // Extremo de datos redondeado (4px); base cuadrada. En apiladas, solo el segmento superior.
                radius={stacked ? (i === series.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]) : [4, 4, 0, 0]}
                // Separación de 2px del color de la superficie entre segmentos apilados.
                stroke={stacked ? chrome.surface : undefined}
                strokeWidth={stacked ? 1 : 0}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Línea(s) por día con cruz de lectura y relleno suave. */
export function DailyLines({ data, series, format = (v) => compact(v), height = 220 }: ChartProps) {
  const { series: colors, chrome } = useChartColors();
  return (
    <div>
      <Legend series={series} kind="line" />
      <div style={{ height }} role="img" aria-label={`Gráfico de líneas: ${series.map((s) => s.label).join(", ")}`}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid vertical={false} stroke={chrome.grid} strokeWidth={1} />
            <XAxis dataKey="day" tickFormatter={dayTick} tick={{ fill: chrome.tick, fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={16} />
            <YAxis tickFormatter={(v) => format(Number(v))} tick={{ fill: chrome.tick, fontSize: 11 }} tickLine={false} axisLine={false} width={56} />
            <Tooltip cursor={{ stroke: chrome.tick, strokeWidth: 1 }} content={<ChartTooltip series={series} format={format} />} />
            {series.map((s) => (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stroke={colors[s.slot]}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill={colors[s.slot]}
                fillOpacity={0.1}
                dot={false}
                activeDot={{ r: 4, stroke: chrome.surface, strokeWidth: 2, fill: colors[s.slot] }}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
