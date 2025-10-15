import { chromium } from 'playwright-core';

/**
 * Environment:
 *  - BROWSERLESS_WS: e.g. wss://production-ams.browserless.io?token=YOUR_TOKEN&stealth=true
 *    See: https://docs.browserless.io/overview/connection-urls
 */
const { BROWSERLESS_WS } = process.env;

if (!BROWSERLESS_WS) {
  console.warn('Missing BROWSERLESS_WS env var. Set wss://...browserless.io?token=...');
}

/** Utils **/
async function typeSmart(page, selOrFn, value) {
  // selOrFn can be {label, placeholder, selector}
  const { label, placeholder, selector } = selOrFn;
  let locator;
  if (selector) locator = page.locator(selector);
  else if (label) locator = page.getByLabel(label, { exact: false });
  else if (placeholder) locator = page.getByPlaceholder(placeholder, { exact: false });
  else throw new Error('typeSmart: selector is required');

  await locator.waitFor({ state: 'visible', timeout: 20000 });
  await locator.fill('');
  await locator.type(String(value), { delay: 20 });
}

async function selectSmart(page, selOrFn, value) {
  const { label, selector } = selOrFn;
  let locator = selector ? page.locator(selector) : page.getByLabel(label, { exact: false });
  await locator.waitFor({ state: 'visible', timeout: 20000 });
  await locator.selectOption({ label: String(value) }).catch(async () => {
    // fallback by value/text
    await locator.selectOption(String(value)).catch(async () => {
      await locator.click();
      await page.getByRole('option', { name: new RegExp(String(value), 'i') }).first().click();
    });
  });
}

// Main handler
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { email, password, firstName, lastName, messengerType, messenger } = req.body || {};

  if (!email || !password || !firstName || !lastName) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  let browser;
  try {
    // 1) Connect to Browserless over CDP (Playwright)
    const wsEndpoint = BROWSERLESS_WS;
    if (!wsEndpoint) throw new Error('BROWSERLESS_WS is not configured');

    browser = await chromium.connectOverCDP(wsEndpoint);

    // Get (or create) default context
    const contexts = browser.contexts();
    const context = contexts.length ? contexts[0] : await browser.newContext();
    const page = await context.newPage();

    // 2) STEP 1 — open and fill email/password
    await page.goto('https://affiliate.swipey.ai/signup', { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Try multiple field strategies to be resilient to DOM changes
    await typeSmart(page, { label: 'Email', placeholder: 'email', selector: 'input[type="email"]' }, email);
    await typeSmart(page, { label: 'Password', placeholder: 'Password', selector: 'input[type="password"]' }, password);

    // Primary next button (try by text, role, or type)
    const nextBtn = page.getByRole('button', { name: /next|continue|sign up/i }).first();
    await nextBtn.waitFor({ state: 'visible', timeout: 15000 }).catch(async () => {});
    if (await nextBtn.isVisible()) {
      await nextBtn.click();
    } else {
      await page.locator('button[type="submit"], button').first().click();
    }

    // 3) STEP 2 — first/last/messenger
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000); // give SPA time to switch step

    await typeSmart(page, { label: 'First Name', placeholder: 'First' }, firstName);
    await typeSmart(page, { label: 'Last Name', placeholder: 'Last' }, lastName);

    if (messengerType) {
      await selectSmart(page, { label: /Messenger/i }, messengerType);
    }
    if (messenger) {
      await typeSmart(page, { label: /Messenger/i, placeholder: /@|phone|handle|username/i, selector: 'input[name*="messenger"], input[name*="contact"], input[type="text"]' }, messenger);
    }

    // submit
    const submitBtn = page.getByRole('button', { name: /submit|finish|complete|sign up/i }).first();
    if (await submitBtn.isVisible().catch(() => false)) {
      await submitBtn.click();
    } else {
      await page.locator('button[type="submit"], button').last().click();
    }

    await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => {});
    const html = (await page.content()) || '';

    const ok = /thank|verify|check your email|dashboard/i.test(html);
    return res.status(200).json({ ok, note: ok ? 'Submitted' : 'Submitted (verify on target)' });
  } catch (err) {
    console.error('signup-proxy error:', err);
    return res.status(500).json({ error: err.message || 'Automation failed' });
  } finally {
    try { await browser?.close(); } catch {}
  }
}
