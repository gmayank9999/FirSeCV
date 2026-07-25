// Central config + feature flags. Reads .env once and reports which integrations
// are live vs mocked so the rest of the code can branch on capability, not keys.

import "dotenv/config";

export const config = {
  port: Number(process.env.PORT) || 3000,
  gemini: {
    key: process.env.GEMINI_API_KEY || "",
    model: process.env.GEMINI_MODEL || "gemini-flash-lite-latest",
  },
  groq: {
    key: process.env.GROQ_API_KEY || "",
    model: process.env.GROQ_MODEL || "llama-3.1-8b-instant",
  },
  supabase: {
    // Accept either the base project URL or a pasted REST/storage endpoint -
    // normalize down to the base ("https://<ref>.supabase.co").
    url: (process.env.SUPABASE_URL || "")
      .trim()
      .replace(/\/+$/, "")
      .replace(/\/(rest|storage)\/v1$/, ""),
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  },
  notion: {
    token: process.env.NOTION_TOKEN || "",
    databaseId: process.env.NOTION_DATABASE_ID || "",
  },
  latex: { engine: process.env.LATEX_ENGINE || "tectonic" },
};

export const live = {
  gemini: Boolean(config.gemini.key),
  groq: Boolean(config.groq.key),
  supabase: Boolean(config.supabase.url && config.supabase.serviceKey),
  notion: Boolean(config.notion.token && config.notion.databaseId),
};

// Single demo user until Supabase Auth lands (see plan §1 - MVP allows one user).
export const DEMO_USER = "demo-user";
