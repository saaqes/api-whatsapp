// Restaura una copia de seguridad descargada desde el panel (Sistema → Copias de seguridad).
// Uso: npm run backup:restore -w backend -- ruta/al/archivo.json [--force]
import { readFileSync } from "node:fs";
import { importBackup } from "../src/services/backup.service.js";
import { prisma } from "../src/database/prisma.js";

const file = process.argv[2];
const force = process.argv.includes("--force");
if (!file) {
  console.error("Uso: npm run backup:restore -w backend -- ruta/al/archivo.json [--force]");
  process.exit(1);
}
try {
  await importBackup(JSON.parse(readFileSync(file, "utf8")), { force });
  console.log("✅ Copia restaurada. Recuerda volver a configurar las credenciales en el panel.");
} catch (err) {
  console.error(`❌ ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
