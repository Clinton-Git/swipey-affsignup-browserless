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
  // общий хелпер (на будущее); для React-Select ниже используем отдельную логику
  const { label, selector } = selOrFn;
  let locator = selector ? page.locator(selector) : page.getByLabel(label, { exact: false });
  await locator.waitFor({ state: 'visible', timeout: 20000 });
  await locator.selectOption({ label: String(value) }).catch(async () => {
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

    // точные селекторы по твоей разметке
    await typeSmart(page, {
      label: 'Email',
      placeholder: 'your@email.com',
      selector: 'input[name="email"][type="text"]'
    }, email);

    await typeSmart(page, {
      label: 'Password',
      placeholder: 'Password',
      selector: 'input[name="password"][type="password"]'
    }, password);

    // Step 1 — submit "Sign Up" (точный селектор + ожидание снятия disabled)
    const submit1 = page.locator(
      'button[type="submit"].btn.btn-primary.account__btn.account__btn--small',
      { hasText: 'Sign Up' }
    );
    await submit1.waitFor({ state: 'visible', timeout: 15000 });
    const el1 = await submit1.elementHandle();
    await page.waitForFunction((el) => !!el && !el.disabled, el1, { timeout: 15000 });
    await submit1.click();

    // ждём появление полей 2-го шага
    await page.waitForSelector('input[name="firstname"]', { timeout: 20000 });

    // 3) STEP 2 — first/last/messenger
    await typeSmart(page, {
      selector: 'input[name="firstname"]',
      placeholder: 'First name',
      label: 'First Name'
    }, firstName);

    await typeSmart(page, {
      selector: 'input[name="lastname"]',
      placeholder: 'Last name',
      label: 'Last name'
    }, lastName);

    // Messenger type — React-Select (robust for various classnames)
if (messengerType) {
  // 1) Открываем контрол (и старые, и новые классы react-select)
  const control = page.locator(
    '.react-select__input__control, .react-select__control'
  );
  await control.first().waitFor({ state: 'visible', timeout: 15000 });
  await control.first().click();

  // 2) Берём именно ВНУТРЕННИЙ input (а не div-обёртку)
  const rsInput = page.locator(
    '.react-select__input input, input[id^="react-select-"][id$="-input"]'
  );
  await rsInput.waitFor({ state: 'visible', timeout: 10000 });

  // 3) Печатаем значение и подтверждаем выбор
  await rsInput.fill('');
  await rsInput.type(String(messengerType), { delay: 20 });

  // дождёмся появления опции (если есть ролевая разметка), затем Enter
  await page
    .getByRole('option', { name: new RegExp(String(messengerType), 'i') })
    .first()
    .waitFor({ timeout: 5000 })
    .catch(() => {});
  await page.keyboard.press('Enter');

  // 4) Проверяем, что hidden-поле заполнилось
  await page.waitForFunction(() => {
    const el = document.querySelector('input[name="messenger_type"]');
    return !!el && !!el.value;
  }, null, { timeout: 10000 });
}

    // Messenger handle/value
    if (messenger) {
      await typeSmart(page, {
        selector: 'input[name="messenger"]',
        placeholder: 'Skype/Telegram/Etc.',
        label: 'Messenger'
      }, messenger);
    }

    // submit step 2 — "Complete Sign Up"
    const submit2 = page.locator(
      'button[type="submit"].btn.btn-primary.account__btn.account__btn--small',
      { hasText: 'Complete Sign Up' }
    );
    await submit2.waitFor({ state: 'visible', timeout: 15000 });

    // на всякий случай ждём, если кнопка тоже может быть disabled
    const el2 = await submit2.elementHandle();
    await page.waitForFunction((el) => !!el && !el.disabled, el2, { timeout: 15000 }).catch(() => {});

    await submit2.click();

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
