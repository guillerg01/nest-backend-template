import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const raw =
      exception instanceof HttpException ? exception.getResponse() : null;

    const message =
      status >= 500
        ? 'Internal server error'
        : typeof raw === 'object'
          ? (raw as any).message
          : raw ?? 'An error occurred';

    const errorResponse = {
      success: false,
      statusCode: status,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} — ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      // Report to Sentry when DSN is configured
      if (process.env.SENTRY_DSN) {
        import('@sentry/node').then(({ captureException, withScope }) => {
          withScope((scope) => {
            scope.setTag('method', request.method);
            scope.setTag('path', request.url);
            scope.setExtra('body', request.body);
            scope.setExtra('query', request.query);
            scope.setUser({ id: (request as any).user?.id, email: (request as any).user?.email });
            captureException(exception instanceof Error ? exception : new Error(String(exception)));
          });
        });
      }
    } else {
      this.logger.warn(`${request.method} ${request.url} — ${status}`);
    }

    response.status(status).json(errorResponse);
  }
}
