# Users Module

CRUD operations, roles/permissions, soft delete, pagination, and multi-tenancy patterns.

---

## Table of Contents

1. [Module Overview](#module-overview)
2. [Architecture Pattern](#architecture-pattern)
3. [CRUD Operations](#crud-operations)
4. [Soft Delete vs Hard Delete](#soft-delete-vs-hard-delete)
5. [Pagination](#pagination)
6. [Roles and Permissions](#roles-and-permissions)
7. [Profile Image Upload](#profile-image-upload)
8. [Multi-Tenancy Patterns](#multi-tenancy-patterns)

---

## Module Overview

```
users/
├── entities/
│   └── user.entity.ts          # TypeORM entity extending BaseEntity
├── dto/
│   ├── create-user.dto.ts
│   ├── update-user.dto.ts
│   └── query-users.dto.ts      # pagination + filter params
├── users.controller.ts
├── users.service.ts             # extends CrudService<User>
├── users.repository.ts          # extends BaseRepository<User>
└── users.module.ts
```

---

## Architecture Pattern

This module follows a layered pattern: `BaseEntity → BaseRepository → CrudService → Controller`. Each layer has a single responsibility and can be extended without modifying the base.

### BaseEntity

```typescript
// common/entities/base.entity.ts
@Entity()
export abstract class BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()  // enables soft delete via TypeORM
  deletedAt: Date | null;
}
```

### BaseRepository

```typescript
// common/repositories/base.repository.ts
export abstract class BaseRepository<T extends BaseEntity> {
  constructor(protected readonly repository: Repository<T>) {}

  findById(id: string): Promise<T | null> {
    return this.repository.findOne({ where: { id } as any });
  }

  findAll(options?: FindManyOptions<T>): Promise<T[]> {
    return this.repository.find(options);
  }

  async create(data: DeepPartial<T>): Promise<T> {
    const entity = this.repository.create(data);
    return this.repository.save(entity);
  }

  async update(id: string, data: DeepPartial<T>): Promise<T> {
    await this.repository.update(id, data as any);
    return this.findById(id);
  }

  // Soft delete — sets deletedAt, keeps record
  softDelete(id: string): Promise<UpdateResult> {
    return this.repository.softDelete(id);
  }

  // Hard delete — removes row permanently
  hardDelete(id: string): Promise<DeleteResult> {
    return this.repository.delete(id);
  }

  // Restore a soft-deleted record
  restore(id: string): Promise<UpdateResult> {
    return this.repository.restore(id);
  }
}
```

### CrudService

```typescript
// common/services/crud.service.ts
export abstract class CrudService<T extends BaseEntity> {
  constructor(protected readonly repo: BaseRepository<T>) {}

  findOne(id: string): Promise<T | null> {
    return this.repo.findById(id);
  }

  findAll(): Promise<T[]> {
    return this.repo.findAll();
  }

  create(data: DeepPartial<T>): Promise<T> {
    return this.repo.create(data);
  }

  update(id: string, data: DeepPartial<T>): Promise<T> {
    return this.repo.update(id, data);
  }

  remove(id: string): Promise<UpdateResult> {
    return this.repo.softDelete(id);
  }
}
```

### UsersService (extends CrudService)

```typescript
// users.service.ts
@Injectable()
export class UsersService extends CrudService<User> {
  constructor(
    private readonly usersRepo: UsersRepository,
    private readonly filesService: FilesService,
  ) {
    super(usersRepo);
  }

  // Domain-specific methods go here — base CRUD is inherited
  async findByEmail(email: string): Promise<User | null> {
    return this.usersRepo.findByEmail(email);
  }

  async assignRole(userId: string, role: string): Promise<User> {
    const user = await this.findOne(userId);
    if (!user) throw new NotFoundException('User not found');
    user.roles = [...new Set([...user.roles, role])];
    return this.usersRepo.save(user);
  }
}
```

---

## CRUD Operations

### Create

```typescript
// POST /users
@Post()
@Roles('admin')
create(@Body() dto: CreateUserDto): Promise<User> {
  return this.usersService.create(dto);
}
```

```typescript
// create-user.dto.ts
export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;
}
```

### Read

```typescript
// GET /users (paginated)
@Get()
findAll(@Query() query: QueryUsersDto) {
  return this.usersService.findPaginated(query);
}

// GET /users/:id
@Get(':id')
findOne(@Param('id', ParseUUIDPipe) id: string) {
  return this.usersService.findOne(id);
}
```

### Update

```typescript
// PATCH /users/:id (partial update)
@Patch(':id')
update(
  @Param('id', ParseUUIDPipe) id: string,
  @Body() dto: UpdateUserDto,
  @CurrentUser() currentUser: User,
) {
  // Only admin or the user themselves can update
  if (currentUser.id !== id && !currentUser.roles.includes('admin')) {
    throw new ForbiddenException();
  }
  return this.usersService.update(id, dto);
}
```

### Delete

```typescript
// DELETE /users/:id — soft deletes by default
@Delete(':id')
@Roles('admin')
remove(@Param('id', ParseUUIDPipe) id: string) {
  return this.usersService.remove(id);
}

// DELETE /users/:id/hard — permanent, admin only
@Delete(':id/hard')
@Roles('super-admin')
hardDelete(@Param('id', ParseUUIDPipe) id: string) {
  return this.usersService.hardDelete(id);
}
```

---

## Soft Delete vs Hard Delete

### Decision Table

| Scenario | Soft Delete | Hard Delete |
|---|---|---|
| User account deletion | Yes — user may return, audit trail | No |
| GDPR "right to be forgotten" request | No — must hard delete PII | Yes |
| Test/seed data cleanup | No | Yes |
| Accidental deletion recovery | Yes | No (gone forever) |
| Posts/comments by deleted user | Yes — keep for content integrity | No |
| Financial records (invoices, transactions) | Yes — never delete financial history | No |
| Temp/spam accounts | No | Yes |

### TypeORM Soft Delete Behavior

TypeORM automatically adds `WHERE deletedAt IS NULL` to all queries when `@DeleteDateColumn()` is present. Soft-deleted records are invisible by default.

```typescript
// To include soft-deleted records in a query:
await repo.find({ withDeleted: true });

// To query only deleted records:
await repo.find({
  withDeleted: true,
  where: { deletedAt: Not(IsNull()) },
});
```

### GDPR Compliance Pattern

When a user requests account deletion under GDPR, anonymize instead of deleting — this preserves referential integrity while removing PII.

```typescript
async anonymizeUser(userId: string): Promise<void> {
  await this.usersRepo.update(userId, {
    email: `deleted-${userId}@removed.invalid`,
    firstName: 'Deleted',
    lastName: 'User',
    password: null,
    avatar: null,
    twoFactorSecret: null,
    googleId: null,
    deletedAt: new Date(),
  });
}
```

---

## Pagination

### Offset-Based Pagination (current)

```typescript
// query-users.dto.ts
export class QueryUsersDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(SortOrder)
  order?: SortOrder = SortOrder.DESC;
}
```

```typescript
// users.service.ts
async findPaginated(query: QueryUsersDto): Promise<PaginatedResult<User>> {
  const { page, limit, search } = query;
  const skip = (page - 1) * limit;

  const qb = this.usersRepo.createQueryBuilder('user')
    .where('user.deletedAt IS NULL');

  if (search) {
    qb.andWhere(
      '(user.email ILIKE :search OR user.firstName ILIKE :search OR user.lastName ILIKE :search)',
      { search: `%${search}%` }
    );
  }

  const [data, total] = await qb
    .skip(skip)
    .take(limit)
    .orderBy('user.createdAt', 'DESC')
    .getManyAndCount();

  return {
    data,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasNextPage: page < Math.ceil(total / limit),
      hasPrevPage: page > 1,
    },
  };
}
```

### Cursor-Based Pagination

Use cursor pagination when dealing with **large datasets (100k+ rows)** or **real-time data** where rows are frequently inserted/deleted between pages.

**Why offset fails at scale:**

- `OFFSET 50000 LIMIT 20` makes the DB scan and discard 50,000 rows — gets slower as page number increases
- If new rows are inserted between page 1 and page 2, rows shift and users see duplicates or miss items

```typescript
// cursor-pagination.dto.ts
export class CursorQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string; // base64-encoded last item's ID + createdAt

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}

// users.service.ts
async findWithCursor(query: CursorQueryDto): Promise<CursorResult<User>> {
  const { cursor, limit } = query;

  const qb = this.usersRepo.createQueryBuilder('user')
    .where('user.deletedAt IS NULL')
    .orderBy('user.createdAt', 'DESC')
    .addOrderBy('user.id', 'DESC') // tiebreaker for same timestamp
    .take(limit + 1); // fetch one extra to determine hasNextPage

  if (cursor) {
    const { createdAt, id } = decodeCursor(cursor);
    qb.andWhere(
      '(user.createdAt < :createdAt OR (user.createdAt = :createdAt AND user.id < :id))',
      { createdAt, id }
    );
  }

  const items = await qb.getMany();
  const hasNextPage = items.length > limit;
  const data = hasNextPage ? items.slice(0, limit) : items;
  const nextCursor = hasNextPage ? encodeCursor(data[data.length - 1]) : null;

  return { data, nextCursor, hasNextPage };
}

function encodeCursor(user: User): string {
  return Buffer.from(JSON.stringify({
    createdAt: user.createdAt.toISOString(),
    id: user.id,
  })).toString('base64');
}

function decodeCursor(cursor: string): { createdAt: string; id: string } {
  return JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8'));
}
```

### When to Use Each

| Scenario | Offset | Cursor |
|---|---|---|
| Admin panel, small dataset (<10k rows) | Yes | Overkill |
| "Jump to page 50" feature needed | Yes | Not possible |
| Infinite scroll / load more | No — row shifting causes duplicates | Yes |
| Real-time feed (new items inserted constantly) | No | Yes |
| Large dataset (100k+ rows) | No — gets slow | Yes |
| API consumed by mobile with infinite scroll | No | Yes |

---

## Roles and Permissions

### Entity Design

```typescript
// user.entity.ts
@Entity('users')
export class User extends BaseEntity {
  @Column({ unique: true })
  email: string;

  @Column({ nullable: true })
  password: string;

  @Column('text', { array: true, default: ['user'] })
  roles: string[]; // ['user', 'admin', 'moderator']

  @Column('text', { array: true, default: [] })
  permissions: string[]; // ['posts:delete', 'users:read']
}
```

### Assigning Roles

```typescript
// POST /users/:id/roles
@Post(':id/roles')
@Roles('admin')
async assignRole(
  @Param('id', ParseUUIDPipe) id: string,
  @Body() dto: AssignRoleDto,
) {
  return this.usersService.assignRole(id, dto.role);
}

// DELETE /users/:id/roles/:role
@Delete(':id/roles/:role')
@Roles('admin')
async removeRole(
  @Param('id', ParseUUIDPipe) id: string,
  @Param('role') role: string,
) {
  return this.usersService.removeRole(id, role);
}
```

### Role Hierarchy Alternative

For complex applications, use a dedicated `roles` table with a many-to-many relationship. This allows dynamic role creation without code changes.

```typescript
@Entity('roles')
export class Role extends BaseEntity {
  @Column({ unique: true })
  name: string; // 'admin', 'moderator', 'editor'

  @Column('text', { array: true })
  permissions: string[]; // ['posts:create', 'posts:delete']
}

@Entity('users')
export class User extends BaseEntity {
  @ManyToMany(() => Role, { eager: true })
  @JoinTable()
  roles: Role[];
}
```

---

## Profile Image Upload

Integration with the files module.

```typescript
// POST /users/me/avatar
@Post('me/avatar')
@UseInterceptors(FileInterceptor('file'))
async uploadAvatar(
  @CurrentUser() user: User,
  @UploadedFile(
    new ParseFilePipe({
      validators: [
        new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }), // 5MB
        new FileTypeValidator({ fileType: /image\/(jpeg|png|webp)/ }),
      ],
    })
  ) file: Express.Multer.File,
) {
  // Delete old avatar if exists
  if (user.avatarKey) {
    await this.filesService.deleteFile(user.avatarKey);
  }

  const { url, key } = await this.filesService.uploadFile(file, `avatars/${user.id}`);

  return this.usersService.update(user.id, { avatar: url, avatarKey: key });
}
```

---

## Multi-Tenancy Patterns

### Pattern 1: Column-Based (simplest)

Every table has an `organizationId` column. All queries filter by it. Good for small-to-medium SaaS.

```typescript
// organization.entity.ts
@Entity('organizations')
export class Organization extends BaseEntity {
  @Column()
  name: string;

  @OneToMany(() => User, user => user.organization)
  users: User[];
}

// user.entity.ts
@ManyToOne(() => Organization)
organization: Organization;

@Column()
organizationId: string;
```

```typescript
// CRITICAL: always filter by organization in every query
async findAllUsers(organizationId: string): Promise<User[]> {
  return this.usersRepo.find({
    where: { organizationId }
  });
}

// Better: use a tenant middleware that injects organizationId
// into every request, then use interceptors to auto-filter
```

### Pattern 2: Schema-Based (strongest isolation)

Each tenant has their own PostgreSQL schema. Perfect for enterprises with compliance requirements (HIPAA, SOC 2).

```
PostgreSQL
├── schema: tenant_abc
│   ├── users
│   └── orders
├── schema: tenant_xyz
│   ├── users
│   └── orders
└── schema: public (shared)
    └── organizations
```

Complexity: high. Libraries: [`typeorm-multi-tenant`](https://github.com/Winberry/typeorm-multi-tenant), or custom connection pool per tenant.

### Pattern 3: Database-Per-Tenant (maximum isolation, max cost)

Each tenant has a separate database. Used by Notion, GitHub (historically). Only makes sense at enterprise scale.

### Tenant Resolution Middleware

```typescript
// tenant.middleware.ts
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // Resolve tenant from: subdomain, header, JWT claim, or path
    const host = req.hostname; // e.g., 'acme.myapp.com'
    const subdomain = host.split('.')[0];

    req['tenantId'] = subdomain; // injected into every request
    next();
  }
}
```

### Common Gotcha: Missing Tenant Filter

The #1 security bug in multi-tenant apps: forgetting to filter by `organizationId` in a query. A user from org A sees data from org B.

**Prevention:** Use a base query builder that automatically adds the tenant filter:

```typescript
// base.repository.ts
protected scopedQuery(tenantId: string): SelectQueryBuilder<T> {
  return this.repository.createQueryBuilder('entity')
    .where('entity.organizationId = :tenantId', { tenantId });
}
```

Write integration tests that create two organizations and verify data isolation.
