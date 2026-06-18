# Payments Module

Production-grade payment system built from real SaaS backends. Covers subscriptions, invoices, transactions, payment methods, webhooks, and full domain model.

Patterns extracted from: `cazarentas-back` + `kaptalo-back` (both in production).

---

## Table of Contents

1. [Architecture — Full Domain Model](#architecture--full-domain-model)
2. [Stripe Subscription Flow](#stripe-subscription-flow)
3. [One-Time Payments](#one-time-payments)
4. [Webhook Handling](#webhook-handling)
5. [Customer Portal (Billing)](#customer-portal-billing)
6. [Refunds](#refunds)
7. [Usage-Based Billing](#usage-based-billing)
8. [Idempotency](#idempotency)
9. [Multi-Currency](#multi-currency)
10. [Testing with Stripe CLI](#testing-with-stripe-cli)
11. [MercadoPago (LATAM)](#mercadopago-latam)
12. [PayPal](#paypal)
13. [Conekta (México — OXXO)](#conekta-méxico--oxxo)
14. [PayU (Colombia, Perú, etc.)](#payu-colombia-perú-etc)
15. [PCI Compliance](#pci-compliance)
16. [Migrating Between Processors](#migrating-between-processors)

---

## Architecture — Full Domain Model

In production you need more than just `stripe.checkout.sessions.create`. You need a proper DB record of every payment, subscription, and invoice — so you can audit, reconcile, and handle failures.

**Domain model (from kaptalo-back + cazarentas-back):**

```
User ─────────────────────────────────────────────
  │
  ├── Subscription (current plan + status)
  │     ├── Plan (monthly/yearly price, features)
  │     ├── InvoiceEntity[]
  │     └── FeatureUsage[] (per-feature usage tracking)
  │
  ├── Payment[] (each billing cycle)
  │     ├── PaymentMethod (saved card)
  │     ├── Transaction (journal entry)
  │     └── Invoice (PDF-ready record)
  │
  └── stripeCustomerId (sync with Stripe)
```

### Entities to add for production

```typescript
// entities/plan.entity.ts
@Entity('plans')
export class PlanEntity extends BaseEntity {
  @Column() name: string;                         // 'Starter', 'Pro', 'Enterprise'
  @Column() description: string;
  @Column('decimal', { precision: 10, scale: 2 }) monthlyPrice: number;
  @Column('decimal', { precision: 10, scale: 2 }) yearlyPrice: number;
  @Column({ nullable: true }) stripePriceIdMonthly: string;
  @Column({ nullable: true }) stripePriceIdYearly: string;
  @Column('jsonb', { default: [] }) features: PlanFeature[];  // { name, limit, type }
  @OneToMany(() => SubscriptionEntity, s => s.plan) subscriptions: SubscriptionEntity[];
}

// entities/subscription.entity.ts
export enum SubscriptionStatus { ACTIVE = 'active', INACTIVE = 'inactive', CANCELED = 'canceled', PAST_DUE = 'past_due', TRIALING = 'trialing' }
export enum SubscriptionType  { MONTHLY = 'monthly', YEARLY = 'yearly' }

@Entity('subscriptions')
export class SubscriptionEntity extends BaseEntity {
  @ManyToOne(() => PlanEntity) plan: PlanEntity;
  @Column() planId: string;
  @ManyToOne(() => UserEntity) user: UserEntity;
  @Column() userId: string;
  @Column() startDate: Date;
  @Column() endDate: Date;
  @Column('decimal', { precision: 10, scale: 2 }) paymentAmount: number;
  @Column({ type: 'enum', enum: SubscriptionType, default: SubscriptionType.MONTHLY }) type: SubscriptionType;
  @Column({ type: 'enum', enum: SubscriptionStatus, default: SubscriptionStatus.INACTIVE }) status: SubscriptionStatus;
  @Column({ nullable: true }) stripeSubscriptionId: string;
  @Column({ nullable: true }) stripeCustomerId: string;
  @Column({ default: true }) autoRenew: boolean;
  @Column({ nullable: true }) nextBillingDate: Date;
  @Column({ nullable: true }) canceledAt: Date;
  @Column({ nullable: true }) pausedAt: Date;
  @OneToMany(() => InvoiceEntity, i => i.subscription) invoices: InvoiceEntity[];
  @OneToMany(() => FeatureUsageEntity, fu => fu.subscription) featureUsage: FeatureUsageEntity[];
}

// entities/payment.entity.ts
export enum PaymentStatus { PENDING = 'pending', PAID = 'paid', FAILED = 'failed', REFUNDED = 'refunded' }

@Entity('payments')
export class PaymentEntity extends BaseEntity {
  @Column('decimal', { precision: 10, scale: 2 }) amount: number;
  @Column({ default: 'usd' }) currency: string;
  @Column() date: Date;
  @Column({ type: 'enum', enum: PaymentStatus, default: PaymentStatus.PENDING }) status: PaymentStatus;
  @ManyToOne(() => UserEntity) user: UserEntity;
  @Column() userId: string;
  @ManyToOne(() => PaymentMethodEntity, { nullable: true }) method: PaymentMethodEntity;
  @OneToOne(() => SubscriptionEntity, { nullable: true }) subscription: SubscriptionEntity;
  @OneToOne(() => InvoiceEntity, { nullable: true }) invoice: InvoiceEntity;
  @Column({ nullable: true }) stripePaymentIntentId: string;
  @Column({ nullable: true }) stripeInvoiceId: string;
  @Column({ default: false }) isRecurring: boolean;
  @Column({ type: 'jsonb', nullable: true }) metadata: Record<string, any>;
}

// entities/transaction.entity.ts
export enum TransactionType   { CHARGE = 'charge', REFUND = 'refund', CREDIT = 'credit' }
export enum TransactionStatus { PENDING = 'pending', COMPLETED = 'completed', FAILED = 'failed' }

@Entity('transactions')
export class TransactionEntity extends BaseEntity {
  @Column('decimal', { precision: 10, scale: 2 }) amount: number;
  @Column() date: Date;
  @Column({ type: 'enum', enum: TransactionType }) type: TransactionType;
  @Column({ type: 'enum', enum: TransactionStatus, default: TransactionStatus.PENDING }) status: TransactionStatus;
  @ManyToOne(() => PaymentEntity, { nullable: true }) payment: PaymentEntity;
  @Column({ nullable: true }) description: string;
  @Column({ nullable: true }) reference: string;  // Stripe charge ID, refund ID, etc.
}

// entities/invoice.entity.ts
@Entity('invoices')
export class InvoiceEntity extends BaseEntity {
  @Column({ unique: true }) invoiceNumber: string;   // INV-2024-001
  @Column() dateIssued: Date;
  @Column({ nullable: true }) dateDue: Date;
  @Column() status: string;                          // draft, open, paid, void, uncollectible
  @Column('decimal', { precision: 10, scale: 2 }) amount: number;
  @ManyToOne(() => UserEntity) issuedTo: UserEntity;
  @ManyToOne(() => SubscriptionEntity, { nullable: true }) subscription: SubscriptionEntity;
  @OneToOne(() => PaymentEntity, { nullable: true }) payment: PaymentEntity;
  @OneToMany(() => InvoiceItemEntity, i => i.invoice, { cascade: true }) items: InvoiceItemEntity[];
  @Column({ nullable: true }) stripeInvoiceId: string;
  @Column({ type: 'jsonb', nullable: true }) metadata: Record<string, any>;
}

// entities/payment-method.entity.ts
@Entity('payment_methods')
export class PaymentMethodEntity extends BaseEntity {
  @Column() userId: string;
  @Column() name: string;                  // 'Card ending in 4242'
  @Column({ nullable: true }) stripePaymentMethodId: string;
  @Column({ nullable: true }) stripeCustomerId: string;
  @Column({ type: 'jsonb', nullable: true }) cardDetails: {
    last4: string; brand: string; expMonth: number; expYear: number;
  };
  @Column({ default: false }) isDefault: boolean;
  @OneToMany(() => PaymentEntity, p => p.method) payments: PaymentEntity[];
}
```

### Feature Usage Tracking (usage-based metering)

```typescript
// entities/feature-usage.entity.ts
export type FeatureType = 'ai_requests' | 'storage_gb' | 'api_calls' | 'team_members';

@Entity('feature_usage')
export class FeatureUsageEntity extends BaseEntity {
  @Column() subscriptionId: string;
  @ManyToOne(() => SubscriptionEntity) subscription: SubscriptionEntity;
  @Column() featureType: FeatureType;
  @Column({ default: 0 }) usedCount: number;
  @Column({ nullable: true }) limit: number;     // null = unlimited
  @Column({ nullable: true }) lastReset: Date;

  get isOverLimit(): boolean {
    return this.limit !== null && this.usedCount >= this.limit;
  }
}

// In SubscriptionService
async checkAndIncrementUsage(subscriptionId: string, feature: FeatureType): Promise<boolean> {
  const usage = await this.featureUsageRepo.findOne({ subscriptionId, featureType: feature });
  if (!usage) throw new NotFoundException('Feature not found in this plan');
  if (usage.isOverLimit) return false; // caller handles 402 or 429
  await this.featureUsageRepo.increment({ id: usage.id }, 'usedCount', 1);
  return true;
}
```

---

## Stripe Subscription Flow

### End-to-End Sequence

```
Customer            Your Frontend          Your API              Stripe
────────            ─────────────          ────────              ──────
  │  Click "Subscribe"   │                    │                    │
  │─────────────────────►│                    │                    │
  │                      │  POST /checkout    │                    │
  │                      │───────────────────►│ createOrGetCustomer│
  │                      │                    │───────────────────►│
  │                      │                    │  Create Checkout   │
  │                      │                    │  Session           │
  │                      │                    │───────────────────►│
  │                      │  { checkoutUrl }   │◄───────────────────│
  │  Redirect to Stripe  │◄───────────────────│                    │
  │─────────────────────►│                    │                    │
  │  Pay card            │                    │                    │
  │                      │                    │◄── Webhook ────────│
  │                      │                    │  checkout.session.completed
  │                      │                    │  Activate subscription
  │  Redirect success_url│◄───────────────────│                    │
```

### Implementation

```typescript
// POST /payments/checkout/subscription
async createSubscriptionCheckout(userId: string, planId: string, type: 'monthly' | 'yearly') {
  const user = await this.userRepo.findById(userId);
  const plan = await this.planRepo.findById(planId);
  const priceId = type === 'monthly' ? plan.stripePriceIdMonthly : plan.stripePriceIdYearly;

  const customer = await this.stripeService.getOrCreateCustomer(user.email, user.fullName, user.stripeCustomerId);
  if (!user.stripeCustomerId) {
    await this.userRepo.update(userId, { stripeCustomerId: customer.id });
  }

  const session = await this.stripe.checkout.sessions.create({
    customer: customer.id,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: { metadata: { userId, planId, type } },
    success_url: `${this.config.get('FRONTEND_URL')}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${this.config.get('FRONTEND_URL')}/billing`,
    allow_promotion_codes: true,
    billing_address_collection: 'required',
  });

  return { checkoutUrl: session.url };
}
```

---

## Webhook Handling

**Critical**: must receive raw body for signature verification. Already handled in `main.ts` (`rawBody: true`).

```typescript
// @Public() POST /payments/stripe/webhook
async handleWebhook(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') sig: string) {
  let event: Stripe.Event;

  try {
    event = this.stripe.webhooks.constructEvent(req.rawBody, sig, this.config.get('STRIPE_WEBHOOK_SECRET'));
  } catch (err) {
    throw new BadRequestException(`Webhook signature verification failed: ${err.message}`);
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const { userId, planId, type } = session.subscription_data?.metadata || {};

      // 1. Create/activate subscription in DB
      const stripeSubscription = await this.stripe.subscriptions.retrieve(session.subscription as string);
      await this.subscriptionService.createFromStripe({
        userId, planId,
        stripeSubscriptionId: stripeSubscription.id,
        stripeCustomerId: session.customer as string,
        status: SubscriptionStatus.ACTIVE,
        type: type as SubscriptionType,
        startDate: new Date(stripeSubscription.current_period_start * 1000),
        endDate:   new Date(stripeSubscription.current_period_end * 1000),
        paymentAmount: stripeSubscription.items.data[0].price.unit_amount / 100,
        autoRenew: true,
        nextBillingDate: new Date(stripeSubscription.current_period_end * 1000),
      });

      // 2. Create payment record
      await this.paymentService.create({
        userId, amount: stripeSubscription.items.data[0].price.unit_amount / 100,
        status: PaymentStatus.PAID, stripePaymentIntentId: session.payment_intent as string,
        isRecurring: true, date: new Date(),
      });

      // 3. Send welcome/confirmation email
      await this.queue.sendEmail({ to: userEmail, subject: 'Subscription Active', html: '...' });
      break;
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription;
      await this.subscriptionService.updateFromStripe(sub.metadata.userId, {
        status: sub.status as SubscriptionStatus,
        endDate: new Date(sub.current_period_end * 1000),
        canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
      });
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      await this.subscriptionService.cancel(sub.metadata.userId);
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      await this.subscriptionService.markPastDue(invoice.subscription as string);
      // Send payment failed email
      break;
    }
  }

  return { received: true };
}
```

### Test locally

```bash
# Install Stripe CLI
stripe listen --forward-to localhost:3000/api/v1/payments/stripe/webhook

# Trigger specific events
stripe trigger checkout.session.completed
stripe trigger customer.subscription.deleted
stripe trigger invoice.payment_failed
```

---

## Customer Portal (Billing)

Let Stripe handle the billing portal — users can update card, cancel, download invoices.

```typescript
async createBillingPortalSession(userId: string): Promise<string> {
  const user = await this.userRepo.findById(userId);
  if (!user.stripeCustomerId) throw new BadRequestException('No Stripe customer found');

  const session = await this.stripe.billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: `${this.config.get('FRONTEND_URL')}/billing`,
  });

  return session.url;
}

// Controller
@Get('portal')
async billingPortal(@CurrentUser('id') userId: string) {
  const url = await this.paymentsService.createBillingPortalSession(userId);
  return { url };
}
```

> Enable Customer Portal in Stripe Dashboard → Billing → Customer Portal

---

## Refunds

```typescript
async refund(paymentIntentId: string, amount?: number): Promise<Stripe.Refund> {
  return this.stripe.refunds.create({
    payment_intent: paymentIntentId,
    amount,  // in cents — omit for full refund
    reason: 'requested_by_customer',
  });
}

// After refund: update PaymentEntity.status = REFUNDED, create Transaction(type=REFUND)
```

---

## Usage-Based Billing

```typescript
// 1. Create metered price in Stripe Dashboard (billing_scheme: per_unit, usage_type: metered)
// 2. Report usage to Stripe per billing period

async reportUsage(subscriptionItemId: string, quantity: number): Promise<void> {
  await this.stripe.subscriptionItems.createUsageRecord(subscriptionItemId, {
    quantity,
    timestamp: Math.floor(Date.now() / 1000),
    action: 'increment',
  });
}

// 3. Track locally in FeatureUsageEntity
// 4. Stripe computes the invoice at period end
```

---

## Idempotency

Stripe supports idempotency keys — retry-safe. Use for critical operations:

```typescript
await this.stripe.paymentIntents.create(
  { amount, currency, customer },
  { idempotencyKey: `payment-${userId}-${orderId}` },
);
```

---

## Multi-Currency

```typescript
// Detect currency from IP or user profile
const session = await this.stripe.checkout.sessions.create({
  currency: userCurrency,   // 'usd', 'eur', 'brl', 'mxn', 'ars', 'cop'
  ...
});

// Or set in the Price object on Stripe Dashboard per region
```

---

## Testing with Stripe CLI

```bash
# Test cards
4242 4242 4242 4242  →  Always succeeds
4000 0025 0000 3155  →  3D Secure required
4000 0000 0000 9995  →  Always declines

# Watch webhook events in real-time
stripe listen --forward-to localhost:3000/api/v1/payments/stripe/webhook

# Manually trigger
stripe trigger payment_intent.succeeded
```

---

## MercadoPago (LATAM)

Best for: Argentina, Brasil, México, Colombia, Chile, Perú, Uruguay.

Why over Stripe in LATAM:
- Accepts local payment methods (OXXO, Boleto, PIX, Rapipago, etc.)
- Installments (cuotas) natively
- ARS/BRL/MXN/COP supported

```bash
npm install mercadopago
```

```typescript
// mercadopago.service.ts
import MercadoPago, { Preference, Payment } from 'mercadopago';

@Injectable()
export class MercadoPagoService {
  private readonly client: MercadoPago;

  constructor(private readonly config: ConfigService) {
    this.client = new MercadoPago({ accessToken: config.get('MP_ACCESS_TOKEN') });
  }

  async createPreference(order: { title: string; price: number; userId: string }) {
    const preference = new Preference(this.client);
    const result = await preference.create({
      body: {
        items: [{ title: order.title, quantity: 1, unit_price: order.price }],
        back_urls: {
          success: `${this.config.get('FRONTEND_URL')}/payment/success`,
          failure: `${this.config.get('FRONTEND_URL')}/payment/failure`,
          pending: `${this.config.get('FRONTEND_URL')}/payment/pending`,
        },
        auto_return: 'approved',
        external_reference: order.userId,
        notification_url: `${this.config.get('API_URL')}/payments/mp/webhook`,
      },
    });
    return { checkoutUrl: result.init_point, preferenceId: result.id };
  }

  async handleWebhook(body: any) {
    if (body.type === 'payment') {
      const payment = new Payment(this.client);
      const detail = await payment.get({ id: body.data.id });
      if (detail.status === 'approved') {
        await this.activateOrder(detail.external_reference, detail.transaction_amount);
      }
    }
  }
}
```

**Webhook**: Verify signature with `X-Signature` header:
```typescript
const ts = req.headers['x-request-id'];
const xSignature = req.headers['x-signature'];
const hash = crypto.createHmac('sha256', MP_SECRET).update(`ts:${ts};v1:${body.data.id}`).digest('hex');
if (`ts=${ts},v1=${hash}` !== xSignature) throw new UnauthorizedException();
```

**ENV**:
```env
MP_ACCESS_TOKEN=APP_USR-...
MP_PUBLIC_KEY=APP_USR-...
MP_WEBHOOK_SECRET=...
```

---

## PayPal

```bash
npm install @paypal/checkout-server-sdk
```

```typescript
// paypal.service.ts
import * as paypal from '@paypal/checkout-server-sdk';

@Injectable()
export class PayPalService {
  private readonly client: paypal.core.PayPalHttpClient;

  constructor(private readonly config: ConfigService) {
    const env = config.get('NODE_ENV') === 'production'
      ? new paypal.core.LiveEnvironment(config.get('PAYPAL_CLIENT_ID'), config.get('PAYPAL_CLIENT_SECRET'))
      : new paypal.core.SandboxEnvironment(config.get('PAYPAL_CLIENT_ID'), config.get('PAYPAL_CLIENT_SECRET'));
    this.client = new paypal.core.PayPalHttpClient(env);
  }

  async createOrder(amount: number, currency = 'USD') {
    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer('return=minimal');
    request.requestBody({
      intent: 'CAPTURE',
      purchase_units: [{ amount: { currency_code: currency, value: amount.toFixed(2) } }],
    });
    const response = await this.client.execute(request);
    return response.result;
  }

  async captureOrder(orderId: string) {
    const request = new paypal.orders.OrdersCaptureRequest(orderId);
    const response = await this.client.execute(request);
    return response.result;
  }
}
```

**Best for**: global reach, buyers without cards (PayPal balance).

---

## Conekta (México — OXXO)

For Mexican OXXO cash payments.

```bash
npm install conekta
```

```typescript
import Conekta from 'conekta';

Conekta.api_key = process.env.CONEKTA_PRIVATE_KEY;
Conekta.locale = 'es';

const order = await Conekta.Order.create({
  currency: 'MXN',
  customer_info: { name: 'Customer', email: 'user@example.com', phone: '+52...' },
  line_items: [{ name: 'Subscription', unit_price: 50000, quantity: 1 }],  // cents
  charges: [{ payment_method: { type: 'oxxo_cash', expires_at: Math.floor(Date.now() / 1000) + 172800 } }],
});
// order.charges[0].payment_method.reference → OXXO reference number to show customer
```

---

## PayU (Colombia, Perú, etc.)

For Colombia (PSE, Nequi, Baloto), Perú, Chile.

```typescript
// PayU uses form-based redirect + signature verification
const signature = md5(`apiKey~merchantId~referenceCode~amount~currency`);

// POST to PayU endpoint with form params
// Webhook: verify notifyUrl signature
const notifySignature = md5(`apiKey~merchantId~referenceCode~amount~currency~transactionState`);
```

---

## PCI Compliance

✅ **What this template does right:**
- Card data never touches your server — Stripe handles it via Checkout / Elements
- `STRIPE_SECRET_KEY` only server-side (never in frontend env)
- Webhook signature verified before processing
- Payment details stored as metadata/references only (never raw card numbers)
- HTTPS enforced via Helmet + reverse proxy

❌ **What would make you OUT of scope:**
- Logging request bodies that include card numbers
- Storing CVV
- Handling raw card form submissions without Stripe.js

---

## Migrating Between Processors

### Stripe → MercadoPago

1. Keep dual-write: write to both during transition
2. Existing Stripe subscriptions stay in Stripe until cancel date
3. New subscriptions go to MercadoPago
4. Update `payments.controller.ts` to route by user region

```typescript
async createCheckout(userId: string, planId: string) {
  const user = await this.userRepo.findById(userId);
  if (LATAM_COUNTRIES.includes(user.country)) {
    return this.mercadoPago.createPreference({ ... });
  }
  return this.stripe.createSubscriptionCheckout({ ... });
}
```

### TypeORM → Prisma (DB layer only)

See `docs/DATABASES.md` for the full Prisma migration guide. The payment entities listed above translate 1:1 to Prisma schema:

```prisma
model Subscription {
  id                   String   @id @default(uuid())
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt
  userId               String
  planId               String
  status               SubscriptionStatus @default(INACTIVE)
  type                 SubscriptionType   @default(MONTHLY)
  startDate            DateTime
  endDate              DateTime
  paymentAmount        Decimal  @db.Decimal(10, 2)
  stripeSubscriptionId String?
  stripeCustomerId     String?
  autoRenew            Boolean  @default(true)
  nextBillingDate      DateTime?
  canceledAt           DateTime?
  user                 User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  plan                 Plan     @relation(fields: [planId], references: [id])
  invoices             Invoice[]
}
```

Migration script (TypeORM → Prisma, keep data):
```bash
# 1. Generate Prisma schema from existing DB
npx prisma db pull

# 2. Generate Prisma client
npx prisma generate

# 3. Replace TypeORM repositories with Prisma client calls
# FROM:  this.subscriptionRepo.findOne({ userId })
# TO:    this.prisma.subscription.findFirst({ where: { userId } })
```

---

## European Payment Processors (from notbetting — production)

6 processors from a real production system serving Spain/EU. All follow the same pattern: create payment link → redirect user → handle webhook → call `confirmPayment()`.

### Table of Contents (EU processors)

17. [Skrill (EU eWallet)](#skrill-eu-ewallet)
18. [Redsys / TPV (Spain — bank cards)](#redsys--tpv-spain--bank-cards)
19. [TS Pay / Bizum (Spain mobile)](#ts-pay--bizum-spain-mobile)
20. [Guardarian (card → crypto on-ramp)](#guardarian-card--crypto-on-ramp)
21. [OxaPay (pure crypto)](#oxapay-pure-crypto)
22. [Payop (multi-method aggregator)](#payop-multi-method-aggregator)
23. [confirmPayment — universal handler](#confirmpayment--universal-handler)

---

### Skrill (EU eWallet)

Visa/MC + Skrill wallet balance. Popular in EU without credit card users.

```bash
SKRILL_EMAIL=merchant@yourdomain.com
SKRILL_SECRET=your_md5_secret
SKRILL_PAY_URL=https://pay.skrill.com
PAYMENT_BASE_CALLBACK=https://yourapi.com
```

```typescript
async createSkrillPayment(amount: number, userEmail: string, orderId: string) {
  const params = new URLSearchParams({
    pay_to_email: process.env.SKRILL_EMAIL,
    pay_from_email: userEmail,
    transaction_id: String(Date.now()),
    amount: String(amount),
    currency: 'EUR',
    payment_methods: 'WLT',  // WLT = wallet, CC = card, DID = direct debit
    return_url: `${process.env.FRONTEND_URL}/payment/success`,
    cancel_url: `${process.env.FRONTEND_URL}/payment/cancel`,
    status_url: `${process.env.PAYMENT_BASE_CALLBACK}/api/payments/webhook/skrill`,
  });

  const res = await fetch(process.env.SKRILL_PAY_URL, {
    method: 'POST',
    body: params.toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  // Skrill returns HTML with meta refresh redirect
  const html = await res.text();
  const match = html.match(/<meta http-equiv=refresh content="0; url=(.*?)">/);
  return match?.[1];
}

// POST /payments/webhook/skrill — receives form-encoded data
// status=2 means payment processed
async handleSkrillWebhook(body: string) {
  const params = new URLSearchParams(body);
  const data = Object.fromEntries(params.entries());

  if (data.status !== '2') return;

  // Verify MD5 signature
  const expected = crypto.createHash('md5')
    .update(`${data.merchant_id}${data.transaction_id}${data.mb_amount}${data.mb_currency}${data.status}${process.env.SKRILL_SECRET}`)
    .digest('hex').toUpperCase();

  if (expected !== data.md5sig) throw new UnauthorizedException('Invalid Skrill signature');

  await this.confirmPayment(Number(data.amount), data.orderId);
}
```

---

### Redsys / TPV (Spain — bank cards)

Spain's bank card network (BBVA, Santander, CaixaBank, etc.). Required for Spanish market card payments. Also supports Bizum via Redsys gateway.

```bash
BBVA_MERCHANT_ID=364227116
BBVA_SECRET=base64EncodedSecret==
BBVA_TPV_URL=https://sis.redsys.es/sis/realizarPago
PAYMENT_BASE_CALLBACK=https://yourapi.com
```

```typescript
import * as CryptoJS from 'crypto-js';

async createRedsysPayment(amount: number, orderId: string) {
  const trackId = String(Math.floor(Math.random() * 9000000) + 1000000);

  const data = {
    DS_MERCHANT_AMOUNT: String(Math.round(amount * 100)),  // cents
    DS_MERCHANT_CURRENCY: '978',                           // EUR ISO 4217
    DS_MERCHANT_MERCHANTCODE: process.env.BBVA_MERCHANT_ID,
    DS_MERCHANT_ORDER: trackId,
    DS_MERCHANT_TERMINAL: '1',
    DS_MERCHANT_TRANSACTIONTYPE: '0',
    Ds_Merchant_MerchantURL: `${process.env.PAYMENT_BASE_CALLBACK}/api/payments/webhook/redsys`,
    Ds_Merchant_UrlOK: `${process.env.FRONTEND_URL}/payment/success`,
    Ds_Merchant_UrlKO: `${process.env.FRONTEND_URL}/payment/error`,
  };

  // 1. Base64-encode the JSON parameters
  const encodedParams = Buffer.from(JSON.stringify(data)).toString('base64');

  // 2. Derive per-order key: 3DES(orderId, merchantSecret)
  const secretKey = Buffer.from(process.env.BBVA_SECRET, 'base64');
  const orderKey = crypto.createCipheriv('des-ede3-cbc', secretKey, Buffer.alloc(8, 0))
    .update(trackId, 'utf8');

  // 3. HMAC-SHA256(encodedParams, derivedKey) → base64url
  const signature = crypto.createHmac('sha256', orderKey)
    .update(encodedParams)
    .digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_');

  return {
    Ds_MerchantParameters: encodedParams,
    Ds_Signature: signature,
    Ds_SignatureVersion: 'HMAC_SHA256_V1',
    tpvUrl: process.env.BBVA_TPV_URL,
  };
  // POST this as form to tpvUrl (redirect user)
}

// Webhook: form-encoded, Ds_Response=0000 = success
async handleRedsysWebhook(body: string) {
  const params = new URLSearchParams(body);
  const merchantParams = params.get('Ds_MerchantParameters');
  const decoded = JSON.parse(Buffer.from(merchantParams, 'base64').toString());

  const secretKey = Buffer.from(process.env.BBVA_SECRET, 'base64');
  const orderKey = crypto.createCipheriv('des-ede3-cbc', secretKey, Buffer.alloc(8, 0))
    .update(decoded.DS_MERCHANT_ORDER ?? decoded.Ds_Order, 'utf8');
  const expected = crypto.createHmac('sha256', orderKey)
    .update(merchantParams)
    .digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_');

  if (expected !== params.get('Ds_Signature')) throw new UnauthorizedException();

  const amount = Number(decoded.Ds_Amount) / 100;
  await this.confirmPayment(amount, decoded.Ds_Order);
}
```

---

### TS Pay / Bizum (Spain mobile)

Bizum is Spain's dominant mobile payment method (30M+ users). TS Pay wraps Bizum for merchant integration.

```bash
TSPAY_SECRET_KEY=your_hmac_secret
TSPAY_MERCHANT_CODE=your_merchant_code
TSPAY_CREATE_URL=https://api.ts-pay.io/payment/create
```

```typescript
async createBizumPayment(amount: number, orderId: string, description: string) {
  const params = {
    order_id: orderId,
    product_name: description,
    payment_method: 'bizum',
    amount: amount.toFixed(2),
    merchant_code: process.env.TSPAY_MERCHANT_CODE,
    url_ok: `${process.env.FRONTEND_URL}/payment/success`,
    url_ko: `${process.env.FRONTEND_URL}/payment/error`,
    notification_url: `${process.env.PAYMENT_BASE_CALLBACK}/api/payments/webhook/tspay`,
  };

  const base64Params = Buffer.from(JSON.stringify(params)).toString('base64');
  const signature = crypto.createHmac('sha256', process.env.TSPAY_SECRET_KEY)
    .update(base64Params).digest('hex');

  return { tspay_parameters: base64Params, tspay_signature: signature };
  // POST as form to TSPAY_CREATE_URL
}

// Webhook: { nt_parameters: base64, nt_signature: hmac }
async handleTsPayWebhook(body: { nt_parameters: string; nt_signature: string }) {
  const expected = crypto.createHmac('sha256', process.env.TSPAY_SECRET_KEY)
    .update(body.nt_parameters).digest('hex');

  if (expected !== body.nt_signature) throw new UnauthorizedException();

  const decoded = JSON.parse(Buffer.from(body.nt_parameters, 'base64').toString());
  if (decoded.paid_status !== 'ok') return;

  await this.confirmPayment(Number(decoded.amount), decoded.order_id);
}
```

**Gotcha**: TS Pay runs a cron reconciliation job — some payments confirm async up to 10 min after user action. Store `PENDING` status and let webhook finalize it.

---

### Guardarian (card → crypto on-ramp)

User pays with Visa/MC, receives crypto at your wallet. EUR/USD → USDT/ETH/BTC. No crypto wallet needed on user side.

```bash
GUARDARIAN_SECRET_KEY=your_api_key
GUARDARIAN_PAYOUT_ADDRESS=0xYourUSDTWallet
GUARDARIAN_CREATE_URL=https://api.guardarian.com/v1/transaction/create
```

```typescript
async createGuardarianPayment(amount: number, userEmail: string, trackId: string) {
  const payload = {
    from_amount: amount,
    from_currency: 'EUR',
    to_currency: 'USDT',
    to_network: 'BSC',           // or TRC20, ERC20
    payout_info: { payout_address: process.env.GUARDARIAN_PAYOUT_ADDRESS },
    customer: { contact_info: { email: userEmail } },
    external_partner_link_id: trackId,
    redirects: {
      successful: `${process.env.FRONTEND_URL}/payment/success`,
      cancelled: `${process.env.FRONTEND_URL}/payment/cancel`,
      failed: `${process.env.FRONTEND_URL}/payment/error`,
    },
  };

  const res = await fetch(process.env.GUARDARIAN_CREATE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': process.env.GUARDARIAN_SECRET_KEY,
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  return data.redirect_url;
}

// Webhook: status='finished' = success
// WARNING: Guardarian has NO webhook signature — verify amount server-side
async handleGuardarianWebhook(body: { payload: any }) {
  const { payload } = body;
  if (payload.status !== 'finished') return;

  await this.confirmPaymentByTrackId(
    Number(payload.from_amount),
    Number(payload.external_partner_link_id),
  );
}
```

---

### OxaPay (pure crypto)

For users who already have crypto and want to pay directly (BTC, ETH, USDT, TON, and 100+ others).

```bash
OXAPAY_MERCHANT_KEY=your_merchant_key
OXAPAY_API_URL=https://api.oxapay.com
```

```typescript
async createOxapayPayment(amount: number, orderId: string, userEmail: string) {
  const payload = {
    merchant: process.env.OXAPAY_MERCHANT_KEY,
    orderId,
    amount,
    currency: 'EUR',    // amount in EUR; user selects crypto at checkout
    lifeTime: 30,       // minutes until order expires
    feePaidByPayer: 1,  // 0 = merchant absorbs fee
    callbackUrl: `${process.env.PAYMENT_BASE_CALLBACK}/api/payments/webhook/oxapay`,
    returnUrl: `${process.env.FRONTEND_URL}/payment/success`,
    email: userEmail,
  };

  const res = await fetch(`${process.env.OXAPAY_API_URL}/merchants/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  return data.payLink;
}

// Webhook: status=Paid = success, verified via HMAC-SHA512
async handleOxapayWebhook(body: Record<string, any>) {
  if (body.status !== 'Paid') return;

  const expected = crypto.createHmac('sha512', process.env.OXAPAY_MERCHANT_KEY)
    .update(JSON.stringify(body)).digest('hex');

  if (expected !== body.hmac) throw new UnauthorizedException();

  await this.confirmPayment(Number(body.amount), body.trackId);
}
```

---

### Payop (multi-method aggregator)

Cards + local payments for 150+ countries: iDEAL (NL), Sofort (DE), BLIK (PL), P24 (PL), SEPA, etc.

```bash
PAYOP_PUBLIC_KEY=your_public_key
PAYOP_SECRET_KEY=your_secret_key
PAYOP_CREATE_URL=https://payop.com/v1/invoices/create
PAYOP_INVOICE_URL=https://checkout.payop.com/en/payment/invoice-preprocessing
```

```typescript
async createPayopPayment(amount: number, orderId: string, description: string) {
  const signature = crypto.createHash('sha256')
    .update(`${amount}:EUR:${orderId}:${process.env.PAYOP_SECRET_KEY}`)
    .digest('hex');

  const payload = {
    publicKey: process.env.PAYOP_PUBLIC_KEY,
    order: { id: orderId, amount, currency: 'EUR', description },
    signature,
    payer: { email: 'user@example.com' },
    language: 'en',
    resultUrl: `${process.env.FRONTEND_URL}/payment/success`,
    failPath: `${process.env.FRONTEND_URL}/payment/error`,
  };

  const res = await fetch(process.env.PAYOP_CREATE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  return `${process.env.PAYOP_INVOICE_URL}/${data.data}`;
}

// Webhook: IPN callback with status=success
async handlePayopWebhook(body: { status: string; orderId: string; amount: number }) {
  if (body.status !== 'success') return;
  await this.confirmPayment(body.amount, body.orderId);
}
```

---

### confirmPayment — universal handler

All processors converge here. Business logic lives in one place, not spread across webhook handlers.

```typescript
// payments.service.ts
async confirmPayment(amount: number, orderId: string): Promise<void> {
  const payment = await this.paymentRepo.findOne({ where: { id: orderId, status: PaymentStatus.PENDING } });
  if (!payment) throw new Error(`Payment not found: ${orderId}`);

  // Fraud prevention: verify amount matches (allow 1 cent rounding)
  if (Math.abs(payment.amount - amount) > 0.01) {
    this.logger.error(`Amount mismatch: expected ${payment.amount}, received ${amount}`);
    throw new Error('Amount mismatch');
  }

  // Atomic update
  await this.dataSource.transaction(async (tx) => {
    await tx.update(PaymentEntity, payment.id, { status: PaymentStatus.PAID });
    await this.subscriptionService.activateForPayment(payment, tx);
    await this.invoiceService.generate(payment, tx);
  });

  // Fire async domain event (email, webhook, notifications)
  this.eventEmitter.emit('payment.confirmed', { paymentId: payment.id, userId: payment.userId });
}
```

**Processor comparison:**

| Processor | Method | Market | Signature |
|-----------|--------|--------|-----------|
| Stripe | Card + saved methods | Global | HMAC-SHA256 |
| MercadoPago | Card + local (LATAM) | LATAM | HMAC-SHA256 |
| Skrill | eWallet + card | EU | MD5 |
| Redsys/TPV | Spanish bank cards | Spain | HMAC-SHA256 + 3DES |
| TS Pay/Bizum | Mobile (Spain) | Spain | HMAC-SHA256 |
| Guardarian | Card → USDT/crypto | Global | None (verify amount) |
| OxaPay | Native crypto | Global | HMAC-SHA512 |
| Payop | 150+ methods | EU/Global | SHA256 |
