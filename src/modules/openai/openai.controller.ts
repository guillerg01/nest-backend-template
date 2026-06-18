import {
  Body,
  Controller,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Response } from 'express';
import { OpenAIService } from './services/openai.service';

class ChatDto {
  @ApiProperty({ example: 'What is TypeScript?' })
  @IsString()
  message: string;

  @ApiProperty({ required: false, example: 'You are a helpful assistant.' })
  @IsOptional()
  @IsString()
  systemPrompt?: string;
}

class ImagePromptDto {
  @ApiProperty({ example: 'A futuristic city skyline at sunset' })
  @IsString()
  prompt: string;
}

class ModerateDto {
  @ApiProperty()
  @IsString()
  text: string;
}

@ApiTags('OpenAI')
@ApiBearerAuth()
@Controller('openai')
export class OpenAIController {
  constructor(private readonly openaiService: OpenAIService) {}

  @Post('chat')
  @ApiOperation({ summary: 'Single-turn chat completion' })
  async chat(@Body() dto: ChatDto) {
    const reply = await this.openaiService.chat(
      [{ role: 'user', content: dto.message }],
      { systemPrompt: dto.systemPrompt },
    );
    return { reply };
  }

  @Post('chat/stream')
  @ApiOperation({ summary: 'Streaming chat completion (Server-Sent Events)' })
  async chatStream(@Body() dto: ChatDto, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    for await (const chunk of this.openaiService.chatStream(
      [{ role: 'user', content: dto.message }],
      { systemPrompt: dto.systemPrompt },
    )) {
      res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
    }

    res.write('data: [DONE]\n\n');
    res.end();
  }

  @Post('image/generate')
  @ApiOperation({ summary: 'Generate image with DALL-E 3' })
  async generateImage(@Body() dto: ImagePromptDto) {
    const urls = await this.openaiService.generateImage(dto.prompt);
    return { urls };
  }

  @Post('moderate')
  @ApiOperation({ summary: 'Check text for policy violations' })
  async moderate(@Body() dto: ModerateDto) {
    return this.openaiService.moderate(dto.text);
  }

  @Post('transcribe')
  @ApiOperation({ summary: 'Transcribe audio file (Whisper)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('audio'))
  async transcribe(@UploadedFile() file: Express.Multer.File) {
    const text = await this.openaiService.transcribe(file.buffer, file.originalname);
    return { text };
  }
}
