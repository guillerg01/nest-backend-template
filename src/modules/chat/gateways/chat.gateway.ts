import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { Logger, UseGuards } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ChatService, SendMessageDto } from '../chat.service';
import { MessageType } from '../entities/message.entity';

interface AuthSocket extends Socket {
  userId: string;
  userEmail: string;
}

interface TypingPayload {
  roomId: string;
  isTyping: boolean;
}

interface JoinRoomPayload {
  roomId: string;
}

interface SendMessagePayload {
  roomId: string;
  content: string;
  type?: MessageType;
  replyToId?: string;
}

interface EditMessagePayload {
  messageId: string;
  content: string;
}

interface ReadPayload {
  roomId: string;
}

/**
 * Full-featured chat gateway.
 * Namespace: /chat
 *
 * Client events (emit FROM client):
 *   join_room      { roomId }
 *   leave_room     { roomId }
 *   send_message   { roomId, content, type?, replyToId? }
 *   edit_message   { messageId, content }
 *   delete_message { messageId }
 *   typing         { roomId, isTyping }
 *   mark_read      { roomId }
 *   get_history    { roomId, cursorId?, limit? }
 *
 * Server events (emit TO client):
 *   new_message      MessageEntity
 *   message_edited   { messageId, content, editedAt }
 *   message_deleted  { messageId, roomId }
 *   typing           { roomId, userId, isTyping }
 *   user_joined      { roomId, userId }
 *   user_left        { roomId, userId }
 *   read_receipt     { roomId, userId, readAt }
 *   history          MessageEntity[]
 *   error            { message }
 */
@WebSocketGateway({
  namespace: '/chat',
  cors: { origin: '*', credentials: true },
})
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChatGateway.name);

  // Track online users: userId → Set of socketIds
  private onlineUsers = new Map<string, Set<string>>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly chatService: ChatService,
  ) {}

  afterInit() {
    this.logger.log('Chat gateway initialized at /chat');

    // JWT auth middleware
    this.server.use((socket: AuthSocket, next) => {
      const token =
        socket.handshake.auth?.token ||
        (socket.handshake.headers?.authorization as string)?.replace('Bearer ', '');

      if (!token) return next(new Error('Authentication required'));

      try {
        const payload = this.jwtService.verify(token, {
          secret: this.config.get('JWT_SECRET'),
        });
        socket.userId = payload.sub;
        socket.userEmail = payload.email;
        next();
      } catch {
        next(new Error('Invalid token'));
      }
    });
  }

  handleConnection(socket: AuthSocket) {
    const { userId } = socket;
    this.logger.log(`Chat connect: ${socket.id} (user:${userId})`);

    // Join personal room for direct notifications
    socket.join(`user:${userId}`);

    // Track online presence
    if (!this.onlineUsers.has(userId)) {
      this.onlineUsers.set(userId, new Set());
    }
    this.onlineUsers.get(userId).add(socket.id);

    // Broadcast presence
    this.server.emit('user_online', { userId });
  }

  handleDisconnect(socket: AuthSocket) {
    const { userId } = socket;
    this.logger.log(`Chat disconnect: ${socket.id} (user:${userId})`);

    const sockets = this.onlineUsers.get(userId);
    if (sockets) {
      sockets.delete(socket.id);
      if (sockets.size === 0) {
        this.onlineUsers.delete(userId);
        this.server.emit('user_offline', { userId });
      }
    }
  }

  // ─── Room Management ──────────────────────────────────────────────────────

  @SubscribeMessage('join_room')
  async handleJoinRoom(
    @ConnectedSocket() socket: AuthSocket,
    @MessageBody() payload: JoinRoomPayload,
  ) {
    try {
      const room = await this.chatService.getRoomById(payload.roomId, socket.userId);
      socket.join(`room:${payload.roomId}`);

      // Notify others in room
      socket.to(`room:${payload.roomId}`).emit('user_joined', {
        roomId: payload.roomId,
        userId: socket.userId,
      });

      return { event: 'joined', roomId: payload.roomId };
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  }

  @SubscribeMessage('leave_room')
  async handleLeaveRoom(
    @ConnectedSocket() socket: AuthSocket,
    @MessageBody() payload: JoinRoomPayload,
  ) {
    socket.leave(`room:${payload.roomId}`);
    socket.to(`room:${payload.roomId}`).emit('user_left', {
      roomId: payload.roomId,
      userId: socket.userId,
    });
    return { event: 'left', roomId: payload.roomId };
  }

  // ─── Messages ─────────────────────────────────────────────────────────────

  @SubscribeMessage('send_message')
  async handleSendMessage(
    @ConnectedSocket() socket: AuthSocket,
    @MessageBody() payload: SendMessagePayload,
  ) {
    try {
      const message = await this.chatService.sendMessage(socket.userId, {
        roomId: payload.roomId,
        content: payload.content,
        type: payload.type,
        replyToId: payload.replyToId,
      });

      // Broadcast to all room members (including sender)
      this.server.to(`room:${payload.roomId}`).emit('new_message', message);

      return message;
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  }

  @SubscribeMessage('edit_message')
  async handleEditMessage(
    @ConnectedSocket() socket: AuthSocket,
    @MessageBody() payload: EditMessagePayload,
  ) {
    try {
      const message = await this.chatService.editMessage(
        payload.messageId,
        socket.userId,
        payload.content,
      );

      this.server.to(`room:${message.roomId}`).emit('message_edited', {
        messageId: message.id,
        content: message.content,
        editedAt: message.editedAt,
      });

      return message;
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  }

  @SubscribeMessage('delete_message')
  async handleDeleteMessage(
    @ConnectedSocket() socket: AuthSocket,
    @MessageBody() data: { messageId: string; roomId: string },
  ) {
    try {
      await this.chatService.deleteMessage(data.messageId, socket.userId);
      this.server.to(`room:${data.roomId}`).emit('message_deleted', {
        messageId: data.messageId,
        roomId: data.roomId,
      });
      return { deleted: true };
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  }

  // ─── Typing Indicators ────────────────────────────────────────────────────

  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() socket: AuthSocket,
    @MessageBody() payload: TypingPayload,
  ) {
    // Send to everyone EXCEPT the sender
    socket.to(`room:${payload.roomId}`).emit('typing', {
      roomId: payload.roomId,
      userId: socket.userId,
      isTyping: payload.isTyping,
    });
  }

  // ─── Read Receipts ────────────────────────────────────────────────────────

  @SubscribeMessage('mark_read')
  async handleMarkRead(
    @ConnectedSocket() socket: AuthSocket,
    @MessageBody() payload: ReadPayload,
  ) {
    await this.chatService.markAsRead(payload.roomId, socket.userId);

    // Notify room that this user has read
    socket.to(`room:${payload.roomId}`).emit('read_receipt', {
      roomId: payload.roomId,
      userId: socket.userId,
      readAt: new Date().toISOString(),
    });

    return { read: true };
  }

  // ─── Message History ──────────────────────────────────────────────────────

  @SubscribeMessage('get_history')
  async handleGetHistory(
    @ConnectedSocket() socket: AuthSocket,
    @MessageBody() data: { roomId: string; cursorId?: string; limit?: number },
  ) {
    try {
      const messages = await this.chatService.getMessages(
        data.roomId,
        socket.userId,
        data.cursorId,
        data.limit ?? 50,
      );

      socket.emit('history', { roomId: data.roomId, messages });
      return messages;
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  }

  // ─── Server → Client helpers (call from other services) ──────────────────

  sendToUser(userId: string, event: string, data: any) {
    this.server.to(`user:${userId}`).emit(event, data);
  }

  sendToRoom(roomId: string, event: string, data: any) {
    this.server.to(`room:${roomId}`).emit(event, data);
  }

  isUserOnline(userId: string): boolean {
    return this.onlineUsers.has(userId);
  }

  getOnlineCount(): number {
    return this.onlineUsers.size;
  }
}
