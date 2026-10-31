import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router";
import { useAuth } from "./hooks/useAuth";
import { AppLayout } from "./layouts/AppLayout";
import { LoginPage } from "./pages/LoginPage";
import { Loading } from "./components/ui";
import type { Role } from "./services/types";

const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const ConversationsPage = lazy(() => import("./pages/ConversationsPage"));
const ContactsPage = lazy(() => import("./pages/ContactsPage"));
const ContactDetailPage = lazy(() => import("./pages/ContactDetailPage"));
const KnowledgePage = lazy(() => import("./pages/KnowledgePage"));
const AutomationsPage = lazy(() => import("./pages/AutomationsPage"));
const StatsPage = lazy(() => import("./pages/StatsPage"));
const SimulatorPage = lazy(() => import("./pages/SimulatorPage"));
const AiSettingsPage = lazy(() => import("./pages/AiSettingsPage"));
const SystemPage = lazy(() => import("./pages/SystemPage"));

function Guard({ roles, children }: { roles?: Role[]; children: React.ReactNode }) {
  const { can } = useAuth();
  if (roles && !can(...roles)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function App() {
  const { user, loading } = useAuth();
  if (loading) return <Loading label="Abriendo el panel…" />;
  if (!user) return <LoginPage />;
  const admin: Role[] = ["OWNER", "ADMIN"];
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="conversaciones" element={<ConversationsPage />} />
          <Route path="conversaciones/:id" element={<ConversationsPage />} />
          <Route path="contactos" element={<ContactsPage />} />
          <Route path="contactos/:id" element={<ContactDetailPage />} />
          <Route path="conocimiento" element={<Guard roles={admin}><KnowledgePage /></Guard>} />
          <Route path="automatizaciones" element={<Guard roles={admin}><AutomationsPage /></Guard>} />
          <Route path="estadisticas" element={<StatsPage />} />
          <Route path="simulador" element={<Guard roles={admin}><SimulatorPage /></Guard>} />
          <Route path="ia" element={<Guard roles={admin}><AiSettingsPage /></Guard>} />
          <Route path="sistema" element={<Guard roles={admin}><SystemPage /></Guard>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
