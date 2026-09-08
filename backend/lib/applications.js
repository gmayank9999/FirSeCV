// Application memory - the record of what you sent, to whom, and when.
//
// This is deliberately independent of resume generation. Discovery found the
// core pain is not the 30 minutes spent tailoring; it is that a reply arrives
// 19-24 weeks later (one documented case: applied in January, called in July)
// and by then nobody remembers what they sent. So an application can be logged
// from anywhere - the extension, the web app, or by hand for a resume that was
// never made here - and a generated resume merely attaches to one.

import { live } from "../config.js";
import { rest } from "./supabase.js";
import { detectDomain } from "./rubric.js";

// The pipeline, in order. `stale` marks the states where silence is expected
// but still worth chasing - the states where memory actually fails people.
export const STATUSES = [
  { id: "saved", label: "Saved", stale: false, terminal: false },
  { id: "applied", label: "Applied", stale: true, terminal: false },
  { id: "screening", label: "In screening", stale: true, terminal: false },
  { id: "interview", label: "Interviewing", stale: true, terminal: false },
  { id: "offer", label: "Offer", stale: false, terminal: true },
  { id: "rejected", label: "Rejected", stale: false, terminal: true },
  { id: "withdrawn", label: "Withdrawn", stale: false, terminal: true },
];

const STATUS_IDS = STATUSES.map((s) => s.id);
export const isStatus = (s) => STATUS_IDS.includes(s);

// How long silence in a given state is normal before it is worth a nudge.
// Calibrated to the reply windows people actually reported, not to a generic
// "follow up in a week" rule that would just produce noise.
const STALE_AFTER_DAYS = { applied: 21, screening: 14, interview: 10 };

const mem = [];
const nowIso = () => new Date().toISOString();
const newId = () => "app_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const TABLE = "/applications";

// ------------------------------------------------------------------- shaping

/** Normalize a row from either backing store into the shape the UI consumes. */
export function toApplication(row) {
  if (!row) return null;
  return {
    id: row.id,
    company: row.company || "",
    position: row.position || "",
    sourceUrl: row.source_url || "",
    jdText: row.jd_text || "",
    domain: row.domain || "general",
    status: row.status || "applied",
    statusHistory: row.status_history || [],
    nextAction: row.next_action || "",
    nextActionAt: row.next_action_at || null,
    notes: row.notes || "",
    tags: row.tags || [],
    resumeVersionId: row.resume_version_id || null,
    contact: row.contact || null,
    appliedAt: row.applied_at,
    updatedAt: row.updated_at,
    ...followUpState(row),
  };
}

/**
 * Is this application overdue for attention? Two independent reasons:
 * an explicit next action whose date has passed, or silence for longer than
 * this stage normally goes quiet.
 */
export function followUpState(row) {
  const status = row.status || "applied";
  const meta = STATUSES.find((s) => s.id === status);
  if (!meta || meta.terminal) return { needsFollowUp: false, followUpReason: "", daysSinceUpdate: daysSince(row.updated_at || row.applied_at) };

  const days = daysSince(row.updated_at || row.applied_at);
  const dueDate = row.next_action_at ? new Date(row.next_action_at) : null;
  const actionDue = dueDate && !isNaN(dueDate) && dueDate <= new Date();

  if (actionDue) {
    return { needsFollowUp: true, followUpReason: row.next_action || "Follow-up scheduled for today", daysSinceUpdate: days };
  }
  const threshold = STALE_AFTER_DAYS[status];
  if (meta.stale && threshold && days >= threshold) {
    return {
      needsFollowUp: true,
      followUpReason: `No movement for ${days} days since "${meta.label.toLowerCase()}"`,
      daysSinceUpdate: days,
    };
  }
  return { needsFollowUp: false, followUpReason: "", daysSinceUpdate: days };
}

function daysSince(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return 0;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}

// -------------------------------------------------------------------- create

export async function createApplication(userId, input = {}) {
  const appliedAt = input.appliedAt || nowIso();
  const status = isStatus(input.status) ? input.status : "applied";
  const row = {
    id: newId(),
    user_id: userId,
    company: (input.company || "").trim() || "Unknown company",
    position: (input.position || "").trim() || "Unknown role",
    source_url: input.sourceUrl || "",
    jd_text: input.jdText || "",
    domain: input.domain || detectDomain(input.jdText || input.position || ""),
    status,
    status_history: [{ status, at: appliedAt, note: input.note || "Logged" }],
    next_action: input.nextAction || "",
    next_action_at: input.nextActionAt || null,
    notes: input.notes || "",
    tags: Array.isArray(input.tags) ? input.tags : [],
    resume_version_id: input.resumeVersionId || null,
    contact: input.contact || null,
    applied_at: appliedAt,
    // At creation the most recent activity IS the application, so a backdated
    // entry (someone backfilling applications they made months ago) is stale
    // from the moment it is saved rather than looking freshly touched.
    updated_at: input.updatedAt || appliedAt,
  };
  if (!live.supabase) {
    mem.unshift(row);
    return toApplication(row);
  }
  const [saved] = await rest(TABLE, { method: "POST", prefer: "return=representation", body: row });
  return toApplication(saved);
}

// ---------------------------------------------------------------------- read

/**
 * List applications, newest first. `q` searches company, position and notes so
 * that "that fintech one in Bangalore" is findable months later.
 */
export async function listApplications(userId, { q = "", status = "", domain = "" } = {}) {
  let rows;
  if (!live.supabase) {
    rows = mem.filter((r) => r.user_id === userId);
  } else {
    const filters = [`user_id=eq.${encodeURIComponent(userId)}`];
    if (status && isStatus(status)) filters.push(`status=eq.${encodeURIComponent(status)}`);
    if (domain) filters.push(`domain=eq.${encodeURIComponent(domain)}`);
    rows = (await rest(`${TABLE}?${filters.join("&")}&order=applied_at.desc`)) || [];
  }
  // Re-apply the filters locally too: they are a no-op for the REST path (the
  // query already applied them) and the real filter for the in-memory path.
  const term = q.trim().toLowerCase();
  return rows
    .filter((r) => !status || r.status === status)
    .filter((r) => !domain || r.domain === domain)
    .filter((r) => !term || [r.company, r.position, r.notes, r.jd_text]
      .some((f) => String(f || "").toLowerCase().includes(term)))
    .sort((a, b) => new Date(b.applied_at) - new Date(a.applied_at))
    .map(toApplication);
}

export async function getApplication(userId, id) {
  if (!live.supabase) return toApplication(mem.find((r) => r.id === id && r.user_id === userId));
  const rows = await rest(`${TABLE}?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`);
  return toApplication(rows && rows[0]);
}

// -------------------------------------------------------------------- update

const PATCHABLE = {
  company: "company",
  position: "position",
  sourceUrl: "source_url",
  jdText: "jd_text",
  domain: "domain",
  nextAction: "next_action",
  nextActionAt: "next_action_at",
  notes: "notes",
  tags: "tags",
  resumeVersionId: "resume_version_id",
  contact: "contact",
};

/**
 * Update an application. A status change is appended to status_history rather
 * than overwriting it - the timeline is the product, so it is never lost.
 */
export async function updateApplication(userId, id, patch = {}) {
  const current = await getApplication(userId, id);
  if (!current) return null;

  const update = { updated_at: nowIso() };
  for (const [key, column] of Object.entries(PATCHABLE)) {
    if (patch[key] !== undefined) update[column] = patch[key];
  }

  if (patch.status && isStatus(patch.status) && patch.status !== current.status) {
    update.status = patch.status;
    update.status_history = [
      ...current.statusHistory,
      { status: patch.status, at: update.updated_at, note: patch.note || "" },
    ];
    // Moving forward clears a follow-up that the move itself just resolved,
    // unless this same patch set a new one.
    if (patch.nextAction === undefined) update.next_action = "";
    if (patch.nextActionAt === undefined) update.next_action_at = null;
  }

  if (!live.supabase) {
    const row = mem.find((r) => r.id === id && r.user_id === userId);
    Object.assign(row, update);
    return toApplication(row);
  }
  const [saved] = await rest(`${TABLE}?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`, {
    method: "PATCH", prefer: "return=representation", body: update,
  });
  return toApplication(saved);
}

export async function deleteApplication(userId, id) {
  if (!live.supabase) {
    const i = mem.findIndex((r) => r.id === id && r.user_id === userId);
    if (i < 0) return false;
    mem.splice(i, 1);
    return true;
  }
  await rest(`${TABLE}?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`, {
    method: "DELETE", prefer: "return=minimal",
  });
  return true;
}

/** Attach a stored resume version to the application it was actually sent for. */
export async function linkResumeVersion(userId, id, resumeVersionId) {
  return updateApplication(userId, id, { resumeVersionId });
}

// ------------------------------------------------------------------ overview

/**
 * The dashboard payload: pipeline counts, what needs chasing, and the funnel
 * numbers (applications -> callbacks -> offers) the discovery deck asks for.
 */
export async function overview(userId) {
  const all = await listApplications(userId);
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s.id, 0]));
  for (const a of all) byStatus[a.status] = (byStatus[a.status] || 0) + 1;

  const followUps = all
    .filter((a) => a.needsFollowUp)
    .sort((a, b) => b.daysSinceUpdate - a.daysSinceUpdate);

  const reachedCallback = all.filter((a) => ["screening", "interview", "offer"].includes(a.status)).length;
  const offers = byStatus.offer || 0;
  const applied = all.filter((a) => a.status !== "saved").length;

  return {
    total: all.length,
    byStatus,
    funnel: {
      applied,
      callbacks: reachedCallback,
      offers,
      callbackRate: applied ? Math.round((reachedCallback / applied) * 100) : 0,
    },
    followUps: followUps.slice(0, 20),
    followUpCount: followUps.length,
    recent: all.slice(0, 5),
    // Longest-waiting open application - the "January application, July callback"
    // case made visible before the callback arrives rather than after.
    longestWait: all
      .filter((a) => !STATUSES.find((s) => s.id === a.status)?.terminal && a.status !== "saved")
      .sort((a, b) => b.daysSinceUpdate - a.daysSinceUpdate)[0] || null,
  };
}

/** Test seam: clear the in-memory store between runs. */
export function _resetMemory() {
  mem.length = 0;
}
