import { Column, Entity, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../../../shared/base/base.entity';
import { RoomEntity } from './room.entity';
import { UserEntity } from '../../users/entities/user.entity';

export enum MessageType {
  TEXT = 'text',
  IMAGE = 'image',
  FILE = 'file',
  AUDIO = 'audio',
  SYSTEM = 'system',  // "User X joined the room"
}

export enum MessageStatus {
  SENT = 'sent',
  DELIVERED = 'delivered',
  READ = 'read',
}

@Entity('chat_messages')
@Index(['roomId', 'createdAt']) // Crucial for history pagination queries
export class MessageEntity extends BaseEntity {
  @Column({ name: 'room_id' })
  roomId: string;

  @Column({ name: 'sender_id', nullable: true })
  senderId: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'enum', enum: MessageType, default: MessageType.TEXT })
  type: MessageType;

  @Column({ type: 'enum', enum: MessageStatus, default: MessageStatus.SENT })
  status: MessageStatus;

  @Column({ name: 'reply_to_id', nullable: true })
  replyToId: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: {
    fileUrl?: string;
    fileName?: string;
    fileSize?: number;
    mimeType?: string;
    thumbnailUrl?: string;
    duration?: number;    // for audio
    width?: number;       // for images
    height?: number;      // for images
  };

  @Column({ name: 'edited_at', nullable: true })
  editedAt: Date;

  @Column({ name: 'read_by', type: 'jsonb', default: [] })
  readBy: { userId: string; readAt: string }[];

  @ManyToOne(() => RoomEntity, (room) => room.messages)
  @JoinColumn({ name: 'room_id' })
  room: RoomEntity;

  @ManyToOne(() => UserEntity, { nullable: true })
  @JoinColumn({ name: 'sender_id' })
  sender: UserEntity;
}
