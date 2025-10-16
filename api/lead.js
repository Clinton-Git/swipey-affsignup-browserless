// /api/lead.js
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, password, firstName, lastName, messengerType, messenger, clickid } = req.body || {};
  if (!email || !password || !firstName || !lastName) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // 1) Пишем в Google Sheets через Apps Script (опционально)
    // GAS_WEBAPP_URL — URL вашего Apps Script Web App (Deploy → Web app → Anyone)
    if (process.env.GAS_WEBAPP_URL) {
      await fetch(process.env.GAS_WEBAPP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ts: Date.now(), email, firstName, lastName, messengerType, messenger, clickid: clickid || ''
        })
      }).catch(() => { /* не мешаем пользователю */ });
    }

    // 2) Кладём job в QStash → цель: ваш воркер /api/signup-proxy
    const qstashToken = process.env.QSTASH_TOKEN;
    const targetUrl   = process.env.RUN_SIGNUP_URL; // полный URL, напр. https://<app>.vercel.app/api/signup-proxy
    if (!qstashToken || !targetUrl) {
      return res.status(500).json({ error: 'Queue is not configured' });
    }

    const r = await fetch('https://qstash.upstash.io/v1/publish', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${qstashToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url: targetUrl,
        body: { email, password, firstName, lastName, messengerType, messenger, clickid: clickid || '' },
        retries: 3,
        delay: 0
      })
    });

    if (!r.ok) {
      const t = await r.text();
      return res.status(502).json({ error: 'Queue publish failed', details: t });
    }

    // 3) Моментальный ответ фронту
    return res.status(200).json({ ok: true, queued: true });
  } catch (e) {
    console.error('lead error', e);
    return res.status(500).json({ error: 'Lead enqueue failed' });
  }
}
