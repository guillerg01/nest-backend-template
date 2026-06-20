import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, IsUrl } from 'class-validator';
import { ScrapingService } from './services/scraping.service';
import { Permissions } from '../../shared/decorators/permissions.decorator';

class ScrapeUrlDto {
  @ApiProperty({ example: 'https://example.com' })
  @IsUrl()
  url: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  proxy?: string;
}

@ApiTags('Scraping')
@ApiBearerAuth()
@Controller('scraping')
export class ScrapingController {
  constructor(private readonly scrapingService: ScrapingService) {}

  @Post('fetch')
  @Permissions('scraping:execute')
  @ApiOperation({ summary: 'Fetch and parse a URL' })
  async fetchUrl(@Body() dto: ScrapeUrlDto) {
    const result = await this.scrapingService.fetchPage({
      url: dto.url,
      proxy: dto.proxy,
    });

    const meta = this.scrapingService.extractMetaTags(result.html);
    const links = this.scrapingService.extractLinks(result.html, dto.url);

    return {
      statusCode: result.statusCode,
      scrapedAt: result.scrapedAt,
      meta,
      linkCount: links.length,
      links: links.slice(0, 20), // Return first 20 links
    };
  }

  @Post('table')
  @Permissions('scraping:execute')
  @ApiOperation({ summary: 'Extract table data from a URL' })
  async extractTable(@Body() dto: ScrapeUrlDto & { tableSelector?: string }) {
    const result = await this.scrapingService.fetchPage({ url: dto.url });
    const rows = this.scrapingService.extractTable(result.html, dto.tableSelector);
    return { rowCount: rows.length, rows };
  }
}
