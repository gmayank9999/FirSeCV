const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');

// -----------------------------------------------------------
// GET /api/search-resumes?company=X&user_id=Y
// Returns past applications filtered by company (partial match)
// -----------------------------------------------------------
router.get('/', async (req, res, next) => {
  try {
    const { user_id, company } = req.query;

    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    let query = supabase
      .from('resume_versions')
      .select('id, company, position, ats_score, applied_at, pdf_storage_path, notion_page_id, status')
      .eq('user_id', user_id)
      .order('applied_at', { ascending: false });

    if (company && company.trim()) {
      query = query.ilike('company', `%${company.trim()}%`);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Generate signed URLs for each PDF
    const results = await Promise.all(
      (data || []).map(async (row) => {
        let pdfUrl = null;
        if (row.pdf_storage_path) {
          try {
            const { data: urlData } = await supabase.storage
              .from('resumes')
              .createSignedUrl(row.pdf_storage_path, 60 * 60); // 1-hour signed URL for preview
            pdfUrl = urlData?.signedUrl || null;
          } catch (_) {}
        }
        return { ...row, pdfUrl };
      })
    );

    return res.json({ success: true, results });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
