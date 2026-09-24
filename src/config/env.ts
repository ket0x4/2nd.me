import { z } from 'zod';

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),
  ALLOWED_TELEGRAM_USER_ID: z.coerce
    .number()
    .positive('ALLOWED_TELEGRAM_USER_ID must be a positive number'),
  GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY is required'),
  DB_PATH: z.string().default('./data/brain.db'),
  STORAGE_DIR: z.string().default('./storage'),
  TIMEZONE: z.string().default('Europe/Istanbul'),
  DEFAULT_MODEL: z.string().default('gemini-3.5-flash-lite'),
  FALLBACK_MODEL: z.string().default('gemma-4-31b-it'),
});

type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  if (process.env.NODE_ENV === 'test') {
    return {
      TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || 'test_bot_token',
      ALLOWED_TELEGRAM_USER_ID: Number(process.env.ALLOWED_TELEGRAM_USER_ID || '123456789'),
      GEMINI_API_KEY: process.env.GEMINI_API_KEY || 'test_gemini_api_key',
      DB_PATH: process.env.TEST_DB_PATH || ':memory:',
      STORAGE_DIR: process.env.STORAGE_DIR || './storage_test',
      TIMEZONE: process.env.TIMEZONE || 'Europe/Istanbul',
      DEFAULT_MODEL: process.env.DEFAULT_MODEL || 'gemini-3.5-flash-lite',
      FALLBACK_MODEL: process.env.FALLBACK_MODEL || 'gemma-4-31b-it',
    };
  }

  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    console.error(`Environment validation error:\n${issues}`);
    console.error('Please configure your .env file according to .env.example');
    process.exit(1);
  }
  return result.data;
}

export const env = loadEnv();
