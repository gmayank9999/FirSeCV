-- JOZY Supabase schema. Run in your project's SQL Editor
-- (Dashboard -> SQL Editor -> New query -> paste -> Run).
--
-- This script is SELF-HEALING and safe to run as many times as you like:
--   * missing tables are created
--   * missing columns are added to tables that already exist
--   * a table left over from an earlier version of this app is repaired in
--     place (widened id types, relaxed obsolete NOT NULLs, backfilled data)
--
-- Why the belt and braces: "create table if not exists" does NOTHING when a
-- table of that name already exists with a different shape. Relying on it alone
-- meant an older `applications` table survived untouched and every query failed
-- with "column applications.applied_at does not exist". Every column below is
-- therefore also asserted individually.
--
-- The backend authenticates with the service-role key, which bypasses Row Level
-- Security, so RLS does not affect how the app behaves. Section 6 still applies
-- an owner-only policy to every table as a second line of defence, in case
-- anything ever reaches them with an anon or end-user key.
--
-- user_id is text so it can hold either a Supabase Auth uuid or the literal
-- 'demo-user' used when auth is not configured.

-- ============================================================================
-- 1. TABLES (fresh installs)
-- ============================================================================

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
  domain            text,
  status            text not null default 'applied',
  status_history    jsonb not null default '[]'::jsonb,
  next_action       text,
  next_action_at    date,
  notes             text,
  tags              jsonb not null default '[]'::jsonb,
  resume_version_id text,
  contact           jsonb,
  applied_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists resume_versions (
  id                 text primary key,
  user_id            text not null,
  application_id     text,
  company            text not null,
  position           text not null,
  jd_text            text,
  ats_score          integer,
  ats_breakdown      jsonb,
  structured_content jsonb,
  pdf_storage_path   text,
  resume_url         text,
  latex_source       text,
  status             text default 'approved',
  notion_page_id     text,
  applied_at         timestamptz not null default now()
);

-- An open role plus the explicit, weighted rubric used to screen against it.
-- The rubric is stored (not just computed) so a shortlist stays defensible and
-- reproducible months later.
create table if not exists requisitions (
  id         text primary key,
  user_id    text not null,
  title      text not null,
  company    text,
  jd_text    text,
  domain     text,
  rubric     jsonb not null default '{}'::jsonb,
  status     text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists candidates (
  id             text primary key,
  requisition_id text not null,
  user_id        text not null,
  name           text,
  email          text,
  source         text,
  resume_text    text,
  score          integer,
  breakdown      jsonb,
  decision       text default 'pending',
  decided_by     text,
  created_at     timestamptz not null default now()
);

-- ============================================================================
-- 2. REPAIR AN `applications` TABLE FROM AN EARLIER VERSION OF THIS APP
--    Each step is guarded, so this whole section is a no-op on a fresh install.
-- ============================================================================

-- 2a. Postgres refuses to retype a column that an RLS policy depends on
--     ("cannot alter type of a column used in a policy definition"). The
--     policies are backed up to a real table first so nothing is lost, then
--     dropped; section 6 re-establishes equivalent owner-only access written
--     for the new text type. Nothing here runs unless a retype is actually due.
create table if not exists jozy_migration_policy_backup (
  captured_at timestamptz not null default now(),
  tablename   text,
  policyname  text,
  permissive  text,
  roles       text,
  cmd         text,
  qual        text,
  with_check  text
);

do $$
declare
  p record;
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'applications'
               and column_name in ('id', 'user_id') and data_type = 'uuid') then

    insert into jozy_migration_policy_backup (tablename, policyname, permissive, roles, cmd, qual, with_check)
    select tablename, policyname, permissive, roles::text, cmd, qual, with_check
      from pg_policies
     where schemaname = 'public' and tablename = 'applications';

    for p in select policyname from pg_policies
              where schemaname = 'public' and tablename = 'applications' loop
      execute format('drop policy %I on public.applications', p.policyname);
    end loop;
  end if;
end $$;

-- 2b. Drop foreign keys that pin the column types in place.
--     The old schema had applications.user_id -> auth.users(id), which cannot
--     survive the move to text: JOZY stores the literal 'demo-user' there when
--     auth is not configured, and no such row exists in auth.users. Ownership
--     is enforced by the RLS policy in section 6 instead, which compares
--     auth.uid()::text to user_id and does not constrain the demo value.
create table if not exists jozy_migration_dropped_constraints (
  dropped_at  timestamptz not null default now(),
  tablename   text,
  constraint_name text,
  definition  text
);

do $$
declare
  c record;
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'applications'
               and column_name in ('id', 'user_id') and data_type = 'uuid') then

    -- Foreign keys declared on applications, and any pointing at it.
    for c in
      select conrelid::regclass::text as tbl, conname, pg_get_constraintdef(oid) as def
        from pg_constraint
       where contype = 'f'
         and (conrelid = 'public.applications'::regclass
              or confrelid = 'public.applications'::regclass)
    loop
      insert into jozy_migration_dropped_constraints (tablename, constraint_name, definition)
      values (c.tbl, c.conname, c.def);
      execute format('alter table %s drop constraint %I', c.tbl, c.conname);
    end loop;
  end if;
end $$;

-- 2c. Widen id / user_id from uuid to text.
--     JOZY mints readable ids like 'app_m1x7q2ab'; a uuid column rejects them,
--     and user_id must also hold 'demo-user' when auth is not configured.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'applications'
               and column_name = 'id' and data_type = 'uuid') then
    alter table public.applications alter column id drop default;
    alter table public.applications alter column id type text using id::text;
  end if;

  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'applications'
               and column_name = 'user_id' and data_type = 'uuid') then
    alter table public.applications alter column user_id type text using user_id::text;
  end if;
end $$;

-- 2d. Release obsolete NOT NULL constraints. These columns belong to the old
--     schema and JOZY never writes them, so leaving them required would make
--     every new insert fail.
do $$
declare
  col text;
begin
  foreach col in array array['role', 'jd_text', 'idem_key', 'latex_output', 'pdf_url', 'tex_url'] loop
    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'applications'
                 and column_name = col and is_nullable = 'NO') then
      execute format('alter table public.applications alter column %I drop not null', col);
    end if;
  end loop;
end $$;

-- ============================================================================
-- 3. ASSERT EVERY COLUMN (repairs drift on any pre-existing table)
-- ============================================================================

alter table master_profiles add column if not exists data       jsonb not null default '{}'::jsonb;
alter table master_profiles add column if not exists updated_at timestamptz not null default now();

alter table applications add column if not exists position          text;
alter table applications add column if not exists source_url        text;
alter table applications add column if not exists jd_text           text;
alter table applications add column if not exists domain            text;
alter table applications add column if not exists status            text;
alter table applications add column if not exists status_history    jsonb not null default '[]'::jsonb;
alter table applications add column if not exists next_action       text;
alter table applications add column if not exists next_action_at    date;
alter table applications add column if not exists notes             text;
alter table applications add column if not exists tags              jsonb not null default '[]'::jsonb;
alter table applications add column if not exists resume_version_id text;
alter table applications add column if not exists contact           jsonb;
alter table applications add column if not exists applied_at        timestamptz;
alter table applications add column if not exists updated_at        timestamptz;

alter table resume_versions add column if not exists application_id     text;
alter table resume_versions add column if not exists ats_score          integer;
alter table resume_versions add column if not exists ats_breakdown      jsonb;
alter table resume_versions add column if not exists structured_content jsonb;
alter table resume_versions add column if not exists pdf_storage_path   text;
alter table resume_versions add column if not exists resume_url         text;
alter table resume_versions add column if not exists latex_source       text;
alter table resume_versions add column if not exists status             text default 'approved';
alter table resume_versions add column if not exists notion_page_id     text;
alter table resume_versions add column if not exists applied_at         timestamptz not null default now();

alter table requisitions add column if not exists company    text;
alter table requisitions add column if not exists jd_text    text;
alter table requisitions add column if not exists domain     text;
alter table requisitions add column if not exists rubric     jsonb not null default '{}'::jsonb;
alter table requisitions add column if not exists status     text not null default 'open';
alter table requisitions add column if not exists created_at timestamptz not null default now();
alter table requisitions add column if not exists updated_at timestamptz not null default now();

alter table candidates add column if not exists name        text;
alter table candidates add column if not exists email       text;
alter table candidates add column if not exists source      text;
alter table candidates add column if not exists resume_text text;
alter table candidates add column if not exists score       integer;
alter table candidates add column if not exists breakdown   jsonb;
alter table candidates add column if not exists decision    text default 'pending';
alter table candidates add column if not exists decided_by  text;
alter table candidates add column if not exists created_at  timestamptz not null default now();

-- ============================================================================
-- 4. BACKFILL (idempotent - each statement only touches rows still missing data)
-- ============================================================================

-- Carry data over from the old column names. Both are guarded on the column
-- existing, because `role` and `created_at` are absent on a fresh install and
-- referencing them unguarded would fail the whole script with 42703 - the very
-- error this migration exists to stop.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'applications' and column_name = 'role') then
    execute 'update public.applications set position = role where position is null and role is not null';
  end if;

  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'applications' and column_name = 'created_at') then
    execute 'update public.applications set applied_at = created_at where applied_at is null and created_at is not null';
  end if;
end $$;

update applications set position   = coalesce(position, 'Unknown role')     where position is null;
update applications set company    = coalesce(company, 'Unknown company')   where company is null;
update applications set applied_at = coalesce(applied_at, now())            where applied_at is null;
update applications set updated_at = coalesce(updated_at, applied_at, now()) where updated_at is null;
update applications set domain     = 'general' where domain is null;

-- Map old status vocabulary onto JOZY's pipeline. A "drafted" application was
-- never confirmed as sent, so it lands in "saved" rather than "applied".
update applications set status = 'saved'   where status = 'drafted';
update applications set status = 'applied' where status is null
   or status not in ('saved','applied','screening','interview','offer','rejected','withdrawn');

-- Seed a timeline for rows that predate it, so the detail view has something
-- to show and future status changes append to a real history.
update applications
   set status_history = jsonb_build_array(
         jsonb_build_object('status', status, 'at', applied_at, 'note', 'Migrated from the earlier schema'))
 where status_history is null or status_history = '[]'::jsonb;

-- Now that every row has values, restore the constraints JOZY relies on.
alter table applications alter column position   set not null;
alter table applications alter column company    set not null;
alter table applications alter column status     set not null;
alter table applications alter column applied_at set not null;
alter table applications alter column updated_at set not null;
alter table applications alter column status     set default 'applied';
alter table applications alter column applied_at set default now();
alter table applications alter column updated_at set default now();

-- ============================================================================
-- 5. INDEXES
-- ============================================================================

create index if not exists applications_user_idx    on applications (user_id);
create index if not exists applications_company_idx on applications (company);
create index if not exists applications_status_idx  on applications (user_id, status);
create index if not exists applications_next_idx    on applications (user_id, next_action_at);

create index if not exists resume_versions_user_idx    on resume_versions (user_id);
create index if not exists resume_versions_company_idx on resume_versions (company);
create index if not exists resume_versions_app_idx     on resume_versions (application_id);

create index if not exists requisitions_user_idx on requisitions (user_id);

create index if not exists candidates_req_idx   on candidates (requisition_id);
create index if not exists candidates_user_idx  on candidates (user_id);
create index if not exists candidates_score_idx on candidates (requisition_id, score desc);

-- ============================================================================
-- 6. ROW LEVEL SECURITY
-- ============================================================================
-- Section 2a had to drop the policies that depended on `applications.user_id`
-- before its type could change. They are re-established here, rewritten for a
-- text user_id (auth.uid() returns uuid, so it is cast rather than compared
-- directly), and the same owner-only rule is applied to every JOZY table.
--
-- The backend authenticates with the service-role key, which bypasses RLS
-- entirely, so none of this changes how the app behaves. It matters if anything
-- ever reaches these tables with an anon or user key - then a row is readable
-- only by the account that owns it.
--
-- Your original policy definitions are kept in jozy_migration_policy_backup:
--     select * from jozy_migration_policy_backup;

alter table applications    enable row level security;
alter table master_profiles enable row level security;
alter table resume_versions enable row level security;
alter table requisitions    enable row level security;
alter table candidates      enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['applications', 'master_profiles', 'resume_versions', 'requisitions', 'candidates'] loop
    execute format('drop policy if exists jozy_owner_rw on public.%I', t);
    execute format(
      'create policy jozy_owner_rw on public.%I for all to authenticated ' ||
      'using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id)', t);
  end loop;
end $$;

-- ============================================================================
-- Note on `master_resumes`
-- ============================================================================
-- An earlier version stored profiles in `master_resumes (user_id, resume_json)`.
-- It is deliberately left untouched: its JSON has a different shape to JOZY's
-- master profile, so copying it across would produce a profile that looks
-- populated but reads as empty. Re-import your resume through the app instead
-- (Master profile -> paste resume), which parses it into the current shape.
-- Once you have done that, `drop table master_resumes;` if you want it gone.
