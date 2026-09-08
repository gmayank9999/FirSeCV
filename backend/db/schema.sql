-- JOZY Supabase schema. Run once in your Supabase project's SQL Editor
-- (Dashboard -> SQL Editor -> New query -> paste -> Run). Safe to re-run.
--
-- The backend uses the service-role key, which bypasses Row Level Security, so
-- no RLS policies are required for the demo. user_id holds the Supabase Auth
-- user id (or 'demo-user' when auth is not configured).

-- ============================================================ job-seeker side

create table if not exists master_profiles (
  user_id    text primary key,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Application memory: the core record. An application exists whether or not a
-- resume was ever generated here, which is the point - people apply from many
-- places and still need to remember what they sent, to whom, and when.
create table if not exists applications (
  id                text primary key,
  user_id           text not null,
  company           text not null,
  position          text not null,
  source_url        text,
  jd_text           text,
  domain            text,                                  -- tech / legal / finance / ...
  status            text not null default 'applied',       -- see STATUSES in lib/applications.js
  status_history    jsonb not null default '[]'::jsonb,    -- [{ status, at, note }]
  next_action       text,
  next_action_at    date,
  notes             text,
  tags              jsonb not null default '[]'::jsonb,
  resume_version_id text,                                  -- the version actually sent, if any
  contact           jsonb,                                 -- { name, email, role }
  applied_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists applications_user_idx    on applications (user_id);
create index if not exists applications_company_idx on applications (company);
create index if not exists applications_status_idx  on applications (user_id, status);
create index if not exists applications_next_idx    on applications (user_id, next_action_at);

create table if not exists resume_versions (
  id                 text primary key,
  user_id            text not null,
  application_id     text,        -- links a stored resume to the application it was sent for
  company            text not null,
  position           text not null,
  jd_text            text,
  ats_score          integer,
  ats_breakdown      jsonb,       -- matched/missing keywords + weighted criteria + notes
  structured_content jsonb,       -- the resume content, to re-render the detail view
  pdf_storage_path   text,
  resume_url         text,        -- public URL of the stored PDF
  latex_source       text,
  status             text default 'approved',
  notion_page_id     text,
  applied_at         timestamptz not null default now()
);

-- For tables created before these columns existed (idempotent):
alter table resume_versions add column if not exists ats_breakdown  jsonb;
alter table resume_versions add column if not exists structured_content jsonb;
alter table resume_versions add column if not exists resume_url     text;
alter table resume_versions add column if not exists application_id text;

create index if not exists resume_versions_user_idx    on resume_versions (user_id);
create index if not exists resume_versions_company_idx on resume_versions (company);
create index if not exists resume_versions_app_idx     on resume_versions (application_id);

-- ============================================================== recruiter side

-- An open role plus the explicit, weighted rubric used to screen against it.
-- The rubric is stored (not just computed) so a shortlist stays defensible and
-- reproducible months later - the fairness requirement from discovery.
create table if not exists requisitions (
  id          text primary key,
  user_id     text not null,
  title       text not null,
  company     text,
  jd_text     text,
  domain      text,
  rubric      jsonb not null default '{}'::jsonb,   -- { domain, criteria: [{ id, label, kind, weight, terms, mustHave }] }
  status      text not null default 'open',         -- open | closed
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists requisitions_user_idx on requisitions (user_id);

create table if not exists candidates (
  id              text primary key,
  requisition_id  text not null,
  user_id         text not null,
  name            text,
  email           text,
  source          text,                    -- where the resume came from
  resume_text     text,
  score           integer,
  breakdown       jsonb,                   -- per-criterion evidence, the "why" behind the score
  decision        text default 'pending',  -- pending | shortlist | reject
  decided_by      text,                    -- 'human' once a recruiter overrides the score
  created_at      timestamptz not null default now()
);

create index if not exists candidates_req_idx   on candidates (requisition_id);
create index if not exists candidates_user_idx  on candidates (user_id);
create index if not exists candidates_score_idx on candidates (requisition_id, score desc);
