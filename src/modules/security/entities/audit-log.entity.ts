import { Column, Entity, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../../shared/base/base.entity';

@Entity('audit_logs')
export class AuditLogEntity extends BaseEntity {
  @Column({ nullable: true })
  userId: string;

  @Column({ nullable: true })
  userEmail: string;

  @Column()
  method: string;

  @Column()
  endpoint: string;

  @Column({ nullable: true })
  ipAddress: string;

  @Column({ type: 'jsonb', nullable: true })
  requestBody: any;

  @Column({ nullable: true })
  statusCode: number;
}
