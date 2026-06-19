import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../shared/base/base.entity';

export enum TenantPlan {
  FREE = 'free',
  PRO = 'pro',
  ENTERPRISE = 'enterprise',
}

@Entity('tenants')
export class TenantEntity extends BaseEntity {
  @Column()
  name: string;

  @Column({ unique: true })
  @Index()
  slug: string;

  @Column({ type: 'enum', enum: TenantPlan, default: TenantPlan.FREE })
  plan: TenantPlan;

  @Column({ type: 'jsonb', nullable: true })
  settings: Record<string, any>;
}
