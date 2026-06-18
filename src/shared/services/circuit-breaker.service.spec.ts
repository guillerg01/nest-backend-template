import { ServiceUnavailableException } from '@nestjs/common';
import { CircuitBreakerService } from './circuit-breaker.service';

describe('CircuitBreakerService', () => {
  let service: CircuitBreakerService;

  beforeEach(() => {
    service = new CircuitBreakerService();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('CLOSED state (normal operation)', () => {
    it('executes operation and returns result', async () => {
      const operation = jest.fn().mockResolvedValue('result');

      const result = await service.execute('test-circuit', operation);

      expect(result).toBe('result');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('passes through errors without opening circuit under threshold', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('fail'));

      // 4 failures — below threshold of 5
      for (let i = 0; i < 4; i++) {
        await expect(service.execute('test', operation)).rejects.toThrow('fail');
      }

      const status = service.getStatus('test');
      expect(status.state).toBe('CLOSED');
      expect(status.failureCount).toBe(4);
    });
  });

  describe('OPEN state (circuit tripped)', () => {
    it('opens after 5 consecutive failures', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('db error'));

      for (let i = 0; i < 5; i++) {
        await expect(service.execute('db', operation)).rejects.toThrow();
      }

      const status = service.getStatus('db');
      expect(status.state).toBe('OPEN');
    });

    it('rejects immediately when OPEN without calling operation', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('fail'));

      // Trip the circuit
      for (let i = 0; i < 5; i++) {
        await expect(service.execute('db', operation)).rejects.toThrow();
      }

      operation.mockClear();

      // Next call should be rejected immediately
      await expect(service.execute('db', jest.fn())).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(operation).not.toHaveBeenCalled();
    });
  });

  describe('HALF_OPEN state (recovery)', () => {
    it('transitions to HALF_OPEN after recovery timeout', async () => {
      const failOp = jest.fn().mockRejectedValue(new Error('fail'));

      // Trip the circuit
      for (let i = 0; i < 5; i++) {
        await expect(service.execute('svc', failOp)).rejects.toThrow();
      }

      expect(service.getStatus('svc').state).toBe('OPEN');

      // Advance time past recovery timeout (60s)
      jest.advanceTimersByTime(61_000);

      // Next call should be allowed (HALF_OPEN)
      const successOp = jest.fn().mockResolvedValue('ok');
      await service.execute('svc', successOp);

      expect(service.getStatus('svc').state).toBe('HALF_OPEN');
    });

    it('closes after 3 consecutive successes in HALF_OPEN', async () => {
      const failOp = jest.fn().mockRejectedValue(new Error('fail'));
      for (let i = 0; i < 5; i++) {
        await expect(service.execute('svc2', failOp)).rejects.toThrow();
      }

      jest.advanceTimersByTime(61_000);

      const successOp = jest.fn().mockResolvedValue('ok');
      for (let i = 0; i < 3; i++) {
        await service.execute('svc2', successOp);
      }

      expect(service.getStatus('svc2').state).toBe('CLOSED');
    });
  });

  describe('getStatus', () => {
    it('returns correct status for new circuit', () => {
      const status = service.getStatus('fresh');
      expect(status.state).toBe('CLOSED');
      expect(status.failureCount).toBe(0);
      expect(status.lastFailureTime).toBeNull();
    });
  });
});
