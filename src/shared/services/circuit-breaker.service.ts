import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

interface CircuitBreaker {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureTime?: number;
  nextAttemptTime?: number;
}

@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);
  private readonly circuits = new Map<string, CircuitBreaker>();

  private readonly FAILURE_THRESHOLD = 5;
  private readonly RECOVERY_TIMEOUT_MS = 60_000;
  private readonly HALF_OPEN_SUCCESS_THRESHOLD = 3;

  private getCircuit(key: string): CircuitBreaker {
    if (!this.circuits.has(key)) {
      this.circuits.set(key, {
        state: CircuitState.CLOSED,
        failureCount: 0,
        successCount: 0,
      });
    }
    return this.circuits.get(key);
  }

  async execute<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const circuit = this.getCircuit(key);

    if (circuit.state === CircuitState.OPEN) {
      if (Date.now() < circuit.nextAttemptTime) {
        throw new ServiceUnavailableException(
          `Circuit breaker OPEN for "${key}". Retry after ${new Date(circuit.nextAttemptTime).toISOString()}`,
        );
      }
      circuit.state = CircuitState.HALF_OPEN;
      circuit.successCount = 0;
      this.logger.log(`Circuit "${key}" → HALF_OPEN`);
    }

    try {
      const result = await operation();
      this.onSuccess(key, circuit);
      return result;
    } catch (error) {
      this.onFailure(key, circuit);
      throw error;
    }
  }

  private onSuccess(key: string, circuit: CircuitBreaker): void {
    circuit.failureCount = 0;

    if (circuit.state === CircuitState.HALF_OPEN) {
      circuit.successCount++;
      if (circuit.successCount >= this.HALF_OPEN_SUCCESS_THRESHOLD) {
        circuit.state = CircuitState.CLOSED;
        this.logger.log(`Circuit "${key}" → CLOSED`);
      }
    }
  }

  private onFailure(key: string, circuit: CircuitBreaker): void {
    circuit.failureCount++;
    circuit.lastFailureTime = Date.now();

    if (
      circuit.state === CircuitState.HALF_OPEN ||
      circuit.failureCount >= this.FAILURE_THRESHOLD
    ) {
      circuit.state = CircuitState.OPEN;
      circuit.nextAttemptTime = Date.now() + this.RECOVERY_TIMEOUT_MS;
      this.logger.warn(
        `Circuit "${key}" → OPEN (${circuit.failureCount} failures). Retry at ${new Date(circuit.nextAttemptTime).toISOString()}`,
      );
    }
  }

  getStatus(key: string) {
    const circuit = this.getCircuit(key);
    return {
      key,
      state: circuit.state,
      failureCount: circuit.failureCount,
      lastFailureTime: circuit.lastFailureTime
        ? new Date(circuit.lastFailureTime).toISOString()
        : null,
    };
  }
}
