import { Router } from "express";
import * as latex from "../lib/latexCompile.js";
import * as db from "../lib/supabase.js";
import * as notion from "../lib/notion.js";

export const approveResume = Router();

// POST /api/approve-resume
// { company, position, jdText, atsScore, structuredContent }
// -> { id, resumeUrl, notionPageId, hasPdf }
approveResume.post("/", async (req, res, next) => {
  try {
    const { company, position, jdText = "", atsScore = 0, atsBreakdown = null, structuredContent } = req.body || {};
    if (!company || !position || !structuredContent) {
      return res.status(400).json({ error: "missing_fields" });
    }

    const latexSource = await latex.populateTemplate(structuredContent);
    const pdfBytes = await latex.compileToPdf(latexSource); // null if no TeX engine

    const upload = await db.uploadResume(req.userId, { company, position, pdfBytes });
    const appliedAt = new Date().toISOString();
    const row = await db.insertResumeVersion({
      user_id: req.userId,
      company, position, jd_text: jdText, ats_score: atsScore,
      ats_breakdown: atsBreakdown, structured_content: structuredContent,
      pdf_storage_path: upload.path, resume_url: upload.url, latex_source: latexSource,
      status: "approved", applied_at: appliedAt,
    });

    const { notionPageId } = await notion.createTrackerRow({
      company, position, atsScore, resumeUrl: upload.url, appliedAt,
    });
    await db.updateNotionRef(row.id, notionPageId);

    res.json({ id: row.id, resumeUrl: upload.url, notionPageId, hasPdf: upload.hasPdf });
  } catch (e) { next(e); }
});
