// Crea el archivo .env a partir de .env.example y genera claves secretas aleatorias.
// Uso: npm run setup   (funciona igual en Windows, macOS y Linux)
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");
const examplePath = path.join(root, ".env.example");

let content = existsSync(envPath) ? readFileSync(envPath, "utf8") : readFileSync(examplePath, "utf8");
const created = !existsSync(envPath);

function setIfEmpty(key, value) {
  const re = new RegExp(`^${key}=(.*)$`, "m");
  const m = content.match(re);
  if (!m) content += `\n${key}=${value}\n`;
  else if (!m[1].trim()) content = content.replace(re, `${key}=${value}`);
  else return false;
  return true;
}

const changes = [];
if (setIfEmpty("ENCRYPTION_KEY", randomBytes(32).toString("hex"))) changes.push("ENCRYPTION_KEY");
if (setIfEmpty("SESSION_SECRET", randomBytes(48).toString("base64url"))) changes.push("SESSION_SECRET");
if (setIfEmpty("WHATSAPP_VERIFY_TOKEN", `verify-${randomBytes(12).toString("hex")}`)) changes.push("WHATSAPP_VERIFY_TOKEN");

writeFileSync(envPath, content);
console.log(created ? "✅ Archivo .env creado." : "✅ Archivo .env actualizado.");
if (changes.length) console.log(`   Generados automáticamente: ${changes.join(", ")}`);
console.log(`
Siguiente paso: abre el archivo .env con el Bloc de notas o VS Code y completa:
  • DATABASE_URL     (tu base de datos PostgreSQL)
  • ADMIN_EMAIL y ADMIN_PASSWORD (tu usuario del panel; contraseña de 10+ caracteres con letras y números)
  • ANTHROPIC_API_KEY (o configúrala luego desde el panel)
Guía completa: docs/INSTALACION.md`);
