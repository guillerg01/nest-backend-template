import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoleEntity } from './entities/role.entity';
import { PermissionEntity } from './entities/permission.entity';
import { AuditLogEntity } from './entities/audit-log.entity';

@Module({
  imports: [TypeOrmModule.forFeature([RoleEntity, PermissionEntity, AuditLogEntity])],
  exports: [TypeOrmModule],
})
export class SecurityModule {}
