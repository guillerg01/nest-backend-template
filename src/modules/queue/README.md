# Queue Module

BullMQ job queues with Redis — background processing, retries, scheduling, and monitoring.

---

## Table of Contents

1. [Why Queues](#why-queues)
2. [BullMQ Setup](#bullmq-setup)
3. [Job Types](#job-types)
4. [Retry Strategies](#retry-strategies)
5. [Dead Letter Queue](#dead-letter-queue)
6. [Multiple Queues by Domain](#multiple-queues-by-domain)
7. [Bull Board (UI)](#bull-board)
8. [Worker Concurrency](#worker-concurrency)
9. [Job Events](#job-events)
10. [Testing Queues in Jest](#testing-queues-in-jest)
11. [Alternatives](#alternatives)

---

## Why Queues

Rule: **never block the request thread for heavy operations**.

```typescript
// Bad: user waits 2-5 seconds for email to send
@Post('register')
async register(@Body() dto: RegisterDto) {
  const user = await this.usersService.create(dto);
  await this.emailService.sendWelcomeEmail(user); // ← 2-5s BLOCKING
  return user; // user was already waiting 2-5s
}

// Good: response in <50ms, email sends in background
@Post('register')
async register(@Body() dto: RegisterDto) {
  const user = await this.usersService.create(dto);
  await this.emailQueue.add('welcome', { userId: user.id }); // ← <5ms
  return user; // instant response
}
```

### Operations That Must Go to a Queue

- Email sending
- SMS sending
- PDF generation
- AI/LLM API calls
- Web scraping jobs
- Image processing (resize/optimize)
- Webhook delivery
- Data export (CSV/Excel generation)
- Report generation
- Batch data imports

---

## BullMQ Setup

```bash
npm install bullmq @nestjs/bullmq
```

```typescript
// queue.module.ts
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get('REDIS_HOST'),
          port: configService.get<number>('REDIS_PORT'),
          password: configService.get('REDIS_PASSWORD'),
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: { count: 100 }, // keep last 100 completed jobs
          removeOnFail: { count: 500 },     // keep last 500 failed jobs
        },
      }),
      inject: [ConfigService],
    }),

    BullModule.registerQueue({ name: 'email' }),
    BullModule.registerQueue({ name: 'scraping' }),
    BullModule.registerQueue({ name: 'exports' }),
    BullModule.registerQueue({ name: 'ai-jobs' }),
  ],
  providers: [
    EmailQueueProducer,
    EmailQueueConsumer,
    ScrapingQueueConsumer,
    ExportsQueueConsumer,
  ],
  exports: [BullModule],
})
export class QueueModule {}
```

### Producer

```typescript
// email-queue.producer.ts
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class EmailQueueProducer {
  constructor(@InjectQueue('email') private emailQueue: Queue) {}

  async sendWelcomeEmail(userId: string): Promise<void> {
    await this.emailQueue.add('welcome', { userId }, {
      priority: 10, // lower number = higher priority (1 = highest)
    });
  }

  async sendPasswordReset(userId: string, token: string): Promise<void> {
    await this.emailQueue.add(
      'password-reset',
      { userId, token },
      {
        attempts: 5, // override default
        backoff: { type: 'fixed', delay: 30000 }, // retry after 30s
      },
    );
  }
}
```

### Consumer (Worker)

```typescript
// email-queue.consumer.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

@Processor('email')
export class EmailQueueConsumer extends WorkerHost {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly usersService: UsersService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    this.logger.log(`Processing job ${job.id}: ${job.name}`);

    switch (job.name) {
      case 'welcome':
        await this.processWelcomeEmail(job);
        break;
      case 'password-reset':
        await this.processPasswordReset(job);
        break;
      default:
        throw new Error(`Unknown job name: ${job.name}`);
    }
  }

  private async processWelcomeEmail(job: Job<{ userId: string }>): Promise<void> {
    const user = await this.usersService.findById(job.data.userId);
    if (!user) throw new Error(`User ${job.data.userId} not found`);

    await this.notificationsService.sendWelcomeEmail(user);

    // Report progress (visible in Bull Board)
    await job.updateProgress(100);
  }
}
```

---

## Job Types

### Regular Jobs

Executed once, as soon as a worker is available.

```typescript
await queue.add('process-image', { imageId: '123' });
```

### Delayed Jobs

Execute after a delay.

```typescript
// Send a follow-up email 24 hours after signup
await queue.add(
  'follow-up-email',
  { userId },
  { delay: 24 * 60 * 60 * 1000 } // 24h in ms
);
```

### Repeatable Jobs (Cron)

```typescript
// Run every day at 9am UTC
await queue.add(
  'daily-report',
  { type: 'daily' },
  {
    repeat: { cron: '0 9 * * *' },
    // or: repeat: { every: 60000 } // every minute
  }
);

// Remove a repeatable job
const repeatableJobs = await queue.getRepeatableJobs();
const job = repeatableJobs.find(j => j.name === 'daily-report');
if (job) await queue.removeRepeatableByKey(job.key);
```

### Priority Jobs

Lower `priority` number = higher priority. Workers process higher priority jobs first.

```typescript
// High priority: process immediately before lower-priority items
await queue.add('critical-alert', data, { priority: 1 });
await queue.add('newsletter', data, { priority: 100 });
```

---

## Retry Strategies

### Fixed Backoff

Retry after a fixed delay — good for external service failures with known recovery time.

```typescript
{
  attempts: 5,
  backoff: { type: 'fixed', delay: 5000 } // retry every 5s
}
```

### Exponential Backoff

Retry with increasing delays — handles transient failures and rate limits.

```typescript
{
  attempts: 5,
  backoff: { type: 'exponential', delay: 1000 }
  // Delays: 1s, 2s, 4s, 8s, 16s
}
```

### Custom Backoff

```typescript
{
  attempts: 5,
  backoff: {
    type: 'custom',
    // Implement in Worker subclass:
  }
}

// In your processor:
@Processor('email')
export class EmailProcessor extends WorkerHost {
  calculateBackoffDelay(attemptsMade: number, err: Error): number {
    if (err.message.includes('rate limit')) {
      return 60000 * attemptsMade; // wait longer for rate limits
    }
    return 1000 * Math.pow(2, attemptsMade); // exponential for other errors
  }
}
```

---

## Dead Letter Queue

Jobs that exhaust all retry attempts go to the "failed" state. Implement a DLQ pattern to handle them.

```typescript
// dead-letter.processor.ts
@Processor('email')
export class EmailProcessor extends WorkerHost {
  // This is called after all retries are exhausted (job.attemptsMade === job.opts.attempts)
  @OnWorkerEvent('failed')
  async onFailed(job: Job, err: Error): Promise<void> {
    if (job.attemptsMade >= (job.opts.attempts ?? 3)) {
      // Move to dead letter queue for manual inspection
      await this.deadLetterQueue.add('failed-job', {
        originalQueue: 'email',
        jobName: job.name,
        jobData: job.data,
        error: err.message,
        failedAt: new Date().toISOString(),
      });

      // Alert on-call
      await this.alertingService.sendAlert({
        title: `Job permanently failed: ${job.name}`,
        message: err.message,
        data: job.data,
      });
    }
  }
}
```

---

## Multiple Queues by Domain

Separate queues allow independent scaling and monitoring.

```typescript
// Queue isolation: email workers ≠ scraping workers
// scraping workers can use more CPU without affecting email throughput

BullModule.registerQueue({ name: 'email' }),       // fast, I/O bound
BullModule.registerQueue({ name: 'scraping' }),    // slow, CPU bound
BullModule.registerQueue({ name: 'exports' }),     // memory intensive
BullModule.registerQueue({ name: 'ai-jobs' }),     // rate-limited by OpenAI
BullModule.registerQueue({ name: 'notifications'}), // high priority
BullModule.registerQueue({ name: 'dead-letter' }), // failed jobs
```

### Worker Scaling

Run more workers for high-throughput queues, fewer for expensive ones:

```bash
# docker-compose.yml
services:
  api:
    image: myapp
    command: node dist/main
    
  email-worker:
    image: myapp
    command: node dist/workers/email
    deploy:
      replicas: 3  # 3 email workers
    
  scraping-worker:
    image: myapp
    command: node dist/workers/scraping
    deploy:
      replicas: 1  # 1 scraping worker (rate-limited anyway)
      resources:
        limits:
          memory: 2G
          cpus: '1.0'
```

---

## Bull Board

Web UI for monitoring queues — see job status, retry failed jobs, view job data.

```bash
npm install @bull-board/api @bull-board/express
```

```typescript
// queue-admin.module.ts
import { BullBoardModule } from '@bull-board/nestjs';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';

@Module({
  imports: [
    BullBoardModule.forRoot({
      route: '/admin/queues',
      adapter: ExpressAdapter,
    }),
    BullBoardModule.forFeature({
      name: 'email',
      adapter: BullMQAdapter,
    }),
    BullBoardModule.forFeature({
      name: 'scraping',
      adapter: BullMQAdapter,
    }),
  ],
})
export class QueueAdminModule {}
```

```typescript
// Protect the route — only admins can access
// In the app module, add auth middleware for /admin/queues
consumer
  .apply(AdminAuthMiddleware)
  .forRoutes({ path: 'admin/queues*', method: RequestMethod.ALL });
```

Access at: `http://localhost:3000/admin/queues`

---

## Worker Concurrency

```typescript
// Set concurrency per processor
@Processor('email', { concurrency: 5 }) // process 5 jobs simultaneously
export class EmailProcessor extends WorkerHost { ... }

@Processor('scraping', { concurrency: 2 }) // max 2 concurrent scraping jobs
export class ScrapingProcessor extends WorkerHost { ... }

@Processor('ai-jobs', { concurrency: 1 }) // serialize AI calls (rate limits)
export class AiProcessor extends WorkerHost { ... }
```

**Rule of thumb:**
- I/O bound (email, HTTP calls): concurrency = 5–20
- CPU bound (PDF, image processing): concurrency = number of CPU cores
- Rate-limited (OpenAI, external APIs): concurrency = 1–3

---

## Job Events

```typescript
@Processor('email')
export class EmailProcessor extends WorkerHost {
  async process(job: Job): Promise<void> {
    // main processing logic
  }

  @OnWorkerEvent('active')
  onActive(job: Job): void {
    this.logger.log(`Job ${job.id} started`);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job, result: unknown): void {
    this.logger.log(`Job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error): void {
    this.logger.error(`Job ${job.id} failed: ${err.message}`, {
      jobName: job.name,
      data: job.data,
      attempts: job.attemptsMade,
    });
    Sentry.captureException(err, { extra: { jobId: job.id, jobData: job.data } });
  }

  @OnWorkerEvent('progress')
  onProgress(job: Job, progress: number): void {
    this.logger.log(`Job ${job.id} progress: ${progress}%`);
  }
}
```

---

## Testing Queues in Jest

```typescript
// email-queue.producer.spec.ts
describe('EmailQueueProducer', () => {
  let producer: EmailQueueProducer;
  let mockQueue: jest.Mocked<Queue>;

  beforeEach(async () => {
    mockQueue = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    } as any;

    const module = await Test.createTestingModule({
      providers: [
        EmailQueueProducer,
        {
          provide: getQueueToken('email'),
          useValue: mockQueue,
        },
      ],
    }).compile();

    producer = module.get(EmailQueueProducer);
  });

  it('should add welcome email job', async () => {
    await producer.sendWelcomeEmail('user-123');

    expect(mockQueue.add).toHaveBeenCalledWith(
      'welcome',
      { userId: 'user-123' },
      expect.objectContaining({ priority: 10 }),
    );
  });
});
```

```typescript
// email-processor.spec.ts — test the processor logic
describe('EmailProcessor', () => {
  let processor: EmailProcessor;
  let notificationsService: jest.Mocked<NotificationsService>;

  // ... setup

  it('should send welcome email for welcome job', async () => {
    const mockJob = {
      name: 'welcome',
      data: { userId: 'user-123' },
      updateProgress: jest.fn(),
    } as any;

    await processor.process(mockJob);

    expect(notificationsService.sendWelcomeEmail).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-123' }),
    );
  });
});
```

---

## Alternatives

### Decision Table

| Library | Backend | Best For | Weakness |
|---|---|---|---|
| BullMQ (current) | Redis | Complex workflows, high throughput, UI support | Requires Redis |
| Agenda | MongoDB | Already using MongoDB, simple cron jobs | Slower than Redis-backed, less active |
| BeeQueue | Redis | Simple, lightweight, high throughput | No priorities, no repeatable jobs |
| AWS SQS | AWS managed | Serverless, no Redis, infinite scale | Polling delay (1-14s), no cron |
| Inngest | Managed (cloud) | Event-driven workflows, no infra to manage | Cost at scale, vendor lock-in |

### AWS SQS (no Redis needed)

```bash
npm install @aws-sdk/client-sqs
```

```typescript
import { SQSClient, SendMessageCommand, ReceiveMessageCommand } from '@aws-sdk/client-sqs';

// Producer
await sqs.send(new SendMessageCommand({
  QueueUrl: process.env.SQS_QUEUE_URL,
  MessageBody: JSON.stringify({ type: 'welcome', userId }),
  MessageGroupId: 'email', // for FIFO queues
  MessageDeduplicationId: uuid(), // prevent duplicates in FIFO queues
}));

// Consumer (poll for messages)
const response = await sqs.send(new ReceiveMessageCommand({
  QueueUrl: process.env.SQS_QUEUE_URL,
  MaxNumberOfMessages: 10,
  WaitTimeSeconds: 20, // long polling — reduces cost
}));
```

**Use SQS when:** deploying to Lambda/serverless, want managed queue with zero infra, already on AWS.

### Inngest (event-driven, managed)

```bash
npm install inngest
```

```typescript
import { Inngest } from 'inngest';

const inngest = new Inngest({ id: 'my-app' });

// Define a function
const sendWelcomeEmail = inngest.createFunction(
  { id: 'send-welcome-email' },
  { event: 'user/registered' },
  async ({ event, step }) => {
    const user = await step.run('fetch-user', () =>
      usersService.findById(event.data.userId)
    );

    await step.run('send-email', () =>
      emailService.sendWelcome(user)
    );
  }
);

// Trigger
await inngest.send({ name: 'user/registered', data: { userId } });
```

**Use Inngest when:** want managed infrastructure, event-driven patterns, built-in retries and logging without Bull Board setup.
