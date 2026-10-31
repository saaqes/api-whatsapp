import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Search, Users } from "lucide-react";
import { api } from "../services/api";
import type { Contact } from "../services/types";
import { Avatar, Badge, Button, Card, EmptyState, Input, Loading, PageHeader, Select } from "../components/ui";
import { CLASSIFICATION_LABELS, contactName, formatPhone, timeAgo } from "../lib/format";

export default function ContactsPage() {
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState("");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ["contacts", search, tag, filter, page],
    queryFn: () =>
      api.get<{ items: Contact[]; total: number; page: number; pageSize: number; tags: string[] }>(
        `/api/contacts?search=${encodeURIComponent(search)}&filter=${filter}&page=${page}${tag ? `&tag=${encodeURIComponent(tag)}` : ""}`,
      ),
    placeholderData: (prev) => prev,
  });
  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / q.data.pageSize)) : 1;

  return (
    <div className="mx-auto max-w-7xl p-4 lg:p-6">
      <PageHeader title="Contactos" description="Cada persona que escribe a tu WhatsApp, con su información, etiquetas, notas y memoria." />
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-line p-3">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
            <Input
              className="pl-9"
              placeholder="Buscar por nombre, número o notas…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <Select className="w-auto" value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }}>
            <option value="all">Todos</option>
            <option value="needs_human">Requieren atención</option>
            <option value="paused">IA pausada</option>
            <option value="blocked">Bloqueados</option>
            <option value="opted_out">Dados de baja (STOP)</option>
          </Select>
          <Select className="w-auto" value={tag} onChange={(e) => { setTag(e.target.value); setPage(1); }}>
            <option value="">Todas las etiquetas</option>
            {q.data?.tags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </div>
        {q.isLoading ? (
          <Loading />
        ) : !q.data?.items.length ? (
          <EmptyState icon={<Users className="size-5" />} title="No hay contactos" description="Aparecerán automáticamente cuando alguien te escriba." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="text-[12px] text-ink-3">
                <tr className="border-b border-line">
                  <th className="px-4 py-2.5 font-medium">Contacto</th>
                  <th className="px-4 py-2.5 font-medium">Etiquetas</th>
                  <th className="hidden px-4 py-2.5 font-medium md:table-cell">Clasificación</th>
                  <th className="hidden px-4 py-2.5 font-medium md:table-cell">Mensajes</th>
                  <th className="px-4 py-2.5 font-medium">Última actividad</th>
                  <th className="px-4 py-2.5 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody>
                {q.data.items.map((c) => (
                  <tr key={c.id} className="border-b border-line/60 hover:bg-surface-2">
                    <td className="px-4 py-2.5">
                      <Link to={`/contactos/${c.id}`} className="flex items-center gap-3">
                        <Avatar name={contactName(c)} className="size-8 text-[12px]" />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-ink">{contactName(c)}</p>
                          <p className="text-[12px] text-ink-3">{formatPhone(c.waId)}</p>
                        </div>
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex max-w-56 flex-wrap gap-1">
                        {c.tags.length ? c.tags.map((t) => <Badge key={t}>{t}</Badge>) : <span className="text-ink-3">—</span>}
                      </div>
                    </td>
                    <td className="hidden px-4 py-2.5 text-ink-2 md:table-cell">{c.classification ? CLASSIFICATION_LABELS[c.classification] ?? c.classification : "—"}</td>
                    <td className="hidden px-4 py-2.5 tabular-nums text-ink-2 md:table-cell">{c._count?.messages ?? 0}</td>
                    <td className="px-4 py-2.5 text-ink-2">{timeAgo(c.lastMessageAt)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {c.blocked && <Badge>Bloqueado</Badge>}
                        {c.optedOut && <Badge>Baja</Badge>}
                        {c.aiPaused && <Badge tone="warning">IA pausada</Badge>}
                        {c.needsHuman && <Badge tone="critical">Atención</Badge>}
                        {!c.blocked && !c.optedOut && !c.aiPaused && !c.needsHuman && <Badge tone="good">IA activa</Badge>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {q.data && q.data.total > q.data.pageSize && (
          <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-[12px] text-ink-3">
            <span>
              {q.data.total} contactos · página {page} de {pages}
            </span>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Anterior">
                <ChevronLeft className="size-4" />
              </Button>
              <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="Siguiente">
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
