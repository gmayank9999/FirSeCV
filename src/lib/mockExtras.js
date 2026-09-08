// Mock implementations of the newer surface (rubric, quick review, application
// memory) so USE_MOCK still demos the whole product with no backend running.
//
// These are deliberately simpler than backend/lib/rubric.js - the real engine
// has domain lexicons and weighting the panel has no business duplicating. The
// shapes match exactly, so the UI cannot tell the difference.

import { getProfile, getApplications, setApplications } from "./store.js";

const delay = (min = 300, max = 700) =>
  new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));

const norm = (s = "") => String(s).toLowerCase().replace(/\s+/g, " ").trim();

const STOPWORDS = new Set(
  ("a an and or the to of in on for with as at by from is are be we you our your they will who this that " +
   "these those it its their have has had work team using job role description responsibilities " +
   "requirements about experience years strong etc").split(" ")
);

function salientTerms(text = "", limit = 8) {
  const counts = new Map();
  for (const raw of norm(text).split(/[^a-z0-9+#.]+/)) {
    const w = raw.replace(/^\.+|\.+$/g, "");
    if (w.length < 3 || STOPWORDS.has(w) || /^\d+$/.test(w)) continue;
    counts.set(w, (counts.get(w) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([w]) => w);
}

function resumeToText(sc) {
  if (!sc) return "";
  if (typeof sc === "string") return sc;
  const parts = [];
  const push = (...xs) => xs.forEach((x) => x && parts.push(String(x)));
  push(sc.fullName, sc.header?.fullName);
  for (const e of sc.experience || []) push(e.role, e.company, ...(e.bullets || []));
  for (const p of sc.projects || []) push(p.name, p.tech, ...(p.bullets || []));
  for (const s of sc.skills || []) push(s.category, ...(s.items || []));
  for (const ed of sc.education || []) push(ed.institution, ed.degree, ed.field);
  if (sc._rawResume) push(sc._rawResume);
  return parts.join("\n");
}

export async function getRubric(jdText = "") {
  await delay();
  const terms = salientTerms(jdText, 7);
  const weights = [22, 18, 15, 13, 12, 10, 10].slice(0, terms.length);
  const total = weights.reduce((n, w) => n + w, 0) || 1;
  return {
    domain: "general",
    source: "mock",
    criteria: terms.map((t, i) => ({
      id: "c" + (i + 1),
      label: t.charAt(0).toUpperCase() + t.slice(1),
      kind: "skill",
      weight: i === terms.length - 1
        ? 100 - weights.slice(0, -1).reduce((n, w) => n + Math.round((w / total) * 100), 0)
        : Math.round((weights[i] / total) * 100),
      terms: [t],
      mustHave: false,
    })),
  };
}

export function scoreAgainstRubric(rubric, resume) {
  const text = norm(resumeToText(resume));
  const criteria = (rubric?.criteria || []).map((c) => {
    const matchedTerms = (c.terms || [c.label]).filter((t) => text.includes(norm(t)));
    const matched = matchedTerms.length > 0;
    return {
      ...c,
      matched,
      matchedTerms,
      evidence: matched ? `…${matchedTerms[0]}…` : "",
      contribution: matched ? c.weight : 0,
    };
  });
  const totalWeight = criteria.reduce((n, c) => n + c.weight, 0) || 1;
  const score = Math.min(99, Math.round((criteria.reduce((n, c) => n + c.contribution, 0) / totalWeight) * 100));
  return {
    score,
    criteria,
    matched: criteria.filter((c) => c.matched).flatMap((c) => c.matchedTerms),
    missing: criteria.filter((c) => !c.matched).map((c) => c.label),
    mustHaveGaps: [],
    notes: ["Mock scoring - run the backend for the real weighted rubric."],
  };
}

export async function reviewResume({ jdText = "", structuredContent = null, rubric = null }) {
  await delay(500, 900);
  const resume = structuredContent || (await getProfile());
  const r = rubric?.criteria?.length ? rubric : await getRubric(jdText);
  const breakdown = scoreAgainstRubric(r, resume);
  const gaps = breakdown.criteria.filter((c) => !c.matched).sort((a, b) => b.weight - a.weight);
  return {
    rubric: r,
    atsScore: breakdown.score,
    atsBreakdown: breakdown,
    suggestions: gaps.length
      ? gaps.slice(0, 5).map((c) => ({
          criterion: c.label,
          action: `Nothing in your resume evidences "${c.label}". If it is true of you, work it into a bullet with a concrete result.`,
          where: "Skills or Experience",
          impact: c.weight,
        }))
      : [{ criterion: "Overall", action: "Your resume already covers this posting. Send it as is.", where: "", impact: 0 }],
  };
}

// ---- application memory ----

const STALE_AFTER_DAYS = { applied: 21, screening: 14, interview: 10 };
const TERMINAL = new Set(["offer", "rejected", "withdrawn"]);

function daysSince(iso) {
  const d = new Date(iso);
  return isNaN(d) ? 0 : Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}

function decorate(a) {
  const days = daysSince(a.updatedAt || a.appliedAt);
  const threshold = STALE_AFTER_DAYS[a.status];
  const stale = !TERMINAL.has(a.status) && threshold && days >= threshold;
  return {
    ...a,
    daysSinceUpdate: days,
    needsFollowUp: Boolean(stale),
    followUpReason: stale ? `No movement for ${days} days since "${a.status}"` : "",
  };
}

export async function listApplications({ q = "", status = "" } = {}) {
  await delay(120, 300);
  const term = q.trim().toLowerCase();
  return (await getApplications())
    .filter((a) => !status || a.status === status)
    .filter((a) => !term || [a.company, a.position, a.notes].some((f) => String(f || "").toLowerCase().includes(term)))
    .sort((a, b) => new Date(b.appliedAt) - new Date(a.appliedAt))
    .map(decorate);
}

export async function createApplication(input = {}) {
  await delay(150, 350);
  const at = input.appliedAt || new Date().toISOString();
  const row = {
    id: "app_" + Date.now().toString(36),
    company: input.company || "Unknown company",
    position: input.position || "Unknown role",
    sourceUrl: input.sourceUrl || "",
    jdText: input.jdText || "",
    domain: input.domain || "general",
    status: input.status || "applied",
    statusHistory: [{ status: input.status || "applied", at, note: "Logged" }],
    notes: input.notes || "",
    tags: [],
    resumeVersionId: input.resumeVersionId || null,
    appliedAt: at,
    updatedAt: at,
  };
  const list = await getApplications();
  list.unshift(row);
  await setApplications(list);
  return decorate(row);
}

export async function updateApplication(id, patch = {}) {
  await delay(120, 260);
  const list = await getApplications();
  const row = list.find((a) => a.id === id);
  if (!row) return null;
  const now = new Date().toISOString();
  if (patch.status && patch.status !== row.status) {
    row.statusHistory = [...(row.statusHistory || []), { status: patch.status, at: now, note: patch.note || "" }];
    row.status = patch.status;
  }
  for (const k of ["company", "position", "notes", "sourceUrl", "jdText", "resumeVersionId"]) {
    if (patch[k] !== undefined) row[k] = patch[k];
  }
  row.updatedAt = now;
  await setApplications(list);
  return decorate(row);
}

export async function overview() {
  const all = await listApplications();
  const byStatus = {};
  for (const a of all) byStatus[a.status] = (byStatus[a.status] || 0) + 1;
  const followUps = all.filter((a) => a.needsFollowUp).sort((a, b) => b.daysSinceUpdate - a.daysSinceUpdate);
  const applied = all.filter((a) => a.status !== "saved").length;
  const callbacks = all.filter((a) => ["screening", "interview", "offer"].includes(a.status)).length;
  return {
    total: all.length,
    byStatus,
    funnel: { applied, callbacks, offers: byStatus.offer || 0, callbackRate: applied ? Math.round((callbacks / applied) * 100) : 0 },
    followUps: followUps.slice(0, 20),
    followUpCount: followUps.length,
    recent: all.slice(0, 5),
    longestWait: all.filter((a) => !TERMINAL.has(a.status) && a.status !== "saved")
      .sort((a, b) => b.daysSinceUpdate - a.daysSinceUpdate)[0] || null,
  };
}
