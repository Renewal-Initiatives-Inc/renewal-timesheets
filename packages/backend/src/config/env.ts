import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),
  // DATABASE_URL is optional at startup to allow health checks without DB
  // The db module will throw if DATABASE_URL is missing when actually accessing the database
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid PostgreSQL URL').optional(),
  FRONTEND_URL: z.string().default('http://localhost:5173'),

  // Zitadel OIDC Configuration
  ZITADEL_ISSUER: z.string().trim().url('ZITADEL_ISSUER must be a valid URL'),
  ZITADEL_PROJECT_ID: z.string().trim().min(1, 'ZITADEL_PROJECT_ID is required for JWT audience validation'),

  // Email (Postmark)
  POSTMARK_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().email().default('noreply@renewal.org'),

  // App URL for email links
  APP_URL: z.string().url().default('http://localhost:5173'),

  // Vercel Blob storage
  BLOB_READ_WRITE_TOKEN: z.string().optional(),

  // Encryption
  DOB_ENCRYPTION_KEY: z.string().trim().length(64, 'DOB_ENCRYPTION_KEY must be 64 hex chars (32 bytes)'),

  // Cron job security
  CRON_SECRET: z.string().optional(),
});

class EnvValidationError extends Error {
  constructor(
    message: string,
    public errors: ReturnType<typeof envSchema.safeParse>['error']
  ) {
    super(message);
    this.name = 'EnvValidationError';
  }
}

function loadEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errorMessage = 'Invalid environment variables';
    console.error(errorMessage + ':');
    console.error(result.error.format());

    // In serverless environments, throw error instead of exiting
    // This allows the error to be caught and returned as a response
    throw new EnvValidationError(errorMessage, result.error);
  }

  return result.data;
}

export const env = loadEnv();
