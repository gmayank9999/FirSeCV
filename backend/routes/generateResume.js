import { Router } from "express";
import * as gemini from "../lib/gemini.js";
import * as db from "../lib/supabase.js";

export const generateResume = Router();

// POST /api/generate-resume
// { company, position, jdText, revisionInstruction?, previousContent? }
// -> { structuredContent, atsScore, atsBreakdown }
generateResume.post("/", async (req, res, next) => {
  try {
    const { jdText = "", revisionInstruction = "", previousContent = null } = req.body || {};
    const profile = (await db.getProfile(req.userId)) || {};
    const structuredContent = await gemini.generateResume({ profile, jdText, revisionInstruction, previousContent });
    const { score, atsBreakdown } = gemini.scoreResume(structuredContent, jdText);
    const atsScore = Math.min(99, revisionInstruction ? score + 2 : score);
    res.json({ structuredContent, atsScore, atsBreakdown });
  } catch (e) { next(e); }
});
