import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { ConfigService } from '@nestjs/config';
import { PermissionEntity } from '../security/entities/permission.entity';
import { RoleEntity } from '../security/entities/role.entity';
import { UserEntity, UserProvider } from '../users/entities/user.entity';

const PERMISSIONS = [
  { name: 'users:read',       module: 'users',    description: 'Read users' },
  { name: 'users:write',      module: 'users',    description: 'Create/update users' },
  { name: 'users:delete',     module: 'users',    description: 'Delete users' },
  { name: 'roles:read',       module: 'security', description: 'Read roles' },
  { name: 'roles:write',      module: 'security', description: 'Create/update roles' },
  { name: 'roles:delete',     module: 'security', description: 'Delete roles' },
  { name: 'products:read',    module: 'products', description: 'Read products' },
  { name: 'products:write',   module: 'products', description: 'Create/update products' },
  { name: 'products:delete',  module: 'products', description: 'Delete products' },
  { name: 'payments:read',    module: 'payments', description: 'Read payments' },
  { name: 'payments:write',   module: 'payments', description: 'Manage payments' },
  { name: 'files:read',       module: 'files',    description: 'Read files' },
  { name: 'files:write',      module: 'files',    description: 'Upload files' },
  { name: 'files:delete',     module: 'files',    description: 'Delete files' },
  { name: 'chat:read',        module: 'chat',     description: 'Read chat messages' },
  { name: 'chat:write',       module: 'chat',     description: 'Send chat messages' },
  { name: 'openai:use',       module: 'openai',   description: 'Use AI features' },
  { name: 'scraping:execute', module: 'scraping', description: 'Execute scraping tasks' },
  { name: 'admin:all',        module: 'admin',    description: 'Full admin access' },
];

@Injectable()
export class SeedService {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    @InjectRepository(PermissionEntity) private readonly permRepo: Repository<PermissionEntity>,
    @InjectRepository(RoleEntity)       private readonly roleRepo: Repository<RoleEntity>,
    @InjectRepository(UserEntity)       private readonly userRepo: Repository<UserEntity>,
    private readonly config: ConfigService,
  ) {}

  async isSeeded(): Promise<boolean> {
    const count = await this.userRepo.count({ where: { email: 'admin@example.com' } });
    return count > 0;
  }

  async seed(): Promise<{ created: string[] }> {
    const created: string[] = [];

    // ── Permissions ───────────────────────────────────────────────
    const perms: PermissionEntity[] = [];
    for (const p of PERMISSIONS) {
      let perm = await this.permRepo.findOne({ where: { name: p.name } });
      if (!perm) {
        perm = await this.permRepo.save(this.permRepo.create(p));
        created.push(`permission:${p.name}`);
      }
      perms.push(perm);
    }

    // ── Roles ─────────────────────────────────────────────────────
    const moderatorPerms = perms.filter(p =>
      ['users:read', 'products:read', 'products:write', 'chat:read', 'chat:write'].includes(p.name),
    );
    const userPerms = perms.filter(p =>
      ['products:read', 'chat:read', 'chat:write', 'files:read', 'files:write'].includes(p.name),
    );

    const roleDefs = [
      { name: 'admin',     description: 'Full access',       permissions: perms },
      { name: 'moderator', description: 'Moderation access', permissions: moderatorPerms },
      { name: 'user',      description: 'Basic access',      permissions: userPerms },
    ];

    const roleMap: Record<string, RoleEntity> = {};
    for (const r of roleDefs) {
      let role = await this.roleRepo.findOne({ where: { name: r.name } });
      if (!role) {
        role = await this.roleRepo.save(
          this.roleRepo.create({ name: r.name, description: r.description, permissions: r.permissions }),
        );
        created.push(`role:${r.name}`);
      }
      roleMap[r.name] = role;
    }

    // ── Admin user ────────────────────────────────────────────────
    const existing = await this.userRepo.findOne({ where: { email: 'admin@example.com' } });
    if (!existing) {
      const adminPassword = this.config.get<string>('SEED_ADMIN_PASSWORD', 'Admin1234!');
      const hash = await bcrypt.hash(adminPassword, 10);
      await this.userRepo.save(
        this.userRepo.create({
          email: 'admin@example.com',
          firstName: 'Admin',
          lastName: 'User',
          password: hash,
          provider: UserProvider.LOCAL,
          isEmailVerified: true,
          role: roleMap['admin'],
        }),
      );
      created.push('user:admin@example.com');
    }

    this.logger.log(`Seed complete. Created: ${created.length} items`);
    return { created };
  }
}
