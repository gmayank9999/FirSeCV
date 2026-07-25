// Application tracker sync. Creates a row in a Notion database on approval.
// Mocked until NOTION_TOKEN + NOTION_DATABASE_ID are set.

import { config, live } from "../config.js";

export async function createTrackerRow({ company, position, atsScore, resumeUrl, appliedAt }) {
  if (!live.notion) {
    return { notionPageId: "mock_notion_" + Date.now().toString(36) };
  }
  // Real Notion call. Property names must match the tracker DB (plan §2.4);
  // note select/date/url each need their typed shape, not a bare string.
  const res = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.notion.token}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      parent: { database_id: config.notion.databaseId },
      properties: {
        Company: { title: [{ text: { content: company || "—" } }] },
        Position: { rich_text: [{ text: { content: position || "" } }] },
        "Date Applied": { date: { start: appliedAt || new Date().toISOString() } },
        "ATS Score": { number: Number(atsScore) || 0 },
        "Resume Link": { url: resumeUrl || null },
        Status: { select: { name: "Applied" } },
      },
    }),
  });
  if (!res.ok) throw new Error(`Notion API ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return { notionPageId: json.id };
}
