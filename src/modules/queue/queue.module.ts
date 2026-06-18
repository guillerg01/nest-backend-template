import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { QueueService } from './queue.service';
import { EmailProcessor } from './processors/email.processor';
import { AiProcessor } from './processors/ai.processor';
import { QUEUES } from './queue.config';

@Module({
  imports: [
    // Register each queue
    BullModule.registerQueue(
      { name: QUEUES.EMAIL },
      { name: QUEUES.NOTIFICATIONS },
      { name: QUEUES.SCRAPING },
      { name: QUEUES.EXPORTS },
      { name: QUEUES.AI_PROCESSING },
    ),


  ],
  providers: [QueueService, EmailProcessor, AiProcessor],
  exports: [QueueService],
})
export class QueueModule {}
