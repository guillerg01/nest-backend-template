import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUES } from '../queue.config';
import { EmailJobData } from '../queue.service';

@Processor(QUEUES.EMAIL, {
  concurrency: 5,           // Process 5 emails concurrently
  limiter: {
    max: 100,               // Max 100 jobs per duration
    duration: 60_000,       // Per minute (rate limit)
  },
})
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);

  async process(job: Job<any>): Promise<void> {
    this.logger.log(`Processing email job ${job.id} → ${job.data.to}`);

    // Update progress so Bull Board shows it
    await job.updateProgress(10);

    try {
      // Inject EmailService via constructor when wiring up in module
      // await this.emailService.send(job.data);
      this.logger.log(`Simulating email to ${job.data.to}...`);
      await new Promise((r) => setTimeout(r, 100)); // Simulate async send

      await job.updateProgress(100);
      this.logger.log(`Email job ${job.id} completed`);
    } catch (error) {
      this.logger.error(`Email job ${job.id} failed: ${error.message}`);
      throw error; // BullMQ retries on throw (up to job.attempts)
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.debug(`Job ${job.id} completed in queue ${QUEUES.EMAIL}`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(`Job ${job.id} failed after ${job.attemptsMade} attempts: ${error.message}`);
  }
}
