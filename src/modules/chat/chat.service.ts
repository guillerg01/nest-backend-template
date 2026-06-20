import {
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { MessageRepository, RoomRepository } from './repositories/chat.repository';
import { RoomEntity, RoomType } from './entities/room.entity';
import { MessageEntity, MessageType } from './entities/message.entity';
import { UserEntity } from '../users/entities/user.entity';

export interface CreateRoomDto {
  name?: string;
  type?: RoomType;
  memberIds: string[];
  isPublic?: boolean;
}

export interface SendMessageDto {
  roomId: string;
  content: string;
  type?: MessageType;
  replyToId?: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class ChatService {
  constructor(
    private readonly roomRepo: RoomRepository,
    private readonly messageRepo: MessageRepository,
  ) {}

  // ─── Rooms ────────────────────────────────────────────────────────────────

  async createRoom(creatorId: string, dto: CreateRoomDto): Promise<RoomEntity> {
    const memberIds = [...new Set([creatorId, ...dto.memberIds])];

    if (dto.type === RoomType.DIRECT && memberIds.length === 2) {
      const existing = await this.roomRepo.findDirectRoom(memberIds[0], memberIds[1]);
      if (existing) return existing;
    }

    const room = await this.roomRepo.createWithMembers(
      {
        name: dto.name,
        type: dto.type ?? RoomType.GROUP,
        isPublic: dto.isPublic ?? false,
        createdBy: creatorId,
        memberCount: memberIds.length,
      },
      memberIds,
    );

    return room;
  }

  async getOrCreateDirectRoom(userAId: string, userBId: string): Promise<RoomEntity> {
    const existing = await this.roomRepo.findDirectRoom(userAId, userBId);
    if (existing) return existing;

    return this.createRoom(userAId, {
      type: RoomType.DIRECT,
      memberIds: [userBId],
    });
  }

  async getUserRooms(userId: string): Promise<RoomEntity[]> {
    return this.roomRepo.findUserRooms(userId);
  }

  async getRoomById(roomId: string, userId: string): Promise<RoomEntity> {
    const isMember = await this.roomRepo.isMember(roomId, userId);
    if (!isMember) throw new ForbiddenException('Not a member of this room');
    return this.roomRepo.findById(roomId, ['members']);
  }

  // ─── Messages ─────────────────────────────────────────────────────────────

  async sendMessage(senderId: string, dto: SendMessageDto): Promise<MessageEntity> {
    const isMember = await this.roomRepo.isMember(dto.roomId, senderId);
    if (!isMember) throw new ForbiddenException('Not a member of this room');

    const message = await this.messageRepo.create({
      roomId: dto.roomId,
      senderId,
      content: dto.content,
      type: dto.type ?? MessageType.TEXT,
      replyToId: dto.replyToId,
      metadata: dto.metadata as any,
      readBy: [],
    });

    // Update room last message
    await this.roomRepo.update(dto.roomId, {
      lastMessageAt: new Date(),
      lastMessagePreview: dto.content.slice(0, 100),
    });

    return message;
  }

  async getMessages(
    roomId: string,
    userId: string,
    cursorId?: string,
    limit = 50,
  ): Promise<MessageEntity[]> {
    const isMember = await this.roomRepo.isMember(roomId, userId);
    if (!isMember) throw new ForbiddenException('Not a member of this room');
    return this.messageRepo.findMessagesBefore(roomId, cursorId, limit);
  }

  async editMessage(
    messageId: string,
    userId: string,
    newContent: string,
  ): Promise<MessageEntity> {
    const message = await this.messageRepo.findById(messageId);
    if (message.senderId !== userId) {
      throw new ForbiddenException('Cannot edit other users messages');
    }
    return this.messageRepo.update(messageId, {
      content: newContent,
      editedAt: new Date(),
    });
  }

  async deleteMessage(messageId: string, userId: string): Promise<void> {
    const message = await this.messageRepo.findById(messageId);
    if (message.senderId !== userId) {
      throw new ForbiddenException('Cannot delete other users messages');
    }
    await this.messageRepo.update(messageId, { content: 'This message was deleted' });
    await this.messageRepo.softDelete(messageId);
  }

  async markAsRead(roomId: string, userId: string): Promise<void> {
    await this.messageRepo.markRoomAsRead(roomId, userId);
  }

  async getUnreadCount(roomId: string, userId: string): Promise<number> {
    return this.messageRepo.getUnreadCount(roomId, userId);
  }
}
