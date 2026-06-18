import { Column, Entity, OneToMany, ManyToMany, JoinTable } from 'typeorm';
import { BaseEntity } from '../../../shared/base/base.entity';
import { MessageEntity } from './message.entity';
import { UserEntity } from '../../users/entities/user.entity';

export enum RoomType {
  DIRECT = 'direct',     // 1:1 conversation
  GROUP = 'group',       // Multiple members
  CHANNEL = 'channel',   // Public/broadcast channel
  SUPPORT = 'support',   // Customer support
}

@Entity('chat_rooms')
export class RoomEntity extends BaseEntity {
  @Column({ nullable: true })
  name: string;

  @Column({ nullable: true })
  description: string;

  @Column({ nullable: true })
  avatarUrl: string;

  @Column({ type: 'enum', enum: RoomType, default: RoomType.GROUP })
  type: RoomType;

  @Column({ name: 'is_public', default: false })
  isPublic: boolean;

  @Column({ name: 'created_by', nullable: true })
  createdBy: string;

  @Column({ name: 'last_message_at', nullable: true })
  lastMessageAt: Date;

  @Column({ name: 'last_message_preview', nullable: true })
  lastMessagePreview: string;

  @Column({ name: 'member_count', default: 0 })
  memberCount: number;

  @ManyToMany(() => UserEntity)
  @JoinTable({
    name: 'chat_room_members',
    joinColumn: { name: 'room_id' },
    inverseJoinColumn: { name: 'user_id' },
  })
  members: UserEntity[];

  @OneToMany(() => MessageEntity, (msg) => msg.room)
  messages: MessageEntity[];
}
