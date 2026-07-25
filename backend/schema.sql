-- ============================================================
-- FirSeCV — Supabase Database Schema
-- Run this in your Supabase project's SQL editor
-- ============================================================

-- ── master_profiles ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS master_profiles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     text UNIQUE NOT NULL,   -- using text for MVP (not tied to Supabase Auth)
  full_name   text,
  email       text,
  phone       text,
  location    text,
  linkedin_url    text,
  github_url      text,
  portfolio_url   text,
  education       jsonb DEFAULT '[]',
  experience      jsonb DEFAULT '[]',
  projects        jsonb DEFAULT '[]',
  skills          jsonb DEFAULT '[]',
  certifications  jsonb DEFAULT '[]',
  achievements    jsonb DEFAULT '[]',
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

-- Auto-update updated_at on change
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_master_profiles_updated_at
  BEFORE UPDATE ON master_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── resume_versions ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS resume_versions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           text NOT NULL,
  company           text NOT NULL,
  position          text NOT NULL,
  jd_text           text,
  jd_url            text,
  ats_score         integer,
  pdf_storage_path  text,
  latex_source      text,
  status            text DEFAULT 'approved',
  applied_at        timestamptz DEFAULT now(),
  notion_page_id    text
);

-- Index for fast user + company queries
CREATE INDEX IF NOT EXISTS idx_resume_versions_user_id ON resume_versions(user_id);
CREATE INDEX IF NOT EXISTS idx_resume_versions_company ON resume_versions(company);

-- ── Supabase Storage ─────────────────────────────────────────
-- Run this in the Supabase dashboard: Storage → New Bucket
-- Bucket name: resumes
-- Public: NO (we use signed URLs)
