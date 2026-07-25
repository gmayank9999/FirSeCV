# FirSeCV — Complete Implementation Plan

## 0. What We're Building (one paragraph, memorize this)

FirSeCV is a Chrome extension that lives on a careers/job posting page. The user clicks the extension, hits "Extract," and it pulls the job description straight off the page. Using a one-time "Master Data" profile (all the user's experience, projects, skills, education — fed once, editable forever), FirSeCV generates a resume tailored to that specific JD, rendered from a LaTeX template into a clean PDF, with a live ATS score. The user can approve it as-is or chat with it ("make the projects section shorter," "emphasize the ML experience more") and it regenerates until approved. On approval, the final resume (PDF + LaTeX source) is stored in Supabase, tagged with company + position + timestamp, and a corresponding row is created in a Notion database (Company | Position | Date | Supabase Link) so the user has a permanent, searchable application tracker with the exact resume they sent, always retrievable.

**Why this beats "just ask Gemini":** Gemini/ChatGPT can rewrite a resume in a chat window if you paste everything in by hand, every single time. FirSeCV has (1) a persistent structured master profile you set up once, (2) one-click JD capture from the actual page you're applying on, (3) a proper LaTeX→PDF pipeline producing a real downloadable, ATS-checkable document, not chat text, and (4) permanent memory — a Notion + Supabase system of record tying every resume to the exact company/role/date it was used for, so months later you know exactly what you sent and can retrieve it instantly. It's an end-to-end workflow tool, not a chat prompt.

---

## 1. Complete Tech Stack (zero paid APIs — every choice below has a real, usable free tier or is fully open-source/self-hosted)

| Layer | Choice | Why | Cost |
|---|---|---|---|
| Extension frontend | Chrome Extension, Manifest V3, vanilla JS/HTML/CSS (or React + Vite if team is comfortable) | Runs in popup or side panel; side panel is better here since the flow is multi-step (extract → generate → chat → approve) | Free (no API involved) |
| JD extraction | Content script injected into the active tab, reads page text/DOM | Runs in the context of the careers page to pull job description text | Free (no API involved) |
| Backend API | Node.js + Express (or Next.js API routes if you want one deployable unit) | Hosts all business logic; extension never calls LLM/Supabase/Notion directly (keeps API keys off the client) | Free to run locally or on a free-tier host (Render/Railway free tier, or just localhost for demo) |
| LLM | **Google Gemini API (`gemini-2.0-flash` or similar free-tier model)** — Gemini has a genuinely free tier with daily request limits that's enough for dev + demo use. Alternative: **Groq API** (free tier, very fast, runs open models like Llama 3.1/3.3) if you want a second option or hit Gemini rate limits. | JD parsing/structuring, resume content generation, chat-based revision, ATS scoring | Free tier (watch the daily/per-minute rate limits on both — build in simple retry/backoff so a rate limit doesn't crash your demo) |
| Resume rendering | LaTeX template + **locally installed TeX Live (`pdflatex` or `tectonic`)**, called via Node `child_process` | Produces a real PDF from a `.tex` template populated with generated content. Both TeX Live and Tectonic are free, open-source, and run entirely on your own machine/server — no external API or paid service needed. | Free (open-source, self-hosted) |
| Master data storage | Supabase (Postgres table `master_profiles`) | Structured profile: experience, projects, skills, education, contact info | Free tier (Supabase's free project tier is enough for a small demo/dev project) |
| Resume storage | Supabase Storage (bucket `resumes`) for PDF + `.tex` files; Supabase table `resume_versions` for metadata | File storage + queryable metadata in one platform | Free tier (well within Supabase's free storage limits for a handful of PDFs) |
| Application tracker | Notion API, database with Company / Position / Date / Supabase Link / Status | User-facing tracker, syncs on approval | Free (Notion's API is free to use with a personal integration token) |
| Auth (minimal) | Supabase Auth (email/password or magic link) — even a single hardcoded demo user is fine for MVP | Needed so master data + resumes are tied to a real user record | Free (included in Supabase free tier) |
| ATS scoring | LLM-based scoring using the same free-tier Gemini/Groq call (keyword match, formatting compatibility, section structure) — optionally supplement with a rules-based checker (parseable fonts, no tables/images, standard section headers) written in plain code, no API needed | Combines semantic + structural scoring | Free |

**Important note on "free tier" reality:** free tiers come with rate limits (e.g., Gemini's free tier caps requests per minute/day). For a dev/demo project this is completely fine — just don't hammer the API in a tight loop while testing, and add basic error handling for a 429 (rate-limited) response so it fails gracefully instead of crashing the extension mid-demo.

---

## 2. Data Models

### 2.1 Supabase — `master_profiles` table
```sql
create table master_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  full_name text,
  email text,
  phone text,
  location text,
  linkedin_url text,
  github_url text,
  portfolio_url text,
  education jsonb,       -- array of {institution, degree, field, start_date, end_date, gpa}
  experience jsonb,      -- array of {company, role, start_date, end_date, bullets[]}
  projects jsonb,        -- array of {name, description, tech_stack[], bullets[], link}
  skills jsonb,          -- array of {category, items[]}
  certifications jsonb,  -- array of {name, issuer, date}
  achievements jsonb,    -- array of strings
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

### 2.2 Supabase — `resume_versions` table
```sql
create table resume_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  company text not null,
  position text not null,
  jd_text text,
  jd_url text,
  ats_score integer,
  pdf_storage_path text,   -- path in Supabase Storage bucket
  latex_source text,       -- full .tex content stored for record/editing
  status text default 'approved',  -- draft | approved
  applied_at timestamptz default now(),
  notion_page_id text      -- reference back to the Notion row
);
```

### 2.3 Supabase Storage
- Bucket: `resumes`
- Path convention: `{user_id}/{company}_{position}_{timestamp}.pdf`

### 2.4 Notion Database Schema
| Property | Type |
|---|---|
| Company | Title |
| Position | Text |
| Date Applied | Date |
| ATS Score | Number |
| Resume Link | URL (Supabase public/signed URL to the PDF) |
| Status | Select (Applied / Interview / Rejected / Offer) |

---

## 3. Complete User Flow (step by step)

1. **First-time setup:** User installs extension, clicks icon → no master data found → prompted to fill out a "Master Data" form (or paste an existing resume and have the LLM auto-structure it into the schema above — recommended, much lower friction than manual form-filling). Data is saved to Supabase `master_profiles`, tied to their user_id.
2. **On a careers page:** User navigates to a job posting (e.g., a Greenhouse/Lever/LinkedIn/company careers page). Opens the extension.
3. **Click "Extract":** Content script scrapes the visible page text (or targets common JD container selectors as a first pass, falling back to full visible body text). Extracted text is sent to the backend, which uses an LLM call to clean/structure it into `{company, position, jd_text}` (auto-detecting company/position where possible, with editable fields shown to the user for correction — extraction won't be perfect on every ATS platform, so always let the user confirm/edit company & position before proceeding).
4. **Generate:** Backend takes `{master_profile, jd_text}`, sends to LLM with a resume-generation prompt (see section 5), gets back structured resume content (selected/reordered experience, tailored bullets, relevant projects, matched skills). This structured content is injected into a LaTeX template, compiled to PDF.
5. **Review:** Extension displays the generated PDF (embedded viewer or download link) plus the ATS score and a breakdown (matched keywords, missing keywords, structural notes).
6. **Approve or Chat:**
   - **Approve →** go to step 7.
   - **Chat →** user types a revision request ("shorten the projects section," "add more emphasis on backend experience"). This message + the current resume content + JD is sent back to the LLM, which returns updated structured content, re-renders the PDF, updates the ATS score, and loops back to step 5. This continues until approved.
7. **On Approval:** Backend uploads the final PDF (and stores the `.tex` source) to Supabase Storage, inserts a row into `resume_versions` with company/position/JD/ATS score/timestamp, then calls the Notion API to create a corresponding row with Company/Position/Date/ATS Score/Resume Link (a signed Supabase Storage URL) linked back via `notion_page_id`.
8. **Later retrieval:** A "History" tab in the extension lets the user search by company name, pulling from Supabase `resume_versions` (or the user can just check their Notion tracker directly, which is the primary human-facing view).

---

## 4. Chrome Extension — Detailed Build Spec

### 4.1 manifest.json
```json
{
  "manifest_version": 3,
  "name": "FirSeCV",
  "version": "1.0",
  "description": "Extract a JD, generate a tailored resume, track every application.",
  "permissions": ["storage", "activeTab", "scripting"],
  "host_permissions": ["http://localhost:3000/*", "https://your-backend-domain.com/*"],
  "action": { "default_title": "FirSeCV" },
  "side_panel": { "default_path": "sidepanel.html" },
  "background": { "service_worker": "background.js" },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ]
}
```
Use `side_panel` instead of a popup — popups close if the user clicks away, which will interrupt a multi-step flow (extract → review → chat → approve). Side panel persists.

### 4.2 background.js
- Listens for the extension icon click, opens the side panel (`chrome.sidePanel.open`).

### 4.3 content.js
- Injected into every page (or trigger on-demand via `chrome.scripting.executeScript` when "Extract" is clicked, which is cleaner than always-on injection).
- On "Extract" trigger: grabs `document.body.innerText` (simplest, most robust fallback), optionally tries known selectors for common ATS platforms (Greenhouse `.job__description`, Lever `.posting-page`, LinkedIn job description container) for cleaner extraction, sends the raw text back to the side panel via `chrome.runtime.sendMessage`.

### 4.4 sidepanel.html / sidepanel.js — Screens
1. **Onboarding screen** (shown only if no master data exists — checked via a call to backend `GET /api/master-profile`): "Paste your existing resume text" textarea + "Parse & Save" button, OR a full manual form as fallback.
2. **Main screen:** "Extract JD" button → shows extracted/editable Company, Position, JD text fields → "Generate Resume" button.
3. **Review screen:** embedded PDF preview (use `<iframe>` pointing to a blob URL or the backend-served PDF), ATS score displayed prominently, keyword match breakdown, two actions: "Approve" and a chat input box for revisions.
4. **History screen:** search bar (company name) → list of past applications pulled from backend, each showing company/position/date/ATS score/link to PDF.

---

## 5. Backend API — Complete Route Spec

Base: Node.js + Express (or Next.js API routes). All extension calls go here — extension never touches Gemini/Supabase/Notion directly.

### `POST /api/master-profile`
- Body: `{ resumeText: string }` (raw pasted resume) OR full structured fields.
- If `resumeText` provided: LLM call with a system prompt instructing structured extraction into the schema in 2.1, returns structured JSON, upserts into Supabase `master_profiles`.

### `GET /api/master-profile`
- Returns the current user's master profile, or 404 if not set up yet (triggers onboarding screen).

### `PATCH /api/master-profile`
- Allows editing individual fields post-onboarding.

### `POST /api/extract-jd`
- Body: `{ rawPageText: string, pageUrl: string }`
- LLM call: system prompt instructs the model to identify and return `{ company: string, position: string, jd_text: string (cleaned job description only, stripped of nav/footer/unrelated page content) }`.
- Returns this to the extension for user confirmation/editing before generation.

### `POST /api/generate-resume`
- Body: `{ masterProfileId, company, position, jdText, revisionInstruction?: string, previousContent?: object }`
- If no `revisionInstruction`: first-pass generation — LLM prompt (see 5.1) takes master profile + JD, returns structured resume content.
- If `revisionInstruction` present: LLM prompt includes the previous structured content + the user's chat instruction, returns updated structured content.
- Structured content is injected into the LaTeX template (see section 6), compiled to PDF.
- Also runs the ATS scoring prompt (see 5.2) on the generated content vs JD.
- Returns: `{ structuredContent, pdfUrl (temp/preview), atsScore, atsBreakdown }`.

### `POST /api/approve-resume`
- Body: `{ company, position, jdText, atsScore, pdfBuffer/path, latexSource }`
- Uploads PDF to Supabase Storage bucket `resumes`.
- Inserts row into `resume_versions`.
- Calls Notion API to create the tracker row, storing the resulting `notion_page_id` back into the Supabase row.
- Returns success + the stored resume's URL.

### `GET /api/search-resumes?company=X`
- Queries Supabase `resume_versions` filtered by company (`ilike` for partial match), returns matches for the History screen.

---

## 6. LaTeX Resume Pipeline (this is the trickiest infra piece — read carefully)

**Approach:** maintain ONE well-designed LaTeX resume template (`template.tex`) with placeholder tokens (e.g. `{{FULL_NAME}}`, `{{EXPERIENCE_BLOCK}}`, `{{PROJECTS_BLOCK}}`) that get string-replaced or templated (using a templating approach like `mustache` or simple placeholder substitution) with the LLM-generated structured content, then compiled.

**Compilation options (pick one):**
- **Option A (recommended if backend can install packages freely):** Install TeX Live in your backend's Docker image/environment, call `pdflatex` or `tectonic` via `child_process.exec` on the populated `.tex` file, read the resulting `.pdf`.
- **Option B (if you can't install TeX Live locally):** Use a hosted LaTeX compilation API (e.g., a self-hosted `texlive` Docker container exposed as a microservice, or a public LaTeX-as-a-service endpoint) — send the `.tex` string, receive PDF bytes back.

**Template structure (example skeleton):**
```latex
\documentclass[11pt]{article}
% ... standard resume packages (geometry, titlesec, enumitem, hyperref) ...
\begin{document}
{\Large \textbf{ {{FULL_NAME}} }} \\
{{CONTACT_LINE}}

\section*{Experience}
{{EXPERIENCE_BLOCK}}

\section*{Projects}
{{PROJECTS_BLOCK}}

\section*{Skills}
{{SKILLS_BLOCK}}

\section*{Education}
{{EDUCATION_BLOCK}}
\end{document}
```
The LLM generation step (5.1 below) should output content already formatted as valid LaTeX fragments for each block (e.g., `\resumeItem{Built X using Y, improving Z by N\%}` style entries matching whatever macros your template defines), not just plain text — this avoids a fragile separate "convert plain text to LaTeX" step. Define your own LaTeX macros (`\resumeItem`, `\resumeSubheading`, etc.) once in the template preamble and instruct the LLM to use exactly those macro names when generating block content.

---

## 7. Core LLM Prompts (write these carefully — they're the product's actual quality bar)

### 5.1 Resume Generation Prompt (system prompt for `/api/generate-resume`)
Instruct the model to:
- Take the master profile JSON and the JD text as input.
- Select the most JD-relevant experience entries and projects (not necessarily all of them — omission is as important as inclusion).
- Rewrite bullets to emphasize JD-aligned skills/impact, using the master profile's factual content as ground truth (never invent experience, companies, or metrics not present in the master data — this is a hard constraint, state it explicitly and firmly in the prompt).
- Output valid LaTeX fragments matching your template's macros, structured as JSON: `{ experience_latex: string, projects_latex: string, skills_latex: string, education_latex: string }`.
- For revision calls, additionally take the previous output + the user's chat instruction, apply only the requested change, and preserve everything else unchanged.

### 5.2 ATS Scoring Prompt
Instruct the model to:
- Compare the generated resume content against the JD text.
- Score 0-100 based on: keyword/skill overlap, standard section presence, quantifiable impact statements present, no problematic formatting patterns (tables/columns/graphics that break ATS parsers — since your output is LaTeX-generated, structural issues should be minimal, but keyword coverage is the main variable).
- Return JSON: `{ score: number, matched_keywords: string[], missing_keywords: string[], notes: string[] }`.

### 5.3 JD Extraction Prompt
Instruct the model to take raw scraped page text (which will contain nav bars, footers, unrelated content) and extract only `{ company, position, jd_text }`, discarding navigation/boilerplate.

---

## 8. Build Order (recommended sequence, not time-boxed)

1. **Supabase setup:** create project, run the SQL for both tables, create the `resumes` storage bucket, set up Supabase Auth (even minimal).
2. **Notion setup:** create integration token, create the tracker database with the schema in 2.4, share the database with the integration.
3. **Backend skeleton:** Express app, env vars for Gemini/Supabase/Notion keys, `/health` route working.
4. **Master profile flow:** build `/api/master-profile` (POST + GET + PATCH), test with a real pasted resume, confirm structured JSON looks right and lands correctly in Supabase.
5. **LaTeX template + compilation pipeline:** get ONE hardcoded example resume compiling to PDF successfully end-to-end before touching the LLM generation step — isolate and de-risk the LaTeX/PDF infra first, since it's the most likely thing to break.
6. **JD extraction:** build `/api/extract-jd`, test against a few real careers pages' scraped text.
7. **Resume generation:** build `/api/generate-resume`, wire the LLM output into the LaTeX pipeline from step 5, confirm a real generated resume compiles correctly.
8. **ATS scoring:** add the scoring call into the generate-resume response.
9. **Chat/revision loop:** extend `/api/generate-resume` to accept `revisionInstruction`, test iterative refinement.
10. **Approval flow:** build `/api/approve-resume`, confirm Supabase Storage upload + `resume_versions` insert + Notion row creation all work together.
11. **Extension:** build the side panel UI screens (onboarding → extract → review/chat → approve → history), wire each to its backend route in the order above (build the extension screen for each backend piece right after that piece is confirmed working, rather than building the whole extension UI first).
12. **History/search:** build `/api/search-resumes` + the History screen.
13. **End-to-end test:** run the full flow for 3 different real job postings, confirm PDFs look good, ATS scores are sensible, Notion rows appear correctly.
14. **Polish:** loading states in the extension for every async step (generation and LaTeX compilation are the slowest steps — make sure the UI communicates progress, not a frozen screen).

---

## 9. Environment Variables Needed
```
GEMINI_API_KEY=
# Optional fallback if you want a second free provider for rate-limit headroom:
# GROQ_API_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
NOTION_TOKEN=
NOTION_DATABASE_ID=
PORT=3000
```

---

## 10. Known Risk Points (address these deliberately, don't discover them late)
- **LaTeX compilation environment:** getting `pdflatex`/`tectonic` installed and callable from your backend is the single most likely infra blocker — test this in complete isolation, hardcoded, before any LLM content touches it.
- **JD extraction reliability across different careers page platforms:** Greenhouse, Lever, Workday, LinkedIn, and custom company sites all structure their DOM differently — full-page-text extraction with LLM-based cleaning (rather than trying to hand-write selectors for every platform) is the more robust approach; always show the user the extracted company/position/JD for confirmation/editing rather than trusting it silently.
- **LLM fabrication risk:** the generation prompt must be strict about never inventing experience/metrics not present in master data — test this explicitly by checking generated resumes against the master profile for factual accuracy.
- **Notion/Supabase property-type mismatches:** Notion API is strict about property types in the request payload (e.g., select fields need `{name: "value"}` objects, not plain strings) — expect to debug this against actual API error messages.

---

## 11. Suggested Repo Structure
```
firsecv/
├── extension/
│   ├── manifest.json
│   ├── background.js
│   ├── content.js
│   ├── sidepanel.html
│   ├── sidepanel.js
│   └── sidepanel.css
├── backend/
│   ├── server.js
│   ├── routes/
│   │   ├── masterProfile.js
│   │   ├── extractJd.js
│   │   ├── generateResume.js
│   │   ├── approveResume.js
│   │   └── searchResumes.js
│   ├── lib/
│   │   ├── gemini.js
│   │   ├── supabase.js
│   │   ├── notion.js
│   │   └── latexCompile.js
│   ├── templates/
│   │   └── template.tex
│   └── .env
└── plan.md  (this file)
```