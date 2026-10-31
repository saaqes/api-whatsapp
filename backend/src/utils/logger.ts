import pino from "pino";
import { env, isTest } from "../config/env.js";

/** Rutas que nunca deben aparecer en los registros. */
export const redactPaths = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers['x-hub-signature-256']",
  "headers.authorization",
  "apiKey",
  "accessToken",
  "password",
  "*.password",
  "*.apiKey",
  "*.accessToken",
];

export const logger = pino({
  level: isTest ? "silent" : env.LOG_LEVEL,
  redact: { paths: redactPaths, censor: "[oculto]" },
});
