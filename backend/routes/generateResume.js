import { Router } from "express";
import * as gemini from "../lib/gemini.js";
import * as db from "../lib/supabase.js";
import { deriveRubric, scoreAgainstRubric } from "../lib/rubric.js";

export const generateResume = Router();

// POST /api/generate-resume
// { company, position, jdText, revisionInstruction?, previousContent?, rubric? }
// -> { structuredContent, atsScore, atsBreakdown, rubric }
//
// Full-tailor mode - the high-effort half of "flexible effort". Scoring runs
// through the shared rubric engine, so the number here means the same thing as
// the number a recruiter sees on the other side of the product.
generateResume.post("/", async (req, res, next) => {
  try {
    const {
      jdText = "",
      revisionInstruction = "",
      previousContent = null,
      rubric: providedRubric = null,
    } = req.body || {};

    const profile = (await db.getProfile(req.userId)) || {};

    // Reuse the rubric across a refine loop: re-deriving it each time would let
    // the target move between iterations, so a "better" resume could score
    // lower for no reason the user can see.
    const rubric = providedRubric && providedRubric.criteria?.length
      ? providedRubric
      : await deriveRubric({ jdText, llm: gemini.jsonPrompt() });

    const structuredContent = await gemini.generateResume({
      profile, jdText, revisionInstruction, previousContent,
      // Give the writer the rubric so it emphasises what is actually scored.
      rubric,
    });

    const atsBreakdown = scoreAgainstRubric(rubric, structuredContent);
    res.json({ structuredContent, atsScore: atsBreakdown.score, atsBreakdown, rubric });
  } catch (e) { next(e); }
});
