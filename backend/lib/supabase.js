// Data + file storage. Uses Supabase's REST (PostgREST) and Storage HTTP APIs
// directly via fetch — no SDK dependency. Falls back to an in-memory store when
// SUPABASE_URL / SERVICE_ROLE_KEY are absent.

import { config, live } from "../config.js";

const BUCKET = "resumes";

// ---- in-memory fallback ----
const memProfiles = new Map();
const memVersions = [];

// ---- REST helpers ----
function sb(path) {
  return `${config.supabase.url}${path}`;
}
function headers(extra = {}) {
  return {
    apikey: config.supabase.serviceKey,
    Authorization: `Bearer ${config.supabase.serviceKey}`,
    ...extra,
  };
}
async function rest(path, { method = "GET", body, prefer } = {}) {
  const res = await fetch(sb(`/rest/v1${path}`), {
    method,
    headers: headers({ "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) }),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Supabase REST ${method} ${path} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ---- master profile (stored as one jsonb blob keyed by user_id) ----
export async function getProfile(userId) {
  if (!live.supabase) return memProfiles.get(userId) || null;
  const rows = await rest(`/master_profiles?user_id=eq.${userId}&select=data`);
  return rows?.[0]?.data || null;
}

export async function saveProfile(userId, profile) {
  const merged = { ...(await getProfile(userId)), ...profile };
  if (!live.supabase) { memProfiles.set(userId, merged); return merged; }
  await rest("/master_profiles", {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: { user_id: userId, data: merged, updated_at: new Date().toISOString() },
  });
  return merged;
}

// ---- storage: upload the compiled PDF, return a public URL ----
export async function uploadResume(userId, { company, position, pdfBytes }) {
  const ts = Date.now();
  const path = `${userId}/${slug(company)}_${slug(position)}_${ts}.pdf`;
  if (!pdfBytes) return { path, url: "", hasPdf: false };
  if (!live.supabase) return { path, url: `mock://storage/resumes/${path}`, hasPdf: true };
  const res = await fetch(sb(`/storage/v1/object/${BUCKET}/${path}`), {
    method: "POST",
    headers: headers({ "Content-Type": "application/pdf", "x-upsert": "true" }),
    body: pdfBytes,
  });
  if (!res.ok) throw new Error(`Supabase upload ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return { path, url: sb(`/storage/v1/object/public/${BUCKET}/${path}`), hasPdf: true };
}

// ---- resume_versions ----
export async function insertResumeVersion(row) {
  const record = { id: "rv_" + Date.now().toString(36), applied_at: new Date().toISOString(), ...row };
  if (!live.supabase) { memVersions.unshift(record); return record; }
  const [saved] = await rest("/resume_versions", {
    method: "POST",
    prefer: "return=representation",
    body: record,
  });
  return saved;
}

export async function updateNotionRef(id, notionPageId) {
  if (!live.supabase) {
    const row = memVersions.find((r) => r.id === id);
    if (row) row.notion_page_id = notionPageId;
    return row;
  }
  await rest(`/resume_versions?id=eq.${id}`, { method: "PATCH", prefer: "return=minimal", body: { notion_page_id: notionPageId } });
  return { id, notion_page_id: notionPageId };
}

export async function searchResumeVersions(userId, company = "") {
  const q = company.trim();
  if (!live.supabase) {
    const l = q.toLowerCase();
    return memVersions.filter((r) => r.user_id === userId).filter((r) => !l || (r.company || "").toLowerCase().includes(l));
  }
  const filter = q ? `&company=ilike.*${encodeURIComponent(q)}*` : "";
  return rest(`/resume_versions?user_id=eq.${userId}${filter}&order=applied_at.desc`);
}

// ---- one-time storage bucket setup (idempotent) ----
export async function ensureBucket() {
  if (!live.supabase) return { ok: true, mocked: true };
  const res = await fetch(sb("/storage/v1/bucket"), {
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true }),
  });
  if (res.ok) return { ok: true, created: true };
  const body = await res.text();
  if (res.status === 409 || /already exists|Duplicate/i.test(body)) return { ok: true, existed: true };
  throw new Error(`ensureBucket ${res.status}: ${body.slice(0, 200)}`);
}

function slug(s = "") {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x";
}
