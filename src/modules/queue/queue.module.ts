import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QueueService } from './queue.service';
import { EmailProcessor } from './processors/email.processor';
import { AiProcessor } from './processors/ai.processor';
import { ScrapingProcessor } from './processors/scraping.processor';
import { ExportProcessor } from './processors/export.processor';
import { QUEUES } from './queue.config';
import { NotificationsModule } from '../notifications/notifications.module';
import { ScrapingModule } from '../scraping/scraping.module';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: QUEUES.EMAIL },
      { name: QUEUES.NOTIFICATIONS },
      { name: QUEUES.SCRAPING },
      { name: QUEUES.EXPORTS },
      { name: QUEUES.AI_PROCESSING },
    ),
    NotificationsModule,
    ScrapingModule,
  ],
  providers: [QueueService, EmailProcessor, AiProcessor, ScrapingProcessor, ExportProcessor],
  exports: [QueueService],
})
export class QueueModule {}
