import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '@nestjs/cache-manager';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { BullModule } from '@nestjs/bullmq';
import { LoggerModule } from 'nestjs-pino';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import { envValidationSchema } from './config/env.validation';
import { databaseConfig } from './config/database.config';
import { pinoLoggerConfig } from './config/logger.config';

import { ResponseInterceptor } from './shared/interceptors/response.interceptor';
import { LoggingInterceptor } from './shared/interceptors/logging.interceptor';
import { AllExceptionsFilter } from './shared/filters/all-exceptions.filter';
import { JwtAuthGuard } from './shared/guards/jwt-auth.guard';
import { PermissionsGuard } from './shared/guards/permissions.guard';
import { CircuitBreakerService } from './shared/services/circuit-breaker.service';
import { RetryService } from './shared/services/retry.service';
import { CorrelationIdMiddleware } from './shared/middleware/correlation-id.middleware';

import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { SecurityModule } from './modules/security/security.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { ScrapingModule } from './modules/scraping/scraping.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { ChatModule } from './modules/chat/chat.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { HealthModule } from './modules/health/health.module';
import { OpenAIModule } from './modules/openai/openai.module';
import { CryptoModule } from './modules/crypto/crypto.module';
import { FilesModule } from './modules/files/files.module';
import { QueueModule } from './modules/queue/queue.module';
import { SentryModule } from './modules/sentry/sentry.module';
import { ProductsModule } from './modules/products/products.module';

@Module({
  imports: [
    // ─── Config (global) ─────────────────────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: { allowUnknown: true, abortEarly: false },
    }),

    // ─── Pino Logger ─────────────────────────────────────────────────────────
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: pinoLoggerConfig,
    }),

    // ─── Database ────────────────────────────────────────────────────────────
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: () => databaseConfig(),
    }),

    // ─── Redis Cache ─────────────────────────────────────────────────────────
    CacheModule.registerAsync({
      isGlobal: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        store: 'memory',    // Replace: require('cache-manager-ioredis') for Redis
        ttl: config.get('REDIS_TTL', 3600),
        max: 500,
      }),
    }),

    // ─── BullMQ (Redis required) ──────────────────────────────────────────────
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
          password: config.get('REDIS_PASSWORD') || undefined,
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 200 },
        },
      }),
    }),

    // ─── Rate Limiting ────────────────────────────────────────────────────────
    // Default: 100 requests per 60 seconds per IP
    // Override per-route with @Throttle({ default: { limit: 5, ttl: 60000 } })
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          { name: 'short', ttl: 1000, limit: 10 },    // 10/sec burst
          { name: 'medium', ttl: 60_000, limit: 100 }, // 100/min sustained
        ],
        // For multi-instance: replace with ThrottlerStorageRedisService
      }),
    }),

    // ─── Event Emitter (in-process domain events) ────────────────────────────
    EventEmitterModule.forRoot({
      wildcard: true,        // Enable 'user.*' patterns
      delimiter: '.',
      maxListeners: 20,
    }),

    // ─── Scheduling (cron jobs) ───────────────────────────────────────────────
    ScheduleModule.forRoot(),

    // ─── Feature Modules ──────────────────────────────────────────────────────
    SentryModule,          // Error tracking — initialize early
    SecurityModule,        // Role + Permission entities (needed by auth)
    AuthModule,
    UsersModule,
    ProductsModule,        // Generic CRUD example
    ChatModule,            // Full chat with persistence
    PaymentsModule,        // Stripe
    ScrapingModule,        // Cheerio + Playwright
    RealtimeModule,        // General-purpose WebSocket gateway
    NotificationsModule,   // Email
    FilesModule,           // S3 upload
    QueueModule,           // BullMQ
    OpenAIModule,          // OpenAI: chat, embeddings, image, whisper, TTS
    CryptoModule,          // Encryption, blockchain read, price data
    HealthModule,          // /health endpoint
  ],
  providers: [
    CircuitBreakerService,
    RetryService,

    // ─── Global Guards ────────────────────────────────────────────────────────
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard }, // Rate limiting

    // ─── Global Interceptors ──────────────────────────────────────────────────
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },

    // ─── Global Filters ───────────────────────────────────────────────────────
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(CorrelationIdMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
