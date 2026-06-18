import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUES } from '../queue.config';

@Processor(QUEUES.AI_PROCESSING, { concurrency: 2 }) // AI calls are expensive, limit concurrency
export class AiProcessor extends WorkerHost {
  private readonly logger = new Logger(AiProcessor.name);

  async process(job: Job<any>): Promise<any> {
    this.logger.log(`AI job ${job.id} — type: ${job.name}`);
    await job.updateProgress(0);

    switch (job.name) {
      case 'embed':
        return this.handleEmbed(job);
      case 'summarize':
        return this.handleSummarize(job);
      case 'classify':
        return this.handleClassify(job);
      case 'extract':
        return this.handleExtract(job);
      default:
        throw new Error(`Unknown AI job type: ${job.name}`);
    }
  }

  private async handleEmbed(job: Job) {
    // Inject OpenAIService → await this.openai.embed(job.data.input)
    await job.updateProgress(100);
    return { embedding: [], model: 'text-embedding-3-small' };
  }

  private async handleSummarize(job: Job) {
    // Inject OpenAIService → await this.openai.chat(...)
    await job.updateProgress(100);
    return { summary: '' };
  }

  private async handleClassify(job: Job) {
    await job.updateProgress(100);
    return { label: '', confidence: 0 };
  }

  private async handleExtract(job: Job) {
    await job.updateProgress(100);
    return { data: {} };
  }
}
