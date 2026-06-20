import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUES } from '../queue.config';
import { ScrapingService } from '../../scraping/services/scraping.service';

@Processor(QUEUES.SCRAPING, { concurrency: 3 })
export class ScrapingProcessor extends WorkerHost {
  private readonly logger = new Logger(ScrapingProcessor.name);

  constructor(private readonly scrapingService: ScrapingService) {
    super();
  }

  async process(job: Job): Promise<{ url: string; statusCode: number; scrapedAt: Date }> {
    const { url, usePlaywright } = job.data;
    this.logger.log(`Scraping job ${job.id} → ${url}`);
    await job.updateProgress(10);

    const result = await this.scrapingService.fetchPage({ url, javascript: usePlaywright });

    await job.updateProgress(100);
    return { url: result.url, statusCode: result.statusCode, scrapedAt: result.scrapedAt };
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(`Scraping job ${job.id} failed: ${error.message}`);
  }
}
