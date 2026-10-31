import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { defineConfig } from "prisma/config";

for (const file of [".env", "../.env"]) {
  if (existsSync(file)) {
    loadDotenv({ path: file, quiet: true });
    break;
  }
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // `prisma generate` no necesita conexión; usamos un valor de relleno si falta.
    url: process.env["DATABASE_URL"] ?? "postgresql://placeholder:placeholder@localhost:5432/placeholder",
  },
});
