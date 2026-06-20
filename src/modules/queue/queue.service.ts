import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue, JobsOptions } from 'bullmq';
import { QUEUES } from './queue.config';

export interface EmailJobData {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  userId?: string;
}

export interface ScrapingJobData {
  url: string;
  targetId: string;
  proxy?: string;
  usePlaywright?: boolean;
}

export interface ExportJobData {
  userId: string;
  format: 'csv' | 'xlsx' | 'pdf';
  filters: Record<string, any>;
  notifyEmail?: string;
}

export interface AiProcessingJobData {
  type: 'embed' | 'summarize' | 'classify' | 'extract';
  input: string;
  targetId?: string;
  model?: string;
}

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    @InjectQueue(QUEUES.EMAIL) private emailQueue: Queue,
    @InjectQueue(QUEUES.NOTIFICATIONS) private notificationsQueue: Queue,
    @InjectQueue(QUEUES.SCRAPING) private scrapingQueue: Queue,
    @InjectQueue(QUEUES.EXPORTS) private exportsQueue: Queue,
    @InjectQueue(QUEUES.AI_PROCESSING) private aiQueue: Queue,
  ) {}

  // ─── Email ───────────────────────────────────────────────────────────────

  async sendEmail(data: EmailJobData, options?: JobsOptions) {
    const job = await this.emailQueue.add('send', data, options);
    this.logger.log(`Email queued → job:${job.id} to:${data.to}`);
    return job;
  }

  async sendEmailDelayed(data: EmailJobData, delayMs: number) {
    return this.sendEmail(data, { delay: delayMs });
  }

  // ─── Scraping ─────────────────────────────────────────────────────────────

  async enqueueScraping(data: ScrapingJobData, options?: JobsOptions) {
    const job = await this.scrapingQueue.add('scrape', data, options);
    this.logger.log(`Scraping queued → job:${job.id} url:${data.url}`);
    return job;
  }

  async enqueueScrapingBatch(urls: string[], baseOptions?: Partial<ScrapingJobData>) {
    const jobs = await Promise.all(
      urls.map((url) =>
        this.scrapingQueue.add('scrape', { url, ...baseOptions }),
      ),
    );
    this.logger.log(`Batch scraping queued → ${jobs.length} jobs`);
    return jobs;
  }

  // ─── Exports ──────────────────────────────────────────────────────────────

  async enqueueExport(data: ExportJobData) {
    const job = await this.exportsQueue.add('export', data, { priority: 2 });
    this.logger.log(`Export queued → job:${job.id} user:${data.userId} format:${data.format}`);
    return job;
  }

  // ─── AI Processing ────────────────────────────────────────────────────────

  async enqueueAiTask(data: AiProcessingJobData, options?: JobsOptions) {
    const job = await this.aiQueue.add(data.type, data, options);
    this.logger.log(`AI task queued → job:${job.id} type:${data.type}`);
    return job;
  }

  // ─── Job Status ───────────────────────────────────────────────────────────

  async getJobStatus(queueName: string, jobId: string) {
    const queues: Record<string, Queue> = {
      [QUEUES.EMAIL]: this.emailQueue,
      [QUEUES.SCRAPING]: this.scrapingQueue,
      [QUEUES.EXPORTS]: this.exportsQueue,
      [QUEUES.AI_PROCESSING]: this.aiQueue,
      [QUEUES.NOTIFICATIONS]: this.notificationsQueue,
    };

    const queue = queues[queueName];
    if (!queue) return null;

    const job = await queue.getJob(jobId);
    if (!job) return null;

    const state = await job.getState();
    return {
      id: job.id,
      name: job.name,
      state,
      progress: job.progress,
      attemptsMade: job.attemptsMade,
      failedReason: job.failedReason,
      processedOn: job.processedOn ? new Date(job.processedOn) : null,
      finishedOn: job.finishedOn ? new Date(job.finishedOn) : null,
    };
  }

  async getQueueStats(queueName: string) {
    const queues: Record<string, Queue> = {
      [QUEUES.EMAIL]: this.emailQueue,
      [QUEUES.SCRAPING]: this.scrapingQueue,
      [QUEUES.EXPORTS]: this.exportsQueue,
      [QUEUES.AI_PROCESSING]: this.aiQueue,
      [QUEUES.NOTIFICATIONS]: this.notificationsQueue,
    };

    const queue = queues[queueName];
    if (!queue) return null;

    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
    ]);

    return { waiting, active, completed, failed, delayed };
  }
}
