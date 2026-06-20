import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger, UsePipes, ValidationPipe } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

interface ConnectedUser {
  userId: string;
  socketId: string;
  connectedAt: Date;
}

@UsePipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }))
@WebSocketGateway({
  namespace: '/realtime',
  cors: {
    origin: process.env.FRONTEND_URL
      ? [process.env.FRONTEND_URL, 'http://localhost:3001', 'http://localhost:3000']
      : ['http://localhost:3001', 'http://localhost:3000'],
    credentials: true,
  },
})
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(RealtimeGateway.name);
  private connectedUsers = new Map<string, ConnectedUser[]>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  afterInit(server: Server) {
    this.logger.log('WebSocket Gateway initialized at /realtime');

    // JWT auth middleware for WebSocket connections
    server.use((socket: Socket, next) => {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) return next(new Error('Authentication required'));

      try {
        const payload = this.jwtService.verify(token, {
          secret: this.config.get('JWT_SECRET'),
        });
        (socket as any).userId = payload.sub;
        next();
      } catch {
        next(new Error('Invalid token'));
      }
    });
  }

  handleConnection(socket: Socket) {
    const userId = (socket as any).userId;
    this.logger.log(`Client connected: ${socket.id} (user: ${userId})`);

    // Join user's personal room
    socket.join(`user:${userId}`);

    // Track connected sockets per user
    const existing = this.connectedUsers.get(userId) || [];
    existing.push({ userId, socketId: socket.id, connectedAt: new Date() });
    this.connectedUsers.set(userId, existing);

    socket.emit('connected', { userId, socketId: socket.id });
  }

  handleDisconnect(socket: Socket) {
    const userId = (socket as any).userId;
    this.logger.log(`Client disconnected: ${socket.id}`);

    const remaining = (this.connectedUsers.get(userId) || []).filter(
      (u) => u.socketId !== socket.id,
    );

    if (remaining.length === 0) {
      this.connectedUsers.delete(userId);
    } else {
      this.connectedUsers.set(userId, remaining);
    }
  }

  // ─── Message Events ───────────────────────────────────────────────────────

  @SubscribeMessage('message')
  handleMessage(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: { roomId: string; content: string },
  ) {
    const userId = (socket as any).userId;
    const message = {
      id: `msg_${Date.now()}`,
      userId,
      roomId: data.roomId,
      content: data.content,
      timestamp: new Date().toISOString(),
    };

    // Broadcast to room
    this.server.to(`room:${data.roomId}`).emit('message', message);
    return { status: 'sent', message };
  }

  @SubscribeMessage('join_room')
  handleJoinRoom(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    socket.join(`room:${data.roomId}`);
    socket.to(`room:${data.roomId}`).emit('user_joined', {
      userId: (socket as any).userId,
      roomId: data.roomId,
    });
    return { status: 'joined', roomId: data.roomId };
  }

  @SubscribeMessage('leave_room')
  handleLeaveRoom(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: { roomId: string },
  ) {
    socket.leave(`room:${data.roomId}`);
    return { status: 'left', roomId: data.roomId };
  }

  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: { roomId: string; isTyping: boolean },
  ) {
    socket.to(`room:${data.roomId}`).emit('typing', {
      userId: (socket as any).userId,
      isTyping: data.isTyping,
    });
  }

  // ─── Server → Client emitters (call from services) ────────────────────────

  sendToUser(userId: string, event: string, data: any) {
    this.server.to(`user:${userId}`).emit(event, data);
  }

  broadcast(event: string, data: any) {
    this.server.emit(event, data);
  }

  sendToRoom(roomId: string, event: string, data: any) {
    this.server.to(`room:${roomId}`).emit(event, data);
  }

  getOnlineUsers(): string[] {
    return [...this.connectedUsers.keys()];
  }
}
