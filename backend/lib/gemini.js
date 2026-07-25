// LLM operations: résumé parsing, JD extraction, résumé generation, ATS scoring.
// When GEMINI_API_KEY is set the real calls go here; until then a deterministic
// local implementation keeps the whole pipeline working end to end.

import { config, live } from "../config.js";

const STOPWORDS = new Set(
  ("a an and or the to of in on for with as at by from is are be we you our your they " +
   "will who this that these those it its their have has had work team using job role " +
   "description responsibilities requirements about experience years strong etc").split(" ")
);

export function keywordsFrom(text = "", limit = 14) {
  const counts = new Map();
  for (const raw of text.toLowerCase().split(/[^a-z0-9+#.]+/)) {
    const w = raw.replace(/^\.+|\.+$/g, "");
    if (w.length < 3 || STOPWORDS.has(w) || /^\d+$/.test(w)) continue;
    counts.set(w, (counts.get(w) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([w]) => w);
}

// Try the real Gemini call; if it fails (e.g. free-tier rate limit after
// retries), log and fall back to the local implementation so the app keeps
// working. Returns { value, source: "gemini" | "local" }.
async function withFallback(label, realFn, localFn) {
  if (live.gemini) {
    try {
      return { value: await realFn(), source: "gemini" };
    } catch (e) {
      console.warn(`[FirSeCV] Gemini ${label} fell back to local: ${e.message}`);
    }
  }
  return { value: await localFn(), source: "local" };
}

// ---- parse a pasted résumé into the master-profile schema ----
export async function parseResume(text) {
  const { value } = await withFallback("parseResume", () => parseResumeReal(text), () => parseResumeLocal(text));
  return value;
}

function parseResumeLocal(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const email = (text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/) || [])[0] || "";
  const phone = (text.match(/(\+?\d[\d\s().-]{7,}\d)/) || [])[0] || "";
  const linkedin = (text.match(/https?:\/\/(www\.)?linkedin\.com\/[^\s)]+/i) || [])[0] || "";
  const github = (text.match(/https?:\/\/(www\.)?github\.com\/[^\s)]+/i) || [])[0] || "";
  const name = lines.find((l) => !/@|http|\d{3}/.test(l) && l.split(" ").length <= 5) || lines[0] || "Your Name";
  return {
    fullName: name, email, phone, location: "",
    links: { linkedin, github, portfolio: "" },
    education: [], experience: [], projects: [],
    skills: [{ category: "Skills", items: keywordsFrom(text, 10) }],
    certifications: [], achievements: [], _rawResume: text,
  };
}

// ---- extract {company, position, jdText} from raw page text ----
export async function extractJd(rawPageText = "", pageUrl = "") {
  const { value } = await withFallback("extractJd",
    () => extractJdReal(rawPageText, pageUrl), () => extractJdLocal(rawPageText, pageUrl));
  return value;
}

function extractJdLocal(rawPageText = "", pageUrl = "") {
  const text = rawPageText.replace(/\n{3,}/g, "\n\n").trim();
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let company = "";
  try { company = new URL(pageUrl).hostname.replace(/^www\./, "").split(".")[0]; } catch { /* ignore */ }
  const at = text.match(/\bat\s+([A-Z][A-Za-z0-9&.\- ]{2,30})/);
  if (at) company = at[1].trim();
  company = company ? company[0].toUpperCase() + company.slice(1) : "Unknown Company";
  const roleLine = lines.find((l) =>
    /(engineer|developer|manager|designer|scientist|analyst|intern|lead|architect|consultant)/i.test(l) && l.length < 80);
  const position = roleLine ? roleLine.replace(/\s+at\s+.*$/i, "").trim() : "Unknown Role";
  return { company, position, jdText: text.slice(0, 6000) };
}

// ---- generate tailored résumé content from a profile + JD ----
export async function generateResume({ profile = {}, jdText = "", revisionInstruction = "", previousContent = null }) {
  const { value } = await withFallback("generateResume",
    () => generateResumeReal({ profile, jdText, revisionInstruction, previousContent }),
    () => (revisionInstruction && previousContent) ? applyRevision(previousContent, revisionInstruction) : buildResume(profile, jdText));
  return value;
}

export function scoreResume(structuredContent, jdText) {
  const kws = keywordsFrom(jdText, 14);
  const text = resumeText(structuredContent);
  const matched = kws.filter((k) => text.includes(k));
  const missing = kws.filter((k) => !text.includes(k));
  const ratio = kws.length ? matched.length / kws.length : 0.7;
  const score = Math.round(58 + ratio * 36);
  const notes = [
    structuredContent.experience?.length ? "Standard experience section present." : "Add an experience section.",
    missing.length ? `Consider working in: ${missing.slice(0, 4).join(", ")}.` : "Strong keyword coverage.",
    "Single-column layout — ATS-parser friendly.",
  ];
  return { score, atsBreakdown: { matched, missing, notes } };
}

// ---- local builders ----
function resumeText(sc) {
  const parts = [];
  for (const e of sc.experience || []) parts.push(e.role, e.company, ...(e.bullets || []));
  for (const p of sc.projects || []) parts.push(p.name, p.tech, ...(p.bullets || []));
  for (const s of sc.skills || []) parts.push(s.category, ...(s.items || []));
  return parts.join(" ").toLowerCase();
}

function contactLine(p) {
  return [p.email, p.phone, p.location, p.links?.linkedin, p.links?.github, p.links?.portfolio]
    .filter(Boolean).join("  •  ");
}

function buildResume(profile, jdText) {
  const kws = keywordsFrom(jdText, 14);
  const kwSet = new Set(kws);
  const experience = (profile.experience?.length ? profile.experience : [{
    company: "Recent Employer", role: "Software Engineer", dates: "2022 — Present",
    bullets: ["Delivered features across the stack, collaborating with product and design.",
              "Improved reliability and performance of core services."],
  }]).map((e) => ({
    company: e.company || "", role: e.role || "",
    dates: e.dates || [e.start_date, e.end_date].filter(Boolean).join(" — "),
    bullets: e.bullets || [],
  }));
  const projects = (profile.projects?.length ? profile.projects : [{
    name: "Portfolio Project", tech: kws.slice(0, 3).join(", "),
    bullets: ["Built and shipped an end-to-end application demonstrating relevant skills."],
  }]).map((p) => ({
    name: p.name || "", tech: p.tech || (p.tech_stack ? p.tech_stack.join(", ") : ""),
    bullets: p.bullets || [],
  }));
  const baseSkills = profile.skills?.length ? profile.skills : [{ category: "Skills", items: kws.slice(0, 8) }];
  const skills = baseSkills.map((s) => ({
    category: s.category || "Skills",
    items: [...(s.items || [])].sort((a, b) => (kwSet.has(b.toLowerCase()) ? 1 : 0) - (kwSet.has(a.toLowerCase()) ? 1 : 0)),
  }));
  const education = (profile.education || []).map((ed) => ({
    institution: ed.institution || "",
    degree: [ed.degree, ed.field].filter(Boolean).join(", "),
    dates: ed.dates || [ed.start_date, ed.end_date].filter(Boolean).join(" — "),
  }));
  return {
    header: { fullName: profile.fullName || "Your Name", contactLine: contactLine(profile) },
    experience, projects, skills, education,
  };
}

function applyRevision(content, instruction) {
  const c = structuredClone(content);
  const ins = instruction.toLowerCase();
  if (/short|shorten|trim|concise|brief/.test(ins)) {
    const cut = (arr) => (arr || []).map((x) => ({ ...x, bullets: (x.bullets || []).slice(0, 2) }));
    if (/project/.test(ins)) c.projects = cut(c.projects);
    else if (/experience|work/.test(ins)) c.experience = cut(c.experience);
    else { c.experience = cut(c.experience); c.projects = cut(c.projects); }
  }
  if (/remove.*project|drop.*project|no project/.test(ins)) c.projects = [];
  const emph = ins.match(/(?:emphasi[sz]e|focus on|highlight|more)\s+([a-z+#. ]{2,30})/);
  if (emph) {
    const term = emph[1].trim().split(" ")[0];
    c.skills = (c.skills || []).map((s) => ({
      ...s,
      items: [...(s.items || [])].sort((a, b) => (b.toLowerCase().includes(term) ? 1 : 0) - (a.toLowerCase().includes(term) ? 1 : 0)),
    }));
    c.experience = [...(c.experience || [])].sort(
      (a, b) => (b.bullets || []).filter((x) => x.toLowerCase().includes(term)).length
              - (a.bullets || []).filter((x) => x.toLowerCase().includes(term)).length);
  }
  return c;
}

// ---- real Gemini calls (used when GEMINI_API_KEY is present) ----

// Call Gemini and return parsed JSON. We ask for a JSON mime type and also strip
// any stray code fences defensively before parsing.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callGeminiJson(prompt, { retries = 3 } = {}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.gemini.model}:generateContent?key=${config.gemini.key}`;
  let res;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.4 },
      }),
    });
    if (res.ok) break;
    // 429 (rate limit) and 503 (overloaded) are transient — back off and retry.
    if ((res.status === 429 || res.status === 503) && attempt < retries) {
      const body = await res.text();
      const retrySec = Number((body.match(/"retryDelay":\s*"(\d+)s"/) || [])[1]);
      const waitMs = retrySec ? Math.min(retrySec * 1000, 30000) : Math.min(2 ** attempt * 1500, 30000);
      await sleep(waitMs + Math.random() * 500);
      continue;
    }
    throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error("Gemini returned non-JSON: " + cleaned.slice(0, 200));
  }
}

const PROFILE_SHAPE = `{
  "fullName": string, "email": string, "phone": string, "location": string,
  "links": { "linkedin": string, "github": string, "portfolio": string },
  "education": [{ "institution": string, "degree": string, "field": string, "start_date": string, "end_date": string }],
  "experience": [{ "company": string, "role": string, "dates": string, "bullets": string[] }],
  "projects": [{ "name": string, "tech": string, "bullets": string[] }],
  "skills": [{ "category": string, "items": string[] }],
  "certifications": [{ "name": string, "issuer": string, "date": string }],
  "achievements": string[]
}`;

const RESUME_SHAPE = `{
  "header": { "fullName": string, "contactLine": string },
  "experience": [{ "company": string, "role": string, "dates": string, "bullets": string[] }],
  "projects": [{ "name": string, "tech": string, "bullets": string[] }],
  "skills": [{ "category": string, "items": string[] }],
  "education": [{ "institution": string, "degree": string, "dates": string }]
}`;

async function parseResumeReal(text) {
  const prompt =
    `Extract the following résumé into this exact JSON shape. Use "" or [] for anything missing. ` +
    `Do not invent data. Return ONLY JSON.\n\nSHAPE:\n${PROFILE_SHAPE}\n\nRÉSUMÉ:\n${text}`;
  return callGeminiJson(prompt);
}

async function extractJdReal(rawPageText, pageUrl) {
  const prompt =
    `From this raw job-posting page text, return ONLY JSON {"company","position","jdText"}. ` +
    `"jdText" must be the cleaned job description only — strip nav, footer, and unrelated page content. ` +
    `Page URL: ${pageUrl}\n\nPAGE TEXT:\n${rawPageText.slice(0, 12000)}`;
  const out = await callGeminiJson(prompt);
  return { company: out.company || "Unknown Company", position: out.position || "Unknown Role", jdText: out.jdText || "" };
}

async function generateResumeReal({ profile, jdText, revisionInstruction, previousContent }) {
  const rules =
    `Rules: use ONLY facts present in the master profile — never invent employers, dates, or metrics. ` +
    `Select and reorder the most JD-relevant experience and projects; rewrite bullets to emphasise JD-aligned impact. ` +
    `Return ONLY JSON in this shape:\n${RESUME_SHAPE}`;
  const prompt = revisionInstruction && previousContent
    ? `Apply this change to the résumé JSON and change nothing else: "${revisionInstruction}".\n` +
      `${rules}\n\nCURRENT RÉSUMÉ:\n${JSON.stringify(previousContent)}\n\nJOB DESCRIPTION:\n${jdText}`
    : `Create a résumé tailored to the job description from the master profile.\n${rules}\n\n` +
      `MASTER PROFILE:\n${JSON.stringify(profile)}\n\nJOB DESCRIPTION:\n${jdText}`;
  return callGeminiJson(prompt);
}
