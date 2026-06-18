import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ChatService } from './chat.service';
import { RoomType } from './entities/room.entity';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';

class CreateRoomDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ enum: RoomType, required: false })
  @IsOptional()
  @IsEnum(RoomType)
  type?: RoomType;

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsUUID('4', { each: true })
  memberIds: string[];
}

class DirectRoomDto {
  @ApiProperty()
  @IsUUID()
  targetUserId: string;
}

@ApiTags('Chat')
@ApiBearerAuth()
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get('rooms')
  @ApiOperation({ summary: 'Get all rooms for current user' })
  getRooms(@CurrentUser('id') userId: string) {
    return this.chatService.getUserRooms(userId);
  }

  @Post('rooms')
  @ApiOperation({ summary: 'Create a new chat room' })
  createRoom(@CurrentUser('id') userId: string, @Body() dto: CreateRoomDto) {
    return this.chatService.createRoom(userId, dto);
  }

  @Post('rooms/direct')
  @ApiOperation({ summary: 'Get or create a direct (1:1) room' })
  directRoom(@CurrentUser('id') userId: string, @Body() dto: DirectRoomDto) {
    return this.chatService.getOrCreateDirectRoom(userId, dto.targetUserId);
  }

  @Get('rooms/:roomId')
  @ApiOperation({ summary: 'Get room details' })
  getRoom(@Param('roomId') roomId: string, @CurrentUser('id') userId: string) {
    return this.chatService.getRoomById(roomId, userId);
  }

  @Get('rooms/:roomId/messages')
  @ApiOperation({ summary: 'Get message history (cursor-based pagination)' })
  getMessages(
    @Param('roomId') roomId: string,
    @CurrentUser('id') userId: string,
    @Query('cursor') cursorId?: string,
    @Query('limit') limit?: number,
  ) {
    return this.chatService.getMessages(roomId, userId, cursorId, limit ?? 50);
  }

  @Get('rooms/:roomId/unread')
  @ApiOperation({ summary: 'Get unread message count for a room' })
  getUnreadCount(
    @Param('roomId') roomId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.chatService.getUnreadCount(roomId, userId);
  }

  @Post('rooms/:roomId/read')
  @ApiOperation({ summary: 'Mark all messages in room as read' })
  markRead(@Param('roomId') roomId: string, @CurrentUser('id') userId: string) {
    return this.chatService.markAsRead(roomId, userId);
  }

  @Delete('messages/:messageId')
  @ApiOperation({ summary: 'Delete a message' })
  deleteMessage(
    @Param('messageId') messageId: string,
    @CurrentUser('id') userId: string,
    @Query('roomId') roomId: string,
  ) {
    return this.chatService.deleteMessage(messageId, userId);
  }
}
