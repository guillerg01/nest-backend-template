# Security Module

RBAC (Role-Based Access Control) with fine-grained permissions and HTTP request audit logging.

## Entities

### PermissionEntity (`permissions`)

```
id, name (unique), description
```

Example names: `users:read`, `users:delete`, `products:create`, `scraping:execute`

Convention: `resource:action` with colon separator.

### RoleEntity (`roles`)

```
id, name (unique), description, permissions (ManyToMany → role_permissions)
```

Built-in roles seeded by `/seed`:
- `superadmin` — all permissions (wildcard)
- `admin` — all permissions
- `moderator` — read + moderate permissions  
- `user` — basic read permissions

### AuditLogEntity (`audit_logs`)

Logs every inbound HTTP request automatically via `AuditInterceptor`.

```
id, userId, userEmail, method, endpoint, ipAddress, requestBody, statusCode, createdAt
```

**Note:** `requestBody` is stored as-is. Ensure sensitive fields (passwords, tokens) are stripped before logging — add a sanitizer in `AuditInterceptor` for any endpoint that accepts credentials.

## How permissions work

### Decorating routes

```ts
@Permissions('products:read')           // single permission
@Permissions('products:read', 'products:update')  // any of these (OR)
```

### Guard chain

```
JwtAuthGuard → RolesGuard/PermissionsGuard → Handler
```

`PermissionsGuard` reads the user's role from the JWT payload, loads the role's permissions (eager), and checks if any match the required permissions.

### Adding permissions to a role

```ts
// Via seed service or admin endpoint:
await roleRepo.addPermissions(roleId, ['products:create', 'products:update']);
```

### Superadmin bypass

If the user's role is `superadmin`, the guard passes immediately regardless of which permissions are declared on the route.

## Audit Log

Every authenticated request is automatically logged. The `AuditInterceptor` (registered globally) stores:

- `userId` + `userEmail` from the JWT payload
- `method` + `endpoint` from the request
- `ipAddress` (respects `X-Forwarded-For`)
- `requestBody` (sanitize sensitive fields before storage)
- `statusCode` from the response

### Querying audit logs

```sql
-- Last 100 actions by a user
SELECT * FROM audit_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100;

-- All DELETEs in the last 24h
SELECT * FROM audit_logs WHERE method = 'DELETE' AND created_at > NOW() - INTERVAL '1 day';
```

## Adding a new permission

1. Add the permission name to `PERMISSIONS` in `seed.service.ts`
2. Run `POST /seed` (dev only) to insert it
3. Decorate your route: `@Permissions('resource:action')`
4. Assign the permission to the relevant role via the admin panel or manually in DB

## Alternative approaches

### Attribute-Based Access Control (ABAC)

Replace `PermissionsGuard` with a policy service:

```ts
class PolicyService {
  can(user: UserEntity, action: string, resource: any): boolean {
    // custom logic: check user.id === resource.ownerId, etc.
  }
}
```

Useful when access depends on the resource's data (e.g., "only the owner can delete").

### Casbin

Replace the custom guard with `@casbin/casbin` + `@nestjs-casbin/core`:

```ts
@UseGuards(AuthGuard('jwt'), CasbinGuard)
@SetMetadata('casbin', { action: 'read', subject: 'products' })
```

Casbin supports RBAC, ABAC, and ACL in a single policy file. Good for complex multi-tenant setups.
