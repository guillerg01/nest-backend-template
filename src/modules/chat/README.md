# Chat Module

Real-time chat using Socket.io with JWT authentication. Namespace: `/chat`.

## Features

- Rooms: direct, group, channel, support
- ManyToMany membership persisted via `chat_room_members` join table
- Typing indicators, read receipts, message history (cursor-based)
- Edit / delete messages
- Presence (user_online / user_offline events)

## REST API

| Method | Route | Permission | Description |
|--------|-------|-----------|-------------|
| POST | `/chat/rooms` | `chat:create` | Create room |
| GET | `/chat/rooms` | `chat:read` | List user rooms |
| GET | `/chat/rooms/:id` | `chat:read` | Room detail + members |
| DELETE | `/chat/rooms/:id` | `chat:delete` | Delete room |
| GET | `/chat/rooms/:id/messages` | `chat:read` | Message history |

## WebSocket (namespace `/chat`)

### Connection

Pass JWT in the handshake:

```js
const socket = io('http://localhost:3000/chat', {
  auth: { token: 'Bearer <access_token>' },
});
```

**Do NOT use `EventSource`** — this gateway requires the JWT token which EventSource can't send. Use `socket.io-client` or `fetch` + `WebSocket`.

### Client → Server events

| Event | Payload | Description |
|-------|---------|-------------|
| `join_room` | `{ roomId }` | Join a room |
| `leave_room` | `{ roomId }` | Leave a room |
| `send_message` | `{ roomId, content, type?, replyToId? }` | Send message |
| `edit_message` | `{ messageId, content }` | Edit own message |
| `delete_message` | `{ messageId, roomId }` | Delete own message |
| `typing` | `{ roomId, isTyping }` | Typing indicator |
| `mark_read` | `{ roomId }` | Mark messages as read |
| `get_history` | `{ roomId, cursorId?, limit? }` | Load message history |

### Server → Client events

| Event | Payload |
|-------|---------|
| `new_message` | `MessageEntity` |
| `message_edited` | `{ messageId, content, editedAt }` |
| `message_deleted` | `{ messageId, roomId }` |
| `typing` | `{ roomId, userId, isTyping }` |
| `user_joined` | `{ roomId, userId }` |
| `user_left` | `{ roomId, userId }` |
| `read_receipt` | `{ roomId, userId, readAt }` |
| `history` | `{ roomId, messages: MessageEntity[] }` |
| `user_online` | `{ userId }` |
| `user_offline` | `{ userId }` |
| `error` | `{ message }` |

### Message types

```ts
enum MessageType {
  TEXT = 'text',
  IMAGE = 'image',
  FILE = 'file',
  SYSTEM = 'system',
}
```

## Validations

- `roomId`, `messageId` must be valid UUIDs (validated in service via TypeORM queries)
- `content` max length enforced in `MessageEntity`
- `type` validated against `MessageType` enum
- Payload whitelist enforced by `ValidationPipe` at gateway level (convert interfaces to DTOs for full decorator-based validation)

## Alternative ORMs / Databases

### Prisma

Replace `RoomEntity` and `MessageEntity` with Prisma models:

```prisma
model ChatRoom {
  id        String   @id @default(uuid())
  name      String?
  type      RoomType @default(GROUP)
  members   User[]   @relation("ChatRoomMembers")
  messages  ChatMessage[]
  createdAt DateTime @default(now())
}

model ChatMessage {
  id        String   @id @default(uuid())
  content   String
  senderId  String
  roomId    String
  room      ChatRoom @relation(fields: [roomId], references: [id])
  createdAt DateTime @default(now())
}
```

Inject `PrismaService` instead of `ChatRepository`. Replace `this.roomRepo.createWithMembers(...)` with:

```ts
await prisma.chatRoom.create({
  data: {
    name, type, members: { connect: memberIds.map(id => ({ id })) }
  }
});
```

### MongoDB (Mongoose)

Use `@Schema()` decorators; ManyToMany becomes an array of ObjectIds in the room document. Presence tracking works the same (in-memory Map + socket events).

### MySQL / MariaDB

Replace `jsonb` column types with `json`. Enum columns are natively supported. ManyToMany join table same structure.
