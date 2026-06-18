import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoomEntity } from './entities/room.entity';
import { MessageEntity } from './entities/message.entity';
import { RoomRepository, MessageRepository } from './repositories/chat.repository';
import { ChatService } from './chat.service';
import { ChatGateway } from './gateways/chat.gateway';
import { ChatController } from './chat.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([RoomEntity, MessageEntity]),
    AuthModule, // For JwtService in gateway
  ],
  providers: [RoomRepository, MessageRepository, ChatService, ChatGateway],
  controllers: [ChatController],
  exports: [ChatService, ChatGateway],
})
export class ChatModule {}
