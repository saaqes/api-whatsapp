import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { env } from "../config/env.js";

export * from "../generated/prisma/client.js";

const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
  // Cerrar conexiones inactivas permite que bases de datos "serverless" (p. ej. Neon)
  // se suspendan cuando no hay tráfico y no consuman horas de cómputo.
  idleTimeoutMillis: 10_000,
});

export const prisma = new PrismaClient({ adapter });

export type Db = typeof prisma;
