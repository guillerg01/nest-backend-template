import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { ROLES_KEY } from '../decorators/permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredPermissions && !requiredRoles) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user) return false;

    // Admin bypasses all permission checks
    if (user.role?.name === 'admin') return true;

    if (requiredRoles?.length) {
      const hasRole = requiredRoles.includes(user.role?.name);
      if (!hasRole) throw new ForbiddenException('Insufficient role');
    }

    if (requiredPermissions?.length) {
      const userPermissions: string[] = user.role?.permissions?.map((p: any) => p.name) ?? [];
      const hasAll = requiredPermissions.every((p) => userPermissions.includes(p));
      if (!hasAll) throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
