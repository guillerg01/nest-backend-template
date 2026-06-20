# Seed Module

Populates the database with initial data: permissions, roles, and an admin user. Development/staging only.

## Endpoint

```
POST /seed
X-Seed-Secret: <value of SEED_SECRET env var>
```

**Blocked in production** (`NODE_ENV=production` → 403 immediately).

## What it seeds

1. **Permissions** — one row per action string (e.g., `users:read`, `products:delete`)
2. **Roles** — `superadmin`, `admin`, `moderator`, `user`
3. **Role-permission mapping** — assigns all permissions to `superadmin` and `admin`
4. **Admin user** — `admin@example.com` with password from `SEED_ADMIN_PASSWORD`

All operations are idempotent — safe to run multiple times (uses `upsert`-style logic: skips existing records).

## Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `SEED_SECRET` | *(required)* | Secret header value required to trigger seeding |
| `SEED_ADMIN_PASSWORD` | `Admin1234!` | Password for the seeded admin account |

Set `SEED_SECRET` to a random string (e.g., `openssl rand -hex 32`) and add it to your `.env`.

## Usage

```bash
# Seed local dev DB
curl -X POST http://localhost:3000/seed \
  -H "X-Seed-Secret: your-secret"

# Seed staging (Render / Railway)
curl -X POST https://your-app.onrender.com/seed \
  -H "X-Seed-Secret: $SEED_SECRET"
```

## Adding more seed data

Edit `src/modules/seed/seed.service.ts`:

```ts
// Add to PERMISSIONS array
private readonly PERMISSIONS = [
  'users:read',
  'products:create',
  'mymodule:action',  // ← add here
  // ...
];
```

For entities, add a new `private async seedMyThings()` method and call it from `seedAll()`.

## Disabling in production

The `NODE_ENV=production` check is enforced in the controller before touching the database. Even if `SEED_SECRET` leaks, production is safe.

For extra protection: remove the `SeedModule` import from `app.module.ts` in production builds using a conditional:

```ts
// app.module.ts
imports: [
  ...(process.env.NODE_ENV !== 'production' ? [SeedModule] : []),
]
```
