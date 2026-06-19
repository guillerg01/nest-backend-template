import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { TenantService } from '../../modules/tenant/tenant.service';

// Attach resolved tenant to every request that sends X-Tenant-ID header
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(private readonly tenantService: TenantService) {}

  async use(req: Request & { tenant?: any }, _res: Response, next: NextFunction) {
    const tenantId = req.headers['x-tenant-id'] as string;
    if (tenantId) {
      req.tenant = await this.tenantService.findBySlug(tenantId).catch(() => null)
        ?? await this.tenantService.findById(tenantId).catch(() => null);
    }
    next();
  }
}
