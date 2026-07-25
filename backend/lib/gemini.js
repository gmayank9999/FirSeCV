const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

/**
 * Call Gemini with a system prompt and user message.
 * Includes simple retry with exponential backoff for rate-limit (429) errors.
 */
async function callGemini(systemPrompt, userMessage, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const fullPrompt = `${systemPrompt}\n\n---\n\n${userMessage}`;
      const result = await model.generateContent(fullPrompt);
      const text = result.response.text();
      return text;
    } catch (err) {
      const isRateLimit = err.status === 429 || (err.message && err.message.includes('429'));
      if (isRateLimit && attempt < retries - 1) {
        const delay = Math.pow(2, attempt + 1) * 1000; // 2s, 4s
        console.warn(`[Gemini] Rate limited. Retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
}

/**
 * Parse JSON from Gemini response — Gemini sometimes wraps JSON in markdown fences.
 */
function parseGeminiJson(text) {
  // Strip markdown code fences if present
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  return JSON.parse(cleaned);
}

module.exports = { callGemini, parseGeminiJson };
