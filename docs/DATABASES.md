# Database Guide

PostgreSQL, Prisma, MongoDB, MySQL, SQLite, Redis, and DynamoDB — when to use each.

---

## Table of Contents

1. [PostgreSQL + TypeORM (current)](#postgresql--typeorm)
2. [PostgreSQL + Prisma](#postgresql--prisma)
3. [MongoDB + Mongoose](#mongodb--mongoose)
4. [MySQL + TypeORM](#mysql--typeorm)
5. [SQLite](#sqlite)
6. [Redis as Primary Store](#redis-as-primary-store)
7. [DynamoDB (AWS)](#dynamodb)
8. [Quick Decision Guide](#quick-decision-guide)

---

## PostgreSQL + TypeORM

**Current setup. Production default for most applications.**

### When to Use

- Relational data with complex joins
- ACID compliance required (financial data, orders, inventory)
- Complex queries (aggregations, window functions, CTEs)
- Full-text search (built-in tsvector)
- JSON storage with indexing (JSONB)
- Mature team: many TypeORM resources and Stack Overflow answers

### TypeORM Pros

- Decorators feel natural with NestJS
- Migrations are TypeScript
- Active Record + Repository pattern
- Works with PostgreSQL, MySQL, SQLite, MSSQL

### TypeORM Cons

- TypeScript types can diverge from DB schema if not careful
- Complex queries are verbose with QueryBuilder
- `relations` option can cause accidental N+1 queries
- No schema-first workflow (Prisma does this better)
- `synchronize: true` in production is dangerous (auto-runs DDL)

### Configuration

```typescript
// typeorm.config.ts
TypeOrmModule.forRootAsync({
  useFactory: (configService: ConfigService): TypeOrmModuleOptions => ({
    type: 'postgres',
    url: configService.get('DATABASE_URL'),
    entities: [__dirname + '/**/*.entity.{ts,js}'],
    migrations: [__dirname + '/migrations/*.{ts,js}'],
    migrationsRun: false, // NEVER auto-run in production — run in deploy pipeline
    synchronize: false,   // NEVER true in production
    logging: configService.get('NODE_ENV') === 'development',
    ssl:
      configService.get('NODE_ENV') === 'production'
        ? { rejectUnauthorized: false }
        : false,
    poolSize: 10,
  }),
  inject: [ConfigService],
}),
```

### Migrations Workflow

```bash
# Generate migration from entity changes
npm run typeorm migration:generate -- -n CreateUsersTable

# Run pending migrations
npm run typeorm migration:run

# Revert last migration
npm run typeorm migration:revert

# package.json scripts
"typeorm": "ts-node -r tsconfig-paths/register ./node_modules/typeorm/cli",
"migration:generate": "npm run typeorm -- migration:generate -d src/database/data-source.ts",
"migration:run": "npm run typeorm -- migration:run -d src/database/data-source.ts",
"migration:revert": "npm run typeorm -- migration:revert -d src/database/data-source.ts"
```

---

## PostgreSQL + Prisma

**Modern alternative. Better DX, type-safe, schema-first.**

### When to Prefer Over TypeORM

- New project with no legacy TypeORM code
- Team prefers schema-first approach (define schema → generate client)
- Need type-safe DB client (Prisma's generated types are more accurate than TypeORM decorators)
- Complex query building (Prisma's fluent API is cleaner than TypeORM QueryBuilder)
- Prisma Accelerate (connection pooling + edge caching as a service)

### Installation

```bash
npm install @prisma/client
npm install -D prisma
npx prisma init
```

### Schema Definition

```prisma
// prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id            String    @id @default(uuid())
  email         String    @unique
  password      String?
  firstName     String?
  lastName      String?
  roles         String[]  @default(["user"])
  emailVerified Boolean   @default(false)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  deletedAt     DateTime? // soft delete

  subscription Subscription?
  posts        Post[]

  @@index([email])
  @@map("users") // table name
}

model Post {
  id        String   @id @default(uuid())
  title     String
  content   String
  published Boolean  @default(false)
  author    User     @relation(fields: [authorId], references: [id])
  authorId  String
  createdAt DateTime @default(now())

  @@map("posts")
}
```

### PrismaService

```typescript
// prisma.service.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect();
  }

  // Soft delete middleware
  constructor() {
    super();

    this.$use(async (params, next) => {
      // Automatically filter soft-deleted records on findMany/findFirst
      if (params.model === 'User' && params.action === 'findMany') {
        params.args.where = {
          ...params.args.where,
          deletedAt: null,
        };
      }
      return next(params);
    });
  }
}
```

### Repository Pattern with Prisma

```typescript
// users.repository.ts
@Injectable()
export class UsersRepository {
  constructor(private prisma: PrismaService) {}

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  create(data: Prisma.UserCreateInput) {
    return this.prisma.user.create({ data });
  }

  update(id: string, data: Prisma.UserUpdateInput) {
    return this.prisma.user.update({ where: { id }, data });
  }

  softDelete(id: string) {
    return this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  findWithPosts(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      include: { posts: { where: { published: true } } },
    });
  }
}
```

### Migration Workflow

```bash
# Create and apply a migration
npx prisma migrate dev --name add-user-avatar

# Apply migrations in production (no interactive prompts)
npx prisma migrate deploy

# Reset database (dev only)
npx prisma migrate reset

# Regenerate Prisma client after schema change
npx prisma generate
```

### TypeORM vs Prisma Summary

| Feature | TypeORM | Prisma |
|---|---|---|
| Approach | Code-first (decorators) | Schema-first (schema.prisma) |
| Type safety | Good (can drift from DB) | Excellent (generated from schema) |
| Query builder | Verbose | Fluent, clean |
| Migrations | TypeScript files | SQL files (auto-generated) |
| Ecosystem | More examples/community | Growing fast |
| NestJS integration | Native (`@nestjs/typeorm`) | Manual service, community modules |
| Performance | Similar | Similar |
| Raw queries | `createQueryBuilder` | `prisma.$queryRaw` |

---

## MongoDB + Mongoose

### When to Use

- Document-heavy data: CMS content, user activity logs, configs
- Flexible/evolving schema during rapid iteration
- Embedded documents make more sense than relations
- Existing MongoDB infrastructure
- Hierarchical data (comments with nested replies)

### When NOT to Use

- Financial data requiring ACID transactions (MongoDB has multi-doc transactions but they're slower and more complex)
- Data with many complex relationships (you'll fight Mongoose with joins)
- Reporting/analytics with complex aggregations (PostgreSQL + CTEs is much better)
- Team lacks MongoDB expertise — PostgreSQL defaults are safer

### Installation

```bash
npm install @nestjs/mongoose mongoose
```

### Setup

```typescript
// app.module.ts
MongooseModule.forRootAsync({
  useFactory: (configService: ConfigService) => ({
    uri: configService.get('MONGODB_URI'),
    // Mongoose 7+ uses native Node.js driver directly
    // These options are no longer needed in Mongoose 7:
    // useNewUrlParser, useUnifiedTopology
  }),
  inject: [ConfigService],
}),
```

### Schema and Model

```typescript
// post.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class Post {
  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  content: string;

  @Prop({ default: false })
  published: boolean;

  // Reference to another document (like foreign key)
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  authorId: Types.ObjectId;

  // Embedded subdocument (no separate collection)
  @Prop({ type: [{ text: String, author: Types.ObjectId, createdAt: Date }] })
  comments: Array<{ text: string; author: Types.ObjectId; createdAt: Date }>;

  // Flexible metadata
  @Prop({ type: Object })
  metadata: Record<string, unknown>;
}

export const PostSchema = SchemaFactory.createForClass(Post);
export type PostDocument = Post & Document;
```

```typescript
// posts.module.ts
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Post.name, schema: PostSchema }]),
  ],
  providers: [PostsService, PostsRepository],
})
export class PostsModule {}
```

### Service Example

```typescript
// posts.service.ts
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

@Injectable()
export class PostsService {
  constructor(@InjectModel(Post.name) private postModel: Model<PostDocument>) {}

  async findAll(): Promise<PostDocument[]> {
    return this.postModel.find({ published: true }).lean().exec();
  }

  async findById(id: string): Promise<PostDocument | null> {
    return this.postModel.findById(id).populate('authorId').exec();
  }

  async create(data: Partial<Post>): Promise<PostDocument> {
    const post = new this.postModel(data);
    return post.save();
  }

  async update(id: string, data: Partial<Post>): Promise<PostDocument | null> {
    return this.postModel
      .findByIdAndUpdate(id, { $set: data }, { new: true })
      .exec();
  }

  async softDelete(id: string): Promise<void> {
    await this.postModel.findByIdAndUpdate(id, {
      $set: { deletedAt: new Date() },
    });
  }

  // Aggregation pipeline
  async getPopularPosts(): Promise<unknown[]> {
    return this.postModel.aggregate([
      { $match: { published: true } },
      { $addFields: { commentCount: { $size: '$comments' } } },
      { $sort: { commentCount: -1 } },
      { $limit: 10 },
      { $project: { title: 1, commentCount: 1 } },
    ]);
  }
}
```

---

## MySQL + TypeORM

Drop-in replacement for PostgreSQL in TypeORM. Change two lines.

### Configuration

```typescript
TypeOrmModule.forRoot({
  type: 'mysql',        // was: 'postgres'
  host: process.env.DB_HOST,
  port: 3306,           // was: 5432
  username: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  entities: [__dirname + '/**/*.entity.{ts,js}'],
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  synchronize: false,
})
```

### Key Differences from PostgreSQL

- No native `uuid` type — use `varchar(36)` or `@PrimaryGeneratedColumn('uuid')` (TypeORM handles this)
- No `text[]` arrays — use a junction table or `JSON` column
- `ILIKE` (case-insensitive LIKE) doesn't exist — use `LIKE` with `LOWER()` or `COLLATE`
- Stricter mode defaults — may need `sql_mode` adjustments
- No JSONB (has JSON, but no indexed queries on JSON fields)

### When to Use MySQL Over PostgreSQL

- Legacy system on MySQL
- Specific MySQL features (certain storage engines, partitioning)
- Managed MySQL from a specific vendor (PlanetScale for serverless MySQL)
- Team expertise is MySQL

For new projects: choose PostgreSQL.

---

## SQLite

### For Testing and Local Development

```bash
npm install better-sqlite3
npm install -D @types/better-sqlite3
```

```typescript
// typeorm.config.testing.ts
TypeOrmModule.forRoot({
  type: 'better-sqlite3',
  database: ':memory:', // in-memory, reset between test runs
  entities: ['src/**/*.entity.ts'],
  synchronize: true,    // safe for in-memory test DB
  dropSchema: true,     // clean state each test
})
```

```typescript
// In Jest setup:
// jest.config.js
module.exports = {
  // ...
  globalSetup: './test/setup.ts',
};

// test/setup.ts
process.env.DATABASE_URL = ':memory:';
process.env.DB_TYPE = 'better-sqlite3';
```

### Production Use Cases

SQLite is appropriate for production in:
- Embedded applications (Electron desktop apps)
- Edge deployments (Cloudflare D1 uses SQLite)
- Single-user apps (local tools, dev tools)
- Read-heavy apps with infrequent writes (< 1 write/second)
- Low-traffic sites that need zero infra

**Not appropriate for:** multi-user web apps, high write throughput, multi-instance deployments (SQLite is a file, can't be shared across servers).

---

## Redis as Primary Store

Redis is NOT a replacement for PostgreSQL — it's a complement.

### What Belongs in Redis

| Data | Why Redis |
|---|---|
| HTTP sessions | Fast reads, automatic expiry |
| Rate limit counters | Atomic increment, fast |
| Cache (L2) | Sub-millisecond reads, TTL built-in |
| WebSocket presence | In-memory, fast, ephemeral |
| Job queues (BullMQ) | List/sorted set operations |
| Leaderboards | Sorted sets with O(log n) updates |
| Pub/Sub events | Built-in pub/sub |
| Distributed locks | SET NX EX pattern |
| Real-time counters | Atomic INCR |

### What Belongs in PostgreSQL, NOT Redis

| Data | Why NOT Redis |
|---|---|
| User accounts | No persistence guarantee without `AOF`/`RDB`, no relations |
| Orders/transactions | Need ACID, complex queries, joins |
| Financial records | Need durability, audit trail |
| Anything you can't recreate | Redis can lose data (AOF helps but adds latency) |

### RedisOM (Redis as Document Store)

For the specific case where you need fast, JSON-queryable documents without PostgreSQL:

```bash
npm install redis-om
```

```typescript
import { Client, Entity, Schema, Repository } from 'redis-om';

// Define entity
class Session extends Entity {}
const schema = new Schema(Session, {
  userId: { type: 'string' },
  data: { type: 'string' },
  expiresAt: { type: 'date' },
});

const client = new Client();
await client.open(process.env.REDIS_URL);

const repo = client.fetchRepository(schema);
await repo.createIndex();

// CRUD
const session = repo.createEntity({ userId: '123', data: '{}' });
const id = await repo.save(session);

const found = await repo.fetch(id);
const byUser = await repo.search().where('userId').eq('123').returnAll();
```

**Use when:** session storage with complex queries, high-speed document storage where eventual durability loss is acceptable.

---

## DynamoDB

### When to Use

- AWS serverless architecture (Lambda, ECS) — no connection pooling issues
- Infinite horizontal scale, single-digit millisecond latency at any size
- Simple, well-defined access patterns (key-value, get by partition key)
- Auto-scaling storage (no capacity planning for TB-scale data)

### When NOT to Use

- Complex queries with multiple filter conditions (no SQL, no joins, no GROUP BY)
- Unpredictable costs — pricing is per read/write unit, can spike with bad table design
- Relational data
- Team unfamiliar with NoSQL access pattern design (getting the partition key wrong = expensive table scans)

### Setup

```bash
npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
```

```typescript
// dynamodb.service.ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';

@Injectable()
export class DynamoDBService {
  private client: DynamoDBDocumentClient;

  constructor(private configService: ConfigService) {
    const ddbClient = new DynamoDBClient({
      region: this.configService.get('AWS_REGION'),
      credentials: {
        accessKeyId: this.configService.get('AWS_ACCESS_KEY_ID'),
        secretAccessKey: this.configService.get('AWS_SECRET_ACCESS_KEY'),
      },
    });

    this.client = DynamoDBDocumentClient.from(ddbClient, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  async get(tableName: string, key: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    const result = await this.client.send(new GetCommand({
      TableName: tableName,
      Key: key,
    }));
    return result.Item ?? null;
  }

  async put(tableName: string, item: Record<string, unknown>): Promise<void> {
    await this.client.send(new PutCommand({
      TableName: tableName,
      Item: {
        ...item,
        createdAt: item.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    }));
  }

  async update(
    tableName: string,
    key: Record<string, unknown>,
    updates: Record<string, unknown>,
  ): Promise<void> {
    const expressionParts: string[] = [];
    const expressionValues: Record<string, unknown> = {};
    const expressionNames: Record<string, string> = {};

    for (const [k, v] of Object.entries(updates)) {
      expressionParts.push(`#${k} = :${k}`);
      expressionValues[`:${k}`] = v;
      expressionNames[`#${k}`] = k; // handles reserved words like 'name', 'status'
    }

    await this.client.send(new UpdateCommand({
      TableName: tableName,
      Key: key,
      UpdateExpression: `SET ${expressionParts.join(', ')}`,
      ExpressionAttributeValues: expressionValues,
      ExpressionAttributeNames: expressionNames,
    }));
  }

  async delete(tableName: string, key: Record<string, unknown>): Promise<void> {
    await this.client.send(new DeleteCommand({ TableName: tableName, Key: key }));
  }

  async query(
    tableName: string,
    partitionKey: string,
    partitionValue: string,
    limit = 20,
  ): Promise<Record<string, unknown>[]> {
    const result = await this.client.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: '#pk = :pk',
      ExpressionAttributeNames: { '#pk': partitionKey },
      ExpressionAttributeValues: { ':pk': partitionValue },
      Limit: limit,
      ScanIndexForward: false, // most recent first
    }));

    return result.Items ?? [];
  }
}
```

### DynamoDB Table Design Example

```typescript
// Single-table design — store all entities in one table
// Partition key (PK) + Sort key (SK) enables multiple access patterns

// USER record
{ PK: 'USER#uuid', SK: 'PROFILE', email: 'test@example.com', name: 'John' }

// USER's POSTS
{ PK: 'USER#uuid', SK: 'POST#2024-01-15T10:00:00Z', title: 'Hello', content: '...' }

// Query: get all posts by user
// KeyCondition: PK = 'USER#uuid' AND begins_with(SK, 'POST#')

// GSI (Global Secondary Index) for: get user by email
// GSI PK: email, GSI SK: USER#uuid
```

**DynamoDB single-table design is a specialized skill.** Alex DeBrie's book "The DynamoDB Book" and [dynamodbguide.com](https://www.dynamodbguide.com) are the best resources.

---

## Quick Decision Guide

```
Is your data relational (users, orders, posts)?
  └─► YES → PostgreSQL
        ├─ New project with TypeScript-first focus? → Prisma
        └─ Team knows TypeORM, existing codebase? → TypeORM

Is your data document-oriented (CMS content, user activity logs)?
  └─► YES → MongoDB (only if truly needed — PostgreSQL JSONB handles most cases)

Do you need extreme throughput and serverless scale on AWS?
  └─► YES → DynamoDB (commit to learning access pattern design)

Do you need fast ephemeral data (sessions, cache, counters, queues)?
  └─► YES → Redis (alongside PostgreSQL, not instead of)

Is it a test environment or embedded app (Electron)?
  └─► YES → SQLite

Are you migrating from MySQL?
  └─► Depends on how complex the migration is — MySQL + TypeORM works fine,
        PostgreSQL is the better long-term choice
```
