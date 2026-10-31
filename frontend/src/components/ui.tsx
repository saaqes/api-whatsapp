import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from "lucide-react";

export function cx(...c: Array<string | false | null | undefined>) {
  return c.filter(Boolean).join(" ");
}

// ───────────────────────────── Botones ─────────────────────────────

type Variant = "primary" | "secondary" | "ghost" | "danger";
const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:bg-accent-hover shadow-sm",
  secondary: "bg-surface text-ink border border-line hover:bg-surface-2",
  ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink",
  danger: "bg-critical text-white hover:opacity-90",
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; loading?: boolean; icon?: ReactNode }
>(function Button({ variant = "secondary", size = "md", loading, icon, className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap",
        size === "sm" ? "h-8 px-3 text-[13px]" : "h-9 px-4 text-sm",
        variants[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export function IconButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cx("inline-flex size-8 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-2 hover:text-ink transition-colors", className)}
      {...rest}
    >
      {children}
    </button>
  );
}

// ───────────────────────────── Superficies ─────────────────────────────

export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx("rounded-xl border border-line bg-surface", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, description, actions, icon }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div className="flex min-w-0 items-start gap-3">
        {icon && <div className="mt-0.5 text-ink-3">{icon}</div>}
        <div className="min-w-0">
          <h3 className="font-semibold text-ink">{title}</h3>
          {description && <p className="mt-0.5 text-[13px] text-ink-3">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[13px] text-ink-3">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ───────────────────────────── Formularios ─────────────────────────────

export function Field({ label, hint, error, children, htmlFor }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-[13px] font-medium text-ink">
        {label}
      </label>
      {children}
      {error ? <p className="text-[12px] text-critical">{error}</p> : hint ? <p className="text-[12px] leading-relaxed text-ink-3">{hint}</p> : null}
    </div>
  );
}

const inputBase =
  "w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-ink-3 transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-[var(--ring)] disabled:opacity-60";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(inputBase, "h-9", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cx(inputBase, "py-2 leading-relaxed", className)} {...rest} />;
});

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(inputBase, "h-9 pr-8", className)} {...rest}>
      {children}
    </select>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
  size = "md",
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  size?: "sm" | "md";
}) {
  const id = useId();
  const btn = (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative inline-flex shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
        size === "sm" ? "h-5 w-9" : "h-6 w-11",
        checked ? "bg-accent" : "bg-surface-3",
      )}
    >
      <span
        className={cx(
          "inline-block rounded-full bg-white shadow transition-transform",
          size === "sm" ? "size-4" : "size-5",
          checked ? (size === "sm" ? "translate-x-[18px]" : "translate-x-[22px]") : "translate-x-0.5",
        )}
      />
    </button>
  );
  if (!label) return btn;
  return (
    <div className="flex items-start justify-between gap-4">
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block text-[13px] font-medium text-ink">{label}</span>
        {description && <span className="mt-0.5 block text-[12px] leading-relaxed text-ink-3">{description}</span>}
      </label>
      {btn}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "h-7 rounded-md px-3 text-[13px] font-medium transition-colors",
            value === o.value ? "bg-surface text-ink shadow-sm" : "text-ink-3 hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Editor de etiquetas o palabras clave (Enter o coma para añadir). */
export function TagInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const parts = draft.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) onChange([...new Set([...value, ...parts])]);
    setDraft("");
  };
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-1.5 focus-within:border-accent focus-within:ring-2 focus-within:ring-[var(--ring)]">
      {value.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-0.5 text-[12px] text-ink">
          {t}
          <button type="button" aria-label={`Quitar ${t}`} className="text-ink-3 hover:text-ink" onClick={() => onChange(value.filter((x) => x !== t))}>
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          } else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={add}
        placeholder={value.length ? "" : placeholder}
        className="min-w-24 flex-1 bg-transparent text-sm text-ink placeholder:text-ink-3 focus:outline-none"
      />
    </div>
  );
}

// ───────────────────────────── Indicadores ─────────────────────────────

type Tone = "neutral" | "good" | "warning" | "critical" | "accent";
const tones: Record<Tone, string> = {
  neutral: "bg-surface-2 text-ink-2",
  good: "bg-good-soft text-good",
  warning: "bg-warning-soft text-warning",
  critical: "bg-critical-soft text-critical",
  accent: "bg-accent-soft text-accent-soft-ink",
};

export function Badge({ tone = "neutral", children, className, icon }: { tone?: Tone; children: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap", tones[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

/** Estado con icono + texto (el color nunca va solo). */
export function StatusPill({ ok, label, warn }: { ok: boolean; label: string; warn?: boolean }) {
  const tone = ok ? "good" : warn ? "warning" : "critical";
  const Icon = ok ? CheckCircle2 : warn ? AlertTriangle : XCircle;
  return (
    <Badge tone={tone} icon={<Icon className="size-3.5" />}>
      {label}
    </Badge>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx("size-5 animate-spin text-ink-3", className)} />;
}

export function Loading({ label = "Cargando…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-ink-3">
      <Spinner className="size-4" /> {label}
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-3 rounded-xl bg-surface-2 p-3 text-ink-3">{icon}</div>}
      <p className="font-medium text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-[13px] text-ink-3">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Callout({ tone = "neutral", title, children, icon }: { tone?: Tone; title?: ReactNode; children?: ReactNode; icon?: ReactNode }) {
  const Icon = tone === "critical" ? XCircle : tone === "warning" ? AlertTriangle : tone === "good" ? CheckCircle2 : Info;
  return (
    <div className={cx("flex gap-3 rounded-xl px-4 py-3 text-[13px] leading-relaxed", tones[tone])}>
      <span className="mt-0.5 shrink-0">{icon ?? <Icon className="size-4" />}</span>
      <div className="min-w-0 text-ink-2">
        {title && <p className="font-medium text-ink">{title}</p>}
        {children}
      </div>
    </div>
  );
}

// ───────────────────────────── Modal ─────────────────────────────

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input,textarea,select,button")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={ref}
        className={cx(
          "animate-in relative flex max-h-[92vh] w-full flex-col rounded-t-2xl border border-line bg-surface shadow-xl sm:rounded-2xl",
          size === "sm" ? "sm:max-w-md" : size === "lg" ? "sm:max-w-3xl" : "sm:max-w-xl",
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="font-semibold text-ink">{title}</h2>
            {description && <p className="mt-0.5 text-[13px] text-ink-3">{description}</p>}
          </div>
          <IconButton label="Cerrar" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </div>
        <div className="scrollbar-thin overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

// ───────────────────────────── Confirmación ─────────────────────────────

interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}
const ConfirmCtx = createContext<(o: ConfirmOptions) => Promise<boolean>>(async () => false);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const confirm = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), []);
  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Modal
        open={Boolean(state)}
        onClose={() => close(false)}
        title={state?.title}
        size="sm"
        footer={
          <>
            <Button onClick={() => close(false)}>Cancelar</Button>
            <Button variant={state?.danger ? "danger" : "primary"} onClick={() => close(true)}>
              {state?.confirmLabel ?? "Confirmar"}
            </Button>
          </>
        }
      >
        <div className="text-[13px] leading-relaxed text-ink-2">{state?.message}</div>
      </Modal>
    </ConfirmCtx.Provider>
  );
}
export const useConfirm = () => useContext(ConfirmCtx);

// ───────────────────────────── Notificaciones ─────────────────────────────

interface Toast {
  id: number;
  tone: "good" | "critical" | "neutral";
  text: string;
}
const ToastCtx = createContext<(text: string, tone?: Toast["tone"]) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast["tone"] = "good") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "critical" ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="animate-in pointer-events-auto flex max-w-md items-start gap-2 rounded-xl border border-line bg-surface px-4 py-2.5 text-[13px] text-ink shadow-lg"
          >
            {t.tone === "good" ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-good" />
            ) : t.tone === "critical" ? (
              <XCircle className="mt-0.5 size-4 shrink-0 text-critical" />
            ) : (
              <Info className="mt-0.5 size-4 shrink-0 text-ink-3" />
            )}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

export function Stat({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-medium text-ink-3">{label}</p>
        {icon && <span className="text-ink-3">{icon}</span>}
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-ink tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-[12px] text-ink-3">{hint}</p>}
    </Card>
  );
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = (() => {
    const parts = name.replace(/^\+/, "").trim().split(/\s+/);
    if (/^\d/.test(parts[0] ?? "")) return "#";
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
  })();
  return (
    <div className={cx("flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[13px] font-semibold text-accent-soft-ink", className)}>
      {initials}
    </div>
  );
}
