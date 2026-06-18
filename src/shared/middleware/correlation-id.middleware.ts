import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

export const CORRELATION_ID_HEADER = 'x-correlation-id';
export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Attaches a correlation ID to every request.
 * - Uses the client-provided x-correlation-id if present (for cross-service tracing)
 * - Otherwise generates a new UUID
 * - Always echoes back in response headers
 * - Available as req.correlationId anywhere in the request lifecycle
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const correlationId =
      (req.headers[CORRELATION_ID_HEADER] as string) || uuidv4();

    const requestId = uuidv4();

    (req as any).correlationId = correlationId;
    (req as any).requestId = requestId;

    res.setHeader(CORRELATION_ID_HEADER, correlationId);
    res.setHeader(REQUEST_ID_HEADER, requestId);

    next();
  }
}
