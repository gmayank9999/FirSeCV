const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DATABASE_ID = process.env.NOTION_DATABASE_ID;

/**
 * Create a new row in the Notion application tracker database.
 * @param {object} params
 * @param {string} params.company
 * @param {string} params.position
 * @param {string} params.dateApplied - ISO date string e.g. "2024-07-25"
 * @param {number} params.atsScore
 * @param {string} params.resumeUrl - Public/signed Supabase URL to the PDF
 * @returns {string} The created Notion page ID
 */
async function createTrackerRow({ company, position, dateApplied, atsScore, resumeUrl }) {
  const response = await notion.pages.create({
    parent: { database_id: DATABASE_ID },
    properties: {
      // "Company" is the Title field
      Company: {
        title: [{ text: { content: company } }]
      },
      Position: {
        rich_text: [{ text: { content: position } }]
      },
      'Date Applied': {
        date: { start: dateApplied }
      },
      'ATS Score': {
        number: atsScore
      },
      'Resume Link': {
        url: resumeUrl
      },
      Status: {
        select: { name: 'Applied' }
      }
    }
  });

  return response.id;
}

module.exports = { createTrackerRow };
