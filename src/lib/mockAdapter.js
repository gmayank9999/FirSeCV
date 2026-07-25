// Mock backend adapter. Mirrors the eventual HTTP adapter's method surface so
// the UI can be built and demoed before the real backend exists. Persists the
// master profile and application history via the store.

import { store, getProfile, setProfile, getHistory, addHistory } from "./store.js";

const delay = (min = 500, max = 1000) =>
  new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));

const STOPWORDS = new Set(
  ("a an and or the to of in on for with as at by from is are be we you our your they " +
   "will who this that these those it its their have has had a an role work team using " +
   "job description responsibilities requirements about experience years strong etc").split(" ")
);

// ---- helpers -------------------------------------------------------------

function keywordsFrom(text = "", limit = 12) {
  const counts = new Map();
  for (const raw of text.toLowerCase().split(/[^a-z0-9+#.]+/)) {
    const w = raw.replace(/^\.+|\.+$/g, "");
    if (w.length < 3 || STOPWORDS.has(w) || /^\d+$/.test(w)) continue;
    counts.set(w, (counts.get(w) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([w]) => w);
}

function resumeText(sc) {
  const parts = [];
  for (const e of sc.experience || []) parts.push(e.role, e.company, ...(e.bullets || []));
  for (const p of sc.projects || []) parts.push(p.name, p.tech, ...(p.bullets || []));
  for (const s of sc.skills || []) parts.push(s.category, ...(s.items || []));
  return parts.join(" ").toLowerCase();
}

function contactLine(p) {
  return [p.email, p.phone, p.location, p.links?.linkedin, p.links?.github, p.links?.portfolio]
    .filter(Boolean)
    .join("  •  ");
}

// Best-effort parse of pasted resume text into the profile schema.
function parseResume(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const email = (text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/) || [])[0] || "";
  const phone = (text.match(/(\+?\d[\d\s().-]{7,}\d)/) || [])[0] || "";
  const linkedin = (text.match(/https?:\/\/(www\.)?linkedin\.com\/[^\s)]+/i) || [])[0] || "";
  const github = (text.match(/https?:\/\/(www\.)?github\.com\/[^\s)]+/i) || [])[0] || "";
  // First non-contact line is usually the name.
  const name = lines.find((l) => !/@|http|\d{3}/.test(l) && l.split(" ").length <= 5) || lines[0] || "Your Name";

  return {
    fullName: name,
    email,
    phone,
    location: "",
    links: { linkedin, github, portfolio: "" },
    education: [],
    experience: [],
    projects: [],
    // Skills: pull the most frequent notable tokens as a starter set.
    skills: [{ category: "Skills", items: keywordsFrom(text, 10) }],
    certifications: [],
    achievements: [],
    _rawResume: text,
  };
}

// Build tailored resume content from a profile + JD keywords.
function buildResume(profile, jdText) {
  const kws = keywordsFrom(jdText, 14);
  const kwSet = new Set(kws);
  const emphasize = (bullet) =>
    kws.some((k) => bullet.toLowerCase().includes(k)) ? bullet : bullet;

  const experience = (profile.experience?.length
    ? profile.experience
    : [{ company: "Recent Employer", role: "Software Engineer", dates: "2022 — Present",
        bullets: ["Delivered features across the stack, collaborating with product and design.",
                  "Improved reliability and performance of core services."] }]
  ).map((e) => ({
    company: e.company || "",
    role: e.role || "",
    dates: e.dates || [e.start_date, e.end_date].filter(Boolean).join(" — "),
    bullets: (e.bullets || []).map(emphasize),
  }));

  const projects = (profile.projects?.length
    ? profile.projects
    : [{ name: "Portfolio Project", tech: kws.slice(0, 3).join(", "),
        bullets: ["Built and shipped an end-to-end application demonstrating relevant skills."] }]
  ).map((p) => ({
    name: p.name || "",
    tech: p.tech || (p.tech_stack ? p.tech_stack.join(", ") : ""),
    bullets: (p.bullets || []).map(emphasize),
  }));

  // Surface JD-matching skills first.
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
    experience,
    projects,
    skills,
    education,
  };
}

function scoreResume(structuredContent, jdText) {
  const kws = keywordsFrom(jdText, 14);
  const text = resumeText(structuredContent);
  const matched = kws.filter((k) => text.includes(k));
  const missing = kws.filter((k) => !text.includes(k));
  const ratio = kws.length ? matched.length / kws.length : 0.7;
  const score = Math.round(58 + ratio * 36); // 58–94 band
  const notes = [];
  notes.push(structuredContent.experience?.length ? "Standard experience section present." : "Add an experience section.");
  notes.push(missing.length ? `Consider working in: ${missing.slice(0, 4).join(", ")}.` : "Strong keyword coverage.");
  notes.push("Single-column layout — ATS-parser friendly.");
  return { score, atsBreakdown: { matched, missing, notes } };
}

// ---- public API ----------------------------------------------------------

export async function getMasterProfile() {
  return getProfile();
}

export async function saveMasterProfile(input) {
  await delay();
  const profile = input && input.resumeText ? parseResume(input.resumeText) : input;
  return setProfile(profile);
}

export async function updateMasterProfile(patch) {
  await delay(200, 400);
  const current = (await getProfile()) || {};
  return setProfile({ ...current, ...patch });
}

export async function extractJd({ rawPageText = "", pageUrl = "" }) {
  await delay();
  const text = rawPageText.replace(/\n{3,}/g, "\n\n").trim();
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  let company = "";
  try { company = new URL(pageUrl).hostname.replace(/^www\./, "").split(".")[0]; } catch { /* ignore */ }
  const atMatch = text.match(/\bat\s+([A-Z][A-Za-z0-9&.\- ]{2,30})/);
  if (atMatch) company = atMatch[1].trim();
  company = company ? company.charAt(0).toUpperCase() + company.slice(1) : "Unknown Company";

  const roleLine = lines.find((l) =>
    /(engineer|developer|manager|designer|scientist|analyst|intern|lead|architect|consultant)/i.test(l) && l.length < 80
  );
  const position = roleLine ? roleLine.replace(/\s+at\s+.*$/i, "").trim() : "Unknown Role";

  return { company, position, jdText: text.slice(0, 6000) };
}

export async function generateResume({ jdText = "", revisionInstruction = "", previousContent = null }) {
  await delay(800, 1500);
  const profile = (await getProfile()) || store.profile || {};

  let structuredContent;
  if (revisionInstruction && previousContent) {
    structuredContent = applyRevision(previousContent, revisionInstruction);
  } else {
    structuredContent = buildResume(profile, jdText);
  }

  const { score, atsBreakdown } = scoreResume(structuredContent, jdText);
  // Revisions nudge the score up a little to reflect refinement.
  const atsScore = Math.min(99, revisionInstruction ? score + 2 + Math.floor(Math.random() * 4) : score);
  return { structuredContent, atsScore, atsBreakdown };
}

// Interpret a plain-language revision request against the current content.
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

  // "emphasize X" / "focus on X" — move sections/skills matching X to the front.
  const emph = ins.match(/(?:emphasi[sz]e|focus on|highlight|more)\s+([a-z+#. ]{2,30})/);
  if (emph) {
    const term = emph[1].trim().split(" ")[0];
    c.skills = (c.skills || []).map((s) => ({
      ...s,
      items: [...(s.items || [])].sort((a, b) => (b.toLowerCase().includes(term) ? 1 : 0) - (a.toLowerCase().includes(term) ? 1 : 0)),
    }));
    c.experience = [...(c.experience || [])].sort(
      (a, b) => scoreBullets(b, term) - scoreBullets(a, term)
    );
  }
  return c;
}

function scoreBullets(entry, term) {
  return (entry.bullets || []).filter((x) => x.toLowerCase().includes(term)).length;
}

export async function approveResume({ company, position, jdText, atsScore, structuredContent }) {
  await delay(500, 900);
  const id = "rv_" + Date.now().toString(36);
  const row = {
    id,
    company,
    position,
    atsScore,
    jdText,
    structuredContent,
    appliedAt: new Date().toISOString(),
    resumeUrl: `mock://resume/${id}`,
  };
  await addHistory(row);
  return { id, resumeUrl: row.resumeUrl };
}

export async function searchResumes({ company = "" } = {}) {
  await delay(150, 350);
  const list = await getHistory();
  const q = company.trim().toLowerCase();
  return q ? list.filter((r) => (r.company || "").toLowerCase().includes(q)) : list;
}
