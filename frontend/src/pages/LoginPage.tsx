import { useState, type FormEvent } from "react";
import { Lock } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { errorText } from "../services/api";
import { Button, Callout, Card, Field, Input } from "../components/ui";

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-12">
      <div className="animate-in w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <img src="/favicon.svg" alt="" className="mb-4 size-11" />
          <h1 className="text-lg font-semibold text-ink">Panel del asistente de WhatsApp</h1>
          <p className="mt-1 text-[13px] text-ink-3">Inicia sesión para administrar tu IA</p>
        </div>
        <Card className="p-6">
          <form onSubmit={submit} className="space-y-4">
            <Field label="Correo electrónico" htmlFor="email">
              <Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Contraseña" htmlFor="password">
              <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            {error && <Callout tone="critical">{error}</Callout>}
            <Button type="submit" variant="primary" className="w-full" loading={busy} icon={<Lock className="size-4" />}>
              Entrar
            </Button>
          </form>
        </Card>
        <p className="mt-6 text-center text-[12px] text-ink-3">
          ¿Primera vez? El usuario se crea con ADMIN_EMAIL y ADMIN_PASSWORD del archivo .env.
        </p>
      </div>
    </div>
  );
}
