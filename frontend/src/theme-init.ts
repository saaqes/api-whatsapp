// Aplica el tema guardado antes de pintar (evita parpadeo claro/oscuro).
try {
  const saved = localStorage.getItem("theme");
  const dark = saved === "dark" || (saved !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
} catch {
  /* almacenamiento no disponible */
}
