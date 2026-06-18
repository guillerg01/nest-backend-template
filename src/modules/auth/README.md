# Auth Module

Complete authentication system supporting JWT, Google OAuth 2.0, 2FA (TOTP), password reset, and email verification.

---

## Table of Contents

1. [JWT Flow](#jwt-flow)
2. [Token Storage: Cookies vs localStorage](#token-storage)
3. [Google OAuth 2.0](#google-oauth-20)
4. [Two-Factor Authentication (TOTP)](#two-factor-authentication)
5. [Password Reset Flow](#password-reset-flow)
6. [Email Verification Flow](#email-verification-flow)
7. [Magic Link Auth (README only)](#magic-link-auth)
8. [Session-Based Auth Alternative](#session-based-auth-alternative)
9. [Decorators Reference](#decorators-reference)
10. [Guard Chain](#guard-chain)
11. [Security Checklist](#security-checklist)

---

## JWT Flow

### Access + Refresh Token Strategy

Access tokens are **short-lived** (15m–1h). Refresh tokens are **long-lived** (7–30d). This limits the blast radius of a stolen access token.

```
┌─────────┐       POST /auth/login          ┌─────────┐
│ Client  │ ──────────────────────────────► │ Server  │
│         │ ◄────────────────────────────── │         │
│         │  { accessToken, refreshToken }  │         │
│         │                                 │         │
│         │  GET /api/resource              │         │
│         │  Authorization: Bearer <access> │         │
│         │ ──────────────────────────────► │         │
│         │ ◄────────────────────────────── │         │
│         │  { data }                       │         │
│         │                                 │         │
│         │  POST /auth/refresh             │         │
│         │  { refreshToken }               │         │
│         │ ──────────────────────────────► │         │
│         │ ◄────────────────────────────── │         │
│         │  { accessToken (new) }          │         │
└─────────┘                                 └─────────┘
```

### Token Generation

```typescript
// auth.service.ts
async generateTokens(user: User) {
  const payload: JwtPayload = {
    sub: user.id,
    email: user.email,
    roles: user.roles,
  };

  const [accessToken, refreshToken] = await Promise.all([
    this.jwtService.signAsync(payload, {
      secret: this.configService.get('JWT_SECRET'),
      expiresIn: '15m',
    }),
    this.jwtService.signAsync(payload, {
      secret: this.configService.get('JWT_REFRESH_SECRET'),
      expiresIn: '7d',
    }),
  ]);

  // Store hashed refresh token in DB (allows revocation)
  await this.usersService.updateRefreshToken(user.id, refreshToken);

  return { accessToken, refreshToken };
}
```

### Token Rotation on Refresh

Every refresh call issues a **new** refresh token and invalidates the old one. If an attacker steals a refresh token and uses it after the legitimate user already refreshed, the server detects reuse (old token no longer valid) and can invalidate all sessions.

```typescript
async refresh(userId: string, refreshToken: string) {
  const user = await this.usersService.findById(userId);
  if (!user?.hashedRefreshToken) throw new ForbiddenException();

  const matches = await bcrypt.compare(refreshToken, user.hashedRefreshToken);
  if (!matches) throw new ForbiddenException();

  // Rotate: generate new tokens, invalidate old refresh token
  return this.generateTokens(user);
}
```

---

## Token Storage

### Decision Table

| Concern | httpOnly Cookie | localStorage |
|---|---|---|
| XSS protection | Inaccessible to JS | Fully exposed to XSS |
| CSRF risk | Yes (mitigate with SameSite + CSRF token) | No (JS controls header) |
| Mobile apps | Not natural | Works fine |
| Automatic sending | Yes (browser sends on every request) | Manual: set `Authorization` header |
| Logout | Server sets expired cookie | Client deletes key |
| Multi-tab sync | Works out of the box | Works out of the box |
| SSR compatibility | Yes | Yes |

**Recommendation:** Use **httpOnly, Secure, SameSite=Strict cookies** for web apps. localStorage is fine for mobile/native clients where XSS risk is lower.

### Setting Cookie on Login

```typescript
// auth.controller.ts
@Post('login')
async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
  const { accessToken, refreshToken } = await this.authService.login(dto);

  res.cookie('refresh_token', refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
    path: '/auth/refresh', // only sent to refresh endpoint
  });

  return { accessToken }; // access token in JSON body — client stores in memory
}
```

> Store the **access token in memory** (React state, Vuex, etc.) — not localStorage. It disappears on refresh, which is fine since you have the httpOnly cookie to get a new one.

---

## Google OAuth 2.0

### Prerequisites

1. Create project in [Google Cloud Console](https://console.cloud.google.com)
2. Enable Google+ API
3. Create OAuth 2.0 credentials (Web application)
4. Add authorized redirect URI: `http://localhost:3000/auth/google/callback`

### Flow Step by Step

```
┌─────────┐                                    ┌───────────┐     ┌────────────┐
│ Browser │                                    │  Your API │     │  Google    │
│         │  GET /auth/google                  │           │     │            │
│         │ ─────────────────────────────────► │           │     │            │
│         │                                    │ redirect  │     │            │
│         │  302 → accounts.google.com/o/...   │           │     │            │
│         │ ◄───────────────────────────────── │           │     │            │
│         │                                    │           │     │            │
│         │  User consents on Google UI        │           │     │            │
│         │ ──────────────────────────────────────────────►│     │            │
│         │                                    │           │     │            │
│         │  GET /auth/google/callback?code=…  │           │     │            │
│         │ ─────────────────────────────────► │           │     │            │
│         │                                    │ exchange  │     │            │
│         │                                    │ code for  │─────────────────►│
│         │                                    │ tokens    │◄─────────────────│
│         │                                    │           │  { id_token,     │
│         │                                    │           │    access_token }│
│         │  { accessToken, refreshToken }     │           │     │            │
│         │ ◄───────────────────────────────── │           │     │            │
└─────────┘                                    └───────────┘     └────────────┘
```

### Implementation

```typescript
// google.strategy.ts
@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(private authService: AuthService) {
    super({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL,
      scope: ['email', 'profile'],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: Profile,
  ): Promise<User> {
    const { emails, photos, name } = profile;
    const email = emails[0].value;

    // Find or create user — never reject OAuth users for missing password
    return this.authService.findOrCreateOAuthUser({
      email,
      firstName: name.givenName,
      lastName: name.familyName,
      avatar: photos[0]?.value,
      provider: 'google',
      providerId: profile.id,
    });
  }
}
```

```typescript
// auth.controller.ts
@Get('google')
@UseGuards(AuthGuard('google'))
googleAuth() {
  // Passport redirects to Google — nothing to implement here
}

@Get('google/callback')
@UseGuards(AuthGuard('google'))
async googleCallback(@CurrentUser() user: User, @Res() res: Response) {
  const tokens = await this.authService.generateTokens(user);
  // Redirect to frontend with token or set cookie
  res.redirect(`${process.env.FRONTEND_URL}/auth/callback?token=${tokens.accessToken}`);
}
```

### Gotcha: Linking Existing Accounts

If a user already registered with email/password and then tries Google OAuth with the same email, you have two options:

1. **Auto-link**: If email is verified on Google, merge the accounts
2. **Block**: Require login with existing method, then link in settings

Option 1 is better UX but requires that you trust Google's email verification (you should — they verify it).

---

## Two-Factor Authentication

Uses **TOTP** (Time-Based One-Time Password) — same algorithm as Google Authenticator, Authy, 1Password.

### Complete Flow

```
SETUP                                       LOGIN (after TOTP enabled)
─────                                       ──────────────────────────
1. User clicks "Enable 2FA"                 1. User submits email + password
2. Server generates secret (speakeasy)      2. Server verifies credentials → OK
3. Server encrypts secret, stores in DB     3. Server checks user.twoFactorEnabled
4. Server returns QR code URL               4. If enabled: return { requires2FA: true }
5. User scans QR with authenticator app     5. Client shows OTP input
6. User enters 6-digit code to confirm      6. User submits OTP
7. Server verifies code against secret      7. Server verifies OTP against stored secret
8. If valid: mark 2FA as enabled            8. If valid: issue tokens
```

### Setup Implementation

```typescript
// auth.service.ts
import * as speakeasy from 'speakeasy';
import * as QRCode from 'qrcode';

async setup2FA(userId: string) {
  const secret = speakeasy.generateSecret({
    name: `MyApp (${user.email})`,
    length: 32,
  });

  // Encrypt secret before storing — NEVER store plaintext
  const encryptedSecret = this.cryptoService.encrypt(secret.base32);
  await this.usersService.storePending2FASecret(userId, encryptedSecret);

  // Generate QR code for authenticator app
  const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);

  return { qrCodeUrl, secret: secret.base32 }; // show secret as text backup
}

async verify2FASetup(userId: string, token: string) {
  const user = await this.usersService.findById(userId);
  const decryptedSecret = this.cryptoService.decrypt(user.pending2FASecret);

  const isValid = speakeasy.totp.verify({
    secret: decryptedSecret,
    encoding: 'base32',
    token,
    window: 1, // allow 1 step tolerance (±30s)
  });

  if (!isValid) throw new BadRequestException('Invalid OTP code');

  // Promote pending secret to active
  await this.usersService.enable2FA(userId, user.pending2FASecret);

  // Generate backup codes
  const backupCodes = await this.generateBackupCodes(userId);
  return { backupCodes };
}
```

### Login with 2FA

```typescript
async login(dto: LoginDto) {
  const user = await this.validateCredentials(dto.email, dto.password);

  if (user.twoFactorEnabled) {
    // Issue a short-lived "2FA pending" token — not a full access token
    const tempToken = await this.jwtService.signAsync(
      { sub: user.id, stage: '2fa-pending' },
      { expiresIn: '5m' }
    );
    return { requires2FA: true, tempToken };
  }

  return this.generateTokens(user);
}

async complete2FALogin(userId: string, otp: string) {
  const user = await this.usersService.findById(userId);
  const secret = this.cryptoService.decrypt(user.twoFactorSecret);

  const isValid = speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token: otp,
    window: 1,
  });

  if (!isValid) throw new UnauthorizedException('Invalid 2FA code');
  return this.generateTokens(user);
}
```

### Backup Codes

Always generate 8–10 single-use backup codes during 2FA setup. Store them **hashed** in the DB. User sees them plaintext once.

```typescript
async generateBackupCodes(userId: string): Promise<string[]> {
  const codes = Array.from({ length: 10 }, () =>
    crypto.randomBytes(4).toString('hex').toUpperCase() // e.g. "A3F2-9C1B"
  );

  const hashedCodes = await Promise.all(codes.map(c => bcrypt.hash(c, 10)));
  await this.usersService.storeBackupCodes(userId, hashedCodes);

  return codes; // show to user ONCE
}
```

---

## Password Reset Flow

```
1. POST /auth/forgot-password { email }
   → Generate secure random token (crypto.randomBytes)
   → Store hashed token + expiry (1h) in DB
   → Send email with link: https://app.com/reset-password?token=<plaintext>

2. User clicks link in email
   → Frontend shows "new password" form

3. POST /auth/reset-password { token, newPassword }
   → Hash the received token, look up in DB
   → Check expiry
   → If valid: hash new password, update user, delete token
   → Send confirmation email
```

```typescript
async forgotPassword(email: string) {
  const user = await this.usersService.findByEmail(email);

  // IMPORTANT: always return success even if user not found — prevents email enumeration
  if (!user) return { message: 'If that email exists, we sent a reset link.' };

  const rawToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = await bcrypt.hash(rawToken, 10);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await this.usersService.storePasswordResetToken(user.id, hashedToken, expiresAt);
  await this.notificationsService.sendPasswordReset(user.email, rawToken);

  return { message: 'If that email exists, we sent a reset link.' };
}

async resetPassword(token: string, newPassword: string) {
  // Find all non-expired reset tokens, then verify by bcrypt compare
  // (can't query by plaintext token since we stored hash)
  const users = await this.usersService.findUsersWithValidResetToken();
  let targetUser: User | null = null;

  for (const user of users) {
    if (await bcrypt.compare(token, user.passwordResetToken)) {
      targetUser = user;
      break;
    }
  }

  if (!targetUser) throw new BadRequestException('Invalid or expired token');
  if (targetUser.passwordResetExpiry < new Date()) {
    throw new BadRequestException('Token expired');
  }

  const hashedPassword = await bcrypt.hash(newPassword, 12);
  await this.usersService.updatePassword(targetUser.id, hashedPassword);
  await this.usersService.clearPasswordResetToken(targetUser.id);
}
```

> **Gotcha:** Searching all users for a matching token is O(n). For scale, store a non-sensitive lookup key alongside the hashed token (e.g., first 8 bytes of the raw token as an index). Or use a separate `password_reset_tokens` table with a unique index on a partial token prefix.

---

## Email Verification Flow

```
1. On registration:
   → Generate verification token (crypto.randomBytes)
   → Store hashed token in DB, set user.emailVerified = false
   → Send verification email with link

2. GET /auth/verify-email?token=<raw>
   → Hash received token, look up in DB
   → Set user.emailVerified = true
   → Delete token

3. Protected routes can check @IsEmailVerified() or add guard
```

```typescript
// Decorator to require verified email
export const RequireEmailVerified = () =>
  applyDecorators(
    UseGuards(EmailVerifiedGuard),
  );

// Guard
@Injectable()
export class EmailVerifiedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user;
    if (!user.emailVerified) {
      throw new ForbiddenException('Please verify your email first');
    }
    return true;
  }
}
```

---

## Magic Link Auth

> Not implemented — README only. Use when you want passwordless login.

### How It Works

```
1. User enters email on login page
2. POST /auth/magic-link { email }
3. Server generates short-lived token (15m), stores in Redis
4. Server sends email with: https://app.com/auth/verify?token=<token>
5. User clicks link
6. GET /auth/magic-link/verify?token=<token>
7. Server validates token from Redis (DELETE it immediately — single use)
8. Server issues JWT tokens
9. Redirect to app
```

### Libraries

- [`@magic-sdk/admin`](https://magic.link/docs/home/welcome) — fully managed magic link service, handles token generation/email/verification
- [`nodemailer`](https://nodemailer.com) + custom token — DIY approach, more control
- [`passport-magic-login`](https://github.com/mxstbr/passport-magic-login) — Passport strategy for magic links

### When to Use Over Password Auth

- B2B SaaS targeting non-technical users (no password fatigue)
- Low-friction signup flows
- Apps where users log in infrequently (OTP via email makes more sense)

---

## Session-Based Auth Alternative

### When to Use Sessions Over JWT

| Scenario | Use Sessions | Use JWT |
|---|---|---|
| Server-side rendered app (SSR) | Yes | Possible but awkward |
| Immediate revocation needed | Yes | No (wait for expiry) |
| Storing server state per user | Yes | No |
| Stateless microservices | No | Yes |
| Mobile app | No | Yes |
| Multi-service authentication | No | Yes |

### Setup

```bash
npm install express-session connect-redis @types/express-session
```

```typescript
// main.ts
import * as session from 'express-session';
import RedisStore from 'connect-redis';
import { createClient } from 'redis';

const redisClient = createClient({ url: process.env.REDIS_URL });
await redisClient.connect();

app.use(session({
  store: new RedisStore({ client: redisClient }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));
```

```typescript
// auth.controller.ts (session-based)
@Post('login')
async login(@Body() dto: LoginDto, @Session() session: Record<string, any>) {
  const user = await this.authService.validateCredentials(dto);
  session.userId = user.id;
  session.roles = user.roles;
  return { message: 'Logged in' };
}

@Post('logout')
logout(@Session() session: Record<string, any>, @Res() res: Response) {
  session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ message: 'Logged out' });
  });
}
```

> **Critical:** Redis is mandatory for sessions in multi-instance deployments. Without it, session data lives in memory on one server and users get logged out on every request that hits a different instance.

---

## Decorators Reference

### `@Public()`

Marks a route as accessible without authentication. Without this, every route requires a valid JWT by default (JwtAuthGuard is applied globally).

```typescript
// Usage
@Public()
@Get('health')
health() {
  return { status: 'ok' };
}

// Implementation
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

// In JwtAuthGuard
canActivate(context: ExecutionContext) {
  const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
    context.getHandler(),
    context.getClass(),
  ]);
  if (isPublic) return true;
  return super.canActivate(context);
}
```

### `@CurrentUser()`

Injects the authenticated user from the request object.

```typescript
// Usage
@Get('profile')
getProfile(@CurrentUser() user: User) {
  return user;
}

// Extract a specific field
@Get('me')
getMe(@CurrentUser('email') email: string) {
  return { email };
}

// Implementation
export const CurrentUser = createParamDecorator(
  (data: keyof User | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;
    return data ? user?.[data] : user;
  },
);
```

### `@Roles()`

Restricts access to users with specific roles. Combine with `RolesGuard`.

```typescript
// Usage
@Roles('admin', 'moderator')
@Delete(':id')
deleteUser(@Param('id') id: string) {
  return this.usersService.delete(id);
}

// Implementation
export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

// RolesGuard
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles?.length) return true;

    const { user } = context.switchToHttp().getRequest();
    return requiredRoles.some(role => user.roles?.includes(role));
  }
}
```

### `@Permissions()`

Fine-grained permission checks beyond roles.

```typescript
// Usage
@Permissions('users:delete', 'users:write')
@Delete(':id')
deleteUser() { ... }

// Implementation
export const PERMISSIONS_KEY = 'permissions';
export const Permissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

// PermissionsGuard — checks user.permissions array
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const { user } = context.switchToHttp().getRequest();
    return required.every(p => user.permissions?.includes(p));
  }
}
```

---

## Guard Chain

Guards execute in registration order. The full chain for a protected route:

```
Request
  │
  ▼
JwtAuthGuard        ← verifies JWT signature, loads user from DB
  │
  ▼
EmailVerifiedGuard  ← optional: ensures email is verified
  │
  ▼
TwoFactorGuard      ← optional: ensures 2FA completed if enabled
  │
  ▼
RolesGuard          ← checks user.roles against @Roles() metadata
  │
  ▼
PermissionsGuard    ← checks user.permissions against @Permissions() metadata
  │
  ▼
Route Handler
```

### Global Registration

```typescript
// app.module.ts
providers: [
  { provide: APP_GUARD, useClass: JwtAuthGuard },   // runs first
  { provide: APP_GUARD, useClass: RolesGuard },     // runs second
  { provide: APP_GUARD, useClass: PermissionsGuard }, // runs third
],
```

### Per-Controller or Per-Route Override

```typescript
@Controller('admin')
@Roles('admin')  // applies to all routes in this controller
export class AdminController {

  @Roles('super-admin')  // overrides controller-level for this route
  @Delete('nuke')
  nukeEverything() { ... }
}
```

---

## Security Checklist

### Rate Limiting

```typescript
// Apply strict rate limits on auth endpoints
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 5, ttl: 60000 } }) // 5 attempts per minute
@Post('login')
login() { ... }

// Even stricter for password reset (prevent email flooding)
@Throttle({ default: { limit: 3, ttl: 3600000 } }) // 3 per hour
@Post('forgot-password')
forgotPassword() { ... }
```

### bcrypt Cost Factor

```typescript
// cost = 12 is the current recommended minimum for production
// cost = 10 is acceptable for high-traffic (bcrypt is intentionally slow)
// Never go below 10

const hash = await bcrypt.hash(password, 12);

// Benchmark on your hardware:
// cost 10 → ~100ms
// cost 12 → ~400ms
// cost 14 → ~1600ms
// Choose based on: acceptable login latency vs. brute-force resistance
```

### Token Rotation

- Rotate refresh token on every use (revoke old, issue new)
- Maintain a `tokenVersion` counter on the user — increment to invalidate all sessions
- Store refresh token hash in DB — never store plaintext

### Additional Measures

- [ ] Helmet middleware: `app.use(helmet())` — sets security headers
- [ ] CORS configured to specific origins only
- [ ] JWT `iss` and `aud` claims validated
- [ ] Logout endpoint deletes refresh token from DB
- [ ] Account lockout after N failed login attempts (or use rate limiting + captcha)
- [ ] Passwords require minimum entropy (zxcvbn library for strength scoring)
- [ ] Log authentication events (login, logout, failed attempts, 2FA events)
- [ ] Rotate JWT secrets periodically — requires short access token lifetimes

### Environment Variables Required

```env
JWT_SECRET=<64-byte-random-hex>
JWT_REFRESH_SECRET=<different-64-byte-random-hex>
JWT_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback
SESSION_SECRET=<64-byte-random-hex>
```

Generate secrets: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`
