import { Injectable, Logger } from '@nestjs/common';

/**
 * Playwright-based scraper for JavaScript-rendered pages.
 * Install playwright separately: npm install playwright
 * Then run: npx playwright install chromium
 */
@Injectable()
export class PlaywrightService {
  private readonly logger = new Logger(PlaywrightService.name);

  async scrapeWithBrowser(url: string, options: {
    waitForSelector?: string;
    screenshot?: boolean;
    timeout?: number;
    proxy?: string;
  } = {}): Promise<{ html: string; screenshotPath?: string }> {
    let playwright: any;
    let browser: any;

    try {
      // Dynamic import — only runs when playwright is installed
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore playwright is an optional peer dep
      playwright = await import('playwright');
    } catch {
      this.logger.warn('Playwright not installed. Run: npm install playwright && npx playwright install chromium');
      throw new Error('Playwright not available. Install it to use JS-rendering scraping.');
    }

    try {
      const launchOptions: any = {
        headless: true,
        timeout: options.timeout || 30000,
      };

      if (options.proxy) {
        launchOptions.proxy = { server: options.proxy };
      }

      browser = await playwright.chromium.launch(launchOptions);
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        viewport: { width: 1280, height: 800 },
      });

      const page = await context.newPage();

      this.logger.log(`Playwright navigating to: ${url}`);
      await page.goto(url, { waitUntil: 'networkidle', timeout: options.timeout || 30000 });

      if (options.waitForSelector) {
        await page.waitForSelector(options.waitForSelector, { timeout: 10000 });
      }

      const html = await page.content();
      let screenshotPath: string | undefined;

      if (options.screenshot) {
        screenshotPath = `screenshots/${Date.now()}.png`;
        await page.screenshot({ path: screenshotPath, fullPage: true });
      }

      return { html, screenshotPath };
    } finally {
      if (browser) await browser.close();
    }
  }

  async extractFromPage(url: string, selectors: Record<string, string>): Promise<Record<string, string>> {
    const { html } = await this.scrapeWithBrowser(url);
    // Use cheerio to parse the rendered HTML
    const cheerio = await import('cheerio');
    const $ = cheerio.load(html);

    const result: Record<string, string> = {};
    for (const [key, selector] of Object.entries(selectors)) {
      result[key] = $(selector).first().text().trim();
    }
    return result;
  }
}
