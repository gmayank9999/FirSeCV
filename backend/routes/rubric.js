import { Router } from "express";
import { deriveRubric, detectDomain, DOMAIN_LEXICONS } from "../lib/rubric.js";
import { jsonPrompt } from "../lib/gemini.js";

export const rubricRoutes = Router();

// GET /api/rubric/domains - the domains the scorer knows vocabulary for.
rubricRoutes.get("/domains", (_req, res) => {
  res.json(Object.keys(DOMAIN_LEXICONS).concat("general"));
});

// POST /api/rubric - { jdText, domain? } -> the weighted criteria a resume is
// scored against. Exposed on its own so both sides of the product can show the
// rubric *before* anyone is scored by it: an applicant sees what the posting
// actually asks for, a recruiter edits the weights before screening anyone.
rubricRoutes.post("/", async (req, res, next) => {
  try {
    const { jdText = "", domain = "" } = req.body || {};
    if (!jdText.trim()) return res.status(400).json({ error: "missing_jd" });
    res.json(await deriveRubric({ jdText, domain: domain || detectDomain(jdText), llm: jsonPrompt() }));
  } catch (e) { next(e); }
});
