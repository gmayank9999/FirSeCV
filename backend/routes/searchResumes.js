import { Router } from "express";
import { DEMO_USER } from "../config.js";
import * as db from "../lib/supabase.js";

export const searchResumes = Router();

// GET /api/search-resumes?company=X -> resume_versions[]
searchResumes.get("/", async (req, res, next) => {
  try {
    const rows = await db.searchResumeVersions(DEMO_USER, String(req.query.company || ""));
    res.json(rows);
  } catch (e) { next(e); }
});
