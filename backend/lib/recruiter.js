// The recruiter side: requisitions and the candidates screened against them.
//
// The design commitment here is that the rubric is *stored on the requisition*,
// not recomputed per screening run. That is what makes a shortlist defensible
// months later - you can show exactly which criteria and weights produced it,
// and re-running the same batch gives the same answer. It is also what lets a
// recruiter disagree with the machine: weights are editable, and a human
// decision is recorded as a human decision.

import { live } from "../config.js";
import { rest } from "./supabase.js";
import { rebalance, scoreAgainstRubric, rankCandidates } from "./rubric.js";

const REQS = "/requisitions";
const CANDS = "/candidates";

const memReqs = [];
const memCands = [];

const nowIso = () => new Date().toISOString();
const newId = (p) => p + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export const DECISIONS = ["pending", "shortlist", "reject"];

// ------------------------------------------------------------------- shaping

export function toRequisition(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title || "",
    company: row.company || "",
    jdText: row.jd_text || "",
    domain: row.domain || "general",
    rubric: row.rubric || { domain: row.domain || "general", criteria: [] },
    status: row.status || "open",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toCandidate(row) {
  if (!row) return null;
  return {
    id: row.id,
    requisitionId: row.requisition_id,
    name: row.name || "Unnamed candidate",
    email: row.email || "",
    source: row.source || "",
    resumeText: row.resume_text || "",
    score: row.score == null ? null : row.score,
    breakdown: row.breakdown || null,
    decision: row.decision || "pending",
    decidedBy: row.decided_by || null,
    createdAt: row.created_at,
  };
}

// -------------------------------------------------------------- requisitions

export async function createRequisition(userId, { title, company = "", jdText = "", rubric }) {
  const row = {
    id: newId("req"),
    user_id: userId,
    title: (title || "").trim() || "Untitled role",
    company: company.trim(),
    jd_text: jdText,
    domain: (rubric && rubric.domain) || "general",
    rubric: rubric || { domain: "general", criteria: [] },
    status: "open",
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  if (!live.supabase) {
    memReqs.unshift(row);
    return toRequisition(row);
  }
  const [saved] = await rest(REQS, { method: "POST", prefer: "return=representation", body: row });
  return toRequisition(saved);
}

export async function listRequisitions(userId) {
  if (!live.supabase) return memReqs.filter((r) => r.user_id === userId).map(toRequisition);
  const rows = (await rest(`${REQS}?user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc`)) || [];
  return rows.map(toRequisition);
}

export async function getRequisition(userId, id) {
  if (!live.supabase) return toRequisition(memReqs.find((r) => r.id === id && r.user_id === userId));
  const rows = await rest(`${REQS}?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`);
  return toRequisition(rows && rows[0]);
}

/**
 * Update a requisition. Editing the rubric re-normalises weights to 100 so a
 * recruiter can type "make this one twice as important" without doing the
 * arithmetic - and so scores stay comparable across requisitions.
 */
export async function updateRequisition(userId, id, patch = {}) {
  const current = await getRequisition(userId, id);
  if (!current) return null;
  const update = { updated_at: nowIso() };
  if (patch.title !== undefined) update.title = patch.title;
  if (patch.company !== undefined) update.company = patch.company;
  if (patch.jdText !== undefined) update.jd_text = patch.jdText;
  if (patch.status !== undefined) update.status = patch.status === "closed" ? "closed" : "open";
  if (patch.rubric) {
    const criteria = rebalance(
      (patch.rubric.criteria || []).map((c, i) => ({
        id: c.id || "c" + (i + 1),
        label: String(c.label || "").slice(0, 80),
        kind: c.kind || "skill",
        weight: Number(c.weight) || 1,
        terms: (Array.isArray(c.terms) ? c.terms : String(c.terms || "").split(","))
          .map((t) => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 8),
        mustHave: Boolean(c.mustHave),
      })).filter((c) => c.label)
    );
    update.rubric = { domain: patch.rubric.domain || current.domain, criteria, source: patch.rubric.source || "edited" };
    update.domain = update.rubric.domain;
  }

  if (!live.supabase) {
    const row = memReqs.find((r) => r.id === id && r.user_id === userId);
    Object.assign(row, update);
    return toRequisition(row);
  }
  const [saved] = await rest(`${REQS}?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`, {
    method: "PATCH", prefer: "return=representation", body: update,
  });
  return toRequisition(saved);
}

export async function deleteRequisition(userId, id) {
  if (!live.supabase) {
    const i = memReqs.findIndex((r) => r.id === id && r.user_id === userId);
    if (i < 0) return false;
    memReqs.splice(i, 1);
    for (let j = memCands.length - 1; j >= 0; j--) if (memCands[j].requisition_id === id) memCands.splice(j, 1);
    return true;
  }
  await rest(`${CANDS}?requisition_id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`, { method: "DELETE", prefer: "return=minimal" });
  await rest(`${REQS}?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`, { method: "DELETE", prefer: "return=minimal" });
  return true;
}

// ----------------------------------------------------------------- candidates

/** Add candidates in bulk and score each one as it lands. */
export async function addCandidates(userId, requisitionId, list = []) {
  const req = await getRequisition(userId, requisitionId);
  if (!req) return null;

  const rows = list
    .filter((c) => (c.resumeText || c.resume_text || "").trim())
    .map((c) => {
      const resumeText = (c.resumeText || c.resume_text || "").trim();
      const breakdown = scoreAgainstRubric(req.rubric, resumeText);
      return {
        id: newId("cand"),
        requisition_id: requisitionId,
        user_id: userId,
        name: (c.name || guessName(resumeText)).slice(0, 120),
        email: c.email || guessEmail(resumeText),
        source: c.source || "pasted",
        resume_text: resumeText,
        score: breakdown.score,
        breakdown,
        decision: "pending",
        decided_by: null,
        created_at: nowIso(),
      };
    });

  if (!rows.length) return [];
  if (!live.supabase) {
    memCands.push(...rows);
    return rows.map(toCandidate);
  }
  const saved = await rest(CANDS, { method: "POST", prefer: "return=representation", body: rows });
  return (saved || []).map(toCandidate);
}

export async function listCandidates(userId, requisitionId) {
  let rows;
  if (!live.supabase) {
    rows = memCands.filter((c) => c.requisition_id === requisitionId && c.user_id === userId);
  } else {
    rows = (await rest(`${CANDS}?requisition_id=eq.${encodeURIComponent(requisitionId)}&user_id=eq.${encodeURIComponent(userId)}&order=score.desc`)) || [];
  }
  return rows.map(toCandidate).sort((a, b) => (b.score || 0) - (a.score || 0));
}

/**
 * Record a human decision. `decidedBy: "human"` is stored deliberately: the
 * gap between the machine ranking and the human shortlist is the metric the
 * roadmap wants ("ATS score correlates with recruiter manual shortlisting"),
 * and it can only be measured if overrides are distinguishable.
 */
export async function decideCandidate(userId, candidateId, decision) {
  if (!DECISIONS.includes(decision)) return null;
  const update = { decision, decided_by: "human" };
  if (!live.supabase) {
    const row = memCands.find((c) => c.id === candidateId && c.user_id === userId);
    if (!row) return null;
    Object.assign(row, update);
    return toCandidate(row);
  }
  const [saved] = await rest(`${CANDS}?id=eq.${encodeURIComponent(candidateId)}&user_id=eq.${encodeURIComponent(userId)}`, {
    method: "PATCH", prefer: "return=representation", body: update,
  });
  return toCandidate(saved);
}

/**
 * Re-score every candidate against the current rubric. Called after weights are
 * edited, so the shortlist always reflects the rubric on screen.
 */
export async function rescoreAll(userId, requisitionId) {
  const req = await getRequisition(userId, requisitionId);
  if (!req) return null;
  const candidates = await listCandidates(userId, requisitionId);
  const ranked = rankCandidates(req.rubric, candidates.map((c) => ({ ...c, resume_text: c.resumeText })));

  for (const c of ranked) {
    if (!live.supabase) {
      const row = memCands.find((m) => m.id === c.id);
      if (row) { row.score = c.score; row.breakdown = c.breakdown; }
    } else {
      await rest(`${CANDS}?id=eq.${encodeURIComponent(c.id)}&user_id=eq.${encodeURIComponent(userId)}`, {
        method: "PATCH", prefer: "return=minimal", body: { score: c.score, breakdown: c.breakdown },
      });
    }
  }
  return ranked.map((c) => ({ ...toCandidate({
    id: c.id, requisition_id: requisitionId, name: c.name, email: c.email, source: c.source,
    resume_text: c.resumeText, score: c.score, breakdown: c.breakdown, decision: c.decision,
    decided_by: c.decidedBy, created_at: c.createdAt,
  }), rank: c.rank }));
}

/** Screening summary for one requisition, including human-vs-rubric agreement. */
export async function requisitionSummary(userId, requisitionId) {
  const candidates = await listCandidates(userId, requisitionId);
  const decided = candidates.filter((c) => c.decidedBy === "human");
  const shortlisted = candidates.filter((c) => c.decision === "shortlist");

  // Of the candidates a human ruled on, how often did the rubric's top half
  // agree with the human's shortlist call? The validation metric, computed live.
  let agreement = null;
  if (decided.length >= 2) {
    const sorted = [...candidates].sort((a, b) => (b.score || 0) - (a.score || 0));
    const cutoff = sorted[Math.max(0, Math.ceil(sorted.length / 2) - 1)]?.score ?? 0;
    const agreed = decided.filter((c) =>
      (c.decision === "shortlist" && (c.score || 0) >= cutoff) ||
      (c.decision === "reject" && (c.score || 0) < cutoff)).length;
    agreement = Math.round((agreed / decided.length) * 100);
  }

  return {
    total: candidates.length,
    scored: candidates.filter((c) => c.score != null).length,
    shortlisted: shortlisted.length,
    rejected: candidates.filter((c) => c.decision === "reject").length,
    pending: candidates.filter((c) => c.decision === "pending").length,
    humanDecisions: decided.length,
    rubricAgreement: agreement,
    topScore: candidates.length ? Math.max(...candidates.map((c) => c.score || 0)) : null,
    medianScore: median(candidates.map((c) => c.score || 0)),
  };
}

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

// ---- best-effort identity extraction from a pasted resume ----

function guessEmail(text) {
  const m = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return m ? m[0] : "";
}

function guessName(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const candidate = lines.find((l) =>
    l.length <= 45 &&
    l.split(/\s+/).length <= 4 &&
    !/@|https?:|\d{4}|resume|curriculum/i.test(l) &&
    /^[A-Za-z][A-Za-z.'\- ]+$/.test(l));
  return candidate || "Unnamed candidate";
}

/** Test seam. */
export function _resetMemory() {
  memReqs.length = 0;
  memCands.length = 0;
}
