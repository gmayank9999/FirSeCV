# FirSeCV

**Extract a job description, generate a résumé tailored to it, and keep a permanent record of every application — right from the page you're applying on.**

FirSeCV is a Chrome side-panel extension. You set up a structured **Master Data** profile once (all your experience, projects, skills, and education). Then, on any job posting, you click **Extract** to pull the description straight off the page, generate a résumé tailored to that JD with a live ATS score, refine it by chatting ("shorten the projects section", "emphasize backend"), and approve. Approved résumés are logged so months later you know exactly what you sent, to whom, and when.

## Why this beats just asking an LLM

A chat assistant can rewrite a résumé — if you paste everything in by hand, every single time. FirSeCV gives you:

1. A **persistent structured profile** you set up once and reuse everywhere.
2. **One-click JD capture** from the actual page you're applying on.
3. A **real document + ATS score**, not chat text.
4. **Permanent memory** — every approved résumé tied to the exact company, role, and date, always retrievable.

It's an end-to-end workflow tool, not a prompt.

## Status

This build is the **complete extension UI running against a mock backend**, so the whole flow is clickable and demoable today. The mock lives behind a single seam (`src/lib/api.js`) and swaps for a real backend without touching any screen. Still to come in later work: a Node/Express backend, Google Gemini for parsing/generation/scoring, a LaTeX→PDF pipeline, and Supabase + Notion for storage and application tracking.

## Install (unpacked)

1. Open `chrome://extensions` and enable **Developer mode** (top right).
2. Click **Load unpacked** and select this repository's root folder (the one with `manifest.json`).
3. Click the FirSeCV icon in the toolbar to open the side panel.

## How to use

1. **First run** — paste your existing résumé; FirSeCV structures it and lets you edit the details, then saves your Master Data.
2. **On a job posting** — click **Extract JD from this page**, confirm the company/position/description, and **Generate**.
3. **Review** — check the ATS score and matched/missing keywords, refine with chat until it's right.
4. **Approve** — the résumé is saved to your application history, searchable by company.

## Project layout

```
manifest.json          Manifest V3 config (side panel)
background.js          Opens the side panel on icon click
src/
  sidepanel/           Panel shell, styles, router + theme
  lib/                 api facade, mock adapter, store, page scraper
  ui/                  screen renderers + shared components
```

## Logo and icon attribution

<a href="https://www.flaticon.com/free-icons/socket" title="socket icons">Socket icons created by Freepik - Flaticon</a>
