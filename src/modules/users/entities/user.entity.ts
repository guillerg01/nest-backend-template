import { Column, Entity, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Exclude } from 'class-transformer';
import { BaseEntity } from '../../../shared/base/base.entity';
import { RoleEntity } from '../../security/entities/role.entity';

export enum UserProvider {
  LOCAL = 'local',
  GOOGLE = 'google',
}

@Entity('users')
export class UserEntity extends BaseEntity {
  @Column({ unique: true })
  email: string;

  @Column({ name: 'first_name' })
  firstName: string;

  @Column({ name: 'last_name' })
  lastName: string;

  @Column({ nullable: true })
  @Exclude()
  password: string;

  @Column({ name: 'avatar_url', nullable: true })
  avatarUrl: string;

  @Column({ name: 'phone', nullable: true })
  phone: string;

  @Column({
    type: 'enum',
    enum: UserProvider,
    default: UserProvider.LOCAL,
  })
  provider: UserProvider;

  @Column({ name: 'provider_id', nullable: true })
  providerId: string;

  @Column({ name: 'is_email_verified', default: false })
  isEmailVerified: boolean;

  @Column({ name: 'email_verification_token', nullable: true })
  @Exclude()
  emailVerificationToken: string;

  @Column({ name: 'password_reset_token', nullable: true })
  @Exclude()
  passwordResetToken: string;

  @Column({ name: 'password_reset_expires', nullable: true })
  passwordResetExpires: Date;

  @Column({ name: 'last_login_at', nullable: true })
  lastLoginAt: Date;

  @ManyToOne(() => RoleEntity, { eager: true, nullable: true })
  @JoinColumn({ name: 'role_id' })
  role: RoleEntity;

  // Stripe customer ID for payment integration
  @Column({ name: 'stripe_customer_id', nullable: true })
  stripeCustomerId: string;

  @Column({ name: 'tenant_id', nullable: true })
  @Index()
  tenantId: string;

  get fullName(): string {
    return `${this.firstName} ${this.lastName}`;
  }
}
