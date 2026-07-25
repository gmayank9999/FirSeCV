import { Router } from "express";
import * as gemini from "../lib/gemini.js";

export const extractJd = Router();

// POST /api/extract-jd - { rawPageText, pageUrl } -> { company, position, jdText }
extractJd.post("/", async (req, res, next) => {
  try {
    const { rawPageText = "", pageUrl = "" } = req.body || {};
    if (!rawPageText.trim()) return res.status(400).json({ error: "empty_page_text" });
    res.json(await gemini.extractJd(rawPageText, pageUrl));
  } catch (e) { next(e); }
});
