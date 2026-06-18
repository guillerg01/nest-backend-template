import { Injectable, Logger } from '@nestjs/common';

interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  retryableErrors?: string[];
}

const DB_RETRYABLE_ERRORS = [
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'timeout',
  'query_timeout',
  'connection',
];

@Injectable()
export class RetryService {
  private readonly logger = new Logger(RetryService.name);

  async execute<T>(
    operation: () => Promise<T>,
    operationName: string,
    options: RetryOptions = {},
  ): Promise<T> {
    const {
      maxAttempts = 3,
      initialDelayMs = 1000,
      maxDelayMs = 30_000,
      backoffMultiplier = 2,
      retryableErrors = DB_RETRYABLE_ERRORS,
    } = options;

    let attempt = 0;
    let delay = initialDelayMs;

    while (attempt < maxAttempts) {
      try {
        return await operation();
      } catch (error) {
        attempt++;
        const errorMsg = error?.message || String(error);

        const isRetryable = retryableErrors.some((e) =>
          errorMsg.toLowerCase().includes(e.toLowerCase()),
        );

        if (!isRetryable || attempt >= maxAttempts) {
          this.logger.error(
            `Operation "${operationName}" failed after ${attempt} attempt(s): ${errorMsg}`,
          );
          throw error;
        }

        this.logger.warn(
          `Operation "${operationName}" failed (attempt ${attempt}/${maxAttempts}). Retrying in ${delay}ms...`,
        );

        await this.sleep(delay);
        delay = Math.min(delay * backoffMultiplier, maxDelayMs);
      }
    }
  }

  async executeDatabaseOperation<T>(
    operation: () => Promise<T>,
    operationName: string,
  ): Promise<T> {
    return this.execute(operation, operationName, {
      maxAttempts: 5,
      initialDelayMs: 500,
      maxDelayMs: 10_000,
      retryableErrors: DB_RETRYABLE_ERRORS,
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
