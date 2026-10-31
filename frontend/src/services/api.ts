export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

type Body = unknown;

async function request<T>(method: string, url: string, body?: Body): Promise<T> {
  const isForm = body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: body !== undefined && !isForm ? { "Content-Type": "application/json" } : undefined,
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "No se pudo conectar con el servidor. ¿Está encendido?");
  }
  const text = await res.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (res.status === 401 && !url.startsWith("/api/auth/login")) {
    window.dispatchEvent(new Event("auth:expired"));
  }
  if (!res.ok) {
    throw new ApiError(res.status, data?.message ?? `Error ${res.status}`, data?.error);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, body?: Body) => request<T>("POST", url, body ?? {}),
  put: <T>(url: string, body?: Body) => request<T>("PUT", url, body ?? {}),
  patch: <T>(url: string, body?: Body) => request<T>("PATCH", url, body ?? {}),
  del: <T>(url: string) => request<T>("DELETE", url),
  upload: <T>(url: string, form: FormData) => request<T>("POST", url, form),
};

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
