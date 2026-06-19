import { Controller, Post, Headers, ForbiddenException, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Public } from '../../shared/decorators/public.decorator';
import { SeedService } from './seed.service';

@ApiTags('Seed')
@Controller('seed')
export class SeedController {
  constructor(
    private readonly seedService: SeedService,
    private readonly config: ConfigService,
  ) {}

  @Get('status')
  @Public()
  @ApiOperation({ summary: 'Check if DB is seeded' })
  async status() {
    return { seeded: await this.seedService.isSeeded() };
  }

  @Post()
  @Public()
  @ApiOperation({ summary: 'Seed DB with roles, permissions and admin user' })
  async seed(@Headers('x-seed-secret') secret: string) {
    const expected = this.config.get<string>('SEED_SECRET');
    if (expected && secret !== expected) throw new ForbiddenException('Invalid seed secret');
    if (await this.seedService.isSeeded()) return { message: 'Already seeded', created: [] };
    return this.seedService.seed();
  }
}
