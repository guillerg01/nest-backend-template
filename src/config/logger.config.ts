import { Params } from 'nestjs-pino';

/**
 * Pino is 10x faster than Winston because it's async by default.
 * Logs JSON in production → pipe to any log aggregator (ELK, Loki, Datadog).
 * In dev, pino-pretty formats logs for readability.
 *
 * Usage in services: inject Logger from @nestjs/common (same API as before)
 * The LoggerModule from nestjs-pino replaces NestJS's built-in logger globally.
 */
export const pinoLoggerConfig = (): Params => ({
  pinoHttp: {
    level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
    transport:
      process.env.NODE_ENV !== 'production'
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              singleLine: true,
              translateTime: 'HH:MM:ss',
              ignore: 'pid,hostname',
            },
          }
        : undefined,
    // Redact sensitive fields from logs
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.body.password',
        'req.body.newPassword',
        'req.body.token',
        '*.password',
        '*.creditCard',
        '*.cvv',
      ],
      censor: '[REDACTED]',
    },
    // Add correlation ID to every log line
    customProps: (req: any) => ({
      correlationId: req.correlationId,
      requestId: req.requestId,
    }),
    // Don't log health check spam
    autoLogging: {
      ignore: (req) => req.url?.includes('/health'),
    },
    serializers: {
      req: (req) => ({
        method: req.method,
        url: req.url,
        userAgent: req.headers?.['user-agent'],
        ip: req.remoteAddress,
      }),
      res: (res) => ({
        statusCode: res.statusCode,
      }),
    },
  },
});
