import { Router } from "express";
import { DEMO_USER } from "../config.js";
import * as gemini from "../lib/gemini.js";
import * as db from "../lib/supabase.js";

export const masterProfile = Router();

// GET /api/master-profile — current profile or 404 (triggers onboarding).
masterProfile.get("/", async (_req, res, next) => {
  try {
    const profile = await db.getProfile(DEMO_USER);
    if (!profile) return res.status(404).json({ error: "no_profile" });
    res.json(profile);
  } catch (e) { next(e); }
});

// POST /api/master-profile — { resumeText } to parse, or a full profile object.
masterProfile.post("/", async (req, res, next) => {
  try {
    const body = req.body || {};
    const profile = body.resumeText ? await gemini.parseResume(body.resumeText) : body;
    const saved = await db.saveProfile(DEMO_USER, profile);
    res.json(saved);
  } catch (e) { next(e); }
});

// PATCH /api/master-profile — merge partial fields.
masterProfile.patch("/", async (req, res, next) => {
  try {
    const saved = await db.saveProfile(DEMO_USER, req.body || {});
    res.json(saved);
  } catch (e) { next(e); }
});
