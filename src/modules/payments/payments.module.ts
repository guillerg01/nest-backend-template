import { Module } from '@nestjs/common';
import { StripeService } from './services/stripe.service';
import { PaymentsController } from './payments.controller';

@Module({
  providers: [StripeService],
  controllers: [PaymentsController],
  exports: [StripeService],
})
export class PaymentsModule {}
