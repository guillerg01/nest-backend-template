import { RegisterQueueOptions } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';

export const QUEUES = {
  EMAIL: 'email',
  NOTIFICATIONS: 'notifications',
  SCRAPING: 'scraping',
  EXPORTS: 'exports',
  AI_PROCESSING: 'ai-processing',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const defaultJobOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential' as const,
    delay: 2000,
  },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 200 },
};

export const queuesConfig = (): RegisterQueueOptions[] =>
  Object.values(QUEUES).map((name) => ({
    name,
    defaultJobOptions,
  }));
