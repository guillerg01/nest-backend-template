import 'reflect-metadata';
import * as dotenv from 'dotenv';
dotenv.config();

import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { databaseConfig } from '../config/database.config';
import { RoleEntity } from '../modules/security/entities/role.entity';
import { PermissionEntity } from '../modules/security/entities/permission.entity';
import { UserEntity } from '../modules/users/entities/user.entity';
import { TenantEntity, TenantPlan } from '../modules/tenant/entities/tenant.entity';

const PERMISSIONS = [
  // Users
  { name: 'users:read', module: 'users', description: 'Read users' },
  { name: 'users:write', module: 'users', description: 'Create/update users' },
  { name: 'users:delete', module: 'users', description: 'Delete users' },
  // Products
  { name: 'products:read', module: 'products', description: 'Read products' },
  { name: 'products:write', module: 'products', description: 'Create/update products' },
  { name: 'products:delete', module: 'products', description: 'Delete products' },
  // Chat
  { name: 'chat:read', module: 'chat', description: 'Read messages' },
  { name: 'chat:write', module: 'chat', description: 'Send messages' },
  { name: 'chat:delete', module: 'chat', description: 'Delete messages' },
  // Files
  { name: 'files:upload', module: 'files', description: 'Upload files' },
  { name: 'files:delete', module: 'files', description: 'Delete files' },
  // Queue
  { name: 'queue:manage', module: 'queue', description: 'Manage queues' },
  // Scraping
  { name: 'scraping:run', module: 'scraping', description: 'Run scrapers' },
  // AI
  { name: 'openai:use', module: 'openai', description: 'Use AI features' },
  // Crypto
  { name: 'crypto:use', module: 'crypto', description: 'Use crypto features' },
  // Payments
  { name: 'payments:create', module: 'payments', description: 'Create payments' },
  // Tenant
  { name: 'tenants:manage', module: 'tenant', description: 'Manage tenants' },
];

const MOD_PERMISSIONS = [
  'users:read', 'products:read', 'products:write', 'products:delete',
  'chat:read', 'chat:write', 'chat:delete', 'files:upload',
];

const USER_PERMISSIONS = [
  'products:read', 'chat:read', 'chat:write', 'files:upload', 'payments:create',
];

async function seed() {
  const ds = new DataSource(databaseConfig());
  await ds.initialize();

  const roleRepo = ds.getRepository(RoleEntity);
  const permRepo = ds.getRepository(PermissionEntity);
  const userRepo = ds.getRepository(UserEntity);
  const tenantRepo = ds.getRepository(TenantEntity);

  console.log('🌱 Seeding permissions...');
  const savedPerms: Record<string, PermissionEntity> = {};
  for (const p of PERMISSIONS) {
    let perm = await permRepo.findOne({ where: { name: p.name } });
    if (!perm) {
      perm = await permRepo.save(permRepo.create(p));
    }
    savedPerms[p.name] = perm;
  }
  console.log(`   ✓ ${PERMISSIONS.length} permissions`);

  console.log('🌱 Seeding roles...');
  let adminRole = await roleRepo.findOne({ where: { name: 'admin' }, relations: ['permissions'] });
  if (!adminRole) {
    adminRole = roleRepo.create({ name: 'admin', description: 'Full access — bypasses all permission checks' });
  }
  adminRole.permissions = Object.values(savedPerms);
  adminRole = await roleRepo.save(adminRole);

  let modRole = await roleRepo.findOne({ where: { name: 'moderator' }, relations: ['permissions'] });
  if (!modRole) {
    modRole = roleRepo.create({ name: 'moderator', description: 'Content moderation' });
  }
  modRole.permissions = MOD_PERMISSIONS.map((n) => savedPerms[n]);
  modRole = await roleRepo.save(modRole);

  let userRole = await roleRepo.findOne({ where: { name: 'user' }, relations: ['permissions'] });
  if (!userRole) {
    userRole = roleRepo.create({ name: 'user', description: 'Standard authenticated user' });
  }
  userRole.permissions = USER_PERMISSIONS.map((n) => savedPerms[n]);
  userRole = await roleRepo.save(userRole);
  console.log('   ✓ admin, moderator, user');

  console.log('🌱 Seeding default tenant...');
  let defaultTenant = await tenantRepo.findOne({ where: { slug: 'default' } });
  if (!defaultTenant) {
    defaultTenant = await tenantRepo.save(
      tenantRepo.create({
        name: 'Default',
        slug: 'default',
        plan: TenantPlan.ENTERPRISE,
        settings: { maxUsers: -1, maxStorage: -1 },
      }),
    );
  }
  console.log('   ✓ default tenant');

  console.log('🌱 Seeding admin user...');
  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@example.com';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'Admin1234!';

  let adminUser = await userRepo.findOne({ where: { email: adminEmail } });
  if (!adminUser) {
    const salt = parseInt(process.env.HASH_SALT || '10');
    const hashed = await bcrypt.hash(adminPassword, salt);
    adminUser = userRepo.create({
      email: adminEmail,
      firstName: 'Admin',
      lastName: 'User',
      password: hashed,
      isEmailVerified: true,
      role: adminRole,
      tenantId: defaultTenant.id,
    });
    await userRepo.save(adminUser);
    console.log(`   ✓ admin user created: ${adminEmail} / ${adminPassword}`);
  } else {
    console.log(`   ℹ admin user already exists: ${adminEmail}`);
  }

  await ds.destroy();
  console.log('\n✅ Seed complete');
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
