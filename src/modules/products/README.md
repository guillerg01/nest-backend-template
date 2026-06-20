# Products Module

Reference CRUD module demonstrating common patterns: enums, decimal columns, JSONB, slug, soft delete, compound index.

Copy this module as the starting point for any new business entity.

## API

| Method | Route | Permission | Description |
|--------|-------|-----------|-------------|
| GET | `/products` | `products:read` | List (paginated, sorted, filtered) |
| GET | `/products/:id` | `products:read` | Get by ID |
| POST | `/products` | `products:create` | Create product |
| PATCH | `/products/:id` | `products:update` | Update product |
| DELETE | `/products/:id` | `products:delete` | Soft delete |

## Query params (pagination)

```
GET /products?page=1&size=20&sortBy=price&sortOrder=ASC
```

| Param | Default | Constraints |
|-------|---------|-------------|
| `page` | 1 | min: 1 |
| `size` | 10 | min: 1, max: 100 |
| `sortBy` | `createdAt` | `createdAt`, `updatedAt`, `id`, `name`, `price` |
| `sortOrder` | `DESC` | `ASC`, `DESC` |

## Create / Update body

```json
{
  "name": "Wireless Headphones",
  "slug": "wireless-headphones-v2",
  "description": "High fidelity over-ear headphones",
  "price": 149.99,
  "compareAtPrice": 199.99,
  "stockQuantity": 50,
  "status": "active",
  "imageUrl": "https://cdn.example.com/img.jpg",
  "images": ["https://cdn.example.com/1.jpg", "https://cdn.example.com/2.jpg"],
  "metadata": { "brand": "Acme", "color": "black" },
  "categoryId": "uuid-of-category",
  "ownerId": "uuid-of-owner"
}
```

## Validations

| Field | Rule |
|-------|------|
| `name` | Required, string |
| `slug` | Required, unique |
| `price` | Number ≥ 0 |
| `status` | `draft` \| `active` \| `archived` |
| `metadata` | Optional JSON object |

## Statuses

```ts
enum ProductStatus {
  DRAFT = 'draft',       // Not visible publicly
  ACTIVE = 'active',     // Available
  ARCHIVED = 'archived', // Hidden, preserves history
}
```

## Soft Delete

`DELETE /products/:id` sets `deletedAt` (TypeORM `@DeleteDateColumn`). Record is excluded from all queries automatically. Use `repo.restore(id)` to recover.

## Computed fields (getters on entity)

```ts
product.isInStock      // stockQuantity > 0
product.discountPercent // % off if compareAtPrice > price
```

Getters are NOT persisted — they are calculated at runtime. Use `@Expose()` in the DTO to include them in API responses.

## Extending for your business

1. Copy `src/modules/products/` → rename folder and all references
2. Replace `ProductEntity` fields with your domain fields
3. Add custom filters in `ProductRepository.findAll()` (status filter, categoryId filter, etc.)
4. Register the module in `app.module.ts`

## Alternative ORMs

### Prisma

```prisma
model Product {
  id             String        @id @default(uuid())
  name           String
  slug           String        @unique
  price          Decimal       @db.Decimal(10, 2)
  compareAtPrice Decimal?      @db.Decimal(10, 2)
  stockQuantity  Int           @default(0)
  status         ProductStatus @default(DRAFT)
  metadata       Json?
  deletedAt      DateTime?
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt

  @@index([status])
}

enum ProductStatus {
  DRAFT
  ACTIVE
  ARCHIVED
}
```

Soft delete with Prisma: use `where: { deletedAt: null }` in every query, or use `prisma-soft-delete-middleware`.

### MongoDB / Mongoose

```ts
@Schema({ timestamps: true })
export class Product {
  @Prop({ required: true }) name: string;
  @Prop({ required: true, unique: true }) slug: string;
  @Prop({ required: true }) price: number;
  @Prop({ enum: ['draft', 'active', 'archived'], default: 'draft' }) status: string;
  @Prop({ type: Object }) metadata: Record<string, any>;
  @Prop() deletedAt: Date;
}
```

### MySQL / MariaDB

Replace `type: 'jsonb'` with `type: 'json'`. All other patterns work identically.
