import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

export const QUEUE_NAMES = {
  EMAIL: 'email',
  SCRAPING: 'scraping',
  NOTIFICATIONS: 'notifications',
  EXPORTS: 'exports',
} as const;

export interface EmailJobData {
  to: string;
  subject: string;
  html: string;
  userId?: string;
}

export interface ScrapingJobData {
  url: string;
  targetId: string;
  proxy?: string;
}

/**
 * Example processor for the 'email' queue.
 * Each queue needs its own @Processor + WorkerHost class.
 */
@Processor(QUEUE_NAMES.EMAIL)
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);

  async process(job: Job<EmailJobData>): Promise<void> {
    this.logger.log(`Processing email job ${job.id} → ${job.data.to}`);

    try {
      // Inject EmailService here and send
      // await this.emailService.send({ to: job.data.to, subject: job.data.subject, html: job.data.html });
      this.logger.log(`Email sent to ${job.data.to}`);
    } catch (error) {
      this.logger.error(`Email job ${job.id} failed: ${error.message}`);
      throw error; // BullMQ will retry based on queue config
    }
  }
}

@Processor(QUEUE_NAMES.SCRAPING)
export class ScrapingProcessor extends WorkerHost {
  private readonly logger = new Logger(ScrapingProcessor.name);

  async process(job: Job<ScrapingJobData>): Promise<{ html: string }> {
    this.logger.log(`Processing scraping job ${job.id} → ${job.data.url}`);
    // Inject ScrapingService here
    // return this.scrapingService.fetchPage({ url: job.data.url });
    return { html: '' };
  }
}
