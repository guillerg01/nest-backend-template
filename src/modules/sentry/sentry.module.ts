import { Module, OnApplicationBootstrap } from '@nestjs/common';
import { SentryService } from './sentry.service';

@Module({
  providers: [SentryService],
  exports: [SentryService],
})
export class SentryModule implements OnApplicationBootstrap {
  constructor(private readonly sentryService: SentryService) {}

  onApplicationBootstrap() {
    this.sentryService.init();
  }
}
