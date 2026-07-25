const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { createTrackerRow } = require('../lib/notion');

// -----------------------------------------------------------
// POST /api/approve-resume
// Body: { user_id, company, position, jdText, atsScore, pdfBase64, latexSource }
// -----------------------------------------------------------
router.post('/', async (req, res, next) => {
  try {
    const {
      user_id,
      company,
      position,
      jdText,
      atsScore,
      pdfBase64,
      latexSource
    } = req.body;

    if (!user_id || !company || !position || !pdfBase64) {
      return res.status(400).json({ error: 'user_id, company, position, and pdfBase64 are required' });
    }

    // 1. Upload PDF to Supabase Storage
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeCompany = company.replace(/[^a-zA-Z0-9]/g, '_');
    const safePosition = position.replace(/[^a-zA-Z0-9]/g, '_');
    const storagePath = `${user_id}/${safeCompany}_${safePosition}_${timestamp}.pdf`;

    console.log(`[ApproveResume] Uploading PDF to Supabase Storage: ${storagePath}`);
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');

    const { error: uploadError } = await supabase.storage
      .from('resumes')
      .upload(storagePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: false
      });

    if (uploadError) throw uploadError;

    // 2. Get a signed URL (valid 10 years — effectively permanent for tracker purposes)
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from('resumes')
      .createSignedUrl(storagePath, 60 * 60 * 24 * 365 * 10); // 10 years in seconds

    if (signedUrlError) throw signedUrlError;
    const resumeUrl = signedUrlData.signedUrl;

    // 3. Insert into resume_versions table
    console.log('[ApproveResume] Inserting into resume_versions...');
    const { data: versionRow, error: insertError } = await supabase
      .from('resume_versions')
      .insert({
        user_id,
        company,
        position,
        jd_text: jdText || null,
        ats_score: atsScore || null,
        pdf_storage_path: storagePath,
        latex_source: latexSource || null,
        status: 'approved',
        applied_at: new Date().toISOString()
      })
      .select()
      .single();

    if (insertError) throw insertError;

    // 4. Create Notion tracker row
    let notionPageId = null;
    try {
      console.log('[ApproveResume] Creating Notion tracker row...');
      const dateApplied = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      notionPageId = await createTrackerRow({
        company,
        position,
        dateApplied,
        atsScore: atsScore || 0,
        resumeUrl
      });

      // 5. Back-fill notion_page_id into resume_versions
      await supabase
        .from('resume_versions')
        .update({ notion_page_id: notionPageId })
        .eq('id', versionRow.id);

    } catch (notionErr) {
      // Notion failure should NOT fail the whole approval — log and continue
      console.error('[ApproveResume] Notion row creation failed (non-fatal):', notionErr.message);
    }

    return res.json({
      success: true,
      resumeUrl,
      storagePath,
      notionPageId,
      versionId: versionRow.id
    });

  } catch (err) {
    next(err);
  }
});

module.exports = router;
