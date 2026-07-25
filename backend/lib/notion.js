// Application tracker sync. Creates a row in a Notion database on approval.
// Mocked until NOTION_TOKEN + NOTION_DATABASE_ID are set.

import { config, live } from "../config.js";

export async function createTrackerRow({ company, position, atsScore, resumeUrl, appliedAt }) {
  if (!live.notion) {
    return { notionPageId: "mock_notion_" + Date.now().toString(36) };
  }
  // Property names/types match the "Job Applications" DB: title is "Name",
  // Company/Position are rich_text, plus date / number / url / select.
  const title = [company, position].filter(Boolean).join(" - ") || "Application";
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
        Name: { title: [{ text: { content: title } }] },
        Company: { rich_text: [{ text: { content: company || "" } }] },
        Position: { rich_text: [{ text: { content: position || "" } }] },
        "Date Applied": { date: { start: appliedAt || new Date().toISOString() } },
        "ATS Score": { number: Number(atsScore) || 0 },
        "Resume Link": resumeUrl ? { url: resumeUrl } : { url: null },
        Status: { select: { name: "Applied" } },
      },
    }),
  });
  if (!res.ok) throw new Error(`Notion API ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return { notionPageId: json.id };
}
