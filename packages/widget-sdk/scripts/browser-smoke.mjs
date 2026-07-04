import { chromium } from 'playwright';

const base = process.env.BASE_URL ?? 'http://localhost:3100';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
page.on('response', async (r) => {
  if (r.url().includes('/api/v1/chat/')) {
    const body = await r.text().catch(() => '');
    errors.push(`chat ${r.status()}: ${body.slice(0, 300)}`);
  }
});

await page.goto(`${base}/customer-demo`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.AelioWidget?.getSessionId?.(), null, { timeout: 15000 });

const sessionId = await page.evaluate(() => window.AelioWidget.getSessionId());
const mount = page.locator('#customer-site-root');
await mount.locator('input').fill('hi');
await mount.locator('button[type="submit"]').click();
await page.waitForTimeout(6000);

const botText = await mount.locator('.msg.bot .bubble').last().textContent().catch(() => 'NO BOT MSG');
console.log(JSON.stringify({ sessionId, botText, errors }, null, 2));
await browser.close();