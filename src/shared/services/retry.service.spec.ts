import { RetryService } from './retry.service';

// Instant sleep — bypasses all delays in tests
const mockSleep = jest.fn().mockResolvedValue(undefined);

describe('RetryService', () => {
  let service: RetryService;

  beforeEach(() => {
    service = new RetryService();
    // Override private sleep so tests don't actually wait
    (service as any).sleep = mockSleep;
    mockSleep.mockClear();
  });

  describe('execute', () => {
    it('returns result on first success', async () => {
      const op = jest.fn().mockResolvedValue('data');

      const result = await service.execute(op, 'test-op');

      expect(result).toBe('data');
      expect(op).toHaveBeenCalledTimes(1);
      expect(mockSleep).not.toHaveBeenCalled();
    });

    it('retries on retryable error and succeeds', async () => {
      const op = jest
        .fn()
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValue('success');

      const result = await service.execute(op, 'conn-op', {
        maxAttempts: 3,
        initialDelayMs: 1000,
      });

      expect(result).toBe('success');
      expect(op).toHaveBeenCalledTimes(3);
      expect(mockSleep).toHaveBeenCalledTimes(2);
    });

    it('throws immediately for non-retryable error', async () => {
      const op = jest.fn().mockRejectedValue(new Error('ValidationError: bad input'));

      await expect(
        service.execute(op, 'validation-op', {
          maxAttempts: 3,
          retryableErrors: ['ECONNREFUSED'],
        }),
      ).rejects.toThrow('ValidationError');

      expect(op).toHaveBeenCalledTimes(1);
      expect(mockSleep).not.toHaveBeenCalled();
    });

    it('exhausts all attempts and throws final error', async () => {
      const op = jest.fn().mockRejectedValue(new Error('timeout'));

      await expect(
        service.execute(op, 'timeout-op', {
          maxAttempts: 3,
          initialDelayMs: 100,
          retryableErrors: ['timeout'],
        }),
      ).rejects.toThrow('timeout');

      expect(op).toHaveBeenCalledTimes(3);
      expect(mockSleep).toHaveBeenCalledTimes(2); // sleep between each retry
    });

    it('caps delay at maxDelayMs with exponential backoff', async () => {
      const capturedDelays: number[] = [];
      mockSleep.mockImplementation((ms: number) => {
        capturedDelays.push(ms);
        return Promise.resolve();
      });

      const op = jest
        .fn()
        .mockRejectedValueOnce(new Error('timeout'))
        .mockRejectedValueOnce(new Error('timeout'))
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValue('ok');

      await service.execute(op, 'delay-test', {
        maxAttempts: 4,
        initialDelayMs: 1000,
        maxDelayMs: 2000,
        backoffMultiplier: 3,
        retryableErrors: ['timeout'],
      });

      // 1st retry: 1000ms, 2nd retry: min(3000, 2000)=2000ms, 3rd retry: min(6000, 2000)=2000ms
      expect(capturedDelays[0]).toBe(1000);
      expect(capturedDelays[1]).toBe(2000);
      expect(capturedDelays[2]).toBe(2000);
    });
  });

  describe('executeDatabaseOperation', () => {
    it('uses DB-specific config and retries on ETIMEDOUT', async () => {
      const op = jest
        .fn()
        .mockRejectedValueOnce(new Error('ETIMEDOUT'))
        .mockResolvedValue('db result');

      const result = await service.executeDatabaseOperation(op, 'db-query');

      expect(result).toBe('db result');
      expect(op).toHaveBeenCalledTimes(2);
      expect(mockSleep).toHaveBeenCalledTimes(1);
    });

    it('retries on connection error up to 5 attempts', async () => {
      const op = jest
        .fn()
        .mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(
        service.executeDatabaseOperation(op, 'failing-query'),
      ).rejects.toThrow('ECONNREFUSED');

      expect(op).toHaveBeenCalledTimes(5);
    });
  });
});
