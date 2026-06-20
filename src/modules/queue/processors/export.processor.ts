import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUES } from '../queue.config';

@Processor(QUEUES.EXPORTS, { concurrency: 2 })
export class ExportProcessor extends WorkerHost {
  private readonly logger = new Logger(ExportProcessor.name);

  async process(job: Job): Promise<{ format: string; userId: string; downloadUrl: string }> {
    const { userId, format, filters } = job.data;
    this.logger.log(`Export job ${job.id} → user:${userId} format:${format}`);

    await job.updateProgress(10);

    // TODO: implement actual export logic per format:
    // - csv: stringify data with papaparse / csv-writer
    // - xlsx: use exceljs
    // - pdf: use puppeteer or pdfkit
    //
    // After generating the file, upload to S3 and return the presigned URL:
    // const url = await this.s3Service.upload(buffer, `exports/${userId}-${Date.now()}.${format}`, { contentType });
    // await this.emailService.send({ to: notifyEmail, subject: 'Export ready', html: `<a href="${url}">Download</a>` });

    await job.updateProgress(100);
    this.logger.warn(`Export job ${job.id} completed (stub — implement actual generation)`);

    return { format, userId, downloadUrl: '' };
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(`Export job ${job.id} failed: ${error.message}`);
  }
}
