import { Router } from "express";
import * as latex from "../lib/latexCompile.js";
import * as db from "../lib/supabase.js";
import * as notion from "../lib/notion.js";
import * as apps from "../lib/applications.js";
import { detectDomain } from "../lib/rubric.js";

export const approveResume = Router();

// POST /api/approve-resume
// { company, position, jdText, atsScore, atsBreakdown, structuredContent, sourceUrl?, applicationId? }
// -> { id, applicationId, resumeUrl, notionPageId, hasPdf }
//
// Approval is the moment a tailored resume becomes a *remembered application*.
// The resume version and the application row are created together and linked,
// so months later the tracker entry can always produce the exact file that was
// sent - which is the whole point of the product.
approveResume.post("/", async (req, res, next) => {
  try {
    const {
      company, position, jdText = "", atsScore = 0, atsBreakdown = null,
      structuredContent, sourceUrl = "", applicationId = null,
    } = req.body || {};

    if (!company || !position || !structuredContent) {
      return res.status(400).json({ error: "missing_fields" });
    }

    const latexSource = await latex.populateTemplate(structuredContent);
    const pdfBytes = await latex.compileToPdf(latexSource); // null if no TeX engine

    // Storage is the least important part of this request. Losing the record of
    // an application because a bucket was missing would defeat the product, so
    // a failed upload degrades to "no PDF" - the LaTeX source is still stored
    // below and stays downloadable.
    let upload = { path: "", url: "", hasPdf: false };
    let storageError = null;
    try {
      upload = await db.uploadResume(req.userId, { company, position, pdfBytes });
    } catch (e) {
      storageError = e.message;
      console.warn(`[JOZY] resume upload failed; keeping the application and LaTeX source: ${e.message}`);
    }

    const appliedAt = new Date().toISOString();

    // Reuse the application the user was already tracking, if they came from one.
    let application = applicationId ? await apps.getApplication(req.userId, applicationId) : null;
    if (!application) {
      application = await apps.createApplication(req.userId, {
        company, position, jdText, sourceUrl, appliedAt,
        domain: detectDomain(jdText || position),
        status: "applied",
        note: "Applied with a resume tailored in JOZY",
      });
    }

    const row = await db.insertResumeVersion({
      user_id: req.userId,
      application_id: application.id,
      company, position, jd_text: jdText, ats_score: atsScore,
      ats_breakdown: atsBreakdown, structured_content: structuredContent,
      pdf_storage_path: upload.path, resume_url: upload.url, latex_source: latexSource,
      status: "approved", applied_at: appliedAt,
    });

    await apps.linkResumeVersion(req.userId, application.id, row.id);

    // Notion is a convenience mirror, not the source of truth - a tracker
    // outage must never cost the user the record of an application.
    let notionPageId = null;
    try {
      ({ notionPageId } = await notion.createTrackerRow({
        company, position, atsScore, resumeUrl: upload.url, appliedAt,
      }));
      if (notionPageId) await db.updateNotionRef(row.id, notionPageId);
    } catch (e) {
      console.warn("[JOZY] Notion sync failed, application still saved: " + e.message);
    }

    res.json({
      id: row.id,
      applicationId: application.id,
      resumeUrl: upload.url,
      notionPageId,
      hasPdf: upload.hasPdf,
      // Present only when the record was saved but the file was not, so the UI
      // can say so rather than implying a clean save.
      storageError,
    });
  } catch (e) { next(e); }
});
