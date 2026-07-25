-- FirSeCV Supabase schema. Run once in your Supabase project's SQL Editor
-- (Dashboard → SQL Editor → New query → paste → Run). Safe to re-run.
--
-- The backend uses the service-role key, which bypasses Row Level Security, so
-- no RLS policies are required for the demo. user_id is a plain text column
-- (single demo user) until Supabase Auth is added.

create table if not exists master_profiles (
  user_id    text primary key,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists resume_versions (
  id                text primary key,
  user_id           text not null,
  company           text not null,
  position          text not null,
  jd_text           text,
  ats_score         integer,
  ats_breakdown     jsonb,       -- matched/missing keywords + notes shown at approval
  structured_content jsonb,      -- the résumé content, to re-render the detail view
  pdf_storage_path  text,
  resume_url        text,        -- public URL of the stored PDF
  latex_source      text,
  status            text default 'approved',
  notion_page_id    text,
  applied_at        timestamptz not null default now()
);

-- For tables created before these columns existed (idempotent):
alter table resume_versions add column if not exists ats_breakdown jsonb;
alter table resume_versions add column if not exists structured_content jsonb;
alter table resume_versions add column if not exists resume_url text;

create index if not exists resume_versions_user_idx on resume_versions (user_id);
create index if not exists resume_versions_company_idx on resume_versions (company);
