# Sentry Module

Error tracking, performance monitoring, source maps, and alternatives.

---

## Table of Contents

1. [Setup and Initialization](#setup-and-initialization)
2. [Automatic vs Manual Exception Capture](#exception-capture)
3. [Performance Monitoring](#performance-monitoring)
4. [User Context](#user-context)
5. [Custom Tags and Extra Data](#custom-tags)
6. [Source Maps for Production](#source-maps)
7. [SentryExceptionFilter vs AllExceptionsFilter](#filter-comparison)
8. [Alternatives](#alternatives)

---

## Setup and Initialization

```bash
npm install @sentry/node @sentry/profiling-node
```

```typescript
// main.ts — MUST be called before anything else
import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  release: process.env.APP_VERSION, // e.g., '1.2.3' or git SHA
  enabled: process.env.NODE_ENV === 'production',

  integrations: [
    nodeProfilingIntegration(),
  ],

  // Performance monitoring: sample rate 0.0–1.0
  // Start at 0.1 (10%) in production — adjust based on volume
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  // Profiling sample rate (subset of traced transactions)
  profilesSampleRate: 0.1,

  // Filter out noise — don't report 4xx client errors
  beforeSend(event, hint) {
    const err = hint.originalException;
    if (err instanceof HttpException && err.getStatus() < 500) {
      return null; // don't send 404s, 401s, 400s to Sentry
    }
    return event;
  },
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // ... rest of setup
}
bootstrap();
```

---

## Exception Capture

### Automatic (via global filter)

```typescript
// sentry-exception.filter.ts
import * as Sentry from '@sentry/node';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

@Catch()
export class SentryExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    // Only report server errors (5xx) to Sentry
    // Don't pollute Sentry with client errors (4xx)
    if (status >= 500) {
      Sentry.withScope(scope => {
        scope.setTag('http.method', request.method);
        scope.setTag('http.url', request.url);
        scope.setTag('http.status_code', status.toString());
        scope.setUser({ id: request.user?.id, email: request.user?.email });
        scope.setExtra('body', request.body);
        Sentry.captureException(exception);
      });
    }

    response.status(status).json({
      statusCode: status,
      message:
        exception instanceof HttpException
          ? exception.message
          : 'Internal server error',
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
```

```typescript
// main.ts — register as global filter
app.useGlobalFilters(new SentryExceptionFilter());
```

### Manual Capture

```typescript
// Capture an error with context
try {
  await this.riskyOperation();
} catch (err) {
  Sentry.withScope(scope => {
    scope.setTag('operation', 'riskyOperation');
    scope.setExtra('operationPayload', payload);
    Sentry.captureException(err);
  });
  throw err; // re-throw — don't swallow errors
}

// Capture a message (non-error event)
Sentry.captureMessage('Unusual state detected', {
  level: 'warning',
  extra: { state: currentState },
});

// Add breadcrumbs (trail leading up to an error)
Sentry.addBreadcrumb({
  category: 'payment',
  message: 'Stripe checkout initiated',
  level: 'info',
  data: { userId, priceId },
});
```

---

## Performance Monitoring

```typescript
// Trace a custom operation
async performHeavyOperation(data: Data): Promise<Result> {
  const transaction = Sentry.startTransaction({
    op: 'heavy-operation',
    name: 'Process Data Batch',
  });

  try {
    const span = transaction.startChild({ op: 'fetch', description: 'DB query' });
    const records = await this.repo.findAll();
    span.finish();

    const processSpan = transaction.startChild({ op: 'process', description: 'Transform records' });
    const result = await this.transform(records);
    processSpan.finish();

    return result;
  } finally {
    transaction.finish();
  }
}
```

Sentry automatically traces:
- HTTP requests (with `http` integration)
- Database queries (with `postgres` integration for TypeORM queries)
- NestJS route handlers

---

## User Context

Attach user info to all events in a request scope.

```typescript
// user-context.interceptor.ts
import * as Sentry from '@sentry/node';

@Injectable()
export class SentryUserContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (user) {
      Sentry.setUser({
        id: user.id,
        email: user.email,
        username: user.firstName,
        // Add any other relevant user attributes
        // DO NOT include sensitive data: passwords, tokens, SSNs
      });
    }

    return next.handle().pipe(
      tap({
        finalize: () => Sentry.setUser(null), // clear after request
      }),
    );
  }
}
```

```typescript
// Register globally (after auth guards so user is set)
app.useGlobalInterceptors(new SentryUserContextInterceptor());
```

---

## Custom Tags and Extra Data

```typescript
// Set globally for all events in current scope
Sentry.setTag('environment', 'production');
Sentry.setTag('app.version', '1.2.3');
Sentry.setTag('region', 'us-east-1');

// Set per-event context
Sentry.withScope(scope => {
  scope.setTag('tenant', organizationId);
  scope.setContext('stripe', {
    customerId: stripeCustomerId,
    subscriptionId: subscriptionId,
    plan: planName,
  });
  scope.setExtra('requestPayload', sanitizedPayload);
  Sentry.captureException(err);
});
```

**Rule:** Tags are indexed and searchable. Extra data is not indexed. Use tags for things you'll filter/search by (status, tenant, region). Use extra for raw payload data.

---

## Source Maps for Production

Without source maps, production stack traces show minified/compiled code — useless for debugging.

### Build Configuration

```typescript
// tsconfig.json
{
  "compilerOptions": {
    "sourceMap": true,
    "inlineSources": true  // includes original TS source in source map
  }
}
```

### Upload Source Maps

```bash
# Install Sentry CLI
npm install --save-dev @sentry/cli

# In CI/CD pipeline after build:
npx sentry-cli sourcemaps inject --org YOUR_ORG --project YOUR_PROJECT ./dist
npx sentry-cli sourcemaps upload --org YOUR_ORG --project YOUR_PROJECT ./dist
```

```typescript
// Or use Sentry webpack/esbuild plugins
// package.json scripts
{
  "build": "nest build",
  "build:prod": "nest build && npm run sentry:sourcemaps",
  "sentry:sourcemaps": "sentry-cli sourcemaps inject ./dist && sentry-cli sourcemaps upload ./dist"
}
```

Set `release` in `Sentry.init()` to match the version you deployed — Sentry uses this to associate source maps with the correct events.

---

## Filter Comparison

### SentryExceptionFilter

**Use when:** you want Sentry to capture errors, and you handle the HTTP response yourself.

```typescript
// Manages: Sentry capture + HTTP response formatting
app.useGlobalFilters(new SentryExceptionFilter());
```

**Pros:** full control over what gets reported, can enrich with request context.
**Cons:** must maintain your own error response format.

### AllExceptionsFilter (general purpose)

**Use when:** standard error handling without Sentry, or extending for other purposes.

```typescript
// Manages: HTTP response formatting only
// Add Sentry.captureException() inside to combine both
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    // format response
  }
}
```

### Recommendation

Use ONE global exception filter that handles both:
1. Format the HTTP error response
2. Capture to Sentry (only for 5xx errors)

Don't register both — filters run in reverse order and both would process the same error.

---

## Alternatives

### Decision Table

| Tool | Best For | Cost |
|---|---|---|
| Sentry | General error tracking, NestJS integration, good DX | Free up to 5k errors/month |
| Datadog APM | Enterprise observability, already using Datadog for metrics/logs | $$$ |
| New Relic | Legacy enterprise, full-stack APM | $$ |
| Rollbar | Simple error tracking, no performance monitoring needed | $ |
| LogRocket | Frontend session replay + errors | $$ (primarily frontend) |
| Glitchtip | Self-hosted Sentry-compatible | Free (self-hosted) |
| Bugsnag | Mobile + server error tracking | $$ |

### Glitchtip (Self-Hosted Sentry Alternative)

If your organization can't use SaaS or needs data sovereignty:

```bash
# docker-compose.yml
services:
  glitchtip-web:
    image: glitchtip/glitchtip
    environment:
      DATABASE_URL: postgres://user:pass@db/glitchtip
      SECRET_KEY: your-secret-key
      EMAIL_URL: smtp://user:pass@smtp:25
    ports:
      - "8000:8000"
```

Glitchtip uses the Sentry SDK — just change the DSN to your self-hosted instance. No code changes needed.

### Datadog

```bash
npm install dd-trace
```

```typescript
// main.ts — BEFORE all imports
import tracer from 'dd-trace';
tracer.init({
  logInjection: true,  // inject trace IDs into logs
  runtimeMetrics: true,
  profiling: true,
});
```

**Use Datadog when:** your team already pays for Datadog, you need unified metrics + logs + traces + APM in one place.
