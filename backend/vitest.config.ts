import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    fileParallelism: false, // las pruebas de integración comparten una base de datos
    testTimeout: 20_000,
    hookTimeout: 30_000,
    setupFiles: ["tests/setup-env.ts"],
  },
});
