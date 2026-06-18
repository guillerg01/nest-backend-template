import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { Request, Response } from 'express';

/**
 * Extends AllExceptionsFilter to also report to Sentry.
 * Use this in place of AllExceptionsFilter when Sentry is enabled.
 * Register via: { provide: APP_FILTER, useClass: SentryExceptionFilter }
 */
@Catch()
export class SentryExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('SentryFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    // Report to Sentry — only 5xx errors or all errors based on preference
    if (status >= 500) {
      Sentry.withScope((scope) => {
        scope.setTag('method', request.method);
        scope.setTag('path', request.url);
        scope.setTag('status', String(status));
        scope.setExtra('body', request.body);
        scope.setExtra('query', request.query);
        scope.setUser({ id: (request as any).user?.id, email: (request as any).user?.email });
        Sentry.captureException(exception instanceof Error ? exception : new Error(String(exception)));
      });
    }

    if (status >= 500) {
      this.logger.error(`${request.method} ${request.url} — ${status}`, exception instanceof Error ? exception.stack : '');
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      message: typeof message === 'object' ? (message as any).message : message,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
