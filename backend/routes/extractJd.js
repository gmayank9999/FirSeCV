const express = require('express');
const router = express.Router();
const { callGemini, parseGeminiJson } = require('../lib/gemini');

// -----------------------------------------------------------
// Prompt
// -----------------------------------------------------------

const JD_EXTRACTION_SYSTEM_PROMPT = `You are a job description extractor. The user will paste raw text scraped from a careers page — it will contain navigation bars, footers, cookie banners, and other noise mixed in with the actual job posting.

Your task: extract ONLY the job description and return a JSON object with exactly this structure:
{
  "company": "string (company name, infer from context if not explicitly stated)",
  "position": "string (exact job title as posted)",
  "jd_text": "string (the full cleaned job description — requirements, responsibilities, qualifications, benefits if present — with nav/footer/cookie/boilerplate stripped)"
}

Rules:
- Return ONLY the JSON, no explanation, no markdown fences.
- If company name cannot be determined from the page text, use "Unknown Company".
- Preserve the structure of the job description (responsibilities, requirements, etc.) but strip all unrelated page content.
- Keep the jd_text concise but complete — include all requirements and responsibilities.`;

// -----------------------------------------------------------
// POST /api/extract-jd
// Body: { rawPageText: string, pageUrl: string }
// -----------------------------------------------------------
router.post('/', async (req, res, next) => {
  try {
    const { rawPageText, pageUrl } = req.body;

    if (!rawPageText || rawPageText.trim().length < 50) {
      return res.status(400).json({ error: 'rawPageText is required and must not be empty' });
    }

    console.log(`[ExtractJD] Extracting JD from page: ${pageUrl || 'unknown'}`);

    const userMessage = `Page URL: ${pageUrl || 'not provided'}\n\nRaw page text:\n${rawPageText}`;
    const raw = await callGemini(JD_EXTRACTION_SYSTEM_PROMPT, userMessage);
    const extracted = parseGeminiJson(raw);

    return res.json({
      success: true,
      company: extracted.company,
      position: extracted.position,
      jd_text: extracted.jd_text
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
