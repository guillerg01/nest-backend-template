import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PermissionEntity } from '../security/entities/permission.entity';
import { RoleEntity } from '../security/entities/role.entity';
import { UserEntity } from '../users/entities/user.entity';
import { SeedService } from './seed.service';
import { SeedController } from './seed.controller';

@Module({
  imports: [TypeOrmModule.forFeature([PermissionEntity, RoleEntity, UserEntity])],
  providers: [SeedService],
  controllers: [SeedController],
})
export class SeedModule {}
