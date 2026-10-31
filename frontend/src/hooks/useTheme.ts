import { useCallback, useEffect, useState } from "react";

export type ThemePref = "light" | "dark" | "system";

function apply(pref: ThemePref) {
  const dark = pref === "dark" || (pref === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  window.dispatchEvent(new Event("themechange"));
}

export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(() => {
    try {
      return (localStorage.getItem("theme") as ThemePref) || "system";
    } catch {
      return "system";
    }
  });
  useEffect(() => {
    apply(pref);
    if (pref !== "system") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => apply("system");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [pref]);
  const set = useCallback((p: ThemePref) => {
    try {
      localStorage.setItem("theme", p);
    } catch {
      /* sin almacenamiento */
    }
    setPref(p);
  }, []);
  return { pref, set };
}

/** true si el tema efectivo es oscuro (para los colores de los gráficos). */
export function useIsDark() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    const on = () => setDark(document.documentElement.classList.contains("dark"));
    window.addEventListener("themechange", on);
    return () => window.removeEventListener("themechange", on);
  }, []);
  return dark;
}
