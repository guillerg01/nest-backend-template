import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { StripeService } from './services/stripe.service';
import { Public } from '../../shared/decorators/public.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';

class CreateCheckoutDto {
  @ApiProperty({ example: 'price_xxx' })
  @IsString()
  priceId: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  successUrl?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  cancelUrl?: string;
}

class CreateOneTimeDto {
  @ApiProperty({ example: 1000, description: 'Amount in cents' })
  @IsNumber()
  amount: number;

  @ApiProperty({ example: 'Premium Feature Access' })
  @IsString()
  description: string;
}

@ApiTags('Payments')
@ApiBearerAuth()
@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(private readonly stripeService: StripeService) {}

  @Post('checkout/subscription')
  @ApiOperation({ summary: 'Create Stripe subscription checkout session' })
  createSubscriptionCheckout(
    @Body() dto: CreateCheckoutDto,
    @CurrentUser() user: any,
  ) {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
    return this.stripeService.createSubscriptionCheckout({
      priceId: dto.priceId,
      customerEmail: user.email,
      userId: user.id,
      successUrl: dto.successUrl || `${frontendUrl}/payment/success`,
      cancelUrl: dto.cancelUrl || `${frontendUrl}/payment/cancel`,
    });
  }

  @Post('checkout/one-time')
  @ApiOperation({ summary: 'Create one-time payment checkout session' })
  createOneTimeCheckout(@Body() dto: CreateOneTimeDto, @CurrentUser() user: any) {
    return this.stripeService.createOneTimeCheckout({
      amount: dto.amount,
      description: dto.description,
      customerEmail: user.email,
    });
  }

  // ─── Webhook — MUST be @Public and use raw body ──────────────────────────
  @Public()
  @Post('stripe/webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stripe webhook endpoint (raw body required)' })
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    const event = this.stripeService.constructWebhookEvent(
      req.rawBody,
      signature,
    );

    this.logger.log(`Stripe event: ${event.type}`);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as any;
        this.logger.log(`Checkout completed for user: ${session.metadata?.userId}`);
        // TODO: activate subscription in DB
        break;
      }
      case 'customer.subscription.updated': {
        const subscription = event.data.object as any;
        this.logger.log(`Subscription updated: ${subscription.id}`);
        // TODO: update subscription status in DB
        break;
      }
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as any;
        this.logger.log(`Subscription cancelled: ${subscription.id}`);
        // TODO: deactivate subscription in DB
        break;
      }
      case 'charge.succeeded': {
        const charge = event.data.object as any;
        this.logger.log(`Charge succeeded: ${charge.id}`);
        break;
      }
      case 'charge.failed': {
        const charge = event.data.object as any;
        this.logger.warn(`Charge failed: ${charge.id}`);
        break;
      }
      default:
        this.logger.debug(`Unhandled event type: ${event.type}`);
    }

    return { received: true };
  }
}
