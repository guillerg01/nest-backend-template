import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, Repository } from 'typeorm';
import { BaseRepository } from '../../../shared/base/base.repository';
import { MessageEntity } from '../entities/message.entity';
import { RoomEntity } from '../entities/room.entity';

@Injectable()
export class MessageRepository extends BaseRepository<MessageEntity> {
  constructor(
    @InjectRepository(MessageEntity)
    private readonly msgRepo: Repository<MessageEntity>,
  ) {
    super(msgRepo);
  }

  /**
   * Cursor-based pagination for messages — much more efficient than offset for chat.
   * Clients send the last message ID they have; we return the next page.
   */
  async findMessagesBefore(
    roomId: string,
    cursorId?: string,
    limit = 50,
  ): Promise<MessageEntity[]> {
    const qb = this.msgRepo
      .createQueryBuilder('msg')
      .leftJoinAndSelect('msg.sender', 'sender')
      .where('msg.roomId = :roomId', { roomId })
      .andWhere('msg.deletedAt IS NULL')
      .orderBy('msg.createdAt', 'DESC')
      .take(limit);

    if (cursorId) {
      const cursor = await this.msgRepo.findOne({ where: { id: cursorId } });
      if (cursor) {
        qb.andWhere('msg.createdAt < :cursorTime', { cursorTime: cursor.createdAt });
      }
    }

    const messages = await qb.getMany();
    return messages.reverse(); // Return chronological order
  }

  async markRoomAsRead(roomId: string, userId: string): Promise<void> {
    // Mark all unread messages in room as read for this user
    await this.msgRepo.query(
      `UPDATE chat_messages
       SET read_by = read_by || $1::jsonb
       WHERE room_id = $2
         AND deleted_at IS NULL
         AND NOT (read_by @> $3::jsonb)
         AND sender_id != $4`,
      [
        JSON.stringify([{ userId, readAt: new Date().toISOString() }]),
        roomId,
        JSON.stringify([{ userId }]),
        userId,
      ],
    );
  }

  async getUnreadCount(roomId: string, userId: string): Promise<number> {
    return this.msgRepo
      .createQueryBuilder('msg')
      .where('msg.roomId = :roomId', { roomId })
      .andWhere('msg.senderId != :userId', { userId })
      .andWhere('msg.deletedAt IS NULL')
      .andWhere(`NOT (msg.readBy @> :check::jsonb)`, {
        check: JSON.stringify([{ userId }]),
      })
      .getCount();
  }
}

@Injectable()
export class RoomRepository extends BaseRepository<RoomEntity> {
  constructor(
    @InjectRepository(RoomEntity)
    private readonly roomRepo: Repository<RoomEntity>,
  ) {
    super(roomRepo);
  }

  async createWithMembers(data: DeepPartial<RoomEntity>, memberIds: string[]): Promise<RoomEntity> {
    const room = this.roomRepo.create(data);
    // Assign by reference so TypeORM inserts into chat_room_members join table
    room.members = memberIds.map((id) => ({ id }) as any);
    return this.roomRepo.save(room);
  }

  async findUserRooms(userId: string): Promise<RoomEntity[]> {
    return this.roomRepo
      .createQueryBuilder('room')
      .innerJoin('room.members', 'member', 'member.id = :userId', { userId })
      .leftJoinAndSelect('room.members', 'allMembers')
      .where('room.deletedAt IS NULL')
      .orderBy('room.lastMessageAt', 'DESC')
      .getMany();
  }

  async findDirectRoom(userA: string, userB: string): Promise<RoomEntity | null> {
    return this.roomRepo
      .createQueryBuilder('room')
      .innerJoin('room.members', 'memberA', 'memberA.id = :userA', { userA })
      .innerJoin('room.members', 'memberB', 'memberB.id = :userB', { userB })
      .where('room.type = :type', { type: 'direct' })
      .getOne();
  }

  async isMember(roomId: string, userId: string): Promise<boolean> {
    const count = await this.roomRepo
      .createQueryBuilder('room')
      .innerJoin('room.members', 'member', 'member.id = :userId', { userId })
      .where('room.id = :roomId', { roomId })
      .getCount();
    return count > 0;
  }
}
