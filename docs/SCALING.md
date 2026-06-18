# Scaling Guide

From single-server to multi-region. Practical steps ordered by impact.

---

## Table of Contents

1. [Horizontal Scaling](#horizontal-scaling)
2. [Database Scaling](#database-scaling)
3. [Caching Strategy](#caching-strategy)
4. [Queue-Based Architecture](#queue-based-architecture)
5. [WebSocket Scaling](#websocket-scaling)
6. [Rate Limiting at Scale](#rate-limiting-at-scale)
7. [Observability](#observability)
8. [Monolith to Microservices Migration](#monolith-to-microservices)

---

## Horizontal Scaling

### Prerequisite: Make the App Stateless

Before adding instances, the app must be **stateless** — no data stored locally that another instance can't access.

| State | Wrong approach | Correct approach |
|---|---|---|
| Sessions | In-memory (express-session default) | Redis (`connect-redis`) |
| File uploads | Local disk (`./uploads`) | S3 or shared NFS |
| Rate limit counters | In-memory (`Map`) | Redis (`ThrottlerStorageRedisService`) |
| Socket rooms | Socket.io in-memory | Redis adapter (`@socket.io/redis-adapter`) |
| Cache | `Map` / `WeakMap` | Redis |
| Scheduled jobs | `@nestjs/schedule` on all instances | Run on ONE designated worker instance |

### PM2 Cluster Mode (Single Server, Multiple Cores)

Fastest way to use all CPU cores on a single machine.

```bash
npm install -g pm2

# pm2.config.js
module.exports = {
  apps: [{
    name: 'nest-api',
    script: 'dist/main.js',
    instances: 'max', // one process per CPU core
    exec_mode: 'cluster',
    max_memory_restart: '1G',
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000,
    },
  }],
};

pm2 start pm2.config.js --env production
pm2 monit # live monitoring
```

**Gotcha:** PM2 cluster uses Node.js `cluster` module — each process has its own memory. Redis is still required for shared state.

### Docker + Docker Compose (Single Server)

```yaml
# docker-compose.yml
version: '3.8'

services:
  api:
    build: .
    deploy:
      replicas: 4  # 4 API containers
    environment:
      - NODE_ENV=production
      - DATABASE_URL=${DATABASE_URL}
      - REDIS_URL=redis://redis:6379
    depends_on:
      - postgres
      - redis
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.api.rule=Host(`api.myapp.com`)"

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./certs:/etc/nginx/certs

  postgres:
    image: postgres:16
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    command: redis-server --requirepass ${REDIS_PASSWORD}

volumes:
  postgres_data:
```

### Nginx Load Balancer

```nginx
# nginx.conf
upstream api_cluster {
  least_conn; # least connections algorithm — better than round-robin for long requests

  server api_1:3000;
  server api_2:3000;
  server api_3:3000;
  server api_4:3000;

  keepalive 32; # keep connections warm
}

server {
  listen 443 ssl;
  server_name api.myapp.com;

  location / {
    proxy_pass http://api_cluster;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;     # for WebSocket
    proxy_set_header Connection "upgrade";      # for WebSocket
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    proxy_connect_timeout 60s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;
  }
}
```

### Kubernetes (Cloud Scale)

```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nest-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: nest-api
  template:
    spec:
      containers:
        - name: nest-api
          image: gcr.io/myproject/nest-api:v1.2.3
          resources:
            requests:
              cpu: "250m"    # 0.25 CPU cores — minimum guarantee
              memory: "256Mi"
            limits:
              cpu: "1000m"   # 1 CPU core — maximum
              memory: "512Mi"
          livenessProbe:
            httpGet:
              path: /health/live
              port: 3000
            initialDelaySeconds: 30
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /health/ready
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 5
```

```yaml
# k8s/hpa.yaml — Horizontal Pod Autoscaler
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: nest-api-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: nest-api
  minReplicas: 2
  maxReplicas: 20
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70  # scale up when avg CPU > 70%
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
```

### Caddy (Simpler HTTPS Alternative to Nginx)

```
# Caddyfile
api.myapp.com {
    reverse_proxy localhost:3001 localhost:3002 localhost:3003 localhost:3004 {
        lb_policy least_conn
    }
}
```

Caddy auto-provisions TLS certificates from Let's Encrypt.

---

## Database Scaling

### Connection Pooling

A NestJS app with 4 instances × 10 TypeORM connections = 40 DB connections. PostgreSQL handles ~100–200 connections efficiently. Beyond that, use PgBouncer.

```typescript
// TypeORM pool configuration
TypeOrmModule.forRoot({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  poolSize: 10,           // connections per app instance
  connectTimeoutMS: 5000,
  extra: {
    max: 10,              // max connections in pool
    min: 2,               // min idle connections
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  },
})
```

### PgBouncer (Connection Proxy Pooler)

PgBouncer sits between your app and PostgreSQL. Apps connect to PgBouncer (lightweight), PgBouncer maintains a small real connection pool to PostgreSQL.

```ini
# pgbouncer.ini
[databases]
myapp = host=localhost port=5432 dbname=myapp

[pgbouncer]
listen_port = 5432
listen_addr = *
auth_type = md5
auth_file = /etc/pgbouncer/userlist.txt

pool_mode = transaction    # recommended for most NestJS/TypeORM apps
max_client_conn = 1000     # app connections to PgBouncer
default_pool_size = 25     # actual PostgreSQL connections
```

With PgBouncer: 1000 app connections → 25 PostgreSQL connections. Supports thousands of concurrent API instances.

**Gotcha:** `transaction` pool mode is incompatible with `SET` statements, advisory locks, and named prepared statements. Use `session` mode if you need these.

### Read Replicas (TypeORM)

```typescript
TypeOrmModule.forRoot({
  type: 'postgres',
  replication: {
    master: { url: process.env.DATABASE_PRIMARY_URL },
    slaves: [
      { url: process.env.DATABASE_REPLICA_1_URL },
      { url: process.env.DATABASE_REPLICA_2_URL },
    ],
  },
  // TypeORM automatically routes reads to replicas, writes to master
})
```

**Replication lag:** replicas may be 10ms–1s behind master. If you write then immediately read, always read from master:

```typescript
// Force read from master
const user = await this.userRepo.findOne({
  where: { id },
  // TypeORM uses { replicationMode: 'master' } in findOptions
});
```

### Indexes

PostgreSQL uses B-tree indexes by default.

```typescript
// TypeORM index decorators
@Entity('users')
@Index(['email'])           // single column
@Index(['firstName', 'lastName']) // composite
export class User {
  @Column()
  email: string;

  @Column({ nullable: true })
  @Index() // on column directly
  stripeCustomerId: string;

  // GIN index for full-text search
  @Column('tsvector', { nullable: true })
  searchVector: string;
}
```

```typescript
// In migration: create GIN index for text search
await queryRunner.query(`
  CREATE INDEX users_search_idx ON users USING gin(search_vector);
  CREATE INDEX messages_content_idx ON messages USING gin(to_tsvector('english', content));
`);
```

| Index Type | Use For | When to Use |
|---|---|---|
| B-tree (default) | Equality, range queries | Most columns |
| GIN | Full-text search, arrays, JSONB | Text search, tags |
| GiST | Geometric, range types | Geo queries, IP ranges |
| BRIN | Time-series, sequential data | Timestamp on large tables, very cheap |
| Hash | Equality only (exact match) | Rarely better than B-tree in Postgres |

### N+1 Query Problem

Occurs when loading a list of entities and then loading a relation for each one separately.

**Detection:** enable TypeORM logging in development:

```typescript
TypeOrmModule.forRoot({
  logging: process.env.NODE_ENV === 'development',
  logger: 'advanced-console',
})
```

If you see 51 queries when fetching 50 posts (1 for posts + 50 for authors) — that's N+1.

**Fix: eager loading**

```typescript
// BAD — N+1
const posts = await this.postRepo.find();
for (const post of posts) {
  post.author = await this.userRepo.findById(post.authorId); // 1 query each
}

// GOOD — 2 queries total (1 for posts + 1 JOIN for authors)
const posts = await this.postRepo.find({ relations: ['author'] });

// BETTER — QueryBuilder for complex joins
const posts = await this.postRepo
  .createQueryBuilder('post')
  .leftJoinAndSelect('post.author', 'author')
  .leftJoinAndSelect('post.tags', 'tag')
  .where('post.published = true')
  .getMany();
```

**For GraphQL:** use DataLoader to batch and deduplicate queries per request.

### Query Optimization

```sql
-- Use EXPLAIN ANALYZE to understand query performance
EXPLAIN ANALYZE SELECT * FROM users WHERE email = 'test@example.com';

-- Look for:
-- "Seq Scan" on large tables → needs an index
-- "Nested Loop" with large row counts → consider a HASH JOIN
-- High "rows" vs low "actual rows" → stale statistics, run ANALYZE
```

---

## Caching Strategy

### Three Layers

```
Request
  │
  L1: In-process Map (microseconds)
  │   Hit → return immediately
  │   Miss ↓
  L2: Redis (< 1ms, shared across instances)
  │   Hit → return, optionally backfill L1
  │   Miss ↓
  L3: Database / External API (milliseconds–seconds)
      → store result in Redis, return
```

### L1: In-Process Cache

```typescript
// Best for: feature flags, app config, rarely-changing lookup tables
@Injectable()
export class L1CacheService {
  private store = new Map<string, { value: unknown; expiresAt: number }>();

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set(key: string, value: unknown, ttlMs = 60000): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }
}
```

**Gotcha:** L1 is per-instance and lost on restart. Never use for data that changes across instances.

### L2: Redis Cache

```typescript
// cache.service.ts
@Injectable()
export class CacheService {
  constructor(@InjectRedis() private redis: Redis) {}

  async get<T>(key: string): Promise<T | null> {
    const value = await this.redis.get(key);
    return value ? JSON.parse(value) : null;
  }

  async set(key: string, value: unknown, ttlSeconds = 300): Promise<void> {
    await this.redis.setex(key, ttlSeconds, JSON.stringify(value));
  }

  async invalidate(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async invalidatePattern(pattern: string): Promise<void> {
    // e.g., invalidate all user cache: pattern = 'user:*'
    const keys = await this.redis.keys(pattern);
    if (keys.length) await this.redis.del(...keys);
  }
}
```

### Cache Invalidation Patterns

| Pattern | How | When to Use |
|---|---|---|
| TTL (Time-To-Live) | Set expiry on write | Acceptable stale window (prices, public data) |
| Write-through | Update cache on every write | Strong consistency needed |
| Write-behind (async) | Queue cache update after write | High write volume, eventual consistency OK |
| Event-based | Emit event on write → invalidate cache | Best for complex dependency graphs |

```typescript
// Event-based invalidation example
async updateUser(id: string, data: UpdateUserDto): Promise<User> {
  const user = await this.usersRepo.update(id, data);

  // Invalidate all related cache keys
  await this.cacheService.invalidate(`user:${id}`);
  await this.cacheService.invalidate(`user:email:${user.email}`);
  await this.cacheService.invalidatePattern(`users:list:*`); // all paginated lists

  return user;
}
```

### Cache Stampede Prevention

When a popular cache key expires, thousands of simultaneous requests all miss cache and hit the DB simultaneously.

```typescript
// Mutex pattern: only one request rebuilds the cache
async getWithLock<T>(
  key: string,
  factory: () => Promise<T>,
  ttl = 300,
): Promise<T> {
  // Try cache first
  const cached = await this.get<T>(key);
  if (cached !== null) return cached;

  // Try to acquire lock
  const lockKey = `lock:${key}`;
  const acquired = await this.redis.set(lockKey, '1', 'NX', 'EX', 10);

  if (acquired) {
    try {
      const value = await factory();
      await this.set(key, value, ttl);
      return value;
    } finally {
      await this.redis.del(lockKey);
    }
  } else {
    // Another instance is rebuilding — wait and retry
    await new Promise(resolve => setTimeout(resolve, 50));
    return this.getWithLock(key, factory, ttl); // retry
  }
}
```

---

## Queue-Based Architecture

Move all heavy operations off the request thread. See [queue/README.md](../src/modules/queue/README.md) for setup.

### Worker vs API Instance Scaling

```yaml
# Scale them independently
docker-compose scale api=4 email-worker=2 scraping-worker=1
```

---

## WebSocket Scaling

See [realtime/README.md](../src/modules/realtime/README.md) for the Redis adapter setup.

### The Problem Visualized

```
Without Redis adapter:
  Instance 1: User A (socket connected)
  Instance 2: User B (socket connected)

  User A sends message → Instance 1 emits to room → User B never receives it

With Redis adapter:
  Instance 1: User A (socket connected)
  Instance 2: User B (socket connected)

  User A sends message → Instance 1 emits to room
    → Redis pub/sub broadcasts to all instances
    → Instance 2 delivers to User B ✓
```

---

## Rate Limiting at Scale

### The Problem with In-Memory ThrottlerGuard

`@nestjs/throttler` default storage is in-memory. In a 4-instance deployment, each instance counts independently — users get 4× the configured limit.

### Solution: Redis-Backed Rate Limiting

```bash
npm install @nestjs-throttler-storage-redis
```

```typescript
// app.module.ts
import { ThrottlerStorageRedisService } from '@nestjs-throttler-storage-redis';

ThrottlerModule.forRootAsync({
  useFactory: (configService: ConfigService) => ({
    throttlers: [
      { name: 'global', ttl: 60000, limit: 100 },  // 100 req/min
      { name: 'login', ttl: 60000, limit: 5 },      // 5 login/min
    ],
    storage: new ThrottlerStorageRedisService(
      new Redis({
        host: configService.get('REDIS_HOST'),
        port: configService.get<number>('REDIS_PORT'),
      })
    ),
  }),
  inject: [ConfigService],
}),
```

```typescript
// Different limits per endpoint
@Controller('auth')
export class AuthController {
  @Throttle({ login: { limit: 5, ttl: 60000 } })  // 5/min
  @Post('login')
  login() { ... }

  @Throttle({ global: { limit: 3, ttl: 3600000 } }) // 3/hour
  @Post('forgot-password')
  forgotPassword() { ... }
}
```

---

## Observability

Non-negotiable at scale. You can't optimize what you can't measure.

### Structured Logging with Pino

JSON logs go to stdout → collected by log aggregator.

```typescript
// logger.module.ts — Pino (current)
import { Logger } from 'nestjs-pino';

// Instead of:
this.logger.log('User created', { userId: user.id });

// Use structured fields:
this.logger.log({ msg: 'User created', userId: user.id, email: user.email });

// Result (JSON):
// {"level":"info","time":1706000000000,"pid":1,"msg":"User created","userId":"uuid","email":"..."}
```

### Log Aggregation

| Stack | Pros | Cons | Cost |
|---|---|---|---|
| ELK (Elasticsearch + Logstash + Kibana) | Powerful search, dashboards | Complex to operate | Self-hosted + compute cost |
| Loki + Grafana | Lightweight, label-based (no full-text index) | Less powerful search | Cheaper |
| Datadog | Managed, integrated with APM | Expensive | $$$ |
| Papertrail | Simple, good DX | Limited retention | $ |
| Logtail (Better Stack) | Modern, affordable, good DX | Newer | $ |

### Metrics: Prometheus + Grafana

```bash
npm install @willsoto/nestjs-prometheus prom-client
```

```typescript
// app.module.ts
import { PrometheusModule } from '@willsoto/nestjs-prometheus';

PrometheusModule.register({
  path: '/metrics', // scrape endpoint for Prometheus
  defaultMetrics: { enabled: true }, // Node.js process metrics
}),
```

```typescript
// Custom metrics
import { Counter, Histogram } from 'prom-client';

@Injectable()
export class MetricsService {
  private httpRequestTotal = new Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests',
    labelNames: ['method', 'route', 'status'],
  });

  private httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration',
    labelNames: ['method', 'route'],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
  });

  recordRequest(method: string, route: string, status: number, duration: number) {
    this.httpRequestTotal.labels(method, route, status.toString()).inc();
    this.httpDuration.labels(method, route).observe(duration);
  }
}
```

**Key metrics to track:** request rate (RPS), error rate, p50/p95/p99 latency, DB query time, queue depth, cache hit ratio.

### Health Checks for Kubernetes

Kubernetes uses two probes:
- **Liveness:** is the app alive? Fail → restart pod
- **Readiness:** is the app ready to receive traffic? Fail → remove from load balancer (not killed)

```typescript
// health.controller.ts
@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private db: TypeOrmHealthIndicator,
    private redis: MicroserviceHealthIndicator,
  ) {}

  // Liveness: is process alive? Only check in-process state.
  @Get('live')
  liveness() {
    return { status: 'ok' };
  }

  // Readiness: can we serve traffic? Check dependencies.
  @Get('ready')
  @HealthCheck()
  readiness() {
    return this.health.check([
      () => this.db.pingCheck('database'),
      () => this.redis.pingCheck('redis'),
    ]);
  }
}
```

### Alerting

Set up alerts for:
- Error rate > 1% (5xx responses)
- p99 latency > 2 seconds
- Queue depth > 1000 jobs
- DB connection pool exhausted
- Redis memory > 80%

Tools: PagerDuty (enterprise), OpsGenie, Grafana Alerting, or simple webhook to Slack.

---

## Monolith to Microservices

### Start as a Modular Monolith (Current Architecture)

This template is a **modular monolith** — the right starting point for most apps.

Why NOT to split prematurely:
- Distributed systems have 8 fallacies: network is not reliable, latency is not zero, bandwidth is infinite, etc.
- Each service boundary needs: separate CI/CD, separate testing, network calls, distributed tracing
- 5 microservices = 5× the infrastructure cost, 5× the deployment complexity

**Rule of thumb:** split when a module's scaling needs differ significantly, team size makes a monolith's codebase hard to own, or you need independent deployments.

### Module Boundaries = Future Service Boundaries

```
Current (monolith):
  ┌─────────────────────────────────────┐
  │         nest-backend-template       │
  │ ┌───────┐ ┌──────┐ ┌─────────────┐ │
  │ │ auth  │ │users │ │  payments   │ │
  │ └───────┘ └──────┘ └─────────────┘ │
  │ ┌────────┐ ┌──────┐ ┌──────────┐  │
  │ │ queue  │ │ files│ │realtime  │  │
  │ └────────┘ └──────┘ └──────────┘  │
  └─────────────────────────────────────┘

Future (if needed):
  ┌──────────┐   ┌──────────┐   ┌──────────┐
  │ auth-svc │   │ user-svc │   │payment-svc│
  └──────────┘   └──────────┘   └──────────┘
       │               │               │
       └───────────────┴───────────────┘
                       │
                  Message Broker
                  (RabbitMQ / Kafka)
```

### NestJS Microservices Transport Options

```typescript
// @nestjs/microservices supports multiple transports
// Switch without changing service logic

// Redis transport (simplest, already have Redis)
app.connectMicroservice<MicroserviceOptions>({
  transport: Transport.REDIS,
  options: { host: 'localhost', port: 6379 },
});

// RabbitMQ (durable queues, enterprise messaging)
app.connectMicroservice<MicroserviceOptions>({
  transport: Transport.RMQ,
  options: {
    urls: ['amqp://localhost:5672'],
    queue: 'auth_queue',
    queueOptions: { durable: true },
  },
});

// gRPC (high-performance, binary protocol, streaming)
app.connectMicroservice<MicroserviceOptions>({
  transport: Transport.GRPC,
  options: {
    protoPath: join(__dirname, 'auth.proto'),
    package: 'auth',
  },
});
```

### In-Process Event Bus (Pre-Split)

Use `@nestjs/event-emitter` for in-process events that will later become cross-service events.

```typescript
// user-created.event.ts
export class UserCreatedEvent {
  constructor(public readonly userId: string, public readonly email: string) {}
}

// users.service.ts
async create(dto: CreateUserDto): Promise<User> {
  const user = await this.usersRepo.create(dto);
  this.eventEmitter.emit('user.created', new UserCreatedEvent(user.id, user.email));
  return user;
}

// email.listener.ts — decoupled, in-process today, microservice tomorrow
@OnEvent('user.created')
async onUserCreated(event: UserCreatedEvent) {
  await this.emailQueue.add('welcome', { userId: event.userId });
}
```

When splitting auth into its own service, replace `eventEmitter.emit` with a message broker publish — the listener code stays the same.
