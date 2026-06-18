# Scraping Module

Web scraping with Cheerio and Playwright, proxy rotation, anti-detection, scheduling, and legal considerations.

---

## Table of Contents

1. [Cheerio vs Playwright vs Puppeteer](#cheerio-vs-playwright-vs-puppeteer)
2. [Proxy Rotation](#proxy-rotation)
3. [Rate Limiting and Robots.txt](#rate-limiting)
4. [Anti-Detection](#anti-detection)
5. [Data Normalization](#data-normalization)
6. [Scheduled Scraping](#scheduled-scraping)
7. [Storing Scraped Data](#storing-scraped-data)
8. [Legal and Ethical Considerations](#legal-and-ethical)
9. [Alternatives: APIs First](#alternatives-apis-first)

---

## Cheerio vs Playwright vs Puppeteer

### Decision Table

| Scenario | Use Cheerio | Use Playwright | Use Puppeteer |
|---|---|---|---|
| Static HTML page | Yes | Overkill | Overkill |
| Content rendered by JavaScript | No | Yes | Yes |
| Pagination with button clicks | No | Yes | Yes |
| Login form to fill | No | Yes | Yes |
| Infinite scroll | No | Yes | Yes |
| Speed (scraping 10k pages) | Fast (~5ms/page) | Slow (browser launch + render) | Slow |
| Memory usage | Tiny | High (Chromium) | High (Chromium) |
| Server cost | Minimal | High | High |

### Cheerio (Static HTML)

```bash
npm install cheerio axios
```

```typescript
// scraping.service.ts
import * as cheerio from 'cheerio';
import axios from 'axios';

@Injectable()
export class CheerioScraperService {
  async scrapeProductPrice(url: string): Promise<ScrapedProduct> {
    const { data: html } = await axios.get(url, {
      headers: { 'User-Agent': this.getRandomUserAgent() },
      timeout: 10000,
    });

    const $ = cheerio.load(html);

    return {
      title: $('h1.product-title').text().trim(),
      price: this.parsePrice($('.price-current').text()),
      description: $('meta[name="description"]').attr('content') ?? '',
      images: $('img.product-image')
        .map((_, el) => $(el).attr('src'))
        .get()
        .filter(Boolean),
      availability: $('[data-availability]').attr('data-availability') ?? 'unknown',
    };
  }

  private parsePrice(priceText: string): number {
    // Remove currency symbols, commas, spaces → parse as float
    const cleaned = priceText.replace(/[^0-9.]/g, '');
    return parseFloat(cleaned) || 0;
  }
}
```

### Playwright (JS-Rendered Content)

```bash
npm install playwright
npx playwright install chromium  # download Chromium binary
```

```typescript
// playwright-scraper.service.ts
import { chromium, Browser, Page } from 'playwright';

@Injectable()
export class PlaywrightScraperService implements OnModuleDestroy {
  private browser: Browser | null = null;

  async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage', // important in Docker
        ],
      });
    }
    return this.browser;
  }

  async scrapeSpa(url: string): Promise<ScrapedData> {
    const browser = await this.getBrowser();
    const context = await browser.newContext({
      userAgent: this.getRandomUserAgent(),
      viewport: { width: 1366, height: 768 },
      locale: 'en-US',
    });
    const page = await context.newPage();

    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

      // Wait for dynamic content
      await page.waitForSelector('[data-products-loaded]', { timeout: 10000 });

      // Extract data
      const products = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.product-card')).map(el => ({
          title: el.querySelector('.title')?.textContent?.trim(),
          price: el.querySelector('.price')?.textContent?.trim(),
          url: (el.querySelector('a') as HTMLAnchorElement)?.href,
        }));
      });

      return { products, scrapedAt: new Date() };
    } finally {
      await context.close();
    }
  }

  // Handle infinite scroll
  async scrapeInfiniteScroll(url: string): Promise<string[]> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    await page.goto(url);

    const allItems: string[] = [];
    let lastHeight = 0;

    while (true) {
      const items = await page.$$eval('.item', els => els.map(el => el.textContent));
      allItems.push(...items);

      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1500); // wait for new content to load

      const newHeight = await page.evaluate(() => document.body.scrollHeight);
      if (newHeight === lastHeight) break; // no more content
      lastHeight = newHeight;
    }

    await page.close();
    return [...new Set(allItems)]; // deduplicate
  }

  async onModuleDestroy() {
    await this.browser?.close();
  }
}
```

---

## Proxy Rotation

Websites block IPs that make too many requests. Rotate proxies to distribute load.

### Why You Need Proxies

- IP-based rate limiting blocks your scraper after N requests
- Geo-restricted content requires IPs from specific countries
- Residential proxies look like real users (harder to detect)

### Proxy Providers

| Provider | Type | Best For | Pricing |
|---|---|---|---|
| [Bright Data](https://brightdata.com) | Residential, Datacenter | Large-scale, enterprise | $$$ |
| [Oxylabs](https://oxylabs.io) | Residential, Datacenter | Enterprise | $$$ |
| [Webshare](https://webshare.io) | Datacenter | Small-medium scale | $ |
| [Smartproxy](https://smartproxy.com) | Residential | Medium scale | $$ |
| Free proxies | Datacenter | Testing only | Free (unreliable) |

### Rotating Proxy Pattern

```typescript
// proxy-rotator.service.ts
@Injectable()
export class ProxyRotatorService {
  private proxies: string[] = [];
  private currentIndex = 0;

  constructor(private configService: ConfigService) {
    // Format: http://user:pass@host:port
    this.proxies = this.configService.get<string>('PROXY_LIST').split(',');
  }

  getNextProxy(): string {
    const proxy = this.proxies[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
    return proxy;
  }

  async makeRequest(url: string): Promise<string> {
    const proxy = this.getNextProxy();
    const { data } = await axios.get(url, {
      proxy: {
        protocol: 'http',
        host: 'proxy-host',
        port: 8080,
        auth: { username: 'user', password: 'pass' },
      },
      timeout: 15000,
    });
    return data;
  }
}
```

---

## Rate Limiting

Respect target sites and avoid getting blocked.

```typescript
// rate-limited-scraper.service.ts
import pLimit from 'p-limit'; // npm install p-limit

@Injectable()
export class ScraperService {
  // Max 3 concurrent requests
  private concurrencyLimit = pLimit(3);

  async scrapeMany(urls: string[]): Promise<ScrapedData[]> {
    // Process all URLs but max 3 at a time
    return Promise.all(
      urls.map(url =>
        this.concurrencyLimit(() => this.scrapeWithDelay(url))
      )
    );
  }

  private async scrapeWithDelay(url: string): Promise<ScrapedData> {
    // Human-like random delay between requests
    await this.randomDelay(1000, 3000);
    return this.scrape(url);
  }

  private randomDelay(min: number, max: number): Promise<void> {
    const delay = Math.random() * (max - min) + min;
    return new Promise(resolve => setTimeout(resolve, delay));
  }
}
```

### Robots.txt Compliance

```typescript
import * as robotsParser from 'robots-parser'; // npm install robots-parser

async canScrape(url: string): Promise<boolean> {
  const { origin, pathname } = new URL(url);
  const robotsUrl = `${origin}/robots.txt`;

  try {
    const { data: robotsTxt } = await axios.get(robotsUrl);
    const robots = robotsParser(robotsUrl, robotsTxt);
    return robots.isAllowed(url, 'Mozilla/5.0') ?? true;
  } catch {
    return true; // no robots.txt = assume allowed
  }
}
```

---

## Anti-Detection

### User Agent Rotation

```typescript
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
];

getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}
```

### Playwright Stealth Mode

```bash
npm install playwright-extra puppeteer-extra-plugin-stealth
```

```typescript
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(StealthPlugin());

const browser = await chromium.launch({ headless: true });
```

Stealth plugin spoofs: `navigator.webdriver`, canvas fingerprint, WebGL, audio context, and other bot-detection signals.

---

## Data Normalization

```typescript
// scraped-product.normalizer.ts
export class ProductNormalizer {
  static normalize(raw: RawScrapedProduct): NormalizedProduct {
    return {
      title: this.cleanText(raw.title),
      price: this.parsePrice(raw.price),
      currency: this.detectCurrency(raw.price),
      url: this.normalizeUrl(raw.url),
      images: raw.images.map(this.normalizeImageUrl).filter(Boolean),
      scrapedAt: new Date(),
      sourceHash: this.hash(raw.url + raw.title), // for deduplication
    };
  }

  private static cleanText(text: string): string {
    return text?.trim().replace(/\s+/g, ' ') ?? '';
  }

  private static parsePrice(price: string): number {
    return parseFloat(price?.replace(/[^0-9.]/g, '') ?? '0') || 0;
  }

  private static hash(input: string): string {
    return require('crypto').createHash('md5').update(input).digest('hex');
  }
}
```

---

## Scheduled Scraping

```typescript
// scraping.cron.ts
import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class ScrapingCron {
  constructor(private readonly scrapingService: ScrapingService) {}

  // Every hour
  @Cron(CronExpression.EVERY_HOUR)
  async scrapeProductPrices() {
    const urls = await this.scrapingService.getScheduledUrls();
    await this.scrapingService.batchScrape(urls);
  }

  // At 2am daily
  @Cron('0 2 * * *')
  async fullCatalogScrape() {
    await this.scrapingService.fullScrape();
  }
}
```

Register `@nestjs/schedule` in AppModule:

```typescript
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [ScheduleModule.forRoot()],
})
export class AppModule {}
```

---

## Storing Scraped Data

```typescript
@Entity('scraped_products')
@Index(['sourceUrl', 'scrapedAt'])
export class ScrapedProduct extends BaseEntity {
  @Column()
  sourceUrl: string;

  @Column()
  title: string;

  @Column('decimal', { precision: 10, scale: 2 })
  price: number;

  @Column({ length: 3 })
  currency: string;

  @Column({ unique: true })
  sourceHash: string; // for deduplication

  @Column('text', { array: true, default: [] })
  images: string[];

  @Column('jsonb', { nullable: true })
  rawData: Record<string, unknown>; // keep raw for re-processing

  @Column()
  scrapedAt: Date;
}
```

### Deduplication Strategy

```typescript
async upsertScrapedProduct(data: NormalizedProduct): Promise<ScrapedProduct> {
  return this.productRepo.upsert(data, {
    conflictPaths: ['sourceHash'],
    // On conflict, update all fields except id and createdAt
    skipUpdateIfNoValuesChanged: true,
  });
}
```

---

## Legal and Ethical Considerations

Before scraping any website, consider:

1. **Terms of Service** — Most sites prohibit scraping in their ToS. Violation can lead to legal action (hiQ v. LinkedIn case established some public data is scrapable, but it's jurisdiction-dependent).

2. **robots.txt** — Always check and respect it. It's not legally binding but demonstrates good faith.

3. **Rate limiting** — Never overwhelm a server. Aggressive scraping is a form of DoS.

4. **Personal data** — Scraping user profiles, emails, or personal data may violate GDPR and local data protection laws.

5. **Copyright** — Scraped content is often copyrighted. Displaying it directly may infringe copyright.

6. **Authentication** — Scraping content behind a login (accepting ToS) is legally riskier.

**Rule of thumb:** Use official APIs when they exist. Scrape only public data. Respect rate limits. Don't scrape personal data.

---

## Alternatives: APIs First

Before scraping, check if an official or third-party API exists:

| Data Type | Check First |
|---|---|
| Social media | Twitter/X API, Instagram Graph API, TikTok API |
| E-commerce prices | Amazon Product API, Google Shopping API |
| News | NewsAPI, GNews, Currents API |
| Financial data | Alpha Vantage, Polygon.io, Yahoo Finance API |
| Real estate | Zillow API, Redfin API |
| Any site | [RapidAPI marketplace](https://rapidapi.com) — 40k+ APIs |

API costs are usually cheaper than proxy costs + maintenance + anti-detection work.
