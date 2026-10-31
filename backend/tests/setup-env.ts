// Variables de entorno para las pruebas (antes de importar la aplicación).
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://wa:wa@localhost:5432/whatsapp_ai_test";
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.SESSION_SECRET = "test-session-secret-0123456789abcdefghijkl";
process.env.CLAUDE_MOCK = "true";
process.env.WHATSAPP_MODE = "simulation";
process.env.META_APP_SECRET = "test_app_secret";
process.env.WHATSAPP_VERIFY_TOKEN = "verify-test-token";
process.env.WHATSAPP_PHONE_NUMBER_ID = "";
process.env.WHATSAPP_ACCESS_TOKEN = "";
process.env.ANTHROPIC_API_KEY = "";
process.env.ADMIN_EMAIL = "";
process.env.ADMIN_PASSWORD = "";
