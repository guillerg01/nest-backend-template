# Realtime Module

Socket.io namespaces, rooms, JWT auth, chat lifecycle, presence, and horizontal scaling.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [JWT Auth on WebSocket Handshake](#jwt-auth-on-websocket-handshake)
3. [Namespaces and Rooms Pattern](#namespaces-and-rooms-pattern)
4. [Chat Room Lifecycle](#chat-room-lifecycle)
5. [Presence and Online Status](#presence-and-online-status)
6. [Typing Indicators](#typing-indicators)
7. [Read Receipts](#read-receipts)
8. [Message Persistence](#message-persistence)
9. [Horizontal Scaling (Redis Adapter)](#horizontal-scaling)
10. [Alternatives](#alternatives)
11. [Mobile Push Notifications](#mobile-push-notifications)

---

## Architecture Overview

```
Client
  │  ws://api/chat (namespace)
  │
  ▼
ChatGateway (@WebSocketGateway)
  │
  ├── @SubscribeMessage('join-room')
  ├── @SubscribeMessage('send-message')
  ├── @SubscribeMessage('typing-start')
  ├── @SubscribeMessage('typing-stop')
  └── @SubscribeMessage('mark-read')
```

---

## JWT Auth on WebSocket Handshake

WebSocket connections happen once — authenticate at handshake time, not per-message.

```typescript
// chat.gateway.ts
@WebSocketGateway({
  namespace: '/chat',
  cors: {
    origin: process.env.FRONTEND_URL,
    credentials: true,
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
    private readonly messagesService: MessagesService,
    private readonly redisService: RedisService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = this.extractToken(client);
      const payload = await this.jwtService.verifyAsync(token, {
        secret: process.env.JWT_SECRET,
      });

      const user = await this.usersService.findById(payload.sub);
      if (!user) throw new Error('User not found');

      // Attach user to socket — available in all handlers
      client.data.user = user;

      // Track presence in Redis
      await this.redisService.set(`online:${user.id}`, client.id, 'EX', 86400);

      // Notify contacts this user is online
      this.server.emit('user-online', { userId: user.id });

      this.logger.log(`Client connected: ${user.email} (${client.id})`);
    } catch (err) {
      // Reject connection — sends disconnect event to client
      client.emit('auth-error', { message: 'Authentication failed' });
      client.disconnect();
    }
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const user = client.data.user;
    if (!user) return;

    await this.redisService.del(`online:${user.id}`);
    this.server.emit('user-offline', { userId: user.id });
  }

  private extractToken(client: Socket): string {
    // Token can come from: auth header, query param, or cookie
    const authHeader = client.handshake.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    const queryToken = client.handshake.query.token as string;
    if (queryToken) return queryToken;

    throw new Error('No token provided');
  }
}
```

### Frontend Connection

```typescript
// Frontend (Socket.io client)
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000/chat', {
  auth: { token: accessToken },
  // Or via query: transports: ['websocket'], query: { token: accessToken }
});

socket.on('connect', () => console.log('Connected'));
socket.on('auth-error', (err) => console.error('Auth failed', err));
```

---

## Namespaces and Rooms Pattern

**Namespaces** = separate connection endpoints, different auth logic, different event sets.
**Rooms** = logical groups within a namespace, same connection.

```
/chat namespace
  ├── room: room_abc123       (conversation between users)
  ├── room: room_xyz456
  └── room: user_user-id-here (personal room for DMs and notifications)

/notifications namespace
  └── room: user_userId       (per-user notification channel)

/admin namespace (separate auth — admin only)
  └── global broadcast room
```

```typescript
// Joining a namespace — done at connection time by client:
// io('http://api/chat')  vs  io('http://api/notifications')

// Rooms are joined programmatically in handlers:
@SubscribeMessage('join-room')
async joinRoom(
  @ConnectedSocket() client: Socket,
  @MessageBody() dto: JoinRoomDto,
) {
  const user = client.data.user;

  // Verify user has access to this room
  const hasAccess = await this.roomsService.userHasAccess(user.id, dto.roomId);
  if (!hasAccess) throw new WsException('Access denied');

  await client.join(`room_${dto.roomId}`);

  // Also join personal room for DMs
  await client.join(`user_${user.id}`);

  // Emit room history to the joining user
  const messages = await this.messagesService.findRecentByRoom(dto.roomId, 50);
  client.emit('room-history', messages);

  // Notify room members someone joined
  client.to(`room_${dto.roomId}`).emit('user-joined', {
    userId: user.id,
    username: user.firstName,
  });
}
```

---

## Chat Room Lifecycle

```
JOIN                    MESSAGE                 LEAVE / DISCONNECT
────                    ───────                 ──────────────────
client.emit('join-room') → joinRoom handler     client.emit('leave-room')
  → verify access                               OR browser closes
  → socket.join(roomId)   client.emit(          → handleDisconnect fires
  → emit history          'send-message')         → leave all rooms
  → notify members          → validate           → emit 'user-left'
                            → save to DB         → update presence
                            → broadcast
                            → emit delivery
                              receipt
```

```typescript
@SubscribeMessage('send-message')
async sendMessage(
  @ConnectedSocket() client: Socket,
  @MessageBody() dto: SendMessageDto,
): Promise<void> {
  const user = client.data.user;

  // Validate user is in the room
  const rooms = client.rooms;
  if (!rooms.has(`room_${dto.roomId}`)) {
    throw new WsException('Not in room');
  }

  // Persist message
  const message = await this.messagesService.create({
    content: dto.content,
    roomId: dto.roomId,
    senderId: user.id,
    type: dto.type ?? 'text', // text | image | file
  });

  const payload = {
    id: message.id,
    content: message.content,
    roomId: message.roomId,
    sender: {
      id: user.id,
      name: user.firstName,
      avatar: user.avatar,
    },
    createdAt: message.createdAt,
    type: message.type,
  };

  // Broadcast to everyone in the room INCLUDING the sender
  this.server.to(`room_${dto.roomId}`).emit('new-message', payload);
}

@SubscribeMessage('leave-room')
async leaveRoom(
  @ConnectedSocket() client: Socket,
  @MessageBody() dto: { roomId: string },
) {
  await client.leave(`room_${dto.roomId}`);
  client.to(`room_${dto.roomId}`).emit('user-left', {
    userId: client.data.user.id,
  });
}
```

---

## Presence and Online Status

Track online users in Redis — not in-memory (breaks with multiple server instances).

```typescript
// Check if specific users are online
async getOnlineUsers(userIds: string[]): Promise<string[]> {
  const pipeline = this.redisService.pipeline();
  for (const id of userIds) {
    pipeline.exists(`online:${id}`);
  }
  const results = await pipeline.exec();
  return userIds.filter((id, i) => results[i][1] === 1);
}

// Get all online users (for small user bases)
async getAllOnlineUserIds(): Promise<string[]> {
  const keys = await this.redisService.keys('online:*');
  return keys.map(key => key.replace('online:', ''));
}
```

```typescript
// REST endpoint for initial presence state
@Get('presence')
async getPresence(@Query('userIds') userIdsQuery: string) {
  const userIds = userIdsQuery.split(',');
  const onlineIds = await this.realtimeService.getOnlineUsers(userIds);
  return { online: onlineIds };
}
```

---

## Typing Indicators

Typing events are ephemeral — never persist them. Emit with debounce.

```typescript
@SubscribeMessage('typing-start')
handleTypingStart(
  @ConnectedSocket() client: Socket,
  @MessageBody() dto: { roomId: string },
) {
  const { user } = client.data;
  client.to(`room_${dto.roomId}`).emit('user-typing', {
    userId: user.id,
    username: user.firstName,
    roomId: dto.roomId,
  });
}

@SubscribeMessage('typing-stop')
handleTypingStop(
  @ConnectedSocket() client: Socket,
  @MessageBody() dto: { roomId: string },
) {
  client.to(`room_${dto.roomId}`).emit('user-stopped-typing', {
    userId: client.data.user.id,
    roomId: dto.roomId,
  });
}
```

Frontend pattern: emit `typing-start` on keydown, emit `typing-stop` on 2s of no keystrokes.

```typescript
// Frontend
let typingTimeout: ReturnType<typeof setTimeout>;

input.addEventListener('keydown', () => {
  socket.emit('typing-start', { roomId });
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    socket.emit('typing-stop', { roomId });
  }, 2000);
});
```

---

## Read Receipts

```typescript
@SubscribeMessage('mark-read')
async markRead(
  @ConnectedSocket() client: Socket,
  @MessageBody() dto: { roomId: string; lastReadMessageId: string },
) {
  const { user } = client.data;

  // Update last read position
  await this.roomMembersService.updateLastRead(
    user.id,
    dto.roomId,
    dto.lastReadMessageId,
  );

  // Notify message sender(s) in the room
  client.to(`room_${dto.roomId}`).emit('message-read', {
    userId: user.id,
    roomId: dto.roomId,
    lastReadMessageId: dto.lastReadMessageId,
    readAt: new Date().toISOString(),
  });
}

// To calculate unread count per room:
async getUnreadCount(userId: string, roomId: string): Promise<number> {
  const member = await this.roomMembersService.findByUserAndRoom(userId, roomId);
  if (!member?.lastReadMessageId) {
    return this.messagesService.countByRoom(roomId);
  }
  return this.messagesService.countAfter(roomId, member.lastReadMessageId);
}
```

---

## Message Persistence

### Entities Required

```typescript
@Entity('rooms')
export class Room extends BaseEntity {
  @Column()
  name: string;

  @Column({ nullable: true })
  description: string;

  @Column({ default: false })
  isPrivate: boolean;

  @Column({ default: 'group' }) // 'group' | 'direct'
  type: string;

  @OneToMany(() => RoomMember, member => member.room)
  members: RoomMember[];

  @OneToMany(() => Message, message => message.room)
  messages: Message[];
}

@Entity('room_members')
export class RoomMember extends BaseEntity {
  @Column()
  userId: string;

  @Column()
  roomId: string;

  @Column({ nullable: true })
  lastReadMessageId: string;

  @Column({ default: 'member' }) // 'owner' | 'admin' | 'member'
  role: string;

  @Column({ nullable: true })
  lastReadAt: Date;
}

@Entity('messages')
export class Message extends BaseEntity {
  @Column('text')
  content: string;

  @Column()
  senderId: string;

  @Column()
  roomId: string;

  @Column({ default: 'text' }) // 'text' | 'image' | 'file' | 'system'
  type: string;

  @Column({ nullable: true })
  replyToId: string; // for threaded replies

  @Column({ default: false })
  isEdited: boolean;

  @Column({ nullable: true })
  editedAt: Date;
}
```

### Performance Consideration

Index messages on `(roomId, createdAt DESC)` for fast message retrieval. For very high-volume chat, consider separate PostgreSQL table partitioned by date, or a dedicated time-series DB.

```typescript
// TypeORM index on Message entity
@Entity('messages')
@Index(['roomId', 'createdAt'])
export class Message extends BaseEntity { ... }
```

---

## Horizontal Scaling

### The Critical Problem

Socket.io stores room/socket state in memory on a single process. When you run multiple instances:

```
User A (Instance 1)  ──sends message──►  Instance 1 (room_abc)
User B (Instance 2)  ──in room_abc──►    Instance 2 (room_abc)

Instance 1 emits to room_abc → only reaches sockets on Instance 1
User B NEVER receives the message
```

### Solution: Redis Adapter

```bash
npm install @socket.io/redis-adapter redis
```

```typescript
// realtime.module.ts — or main.ts after app init
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const httpServer = app.getHttpServer();

  // Wait for app to init so IoAdapter is set up
  await app.init();

  // Get Socket.io server instance
  const io = app.get(Server); // or via IoAdapter

  // Create Redis pub/sub clients (must be separate clients)
  const pubClient = createClient({ url: process.env.REDIS_URL });
  const subClient = pubClient.duplicate();

  await Promise.all([pubClient.connect(), subClient.connect()]);

  io.adapter(createAdapter(pubClient, subClient));

  await app.listen(3000);
}
```

```typescript
// Better approach: custom IoAdapter
// src/common/adapters/redis-io.adapter.ts
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { ServerOptions } from 'socket.io';

export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor: ReturnType<typeof createAdapter>;

  async connectToRedis(url: string): Promise<void> {
    const pubClient = createClient({ url });
    const subClient = pubClient.duplicate();

    await Promise.all([pubClient.connect(), subClient.connect()]);

    this.adapterConstructor = createAdapter(pubClient, subClient);
  }

  createIOServer(port: number, options?: ServerOptions): any {
    const server = super.createIOServer(port, options);
    server.adapter(this.adapterConstructor);
    return server;
  }
}

// main.ts
const redisIoAdapter = new RedisIoAdapter(app);
await redisIoAdapter.connectToRedis(process.env.REDIS_URL);
app.useWebSocketAdapter(redisIoAdapter);
```

### What Redis Adapter Does

- Synchronizes room membership across all instances
- Broadcasts messages to the correct sockets regardless of which instance they're connected to
- Uses Redis pub/sub channel per Socket.io namespace
- Minimal latency overhead (sub-millisecond for local Redis)

---

## Alternatives

### When to Use Each Realtime Technology

| Technology | Use case | Pros | Cons |
|---|---|---|---|
| Socket.io (current) | Bidirectional, chat, games, collaboration | Auto-reconnect, rooms, fallback | Requires Redis at scale, heavy |
| `ws` (native WebSocket) | Simple bidirectional, custom protocol | Lightweight, no abstraction | No rooms, no reconnect, manual everything |
| Server-Sent Events (SSE) | One-way: notifications, live feeds, dashboards | HTTP-based, simple, proxies work | One-way only (server → client) |
| Long Polling | Compatibility, firewalls block WS | Works everywhere | Inefficient, high latency |
| WebRTC | P2P: video, audio, file sharing | True P2P, no server relay cost | Complex signaling, NAT traversal |

### SSE for One-Way Streams

Perfect for: live dashboard updates, notification feeds, job progress.

```typescript
// notifications.controller.ts
@Get('stream')
@Sse()
notificationStream(@CurrentUser() user: User): Observable<MessageEvent> {
  return new Observable(observer => {
    const handler = (notification: Notification) => {
      observer.next({ data: JSON.stringify(notification) });
    };

    this.notificationEmitter.on(`notification:${user.id}`, handler);

    return () => {
      this.notificationEmitter.off(`notification:${user.id}`, handler);
    };
  });
}
```

```typescript
// Frontend SSE consumption
const eventSource = new EventSource('/notifications/stream', {
  withCredentials: true,
});

eventSource.onmessage = (event) => {
  const notification = JSON.parse(event.data);
  showToast(notification);
};
```

---

## Mobile Push Notifications

When users are offline (app backgrounded/closed), WebSockets can't deliver. Use FCM for mobile push.

```bash
npm install firebase-admin
```

```typescript
// push.service.ts
import * as admin from 'firebase-admin';

@Injectable()
export class PushNotificationService implements OnModuleInit {
  onModuleInit() {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });
  }

  async sendPush(
    fcmToken: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<void> {
    await admin.messaging().send({
      token: fcmToken,
      notification: { title, body },
      data,
      android: {
        priority: 'high',
        notification: { sound: 'default', channelId: 'default' },
      },
      apns: {
        payload: { aps: { sound: 'default', badge: 1 } },
      },
    });
  }

  async sendMulticast(
    fcmTokens: string[],
    title: string,
    body: string,
  ): Promise<admin.messaging.BatchResponse> {
    return admin.messaging().sendEachForMulticast({
      tokens: fcmTokens,
      notification: { title, body },
    });
  }
}
```

### Hybrid Strategy

```typescript
async deliverMessage(userId: string, message: ChatMessage): Promise<void> {
  const isOnline = await this.redisService.exists(`online:${userId}`);

  if (isOnline) {
    // User is online — deliver via WebSocket
    this.server.to(`user_${userId}`).emit('new-message', message);
  } else {
    // User is offline — send push notification
    const user = await this.usersService.findById(userId);
    if (user.fcmToken) {
      await this.pushService.sendPush(
        user.fcmToken,
        `New message from ${message.sender.name}`,
        message.content.substring(0, 100),
        { roomId: message.roomId, messageId: message.id },
      );
    }
  }
}
```
