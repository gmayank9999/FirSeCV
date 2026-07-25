import { Router } from "express";
import * as gemini from "../lib/gemini.js";

export const interviewPrep = Router();

// POST /api/interview-prep
// { company, position, jdText, structuredContent }
// -> { technicalQuestions[], behavioralQuestions[], questionsToAsk[], focusAreas[] }
interviewPrep.post("/", async (req, res, next) => {
  try {
    const { company = "", position = "", jdText = "", structuredContent = null } = req.body || {};
    res.json(await gemini.interviewPrep({ company, position, jdText, structuredContent }));
  } catch (e) { next(e); }
});
