import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { StripeService } from './stripe.service';

jest.mock('stripe');

const MockStripe = Stripe as jest.MockedClass<typeof Stripe>;

describe('StripeService', () => {
  let service: StripeService;
  let mockStripe: jest.Mocked<Stripe>;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(() => {
    configService = {
      get: jest.fn().mockImplementation((key: string) => {
        const map: Record<string, string> = {
          STRIPE_SECRET_KEY: 'sk_test_mock',
          STRIPE_WEBHOOK_SECRET: 'whsec_mock',
          FRONTEND_URL: 'https://app.test.com',
        };
        return map[key];
      }),
    } as any;

    service = new StripeService(configService);

    // Access the mocked stripe instance
    mockStripe = (service as any).stripe;
  });

  describe('createCustomer', () => {
    it('creates customer with email and name', async () => {
      const customer = { id: 'cus_mock', email: 'user@test.com' } as Stripe.Customer;
      mockStripe.customers = { create: jest.fn().mockResolvedValue(customer) } as any;

      const result = await service.createCustomer('user@test.com', 'John Doe');

      expect(mockStripe.customers.create).toHaveBeenCalledWith({ email: 'user@test.com', name: 'John Doe' });
      expect(result).toEqual(customer);
    });
  });

  describe('getOrCreateCustomer', () => {
    it('retrieves existing customer when ID provided', async () => {
      const customer = { id: 'cus_existing' } as Stripe.Customer;
      mockStripe.customers = { retrieve: jest.fn().mockResolvedValue(customer) } as any;

      const result = await service.getOrCreateCustomer('user@test.com', 'John', 'cus_existing');

      expect(mockStripe.customers.retrieve).toHaveBeenCalledWith('cus_existing');
      expect(result).toEqual(customer);
    });

    it('creates new customer when no ID provided', async () => {
      const customer = { id: 'cus_new' } as Stripe.Customer;
      mockStripe.customers = { create: jest.fn().mockResolvedValue(customer) } as any;

      const result = await service.getOrCreateCustomer('user@test.com', 'John');

      expect(mockStripe.customers.create).toHaveBeenCalled();
      expect(result).toEqual(customer);
    });
  });

  describe('createSubscriptionCheckout', () => {
    it('creates checkout session and returns URL', async () => {
      const session = { id: 'cs_mock', url: 'https://checkout.stripe.com/...' } as Stripe.Checkout.Session;
      mockStripe.checkout = { sessions: { create: jest.fn().mockResolvedValue(session) } } as any;

      const result = await service.createSubscriptionCheckout({
        priceId: 'price_mock',
        userId: 'user-uuid',
        successUrl: 'https://app.test.com/success',
        cancelUrl: 'https://app.test.com/cancel',
      });

      expect(result.url).toBe(session.url);
      expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({ mode: 'subscription' }),
      );
    });
  });

  describe('cancelSubscription', () => {
    it('cancels subscription immediately', async () => {
      const sub = { id: 'sub_mock', status: 'canceled' } as Stripe.Subscription;
      mockStripe.subscriptions = { cancel: jest.fn().mockResolvedValue(sub) } as any;

      const result = await service.cancelSubscription('sub_mock');

      expect(mockStripe.subscriptions.cancel).toHaveBeenCalledWith('sub_mock');
      expect(result.status).toBe('canceled');
    });
  });

  describe('createRefund', () => {
    it('creates full refund for payment intent', async () => {
      const refund = { id: 're_mock', amount: 5000 } as Stripe.Refund;
      mockStripe.refunds = { create: jest.fn().mockResolvedValue(refund) } as any;

      const result = await service.createRefund('pi_mock');

      expect(mockStripe.refunds.create).toHaveBeenCalledWith(
        expect.objectContaining({ payment_intent: 'pi_mock' }),
      );
      expect(result.id).toBe('re_mock');
    });

    it('creates partial refund when amount provided', async () => {
      const refund = { id: 're_partial', amount: 2500 } as Stripe.Refund;
      mockStripe.refunds = { create: jest.fn().mockResolvedValue(refund) } as any;

      await service.createRefund('pi_mock', 2500);

      expect(mockStripe.refunds.create).toHaveBeenCalledWith(
        expect.objectContaining({ payment_intent: 'pi_mock', amount: 2500 }),
      );
    });
  });

  describe('constructWebhookEvent', () => {
    it('throws BadRequestException on invalid signature', () => {
      mockStripe.webhooks = {
        constructEvent: jest.fn().mockImplementation(() => {
          throw new Error('No signatures found matching the expected signature');
        }),
      } as any;

      expect(() =>
        service.constructWebhookEvent(Buffer.from('payload'), 'bad-sig'),
      ).toThrow(BadRequestException);
    });

    it('returns event on valid signature', () => {
      const event = { id: 'evt_mock', type: 'checkout.session.completed' } as Stripe.Event;
      mockStripe.webhooks = { constructEvent: jest.fn().mockReturnValue(event) } as any;

      const result = service.constructWebhookEvent(Buffer.from('payload'), 'valid-sig');

      expect(result).toEqual(event);
    });
  });
});
