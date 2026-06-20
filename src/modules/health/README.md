# Health Module

Liveness + readiness probe for deployment platforms (Render, Railway, Fly.io, Kubernetes).

## Endpoint

```
GET /health
```

No authentication required (`@Public()`).

## Response

```json
{
  "status": "ok",
  "info": {
    "database": { "status": "up" },
    "redis": { "status": "up" },
    "memory_heap": { "status": "up" },
    "memory_rss": { "status": "up" }
  },
  "error": {},
  "details": { ... }
}
```

Returns `200 OK` when all checks pass. Returns `503 Service Unavailable` when any check fails.

## Checks

| Check | Indicator | Threshold |
|-------|-----------|-----------|
| `database` | `TypeOrmHealthIndicator.pingCheck` | Responds to query |
| `redis` | `RedisHealthIndicator` (custom) | `SET` + `DEL` roundtrip |
| `memory_heap` | `MemoryHealthIndicator.checkHeap` | < 512 MB |
| `memory_rss` | `MemoryHealthIndicator.checkRSS` | < 512 MB |

## Redis indicator

Uses `CACHE_MANAGER` to do a `SET`/`DEL` roundtrip. Falls back gracefully — if Redis is not configured (no `REDIS_HOST`), the app starts in in-memory cache mode and the ping uses that store instead.

## Adjusting thresholds

Edit `health.controller.ts`:

```ts
() => this.memory.checkHeap('memory_heap', 1024 * 1024 * 1024), // 1GB
```

## Render / Railway health check path

Set the health check URL to `/health` in your service settings. Render expects a `200` response within 30 seconds. If your app takes longer to cold-start, extend the startup grace period in `render.yaml`:

```yaml
healthCheckPath: /health
```

## Adding custom checks

```ts
// 1. Create an indicator
@Injectable()
class S3HealthIndicator extends HealthIndicator {
  constructor(private readonly s3: S3Service) { super(); }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      await this.s3.list('__health__', 1);
      return this.getStatus(key, true);
    } catch {
      throw new HealthCheckError('S3 check failed', this.getStatus(key, false));
    }
  }
}

// 2. Add to HealthModule providers
// 3. Inject in HealthController and add to check() array
```
