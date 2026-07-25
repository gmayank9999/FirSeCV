const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { callGemini, parseGeminiJson } = require('../lib/gemini');

// -----------------------------------------------------------
// Prompts
// -----------------------------------------------------------

const PARSE_RESUME_SYSTEM_PROMPT = `You are a resume parser. The user will provide raw resume text. 
Extract and return a JSON object with exactly this structure (no extra fields):
{
  "full_name": "string",
  "email": "string",
  "phone": "string",
  "location": "string (city, state/country)",
  "linkedin_url": "string or null",
  "github_url": "string or null",
  "portfolio_url": "string or null",
  "education": [
    {
      "institution": "string",
      "degree": "string (e.g. Bachelor of Science)",
      "field": "string (e.g. Computer Science)",
      "start_date": "string (e.g. Aug 2020)",
      "end_date": "string (e.g. May 2024 or Present)",
      "gpa": "string or null"
    }
  ],
  "experience": [
    {
      "company": "string",
      "role": "string",
      "start_date": "string",
      "end_date": "string",
      "bullets": ["string", "string"]
    }
  ],
  "projects": [
    {
      "name": "string",
      "description": "string (one sentence summary)",
      "tech_stack": ["string"],
      "bullets": ["string"],
      "link": "string or null"
    }
  ],
  "skills": [
    {
      "category": "string (e.g. Languages, Frameworks, Tools)",
      "items": ["string"]
    }
  ],
  "certifications": [
    {
      "name": "string",
      "issuer": "string",
      "date": "string"
    }
  ],
  "achievements": ["string"]
}

Rules:
- Return ONLY the JSON, no explanation, no markdown fences.
- If a field is missing from the resume, use null or an empty array as appropriate.
- Preserve all factual information exactly as stated — do not embellish or add anything.`;

// -----------------------------------------------------------
// GET /api/master-profile
// Returns the current master profile or 404 if not set up
// -----------------------------------------------------------
router.get('/', async (req, res, next) => {
  try {
    // For MVP: use a single demo user ID stored in extension local storage
    // The user_id is passed as a query param or header
    const userId = req.query.user_id || req.headers['x-user-id'];
    if (!userId) {
      return res.status(400).json({ error: 'user_id required' });
    }

    const { data, error } = await supabase
      .from('master_profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error && error.code === 'PGRST116') {
      // No row found
      return res.status(404).json({ error: 'No master profile found. Please complete onboarding.' });
    }
    if (error) throw error;

    return res.json(data);
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------------------------
// POST /api/master-profile
// Create or update master profile from raw resume text or structured JSON
// -----------------------------------------------------------
router.post('/', async (req, res, next) => {
  try {
    const { resumeText, structuredData, user_id } = req.body;

    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    let profileData;

    if (resumeText) {
      // LLM parsing path
      console.log('[MasterProfile] Parsing resume text with Gemini...');
      const raw = await callGemini(PARSE_RESUME_SYSTEM_PROMPT, resumeText);
      profileData = parseGeminiJson(raw);
    } else if (structuredData) {
      profileData = structuredData;
    } else {
      return res.status(400).json({ error: 'Provide either resumeText or structuredData' });
    }

    // Upsert: update if exists, insert if not
    const upsertPayload = {
      user_id,
      ...profileData,
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('master_profiles')
      .upsert(upsertPayload, { onConflict: 'user_id' })
      .select()
      .single();

    if (error) throw error;

    return res.status(201).json({ success: true, profile: data });
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------------------------
// PATCH /api/master-profile
// Partial update of the master profile
// -----------------------------------------------------------
router.patch('/', async (req, res, next) => {
  try {
    const { user_id, ...fields } = req.body;

    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    const { data, error } = await supabase
      .from('master_profiles')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('user_id', user_id)
      .select()
      .single();

    if (error) throw error;
    return res.json({ success: true, profile: data });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
