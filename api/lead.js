// /api/lead.js
import { Client } from "@upstash/qstash";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { email, password, firstName, lastName, messengerType, messenger, clickid } = req.body || {};
  if (!email || !password || !firstName || !lastName) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    // 1) (опционально) лог в Google Sheets через Apps Script
    if (process.env.GAS_WEBAPP_URL) {
      fetch(process.env.GAS_WEBAPP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ts: Date.now(), email, firstName, lastName, messengerType, messenger, clickid: clickid || ""
        })
      }).catch(() => {});
    }

    const RUN_SIGNUP_URL = process.env.RUN_SIGNUP_URL; // ПОЛНЫЙ https URL на /api/signup-proxy
    if (!RUN_SIGNUP_URL) {
      return res.status(500).json({ error: "RUN_SIGNUP_URL is missing" });
    }

    const QSTASH_TOKEN = process.env.QSTASH_TOKEN; // твой JWT (eyJ…)
    const QSTASH_URL   = process.env.QSTASH_URL || "https://qstash.upstash.io";

    if (!QSTASH_TOKEN) {
      return res.status(500).json({ error: "QSTASH_TOKEN is missing" });
    }

    // 2) Публикуем джобу через SDK (надёжнее, чем ручной fetch)
    const qstash = new Client({ token: QSTASH_TOKEN, url: QSTASH_URL });

    const publishResp = await qstash.publishJSON({
      url: RUN_SIGNUP_URL,
      body: { email, password, firstName, lastName, messengerType, messenger, clickid: clickid || "" },
      retries: 3,
      // delay: 0, // можно добавить задержку при необходимости
    });

    // publishJSON возвращает объект с messageId/… если ок
    if (!publishResp?.messageId) {
      console.error("QStash publish unexpected response:", publishResp);
      return res.status(502).json({ error: "Queue publish failed", details: publishResp || null });
    }

    return res.status(200).json({ ok: true, queued: true, messageId: publishResp.messageId });
  } catch (err) {
    // покажем максимум деталей в логах
    console.error("QStash publish error:", err?.status, err?.message || err);
    return res.status(502).json({ error: "Queue publish failed", details: err?.message || String(err) });
  }
}
