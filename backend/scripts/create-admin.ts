// Crea un usuario del panel desde la terminal.
// Uso: npm run admin:create -- correo@ejemplo.com "Nombre" "ContraseñaSegura123" [OWNER|ADMIN|AGENT]
import { createUser } from "../src/services/auth.service.js";
import { prisma } from "../src/database/prisma.js";

const [email, name, password, role = "OWNER"] = process.argv.slice(2);
if (!email || !name || !password) {
  console.error('Uso: npm run admin:create -- correo@ejemplo.com "Tu nombre" "ContraseñaSegura123" [OWNER|ADMIN|AGENT]');
  process.exit(1);
}
try {
  const u = await createUser({ email, name, password, role: role as "OWNER" | "ADMIN" | "AGENT" });
  console.log(`✅ Usuario creado: ${u.email} (${u.role})`);
} catch (err) {
  console.error(`❌ ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
