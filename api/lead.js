import { Client } from "@upstash/qstash";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    email,
    password,
    firstName,
    lastName,
    messengerType,
    messenger,
    clickid,
  } = req.body || {};

  if (!email || !password || !firstName || !lastName) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const RUN_SIGNUP_URL = process.env.RUN_SIGNUP_URL;
  const QSTASH_TOKEN = process.env.QSTASH_TOKEN;
  const QSTASH_URL =
    process.env.QSTASH_URL || "https://qstash.upstash.io";
  const GAS_WEBAPP_URL = process.env.GAS_WEBAPP_URL || "";

  // ---- логирование в Google Sheets ----
  if (GAS_WEBAPP_URL) {
    const logBody = {
      ts: Date.now(),
      stage: "lead", // форма пришла
      email,
      firstName,
      lastName,
      messengerType,
      messenger,
      clickid: clickid || "",
      ua: req.headers["user-agent"] || "",
      ip:
        req.headers["x-forwarded-for"] ||
        req.socket?.remoteAddress ||
        "",
    };

    fetch(GAS_WEBAPP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(logBody),
    }).catch(() => {});
  }
  // -------------------------------------

  if (!RUN_SIGNUP_URL || !QSTASH_TOKEN) {
    return res.status(500).json({
      error: "Missing required environment variables",
      missing: {
        RUN_SIGNUP_URL: !RUN_SIGNUP_URL,
        QSTASH_TOKEN: !QSTASH_TOKEN,
      },
    });
  }

  try {
    const client = new Client({
      token: QSTASH_TOKEN,
      url: QSTASH_URL,
    });

    const response = await client.publishJSON({
      url: RUN_SIGNUP_URL,
      body: {
        email,
        password,
        firstName,
        lastName,
        messengerType,
        messenger,
        clickid,
      },
      timeout: 180, // до 3 минут
      retries: 1, // без повторов
    });

    if (!response?.messageId) {
      console.error("[lead] QStash publish failed:", response);
      return res.status(500).json({
        error: "Queue publish failed",
        details: response || null,
      });
    }

    return res.status(200).json({
      ok: true,
      queued: true,
      messageId: response.messageId,
    });
  } catch (error) {
    console.error("[lead] QStash error:", error);
    return res.status(500).json({
      error: "Queue publish failed",
      details: error?.message || String(error),
    });
  }
}
