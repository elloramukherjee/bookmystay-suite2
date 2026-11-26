// Runs in every worker before test files import application modules (env.ts validates at import time).
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-0123456789-abcdefghijklmnop';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-0123456789-abcdefghijklmnop';
process.env.CLIENT_URL = 'http://localhost:5173';
process.env.AUTH_RATE_LIMIT_MAX = '1000';
process.env.GLOBAL_RATE_LIMIT_MAX = '10000';
process.env.LOG_LEVEL = 'silent';
delete process.env.GEMINI_API_KEY;
delete process.env.WHATSAPP_ACCESS_TOKEN;
