import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

export interface CreateCheckoutParams {
  priceId: string;
  customerId?: string;
  customerEmail?: string;
  userId: string;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string>;
}

export interface CreateOneTimePaymentParams {
  amount: number; // in cents
  currency?: string;
  description: string;
  customerId?: string;
  customerEmail?: string;
  metadata?: Record<string, string>;
}

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private readonly stripe: Stripe;

  constructor(private readonly config: ConfigService) {
    const key = config.get<string>('STRIPE_SECRET_KEY');
    if (key) {
      this.stripe = new Stripe(key, { apiVersion: '2025-08-27.basil' });
    }
  }

  get isConfigured(): boolean {
    return !!this.stripe;
  }

  private ensureConfigured(): void {
    if (!this.stripe) {
      throw new ServiceUnavailableException(
        'Payment service not configured. Set STRIPE_SECRET_KEY environment variable.',
      );
    }
  }

  // ─── Customers ──────────────────────────────────────────────────────────

  async createCustomer(email: string, name: string): Promise<Stripe.Customer> {
    this.ensureConfigured();
    return this.stripe.customers.create({ email, name });
  }

  async getOrCreateCustomer(
    email: string,
    name: string,
    existingId?: string,
  ): Promise<Stripe.Customer> {
    this.ensureConfigured();
    if (existingId) {
      return this.stripe.customers.retrieve(existingId) as Promise<Stripe.Customer>;
    }
    return this.createCustomer(email, name);
  }

  // ─── Checkout Sessions ───────────────────────────────────────────────────

  async createSubscriptionCheckout(params: CreateCheckoutParams): Promise<Stripe.Checkout.Session> {
    this.ensureConfigured();
    return this.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: params.customerId,
      customer_email: params.customerId ? undefined : params.customerEmail,
      line_items: [{ price: params.priceId, quantity: 1 }],
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      metadata: {
        userId: params.userId,
        ...params.metadata,
      },
      subscription_data: {
        metadata: { userId: params.userId },
      },
    });
  }

  async createOneTimeCheckout(params: CreateOneTimePaymentParams): Promise<Stripe.Checkout.Session> {
    this.ensureConfigured();
    return this.stripe.checkout.sessions.create({
      mode: 'payment',
      customer: params.customerId,
      customer_email: params.customerId ? undefined : params.customerEmail,
      line_items: [
        {
          price_data: {
            currency: params.currency || 'usd',
            product_data: { name: params.description },
            unit_amount: params.amount,
          },
          quantity: 1,
        },
      ],
      success_url: `${this.config.get('FRONTEND_URL')}/payment/success`,
      cancel_url: `${this.config.get('FRONTEND_URL')}/payment/cancel`,
      metadata: params.metadata,
    });
  }

  // ─── Subscriptions ───────────────────────────────────────────────────────

  async cancelSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    this.ensureConfigured();
    return this.stripe.subscriptions.cancel(subscriptionId);
  }

  async getSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    this.ensureConfigured();
    return this.stripe.subscriptions.retrieve(subscriptionId);
  }

  // ─── Payment Intents ─────────────────────────────────────────────────────

  async createPaymentIntent(
    amount: number,
    currency = 'usd',
    customerId?: string,
    metadata?: Record<string, string>,
  ): Promise<Stripe.PaymentIntent> {
    this.ensureConfigured();
    return this.stripe.paymentIntents.create({
      amount,
      currency,
      customer: customerId,
      metadata,
      automatic_payment_methods: { enabled: true },
    });
  }

  // ─── Webhooks ────────────────────────────────────────────────────────────

  constructWebhookEvent(payload: Buffer, signature: string): Stripe.Event {
    this.ensureConfigured();
    const secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    try {
      return this.stripe.webhooks.constructEvent(payload, signature, secret);
    } catch (err) {
      this.logger.error(`Webhook signature verification failed: ${err.message}`);
      throw new BadRequestException('Invalid webhook signature');
    }
  }

  // ─── Prices & Products ───────────────────────────────────────────────────

  async listPrices(): Promise<Stripe.Price[]> {
    this.ensureConfigured();
    const { data } = await this.stripe.prices.list({ active: true, expand: ['data.product'] });
    return data;
  }

  async getPrice(priceId: string): Promise<Stripe.Price> {
    this.ensureConfigured();
    return this.stripe.prices.retrieve(priceId, { expand: ['product'] });
  }

  // ─── Refunds ─────────────────────────────────────────────────────────────

  async createRefund(paymentIntentId: string, amount?: number): Promise<Stripe.Refund> {
    this.ensureConfigured();
    return this.stripe.refunds.create({
      payment_intent: paymentIntentId,
      amount,
    });
  }
}
