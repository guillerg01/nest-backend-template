import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { OpenAIService } from './services/openai.service';
import { OpenAIController } from './openai.controller';

@Module({
  imports: [
    MulterModule.register({ limits: { fileSize: 25 * 1024 * 1024 } }), // 25MB for Whisper
  ],
  providers: [OpenAIService],
  controllers: [OpenAIController],
  exports: [OpenAIService],
})
export class OpenAIModule {}
