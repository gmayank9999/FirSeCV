const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const supabase = require('../lib/supabase');
const { callGemini, parseGeminiJson } = require('../lib/gemini');
const { compileLaTeX } = require('../lib/latexCompile');

// -----------------------------------------------------------
// Load LaTeX template once at startup
// -----------------------------------------------------------
const TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'template.tex');
const LATEX_TEMPLATE = fs.readFileSync(TEMPLATE_PATH, 'utf8');

// -----------------------------------------------------------
// PROMPTS
// -----------------------------------------------------------

function buildGenerationPrompt(masterProfile, jdText, revisionInstruction, previousContent) {
  const isRevision = !!revisionInstruction;

  const systemPrompt = `You are an expert resume writer and LaTeX formatter.

Your task: Generate tailored resume content for a specific job description, formatted as valid LaTeX fragments that will be inserted into a professional template.

The template defines these custom macros — use ONLY these macros, do not invent others:
- \\resumeSubheading{Role}{Dates}{Company}{Location} — for each experience entry
- \\resumeItem{bullet text} — for each bullet point
- \\resumeItemListStart ... \\resumeItemListEnd — wraps bullet lists
- \\resumeProjectHeading{\\textbf{Project Name} $|$ \\emph{Tech Stack}}{Dates} — for each project
- \\resumeSubHeadingListStart ... \\resumeSubHeadingListEnd — wraps all subheadings in a section
- \\resumeSubheading{Degree}{Dates}{Institution}{Location} — for education

Output a JSON object with exactly this structure:
{
  "experience_latex": "string — LaTeX for the Experience section body",
  "projects_latex": "string — LaTeX for the Projects section body",
  "skills_latex": "string — LaTeX for the Technical Skills section body (format: \\\\textbf{Category:} item1, item2; ... )",
  "education_latex": "string — LaTeX for the Education section body",
  "contact_line": "string — contact line HTML/LaTeX: phone $|$ email $|$ LinkedIn $|$ GitHub (use \\\\href{url}{text} for links)",
  "full_name": "string"
}

HARD RULES — violating these is a critical failure:
1. NEVER invent experience, companies, job titles, projects, dates, or metrics not present in the master profile. Only use factual information from the master profile.
2. SELECT the most JD-relevant experience entries and projects — omit less relevant ones if needed to keep the resume focused.
3. REWRITE bullets to emphasize JD-aligned skills and impact, using the master profile's facts as ground truth.
4. All LaTeX must be syntactically valid — escape special characters (%, &, _, #, $, {, }, ~, ^, \\) properly in text content.
5. Quantify impact wherever the master profile provides numbers — don't drop metrics that exist.
6. Return ONLY the JSON, no explanation, no markdown fences.`;

  let userMessage;

  if (isRevision) {
    userMessage = `REVISION REQUEST — Apply the user's requested change to the existing resume content.

Previous resume content (JSON):
${JSON.stringify(previousContent, null, 2)}

User's revision instruction: "${revisionInstruction}"

Job Description:
${jdText}

Master Profile (for factual reference):
${JSON.stringify(masterProfile, null, 2)}

Apply ONLY the requested change. Preserve everything else unchanged. Return the full updated JSON.`;
  } else {
    userMessage = `Generate a tailored resume for this job.

Master Profile:
${JSON.stringify(masterProfile, null, 2)}

Job Description:
${jdText}`;
  }

  return { systemPrompt, userMessage };
}

const ATS_SCORING_SYSTEM_PROMPT = `You are an ATS (Applicant Tracking System) expert and resume evaluator.

Given a resume's LaTeX content and a job description, score how well the resume matches the JD.

Score 0-100 based on:
- Keyword/skill overlap between resume and JD (40 points)
- Presence of quantifiable impact statements (20 points)
- Standard section structure — Experience, Education, Projects, Skills (20 points)
- Relevance of selected experience and projects to the role (20 points)

Return ONLY this JSON (no markdown fences):
{
  "score": number,
  "matched_keywords": ["string"],
  "missing_keywords": ["string"],
  "notes": ["string — specific actionable feedback"]
}`;

// -----------------------------------------------------------
// Helper: populate LaTeX template with structured content
// -----------------------------------------------------------
function populateTemplate(structured) {
  return LATEX_TEMPLATE
    .replace('{{FULL_NAME}}', structured.full_name || '')
    .replace('{{CONTACT_LINE}}', structured.contact_line || '')
    .replace('{{EDUCATION_BLOCK}}', structured.education_latex || '')
    .replace('{{EXPERIENCE_BLOCK}}', structured.experience_latex || '')
    .replace('{{PROJECTS_BLOCK}}', structured.projects_latex || '')
    .replace('{{SKILLS_BLOCK}}', structured.skills_latex || '');
}

// -----------------------------------------------------------
// POST /api/generate-resume
// -----------------------------------------------------------
router.post('/', async (req, res, next) => {
  try {
    const {
      user_id,
      masterProfileId,
      company,
      position,
      jdText,
      revisionInstruction,
      previousContent
    } = req.body;

    if (!user_id && !masterProfileId) {
      return res.status(400).json({ error: 'user_id or masterProfileId required' });
    }
    if (!jdText) {
      return res.status(400).json({ error: 'jdText is required' });
    }

    // 1. Fetch master profile
    console.log('[GenerateResume] Fetching master profile...');
    const query = masterProfileId
      ? supabase.from('master_profiles').select('*').eq('id', masterProfileId).single()
      : supabase.from('master_profiles').select('*').eq('user_id', user_id).single();

    const { data: masterProfile, error: profileError } = await query;
    if (profileError) throw new Error('Master profile not found. Complete onboarding first.');

    // 2. Generate or revise structured resume content
    console.log(revisionInstruction
      ? '[GenerateResume] Applying revision...'
      : '[GenerateResume] Generating resume content...');

    const { systemPrompt, userMessage } = buildGenerationPrompt(
      masterProfile, jdText, revisionInstruction, previousContent
    );
    const rawContent = await callGemini(systemPrompt, userMessage);
    const structuredContent = parseGeminiJson(rawContent);

    // 3. ATS Scoring (parallel or sequential — sequential to avoid double rate-limit hit)
    console.log('[GenerateResume] Running ATS scoring...');
    const atsUserMsg = `Resume content:\n${JSON.stringify(structuredContent, null, 2)}\n\nJob Description:\n${jdText}`;
    const rawAts = await callGemini(ATS_SCORING_SYSTEM_PROMPT, atsUserMsg);
    const atsResult = parseGeminiJson(rawAts);

    // 4. Compile LaTeX → PDF
    console.log('[GenerateResume] Compiling LaTeX...');
    const latexSource = populateTemplate(structuredContent);
    const pdfBuffer = await compileLaTeX(latexSource);

    // 5. Return PDF as base64 + metadata
    const pdfBase64 = pdfBuffer.toString('base64');

    return res.json({
      success: true,
      structuredContent,
      latexSource,
      pdfBase64,
      atsScore: atsResult.score,
      atsBreakdown: {
        matched_keywords: atsResult.matched_keywords,
        missing_keywords: atsResult.missing_keywords,
        notes: atsResult.notes
      }
    });

  } catch (err) {
    next(err);
  }
});

module.exports = router;
