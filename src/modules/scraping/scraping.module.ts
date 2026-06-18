import { Module } from '@nestjs/common';
import { ScrapingService } from './services/scraping.service';
import { PlaywrightService } from './services/playwright.service';
import { ScrapingController } from './scraping.controller';
import { RetryService } from '../../shared/services/retry.service';

@Module({
  providers: [ScrapingService, PlaywrightService, RetryService],
  controllers: [ScrapingController],
  exports: [ScrapingService, PlaywrightService],
})
export class ScrapingModule {}
