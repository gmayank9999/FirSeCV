# FirSeCV

> An AI-powered Chrome extension that tailors resumes to job descriptions in real-time — with LaTeX PDF output, live ATS scoring, and a permanent Notion + Supabase application tracker.

## What it does

1. **One-time setup**: Paste your existing resume → AI structures it into a master profile
2. **On any job page**: Click "Extract JD" → the extension scrapes the JD and cleans it with AI
3. **Generate**: AI selects and rewrites your experience to match the role, compiles a PDF via LaTeX
4. **Review & chat**: See the ATS score (0-100), keyword breakdown, and live PDF preview — iterate with natural language ("shorten projects section")
5. **Approve**: PDF + LaTeX saved to Supabase Storage, row created in your Notion tracker (Company | Position | Date | ATS Score | Resume Link)

## Tech Stack

| Layer | Tech |
|---|---|
| Extension | Chrome Extension MV3, vanilla JS |
| Backend | Node.js + Express |
| AI | Google Gemini 2.0 Flash |
| Resume | LaTeX → PDF via `tectonic` / `pdflatex` |
| Storage | Supabase (Postgres + Storage) |
| Tracker | Notion API |

## Setup

### 1. Prerequisites

```bash
# Install tectonic (recommended LaTeX compiler)
brew install tectonic

# OR install full TeX Live
brew install --cask mactex-no-gui
```

### 2. Backend

```bash
cd backend
npm install
cp .env.example .env
# Fill in your API keys in .env
npm run dev
```

### 3. Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Open the SQL Editor and run `backend/schema.sql`
3. Create a Storage bucket named `resumes` (private/non-public)
4. Copy your Project URL and Service Role key into `backend/.env`

### 4. Notion

1. Go to [notion.so/my-integrations](https://www.notion.so/my-integrations) → New Integration
2. Create a database with columns: Company (Title), Position (Text), Date Applied (Date), ATS Score (Number), Resume Link (URL), Status (Select)
3. Share the database with your integration
4. Copy the integration token and database ID into `backend/.env`

### 5. Gemini API

1. Get a free API key at [aistudio.google.com](https://aistudio.google.com)
2. Add it to `backend/.env` as `GEMINI_API_KEY`

### 6. Chrome Extension

1. Open Chrome → `chrome://extensions/`
2. Enable **Developer Mode** (top right)
3. Click **Load unpacked** → select the `extension/` folder
4. Pin the FirSeCV extension
5. Click the icon on any job posting page

## Repo Structure

```
FirSeCV/
├── extension/          # Chrome Extension (MV3)
│   ├── manifest.json
│   ├── background.js
│   ├── content.js
│   ├── sidepanel.html
│   ├── sidepanel.js
│   └── sidepanel.css
├── backend/            # Node.js + Express API
│   ├── server.js
│   ├── schema.sql
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
│   └── templates/
│       └── template.tex
└── plan.md
```

## Environment Variables

```env
GEMINI_API_KEY=          # Google AI Studio key
SUPABASE_URL=            # https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=
NOTION_TOKEN=            # secret_xxxx
NOTION_DATABASE_ID=      # 32-char hex or UUID
PORT=3000
```

## Known Caveats

- LaTeX compiler must be installed locally (see Prerequisites)
- Rate limits on Gemini free tier — generation + ATS scoring = 2 calls; the backend has automatic retry/backoff
- JD extraction uses LLM cleaning — always review extracted company/position before generating
