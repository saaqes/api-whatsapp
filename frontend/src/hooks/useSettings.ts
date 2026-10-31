import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorText } from "../services/api";
import type { SettingsResponse } from "../services/types";
import { useToast } from "../components/ui";

type Sections = SettingsResponse["settings"];

export function useSettings() {
  return useQuery({ queryKey: ["settings"], queryFn: () => api.get<SettingsResponse>("/api/settings") });
}

export function useSaveSection<K extends keyof Sections>(section: K, opts: { silent?: boolean } = {}) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (patch: Partial<Sections[K]>) => api.put<Sections[K]>(`/api/settings/${section}`, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["assistant"] });
      qc.invalidateQueries({ queryKey: ["prompt-preview"] });
      if (!opts.silent) toast("Configuración guardada");
    },
    onError: (e) => toast(errorText(e), "critical"),
  });
}
