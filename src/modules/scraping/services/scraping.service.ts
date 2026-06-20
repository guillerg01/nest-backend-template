import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosRequestConfig } from 'axios';
import * as cheerio from 'cheerio';
import { RetryService } from '../../../shared/services/retry.service';

export interface ScrapeOptions {
  url: string;
  headers?: Record<string, string>;
  proxy?: string;
  timeout?: number;
  javascript?: boolean; // Use Playwright when true
}

export interface ScrapeResult {
  url: string;
  html: string;
  statusCode: number;
  scrapedAt: Date;
}

export interface ParsedItem {
  [key: string]: any;
}

@Injectable()
export class ScrapingService {
  private readonly logger = new Logger(ScrapingService.name);
  private readonly defaultHeaders = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  };

  constructor(
    private readonly config: ConfigService,
    private readonly retryService: RetryService,
  ) {}

  // ─── SSRF block list ─────────────────────────────────────────────────────

  private readonly BLOCKED_HOSTS = [
    'localhost', '127.0.0.1', '0.0.0.0', '::1',
    '169.254.169.254', // AWS/GCP/Azure metadata
    '100.100.100.200', // Alibaba metadata
    'metadata.google.internal',
  ];

  private assertSafeUrl(url: string): void {
    let hostname: string;
    try {
      hostname = new URL(url).hostname.toLowerCase();
    } catch {
      throw new BadRequestException(`Invalid URL: ${url}`);
    }
    if (this.BLOCKED_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`))) {
      throw new BadRequestException(`URL not allowed: ${url}`);
    }
    // Block private RFC-1918 ranges by hostname pattern (basic guard)
    if (/^10\.|^172\.(1[6-9]|2\d|3[01])\.|^192\.168\./.test(hostname)) {
      throw new BadRequestException(`Private network URLs not allowed: ${url}`);
    }
  }

  // ─── Core HTTP Fetch ─────────────────────────────────────────────────────

  async fetchPage(options: ScrapeOptions): Promise<ScrapeResult> {
    this.assertSafeUrl(options.url);
    const { url, headers = {}, proxy, timeout = 15000 } = options;

    const axiosConfig: AxiosRequestConfig = {
      url,
      method: 'GET',
      headers: { ...this.defaultHeaders, ...headers },
      timeout,
      validateStatus: () => true,
    };

    if (proxy) {
      const proxyUrl = new URL(proxy);
      axiosConfig.proxy = {
        host: proxyUrl.hostname,
        port: parseInt(proxyUrl.port),
        auth:
          proxyUrl.username && proxyUrl.password
            ? { username: proxyUrl.username, password: proxyUrl.password }
            : undefined,
      };
    }

    return this.retryService.execute(
      async () => {
        this.logger.log(`Fetching: ${url}`);
        const response = await axios(axiosConfig);
        return {
          url,
          html: response.data,
          statusCode: response.status,
          scrapedAt: new Date(),
        };
      },
      `fetch:${url}`,
      { maxAttempts: 3, initialDelayMs: 2000 },
    );
  }

  // ─── Cheerio Parsing Utilities ───────────────────────────────────────────

  parseWithCheerio(html: string) {
    return cheerio.load(html);
  }

  extractLinks(html: string, baseUrl?: string): string[] {
    const $ = this.parseWithCheerio(html);
    const links: string[] = [];

    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;

      try {
        const fullUrl = baseUrl ? new URL(href, baseUrl).toString() : href;
        links.push(fullUrl);
      } catch {
        // ignore invalid URLs
      }
    });

    return [...new Set(links)];
  }

  extractTable(html: string, tableSelector = 'table'): Record<string, string>[] {
    const $ = this.parseWithCheerio(html);
    const headers: string[] = [];
    const rows: Record<string, string>[] = [];

    $(`${tableSelector} thead th`).each((_, el) => {
      headers.push($(el).text().trim());
    });

    $(`${tableSelector} tbody tr`).each((_, row) => {
      const rowData: Record<string, string> = {};
      $(row).find('td').each((i, cell) => {
        const header = headers[i] || `col_${i}`;
        rowData[header] = $(cell).text().trim();
      });
      if (Object.keys(rowData).length) rows.push(rowData);
    });

    return rows;
  }

  extractMetaTags(html: string): Record<string, string> {
    const $ = this.parseWithCheerio(html);
    const meta: Record<string, string> = {};

    $('meta').each((_, el) => {
      const name = $(el).attr('name') || $(el).attr('property');
      const content = $(el).attr('content');
      if (name && content) meta[name] = content;
    });

    meta.title = $('title').text().trim();
    return meta;
  }

  // ─── Batch Scraping with Rate Limiting ───────────────────────────────────

  async scrapeMany(
    urls: string[],
    options: Omit<ScrapeOptions, 'url'> = {},
    concurrency = parseInt(this.config.get('SCRAPING_CONCURRENCY') || '5'),
  ): Promise<ScrapeResult[]> {
    const results: ScrapeResult[] = [];
    const delayMs = parseInt(this.config.get('SCRAPING_DELAY_MS') || '2000');

    // Process in chunks to respect rate limits
    for (let i = 0; i < urls.length; i += concurrency) {
      const chunk = urls.slice(i, i + concurrency);
      const chunkResults = await Promise.allSettled(
        chunk.map((url) => this.fetchPage({ url, ...options })),
      );

      for (const result of chunkResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          this.logger.error(`Scrape failed: ${result.reason}`);
        }
      }

      // Rate limit delay between chunks
      if (i + concurrency < urls.length) {
        await this.sleep(delayMs);
      }
    }

    return results;
  }

  // ─── Data Normalization ───────────────────────────────────────────────────

  normalizeText(text: string): string {
    return text
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s.,@-]/g, '')
      .trim();
  }

  extractPrice(text: string): number | null {
    const match = text.match(/[\d.,]+/);
    if (!match) return null;
    return parseFloat(match[0].replace(',', '.'));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
