import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

@Injectable()
export class SentryService {
  private readonly logger = new Logger(SentryService.name);
  private initialized = false;

  constructor(private readonly config: ConfigService) {}

  init(): void {
    const dsn = this.config.get<string>('SENTRY_DSN');
    if (!dsn) {
      this.logger.warn('SENTRY_DSN not set — Sentry disabled');
      return;
    }

    Sentry.init({
      dsn,
      environment: this.config.get('NODE_ENV', 'development'),
      release: this.config.get('APP_VERSION', '1.0.0'),
      tracesSampleRate: this.config.get('NODE_ENV') === 'production' ? 0.2 : 1.0,
      profilesSampleRate: 1.0,
      integrations: [nodeProfilingIntegration()],
      // Strip sensitive data from breadcrumbs
      beforeBreadcrumb: (breadcrumb) => {
        if (breadcrumb.category === 'http') {
          delete breadcrumb.data?.['Authorization'];
          delete breadcrumb.data?.['Cookie'];
        }
        return breadcrumb;
      },
    });

    this.initialized = true;
    this.logger.log(`Sentry initialized — env: ${this.config.get('NODE_ENV')}`);
  }

  captureException(error: Error, context?: Record<string, any>): void {
    if (!this.initialized) return;
    Sentry.withScope((scope) => {
      if (context) scope.setExtras(context);
      Sentry.captureException(error);
    });
  }

  captureMessage(message: string, level: Sentry.SeverityLevel = 'info', extra?: Record<string, any>): void {
    if (!this.initialized) return;
    Sentry.withScope((scope) => {
      if (extra) scope.setExtras(extra);
      Sentry.captureMessage(message, level);
    });
  }

  setUser(user: { id: string; email?: string; username?: string }): void {
    if (!this.initialized) return;
    Sentry.setUser(user);
  }

  clearUser(): void {
    if (!this.initialized) return;
    Sentry.setUser(null);
  }

  setTag(key: string, value: string): void {
    if (!this.initialized) return;
    Sentry.setTag(key, value);
  }

  startTransaction(name: string, op: string) {
    if (!this.initialized) return null;
    return Sentry.startInactiveSpan({ name, op });
  }

  async flush(timeout = 2000): Promise<void> {
    if (!this.initialized) return;
    await Sentry.flush(timeout);
  }
}
