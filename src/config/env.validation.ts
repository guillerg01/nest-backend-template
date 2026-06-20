import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(3000),
  APP_HOST: Joi.string().default('http://localhost:3000'),
  FRONTEND_URL: Joi.string().default('http://localhost:3001'),

  JWT_SECRET: Joi.string().required(),
  JWT_EXPIRES_IN: Joi.string().default('1d'),
  JWT_REFRESH_SECRET: Joi.string().required(),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),

  // Either DATABASE_URL (Render/Railway/Heroku) or individual DB_* vars are required
  DATABASE_URL: Joi.string().allow('').optional(),
  DB_HOST: Joi.when('DATABASE_URL', { is: Joi.exist().not(''), then: Joi.optional(), otherwise: Joi.string().required() }),
  DB_PORT: Joi.number().default(5432),
  DB_USER: Joi.when('DATABASE_URL', { is: Joi.exist().not(''), then: Joi.optional(), otherwise: Joi.string().required() }),
  DB_PASSWORD: Joi.when('DATABASE_URL', { is: Joi.exist().not(''), then: Joi.optional(), otherwise: Joi.string().required() }),
  DB_NAME: Joi.when('DATABASE_URL', { is: Joi.exist().not(''), then: Joi.optional(), otherwise: Joi.string().required() }),
  DB_SYNC: Joi.boolean().default(false),
  DB_MIGRATIONS_RUN: Joi.boolean().default(false),

  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').default(''),
  REDIS_TTL: Joi.number().default(3600),

  HASH_SALT: Joi.number().default(10),

  GOOGLE_CLIENT_ID: Joi.string().allow('').optional(),
  GOOGLE_CLIENT_SECRET: Joi.string().allow('').optional(),
  GOOGLE_CALLBACK_URL: Joi.string().allow('').optional(),

  STRIPE_SECRET_KEY: Joi.string().allow('').optional(),
  STRIPE_WEBHOOK_SECRET: Joi.string().allow('').optional(),

  SMTP_HOST: Joi.string().allow('').optional(),
  SMTP_PORT: Joi.number().optional(),
  SMTP_USER: Joi.string().allow('').optional(),
  SMTP_PASS: Joi.string().allow('').optional(),
  EMAIL_FROM: Joi.string().allow('').optional(),

  // Seed (dev only)
  SEED_SECRET: Joi.string().allow('').optional(),
  SEED_ADMIN_PASSWORD: Joi.string().allow('').optional(),

  // Optional integrations
  AWS_REGION: Joi.string().allow('').optional(),
  AWS_ACCESS_KEY_ID: Joi.string().allow('').optional(),
  AWS_SECRET_ACCESS_KEY: Joi.string().allow('').optional(),
  AWS_S3_BUCKET: Joi.string().allow('').optional(),
  OPENAI_API_KEY: Joi.string().allow('').optional(),
  SENTRY_DSN: Joi.string().allow('').optional(),
  EVM_RPC_URL: Joi.string().allow('').optional(),
  SOLANA_RPC_URL: Joi.string().allow('').optional(),
  SCRAPING_CONCURRENCY: Joi.number().optional(),
  SCRAPING_DELAY_MS: Joi.number().optional(),
  LOG_LEVEL: Joi.string().valid('debug', 'info', 'warn', 'error').optional(),
  APP_VERSION: Joi.string().allow('').optional(),
});
