import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { BullBoardModule } from '@bull-board/nestjs';
import { ExpressAdapter } from '@bull-board/express';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
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

    // Bull Board UI — accessible at /queues (protect this in production!)
    BullBoardModule.forFeature(
      { name: QUEUES.EMAIL, adapter: BullMQAdapter as any },
      { name: QUEUES.NOTIFICATIONS, adapter: BullMQAdapter as any },
      { name: QUEUES.SCRAPING, adapter: BullMQAdapter as any },
      { name: QUEUES.EXPORTS, adapter: BullMQAdapter as any },
      { name: QUEUES.AI_PROCESSING, adapter: BullMQAdapter as any },
    ),
  ],
  providers: [QueueService, EmailProcessor, AiProcessor],
  exports: [QueueService],
})
export class QueueModule {}
