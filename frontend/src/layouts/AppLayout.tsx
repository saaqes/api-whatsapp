import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  BookOpen,
  Bot,
  FlaskConical,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  MessagesSquare,
  Monitor,
  Moon,
  Plug,
  Power,
  Sun,
  Users,
  Workflow,
  X,
} from "lucide-react";
import { api, errorText } from "../services/api";
import { useAuth } from "../hooks/useAuth";
import { useTheme, type ThemePref } from "../hooks/useTheme";
import { Button, Field, IconButton, Input, Modal, cx, useConfirm, useToast } from "../components/ui";
import type { Role } from "../services/types";

const NAV: Array<{ to: string; label: string; icon: typeof LayoutDashboard; roles?: Role[] }> = [
  { to: "/", label: "Inicio", icon: LayoutDashboard },
  { to: "/conversaciones", label: "Conversaciones", icon: MessagesSquare },
  { to: "/contactos", label: "Contactos", icon: Users },
  { to: "/conocimiento", label: "Base de conocimientos", icon: BookOpen, roles: ["OWNER", "ADMIN"] },
  { to: "/automatizaciones", label: "Automatizaciones", icon: Workflow, roles: ["OWNER", "ADMIN"] },
  { to: "/estadisticas", label: "Estadísticas", icon: BarChart3 },
  { to: "/simulador", label: "Simulador", icon: FlaskConical, roles: ["OWNER", "ADMIN"] },
  { to: "/ia", label: "Configuración de la IA", icon: Bot, roles: ["OWNER", "ADMIN"] },
  { to: "/sistema", label: "Conexiones y sistema", icon: Plug, roles: ["OWNER", "ADMIN"] },
];

function ThemeToggle() {
  const { pref, set } = useTheme();
  const next: Record<ThemePref, ThemePref> = { system: "light", light: "dark", dark: "system" };
  const Icon = pref === "light" ? Sun : pref === "dark" ? Moon : Monitor;
  const label = pref === "light" ? "Tema claro" : pref === "dark" ? "Tema oscuro" : "Tema del sistema";
  return (
    <IconButton label={`${label} (clic para cambiar)`} onClick={() => set(next[pref])}>
      <Icon className="size-4" />
    </IconButton>
  );
}

function AssistantSwitch({ enabled }: { enabled: boolean }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const toast = useToast();
  const m = useMutation({
    mutationFn: (v: boolean) => api.post<{ assistantEnabled: boolean }>("/api/settings/assistant", { enabled: v }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["assistant"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast(r.assistantEnabled ? "Respuestas automáticas reactivadas" : "Respuestas automáticas detenidas");
    },
    onError: (e) => toast(errorText(e), "critical"),
  });
  const toggle = async () => {
    if (enabled) {
      const ok = await confirm({
        title: "¿Detener todas las respuestas automáticas?",
        message:
          "La IA y las automatizaciones dejarán de responder a TODOS los contactos. Los mensajes seguirán llegando al panel y podrás responder manualmente.",
        confirmLabel: "Detener todo",
        danger: true,
      });
      if (!ok) return;
    }
    m.mutate(!enabled);
  };
  return (
    <button
      onClick={toggle}
      disabled={m.isPending}
      className={cx(
        "inline-flex h-8 items-center gap-2 rounded-full border px-3 text-[12px] font-semibold transition-colors",
        enabled ? "border-good/30 bg-good-soft text-good" : "border-critical/30 bg-critical-soft text-critical",
      )}
      title="Botón general de respuestas automáticas"
    >
      <Power className="size-3.5" />
      <span className="hidden sm:inline">{enabled ? "IA activa" : "IA detenida"}</span>
    </button>
  );
}

function PasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const toast = useToast();
  const m = useMutation({
    mutationFn: () => api.post("/api/auth/password", { current, next }),
    onSuccess: () => {
      toast("Contraseña actualizada");
      setCurrent("");
      setNext("");
      onClose();
    },
    onError: (e) => toast(errorText(e), "critical"),
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Cambiar contraseña"
      size="sm"
      footer={
        <Button variant="primary" loading={m.isPending} onClick={() => m.mutate()} disabled={!current || !next}>
          Guardar
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label="Contraseña actual">
          <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label="Nueva contraseña" hint="Mínimo 10 caracteres, con letras y números.">
          <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

export function AppLayout() {
  const { user, logout, can } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setMenuOpen(false), [location.pathname]);

  const assistant = useQuery({
    queryKey: ["assistant"],
    queryFn: () => api.get<{ assistantEnabled: boolean; claudeMock: boolean }>("/api/settings/assistant"),
    refetchInterval: 30_000,
  });
  const attention = useQuery({
    queryKey: ["conversations", "needs_human", ""],
    queryFn: () => api.get<{ items: unknown[] }>("/api/conversations?filter=needs_human"),
    refetchInterval: 15_000,
  });
  const attentionCount = attention.data?.items.length ?? 0;

  const nav = (
    <nav className="flex flex-col gap-0.5 px-3">
      {NAV.filter((n) => !n.roles || can(...n.roles)).map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.to === "/"}
          className={({ isActive }) =>
            cx(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors",
              isActive ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface-2/60 hover:text-ink",
            )
          }
        >
          <n.icon className="size-4 shrink-0" />
          <span className="flex-1 truncate">{n.label}</span>
          {n.to === "/conversaciones" && attentionCount > 0 && (
            <span className="rounded-full bg-critical px-1.5 text-[11px] font-semibold text-white" title="Requieren atención humana">
              {attentionCount}
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  );

  const brand = (
    <div className="flex items-center gap-2.5 px-5 py-5">
      <img src="/favicon.svg" alt="" className="size-7" />
      <div className="leading-tight">
        <p className="text-[13px] font-semibold text-ink">Asistente IA</p>
        <p className="text-[11px] text-ink-3">WhatsApp · Claude</p>
      </div>
    </div>
  );

  const userBox = (
    <div className="border-t border-line p-3">
      <div className="flex items-center gap-2 rounded-lg px-2 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-ink">{user?.name}</p>
          <p className="truncate text-[11px] text-ink-3">{user?.email}</p>
        </div>
        <IconButton label="Cambiar contraseña" onClick={() => setPwOpen(true)}>
          <KeyRound className="size-4" />
        </IconButton>
        <IconButton label="Cerrar sesión" onClick={() => void logout()}>
          <LogOut className="size-4" />
        </IconButton>
      </div>
    </div>
  );

  return (
    <div className="flex h-full">
      {/* Barra lateral (escritorio) */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-line bg-surface lg:flex">
        {brand}
        <div className="flex-1 overflow-y-auto">{nav}</div>
        {userBox}
      </aside>

      {/* Menú móvil */}
      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMenuOpen(false)} />
          <aside className="animate-in absolute inset-y-0 left-0 flex w-72 flex-col border-r border-line bg-surface">
            <div className="flex items-center justify-between pr-3">
              {brand}
              <IconButton label="Cerrar menú" onClick={() => setMenuOpen(false)}>
                <X className="size-4" />
              </IconButton>
            </div>
            <div className="flex-1 overflow-y-auto">{nav}</div>
            {userBox}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface/80 px-4 backdrop-blur lg:px-6">
          <IconButton label="Abrir menú" className="lg:hidden" onClick={() => setMenuOpen(true)}>
            <Menu className="size-5" />
          </IconButton>
          <div className="flex-1" />
          {assistant.data && <AssistantSwitch enabled={assistant.data.assistantEnabled} />}
          <ThemeToggle />
        </header>
        {assistant.data?.claudeMock && (
          <div className="border-b border-warning/30 bg-warning-soft px-4 py-2 text-center text-[12px] text-warning lg:px-6">
            <strong>Modo prueba activo (CLAUDE_MOCK):</strong> las respuestas son simuladas, no las genera Claude. Desactívalo en el archivo .env para usar la IA real.
          </div>
        )}
        {assistant.data && !assistant.data.assistantEnabled && (
          <div className="border-b border-critical/30 bg-critical-soft px-4 py-2 text-center text-[12px] text-critical lg:px-6">
            <strong>Respuestas automáticas detenidas.</strong> Nadie recibirá respuestas de la IA ni de las automatizaciones hasta que las reactives.
          </div>
        )}
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
      <PasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
    </div>
  );
}
