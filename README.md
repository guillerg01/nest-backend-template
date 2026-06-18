# NestJS Backend Template

Production-ready NestJS monolith — copy this, tell me your business domain, and we ship the right architecture fast.

Built from real production codebases. Every pattern has been battle-tested.

---

## What's Inside

| Layer | What | Why |
|-------|------|-----|
| Framework | NestJS 11 + TypeScript | Structured, scalable, great DX |
| Database | PostgreSQL + TypeORM | Relational data, ACID, production default |
| Cache | Redis + cache-manager | Shared cache across instances |
| Queue | BullMQ + Bull Board UI | Async work, never block request threads |
| Auth | JWT + Passport + Google OAuth | Industry standard |
| Realtime | Socket.io — 2 gateways | Chat (persistent) + general events |
| Payments | Stripe — subscriptions + webhooks | Correct raw-body handling |
| Files | AWS S3 — presigned URLs | Client-direct upload pattern |
| Email | Nodemailer — SMTP | See alternatives/ for SendGrid/Resend |
| AI | OpenAI — chat, stream, vision, TTS | Full API coverage |
| Crypto | AES-256-GCM + blockchain read | Encryption utilities + price/balance |
| Scraping | Cheerio + Playwright | Static + JS-rendered pages |
| Error tracking | Sentry | Exception capture + performance |
| Logging | Pino (nestjs-pino) | 10x faster than Winston, JSON output |
| Security | Helmet + @nestjs/throttler | Headers + rate limiting |
| Tracing | Correlation ID middleware | Every request gets x-correlation-id |
| Health | @nestjs/terminus | DB + memory checks |
| Docs | Swagger at `/docs` | Auto-generated from decorators |
| Infra | Docker Compose | Postgres + Redis + app |

---

## Quick Start

```bash
# 1. Clone and install
cp -r nest-backend-template my-backend && cd my-backend
npm install

# 2. Environment
cp env.example .env
# Fill in: DB_*, JWT_SECRET, JWT_REFRESH_SECRET (minimum to start)

# 3. Start infrastructure
docker compose up postgres redis -d

# 4. Run dev
npm run start:dev

# API:    http://localhost:3000/api/v1
# Docs:   http://localhost:3000/docs
# Queues: http://localhost:3000/queues
```

---

## Modules

| Module | Path | What it demonstrates |
|--------|------|----------------------|
| `auth` | `/api/v1/auth` | JWT login, register, Google OAuth, refresh, forgot/reset password |
| `users` | `/api/v1/users` | CRUD pattern, BaseRepository, CrudService, @CurrentUser |
| `products` | `/api/v1/products` | **Copy this for any new domain entity** — slug, search, owner filter, stock |
| `chat` | `/api/v1/chat` + WS `/chat` | Full chat: rooms, messages, typing, read receipts, history pagination |
| `realtime` | WS `/realtime` | General-purpose broadcast gateway |
| `payments` | `/api/v1/payments` | Stripe subscriptions + one-time + webhook + refund |
| `files` | `/api/v1/files` | S3 upload (single/batch), presigned URLs |
| `openai` | `/api/v1/openai` | Chat, streaming SSE, image gen, transcription, TTS, moderation |
| `crypto` | `/api/v1/crypto` | AES-256-GCM encrypt, HMAC sign, EVM/Solana balance, price data |
| `scraping` | `/api/v1/scraping` | Cheerio fetch, table extract, Playwright for JS pages |
| `queue` | internal | BullMQ — email, AI, scraping, export queues |
| `sentry` | internal | Error + performance tracking |
| `health` | `/health` | DB + memory health |
| `notifications` | internal | Email service (inject from other modules) |
| `security` | internal | Role, Permission, AuditLog entities |

> Each module has its own `README.md` with all use cases, examples, and gotchas.

---

## Architecture

### The Pattern Every Module Follows

```
Request → Controller (HTTP/WS) → Service (business logic) → Repository (DB) → Entity
                                      ↓
                               DTOs wrap all responses — never return raw entities
```

### Adding a New Module (6 steps, ~15 minutes)

**1. Entity** — extends BaseEntity (gets UUID, timestamps, soft delete for free)

```typescript
@Entity('orders')
export class OrderEntity extends BaseEntity {
  @Column() total: number;
  @Column({ name: 'user_id' }) userId: string;
  @Column({ type: 'enum', enum: OrderStatus }) status: OrderStatus;
}
```

**2. DTO** — response shape + creation/update inputs

```typescript
export class OrderDto extends BaseDto {
  total: number;
  status: OrderStatus;
  fromEntity(e: any): this {
    super.fromEntity(e);
    this.total = Number(e.total);
    this.status = e.status;
    return this;
  }
}
export class CreateOrderDto { @IsNumber() total: number; }
```

**3. Repository** — extends BaseRepository (gets CRUD + pagination for free)

```typescript
@Injectable()
export class OrderRepository extends BaseRepository<OrderEntity> {
  constructor(@InjectRepository(OrderEntity) repo: Repository<OrderEntity>) { super(repo); }
  // Custom queries go here
}
```

**4. Service** — extends CrudService

```typescript
@Injectable()
export class OrdersService extends CrudService<OrderEntity, OrderDto, OrderRepository> {
  constructor(repo: OrderRepository) { super(repo, OrderDto); }
  // Override or add methods
}
```

**5. Controller**

```typescript
@ApiTags('Orders') @ApiBearerAuth() @Controller('orders')
export class OrdersController {
  constructor(private readonly service: OrdersService) {}
  @Get() findAll(@Query() p: PaginationDto) { return this.service.findAll(p); }
  @Post() create(@Body() dto: CreateOrderDto) { return this.service.create(dto); }
  @Patch(':id') update(@Param('id') id: string, @Body() dto: any) { return this.service.update(id, dto); }
  @Delete(':id') remove(@Param('id') id: string) { return this.service.remove(id); }
}
```

**6. Module** → add to `app.module.ts` imports

```typescript
@Module({ imports: [TypeOrmModule.forFeature([OrderEntity])], providers: [OrderRepository, OrdersService], controllers: [OrdersController], exports: [OrdersService] })
export class OrdersModule {}
```

---

## Response Shape

Every response is automatically wrapped:

```json
{ "success": true, "data": { ... }, "timestamp": "...", "path": "/api/v1/..." }
```

Errors:

```json
{ "success": false, "statusCode": 404, "message": "Resource with id x not found", "timestamp": "..." }
```

---

## Request Tracing

Every request gets a `x-correlation-id` header (from client or auto-generated). It's attached to every Pino log line — lets you trace a request across all logs.

```typescript
// In Pino logs, every line includes:
{ "correlationId": "abc-123", "requestId": "xyz-456", "msg": "..." }
```

---

## Guards & Decorators

Applied globally in `app.module.ts`. Use decorators to control access:

```typescript
@Public()                          // Skip JWT entirely — for login, register, public APIs
@Roles('admin')                    // Role check
@Permissions('products.delete')    // Permission check (granular)
@Throttle({ short: { limit: 3, ttl: 60000 } })  // Override rate limit per-route
@CurrentUser()                     // Inject full user object
@CurrentUser('id')                 // Inject just the ID (string)
```

---

## Chat (WebSocket)

Connect from frontend:

```typescript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000/chat', {
  auth: { token: 'your_jwt_access_token' }
});

// Get or create a direct room with another user (REST first)
const { data: room } = await fetch('/api/v1/chat/rooms/direct', {
  method: 'POST', headers: { Authorization: 'Bearer ...' },
  body: JSON.stringify({ targetUserId: 'user-uuid' })
});

// Join the room socket channel
socket.emit('join_room', { roomId: room.id });

// Send a message
socket.emit('send_message', { roomId: room.id, content: 'Hello!' });

// Listen for new messages
socket.on('new_message', (message) => console.log(message));

// Typing indicators
socket.emit('typing', { roomId: room.id, isTyping: true });
socket.on('typing', ({ userId, isTyping }) => { /* update UI */ });

// Read receipts
socket.emit('mark_read', { roomId: room.id });
socket.on('read_receipt', ({ userId, readAt }) => { /* update UI */ });

// Load history (cursor-based)
socket.emit('get_history', { roomId: room.id, limit: 50 });
socket.on('history', ({ messages }) => { /* populate UI */ });
// Load older: socket.emit('get_history', { roomId, cursorId: messages[0].id })
```

> **Scaling chat to multiple instances?** Add `@socket.io/redis-adapter`. See `src/modules/chat/README.md`.

---

## Queues (BullMQ)

Never process heavy work in the request cycle. Inject `QueueService` and enqueue:

```typescript
constructor(private readonly queue: QueueService) {}

// Send email async (non-blocking)
await this.queue.sendEmail({ to: 'user@example.com', subject: 'Welcome!', html: '...' });

// Scrape a URL
await this.queue.enqueueScraping({ url: 'https://example.com', targetId: 'product-123' });

// AI processing (embeddings, summaries)
await this.queue.enqueueAiTask({ type: 'embed', input: 'text to embed', targetId: 'doc-123' });

// Export (heavy PDF/CSV generation)
await this.queue.enqueueExport({ userId, format: 'pdf', filters: {}, notifyEmail: 'user@...' });
```

Monitor all queues at: `http://localhost:3000/queues` (protect this route in production)

---

## Stripe Integration

```typescript
// Create checkout session (returns URL)
POST /api/v1/payments/checkout/subscription
{ "priceId": "price_xxx" }

// Webhook: POST /api/v1/payments/stripe/webhook (raw body, @Public)
// Test locally: stripe listen --forward-to localhost:3000/api/v1/payments/stripe/webhook
```

---

## OpenAI

```typescript
// Chat (single turn)
POST /api/v1/openai/chat
{ "message": "What is TypeScript?", "systemPrompt": "You are a senior dev." }

// Streaming (SSE — connect via EventSource in frontend)
POST /api/v1/openai/chat/stream

// Image generation
POST /api/v1/openai/image/generate
{ "prompt": "A futuristic city at sunset" }

// Audio transcription (Whisper) — multipart/form-data
POST /api/v1/openai/transcribe
```

---

## File Upload (S3)

```typescript
// Upload file (multipart/form-data, field: 'file')
POST /api/v1/files/upload?folder=avatars

// Upload multiple
POST /api/v1/files/upload/many

// Get presigned download URL (for private files)
GET /api/v1/files/:key/url?expiresIn=3600
```

---

## Environment Variables

Validated at startup with Joi — app **won't start** if required vars are missing.

| Variable | Required | Default |
|----------|----------|---------|
| `JWT_SECRET` | Yes | — |
| `JWT_REFRESH_SECRET` | Yes | — |
| `DB_HOST` | Yes | — |
| `DB_USER` | Yes | — |
| `DB_PASSWORD` | Yes | — |
| `DB_NAME` | Yes | — |
| `DB_SYNC` | No | `false` (use `true` in dev only) |
| `REDIS_HOST` | No | `localhost` |
| `STRIPE_SECRET_KEY` | No | — (payments disabled without it) |
| `OPENAI_API_KEY` | No | — (AI disabled without it) |
| `AWS_S3_BUCKET` | No | — (file upload disabled without it) |
| `SENTRY_DSN` | No | — (Sentry disabled if empty) |

---

## Database Migrations (Production)

```bash
# 1. Set DB_SYNC=false in .env (never synchronize in production)
# 2. Generate migration from entity changes
npm run m:gen -- src/migrations/AddOrdersTable

# 3. Review the generated migration file

# 4. Run migrations
npm run m:run

# 5. Rollback if needed
npm run m:revert
```

---

## Scaling

See `docs/SCALING.md` for the full guide. TL;DR:

1. **Stateless**: App stores no local state → scale horizontally with PM2 cluster or k8s
2. **Sessions in Redis**: Not in memory or DB
3. **Queues**: Workers can scale independently from API instances
4. **WebSockets**: Add `@socket.io/redis-adapter` before scaling to 2+ instances
5. **Rate limiting**: Replace in-memory ThrottlerStorage with `ThrottlerStorageRedisService` before scaling
6. **Database**: Add read replicas for read-heavy workloads, PgBouncer for connection pooling

---

## Module READMEs

Each module has its own `README.md`:

- `src/modules/auth/README.md` — JWT, OAuth, 2FA, sessions, magic link
- `src/modules/users/README.md` — CRUD, pagination, roles
- `src/modules/chat/README.md` — WebSocket chat, scaling, Redis adapter
- `src/modules/payments/README.md` — Stripe, webhooks, MercadoPago, PayPal
- `src/modules/notifications/README.md` — Nodemailer, SendGrid, Resend, Mailgun, Twilio SMS
- `src/modules/files/README.md` — S3, Cloudinary, local disk, MinIO
- `src/modules/openai/README.md` — Full API, RAG, streaming, alternatives
- `src/modules/crypto/README.md` — Built-in crypto, ethers.js, viem, Solana
- `src/modules/queue/README.md` — BullMQ, Bull Board, Agenda, SQS
- `src/modules/scraping/README.md` — Cheerio, Playwright, proxies, anti-detection
- `src/modules/sentry/README.md` — Setup, alternatives, when to use
- `docs/SCALING.md` — Full horizontal + vertical scaling guide
- `docs/DATABASES.md` — PostgreSQL, MongoDB, Prisma, MySQL, DynamoDB alternatives
