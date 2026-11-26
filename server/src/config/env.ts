import { z } from 'zod';

const WEAK_SECRET_MARKERS = ['change-me', 'changeme', 'secret', 'replace', 'example'];

const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    MONGODB_URI: z.string().min(1).default('mongodb://127.0.0.1:27017/bookmystay'),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(60).default(7),

    GEMINI_API_KEY: optionalString,
    GEMINI_MODEL: z.string().trim().min(1).default('gemini-3.8-flash'),
    /** Used for the single retry when the primary model is overloaded (429/5xx). */
    GEMINI_FALLBACK_MODEL: optionalString,
    /** Optional thinking level (MINIMAL/LOW/MEDIUM/HIGH). Unset = the model's default. Lower = faster replies. */
    GEMINI_THINKING_LEVEL: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['MINIMAL', 'LOW', 'MEDIUM', 'HIGH']).optional()),
    GEMINI_TIMEOUT_MS: z.coerce.number().int().min(3000).max(60_000).default(12_000),

    WHATSAPP_ACCESS_TOKEN: optionalString,
    WHATSAPP_PHONE_NUMBER_ID: optionalString,
    WHATSAPP_VERIFY_TOKEN: optionalString,
    WHATSAPP_APP_SECRET: optionalString,
    WHATSAPP_API_VERSION: z.string().default('v21.0'),
    /**
     * Meta-approved templates for business-initiated messages (outside the 24-hour window), as
     * "booking_confirmed=bms_booking_confirmed:en,checkin_welcome=bms_checkin_welcome:en". Unmapped
     * messages are sent as plain text.
     */
    WHATSAPP_TEMPLATES: optionalString,

    /**
     * "razorpay" = online payment (UPI/card/netbanking). "pay_at_hotel" = no payment gateway: website bookings are
     * confirmed straight away and the guest pays at the property. "mock" = development only.
     */
    PAYMENT_PROVIDER: z.enum(['mock', 'razorpay', 'pay_at_hotel']).default('mock'),
    PAYMENT_GATEWAY_KEY: optionalString,
    PAYMENT_GATEWAY_SECRET: optionalString,
    PAYMENT_WEBHOOK_SECRET: optionalString,

    /**
     * No SMS or email gateway is integrated in this version: "console" logs instead of sending, and the
     * outbox never treats it as a delivery. Undeliverable messages become staff call tasks instead.
     */
    SMS_PROVIDER: z.enum(['console'], { message: 'Only "console" is available in this version (no SMS gateway is integrated)' }).default('console'),
    SMS_API_KEY: optionalString,
    EMAIL_PROVIDER: z.enum(['console'], { message: 'Only "console" is available in this version (no email provider is integrated)' }).default('console'),
    SMTP_URL: optionalString,

    CLIENT_URL: z.string().default('http://localhost:5173'),
    /** Serve the built React app (client/dist) from this process: one service, one origin. */
    SERVE_CLIENT: z.preprocess((v) => (v === undefined || v === '' ? undefined : String(v).toLowerCase() === 'true'), z.boolean().default(false)),
    CLIENT_DIST_DIR: optionalString,
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
    GLOBAL_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
    IP_HASH_SALT: z.string().min(8).default('bookmystay-dev-ip-salt'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
      const value = env[key].toLowerCase();
      if (WEAK_SECRET_MARKERS.some((m) => value.includes(m))) {
        ctx.addIssue({ code: 'custom', path: [key], message: `${key} looks like a placeholder` });
      }
    }
    if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
      ctx.addIssue({ code: 'custom', path: ['JWT_REFRESH_SECRET'], message: 'Access and refresh secrets must differ' });
    }
    if (env.PAYMENT_PROVIDER === 'mock') {
      ctx.addIssue({ code: 'custom', path: ['PAYMENT_PROVIDER'], message: 'The mock payment provider is not allowed in production' });
    }
    if (env.PAYMENT_PROVIDER === 'razorpay' && !(env.PAYMENT_GATEWAY_KEY && env.PAYMENT_GATEWAY_SECRET && env.PAYMENT_WEBHOOK_SECRET)) {
      ctx.addIssue({
        code: 'custom',
        path: ['PAYMENT_WEBHOOK_SECRET'],
        message: 'Razorpay needs PAYMENT_GATEWAY_KEY, PAYMENT_GATEWAY_SECRET and PAYMENT_WEBHOOK_SECRET',
      });
    }
    if (env.IP_HASH_SALT === 'bookmystay-dev-ip-salt') {
      ctx.addIssue({ code: 'custom', path: ['IP_HASH_SALT'], message: 'Set a unique IP_HASH_SALT in production' });
    }
    if (env.CLIENT_URL.includes('localhost')) {
      ctx.addIssue({ code: 'custom', path: ['CLIENT_URL'], message: 'CLIENT_URL must be the public origin in production' });
    } else if (env.CLIENT_URL.split(',').some((o) => !o.trim().startsWith('https://'))) {
      // The refresh cookie is Secure in production: over plain http staff could never stay signed in.
      ctx.addIssue({ code: 'custom', path: ['CLIENT_URL'], message: 'CLIENT_URL must use https:// in production' });
    }
  });

export type Env = z.infer<typeof envSchema> & {
  clientOrigins: string[];
  isProduction: boolean;
  isTest: boolean;
  geminiConfigured: boolean;
  whatsappConfigured: boolean;
};

/** Exported for tests: validates any variable set exactly as the server does at startup. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.') || 'env'}: ${i.message}`);
    // Fail fast: a misconfigured server must never start.
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}\nSee .env.example (or run "npm run setup:env").`);
  }
  const e = parsed.data;
  return {
    ...e,
    clientOrigins: e.CLIENT_URL.split(',')
      .map((s) => s.trim().replace(/\/$/, ''))
      .filter(Boolean),
    isProduction: e.NODE_ENV === 'production',
    isTest: e.NODE_ENV === 'test',
    geminiConfigured: Boolean(e.GEMINI_API_KEY),
    whatsappConfigured: Boolean(e.WHATSAPP_ACCESS_TOKEN && e.WHATSAPP_PHONE_NUMBER_ID && e.WHATSAPP_VERIFY_TOKEN && e.WHATSAPP_APP_SECRET),
  };
}

export const env: Env = loadEnv();
