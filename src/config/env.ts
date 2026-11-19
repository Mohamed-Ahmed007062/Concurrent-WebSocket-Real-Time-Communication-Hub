import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

// Load .env
dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  REDIS_HOST: z.string().default('127.0.0.1'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional().default(''),
  USE_REDIS_MOCK: z.string().default('auto'), // 'true', 'false', or 'auto'
  LOG_DIR: z.string().default('./logs'),
  LOG_FILE_PREFIX: z.string().default('transactions'),
  LOG_FLUSH_INTERVAL_MS: z.coerce.number().default(500),
  MAX_MESSAGE_LENGTH: z.coerce.number().default(2048),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(1000),
  RATE_LIMIT_MAX_MESSAGES: z.coerce.number().default(15),
  PING_INTERVAL_MS: z.coerce.number().default(25000),
  PING_TIMEOUT_MS: z.coerce.number().default(20000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.format());
  process.exit(1);
}

export const env = {
  ...parsed.data,
  LOG_DIR_RESOLVED: path.resolve(process.cwd(), parsed.data.LOG_DIR),
};

export type EnvConfig = typeof env;
