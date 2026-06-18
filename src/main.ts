import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { corsConfig } from './config/cors.config';

const LANDING_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>NestJS Backend Template</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f0f13;
      color: #e2e8f0;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2rem;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(99,102,241,0.15);
      border: 1px solid rgba(99,102,241,0.3);
      color: #a5b4fc;
      padding: 4px 12px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      margin-bottom: 1.5rem;
    }
    h1 {
      font-size: clamp(2rem, 5vw, 3.5rem);
      font-weight: 800;
      background: linear-gradient(135deg, #e2e8f0 0%, #a5b4fc 50%, #818cf8 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      text-align: center;
      line-height: 1.15;
      margin-bottom: 1rem;
    }
    p.subtitle {
      color: #94a3b8;
      font-size: 1.125rem;
      text-align: center;
      max-width: 560px;
      line-height: 1.7;
      margin-bottom: 2.5rem;
    }
    .actions {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      justify-content: center;
      margin-bottom: 3rem;
    }
    a.btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 12px 24px;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 600;
      text-decoration: none;
      transition: all 0.15s ease;
      cursor: pointer;
    }
    a.btn-primary {
      background: linear-gradient(135deg, #6366f1, #818cf8);
      color: #fff;
      box-shadow: 0 4px 15px rgba(99,102,241,0.35);
    }
    a.btn-primary:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(99,102,241,0.45); }
    a.btn-secondary {
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.1);
      color: #cbd5e1;
    }
    a.btn-secondary:hover { background: rgba(255,255,255,0.1); }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 12px;
      max-width: 860px;
      width: 100%;
      margin-bottom: 3rem;
    }
    .card {
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 12px;
      padding: 16px 18px;
      transition: border-color 0.15s;
    }
    .card:hover { border-color: rgba(99,102,241,0.4); }
    .card-icon { font-size: 1.4rem; margin-bottom: 6px; }
    .card-title { font-size: 13px; font-weight: 700; color: #e2e8f0; margin-bottom: 3px; }
    .card-desc { font-size: 12px; color: #64748b; line-height: 1.5; }
    .stack {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: center;
      max-width: 700px;
    }
    .tag {
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.08);
      color: #94a3b8;
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 500;
    }
    .divider {
      width: 100%;
      max-width: 860px;
      border: none;
      border-top: 1px solid rgba(255,255,255,0.06);
      margin: 2rem 0;
    }
    footer { color: #334155; font-size: 12px; }
  </style>
</head>
<body>
  <div class="badge">&#9679; Production Ready</div>

  <h1>NestJS Backend<br/>Template</h1>

  <p class="subtitle">
    Full-stack NestJS 11 starter with auth, payments, real-time, queues, AI,
    file uploads, crypto, scraping, and observability — ready to clone and ship.
  </p>

  <div class="actions">
    <a class="btn btn-primary" href="/docs">&#128196; API Docs (Swagger)</a>
    <a class="btn btn-secondary" href="/health">&#10003; Health Check</a>
    <a class="btn btn-secondary" href="https://github.com/guillerg01/nest-backend-template" target="_blank">&#128279; GitHub</a>
  </div>

  <div class="grid">
    <div class="card">
      <div class="card-icon">&#128274;</div>
      <div class="card-title">Auth</div>
      <div class="card-desc">JWT + Refresh tokens, Google OAuth, bcrypt, 2FA ready</div>
    </div>
    <div class="card">
      <div class="card-icon">&#128179;</div>
      <div class="card-title">Payments</div>
      <div class="card-desc">Stripe, MercadoPago, Redsys, Bizum, OxaPay, Payop + 4 more</div>
    </div>
    <div class="card">
      <div class="card-icon">&#9889;</div>
      <div class="card-title">Real-time</div>
      <div class="card-desc">Socket.io gateways — chat rooms + generic pubsub</div>
    </div>
    <div class="card">
      <div class="card-icon">&#128200;</div>
      <div class="card-title">Queue</div>
      <div class="card-desc">BullMQ workers — email, AI, scraping, export jobs</div>
    </div>
    <div class="card">
      <div class="card-icon">&#129302;</div>
      <div class="card-title">OpenAI</div>
      <div class="card-desc">Chat completions, embeddings, Whisper, TTS, image gen</div>
    </div>
    <div class="card">
      <div class="card-icon">&#128230;</div>
      <div class="card-title">File Uploads</div>
      <div class="card-desc">AWS S3 — upload, presigned URLs, delete</div>
    </div>
    <div class="card">
      <div class="card-icon">&#128296;</div>
      <div class="card-title">Scraping</div>
      <div class="card-desc">Cheerio + Playwright — static & SPA scraping</div>
    </div>
    <div class="card">
      <div class="card-icon">&#128373;</div>
      <div class="card-title">Crypto</div>
      <div class="card-desc">AES-256-GCM, RSA, HMAC, blockchain reads, price feeds</div>
    </div>
    <div class="card">
      <div class="card-icon">&#128202;</div>
      <div class="card-title">Observability</div>
      <div class="card-desc">Pino structured logs, Sentry errors, health checks</div>
    </div>
  </div>

  <hr class="divider" />

  <div class="stack">
    <span class="tag">NestJS 11</span>
    <span class="tag">TypeScript 5</span>
    <span class="tag">TypeORM 0.3</span>
    <span class="tag">PostgreSQL</span>
    <span class="tag">Redis</span>
    <span class="tag">BullMQ v5</span>
    <span class="tag">Socket.io</span>
    <span class="tag">Passport JWT</span>
    <span class="tag">Swagger</span>
    <span class="tag">Pino</span>
    <span class="tag">Sentry</span>
    <span class="tag">Docker</span>
    <span class="tag">GitHub Actions</span>
    <span class="tag">Render</span>
  </div>

  <hr class="divider" />
  <footer>MIT License &mdash; guillerg01/nest-backend-template</footer>
</body>
</html>`;

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.enableCors(corsConfig);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      stopAtFirstError: false,
    }),
  );

  // ─── Landing page at / ────────────────────────────────────────────────────
  const httpAdapter = app.getHttpAdapter();
  httpAdapter.get('/', (_req: any, res: any) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(LANDING_HTML);
  });

  app.setGlobalPrefix('api/v1', {
    exclude: ['/', '/health', '/docs'],
  });

  // ─── Swagger (always enabled — this is a template) ───────────────────────
  const swaggerConfig = new DocumentBuilder()
    .setTitle('NestJS Backend Template')
    .setDescription(
      'Production-ready NestJS 11 template — Auth, Users, Chat, Products, Payments, Files, AI, Crypto, Scraping, Queue',
    )
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'JWT')
    .addTag('Auth', 'Register, login, refresh token, OAuth')
    .addTag('Users', 'CRUD + profile management')
    .addTag('Products', 'Catalog with slugs, search, pagination')
    .addTag('Chat', 'Rooms + message history')
    .addTag('Payments', 'Stripe subscriptions + webhooks')
    .addTag('Files', 'S3 upload + presigned URLs')
    .addTag('Scraping', 'Cheerio + Playwright')
    .addTag('OpenAI', 'Chat, embeddings, Whisper, TTS, images')
    .addTag('Crypto / Blockchain', 'Encrypt, sign, blockchain reads')
    .addTag('Health', 'Liveness + readiness probes')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
    customSiteTitle: 'NestJS Template API',
  });

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  const logger = app.get(Logger);
  logger.log(`Running on http://localhost:${port}`);
  logger.log(`Swagger: http://localhost:${port}/docs`);
}

bootstrap();
