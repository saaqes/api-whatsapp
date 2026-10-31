/** Error con código HTTP y mensaje apto para mostrar en el panel. */
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string) => new HttpError(400, msg, "bad_request");
export const notFound = (msg = "No encontrado") => new HttpError(404, msg, "not_found");
export const forbidden = (msg = "No tienes permiso para esta acción") => new HttpError(403, msg, "forbidden");
export const unauthorized = (msg = "Sesión no válida") => new HttpError(401, msg, "unauthorized");

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
