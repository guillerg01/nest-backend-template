import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { corsConfig } from './config/cors.config';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,        // Required for Stripe webhook signature verification
    bufferLogs: true,     // Buffer logs until Pino logger is ready
  });

  // ─── Use Pino as the NestJS logger ───────────────────────────────────────
  app.useLogger(app.get(Logger));

  // ─── Trust proxy (production behind Nginx/Caddy/ALB) ────────────────────
  app.set('trust proxy', 1);

  // ─── Security headers (Helmet) ────────────────────────────────────────────
  // Protects against XSS, clickjacking, MIME sniffing, etc.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],   // Swagger UI needs this
          scriptSrc: ["'self'", "'unsafe-inline'"],   // Swagger UI needs this
          imgSrc: ["'self'", 'data:', 'https:'],
        },
      },
      crossOriginEmbedderPolicy: false, // Required for Swagger UI
    }),
  );

  // ─── CORS ─────────────────────────────────────────────────────────────────
  app.enableCors(corsConfig);

  // ─── Global validation pipe ───────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,               // Strip unknown properties
      forbidNonWhitelisted: true,    // Throw 400 on unknown properties
      transform: true,               // Auto-transform to DTO types (string → number)
      transformOptions: { enableImplicitConversion: true },
      stopAtFirstError: false,       // Return ALL validation errors at once
    }),
  );

  // ─── Global prefix ────────────────────────────────────────────────────────
  app.setGlobalPrefix('api/v1', {
    exclude: ['/health', '/docs', '/queues(.*)'], // Don't prefix these
  });

  // ─── Swagger (dev/staging only) ───────────────────────────────────────────
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('NestJS Backend Template')
      .setDescription(
        'Production-ready NestJS template — Auth, Users, Chat, Products, Payments, Files, AI, Crypto, Scraping, Queue',
      )
      .setVersion('1.0')
      .addBearerAuth()
      .addTag('Auth')
      .addTag('Users')
      .addTag('Products')
      .addTag('Chat')
      .addTag('Payments')
      .addTag('Files')
      .addTag('Scraping')
      .addTag('OpenAI')
      .addTag('Crypto / Blockchain')
      .addTag('Health')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  const logger = app.get(Logger);
  logger.log(`🚀 Running: http://localhost:${port}/api/v1`);
  if (process.env.NODE_ENV !== 'production') {
    logger.log(`📚 Swagger: http://localhost:${port}/docs`);
    logger.log(`📊 Queues:  http://localhost:${port}/queues`);
  }
}

bootstrap();
