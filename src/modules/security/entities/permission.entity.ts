import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../shared/base/base.entity';

@Entity('permissions')
export class PermissionEntity extends BaseEntity {
  @Column({ unique: true })
  name: string;

  @Column({ nullable: true })
  description: string;

  @Column({ nullable: true })
  module: string;
}
