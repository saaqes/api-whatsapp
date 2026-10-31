import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "../services/api";
import type { Role, User } from "../services/types";

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (...roles: Role[]) => boolean;
}

const Ctx = createContext<AuthState>(null as unknown as AuthState);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<{ user: User | null }>("/api/auth/session")
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
    const expired = () => setUser(null);
    window.addEventListener("auth:expired", expired);
    return () => window.removeEventListener("auth:expired", expired);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api.post<{ user: User }>("/api/auth/login", { email, password });
    setUser(r.user);
  }, []);
  const logout = useCallback(async () => {
    await api.post("/api/auth/logout").catch(() => undefined);
    setUser(null);
  }, []);
  const can = useCallback((...roles: Role[]) => Boolean(user && roles.includes(user.role)), [user]);

  return <Ctx.Provider value={{ user, loading, login, logout, can }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
