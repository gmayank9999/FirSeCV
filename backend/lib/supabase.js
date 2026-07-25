// Data + file storage. In-memory until SUPABASE_URL/SERVICE_ROLE_KEY are set,
// at which point these functions talk to Postgres + Storage instead.

import { live } from "../config.js";

const profiles = new Map(); // userId -> profile
const resumeVersions = []; // rows

export async function getProfile(userId) {
  if (live.supabase) throw new Error("Supabase getProfile not implemented yet");
  return profiles.get(userId) || null;
}

export async function saveProfile(userId, profile) {
  if (live.supabase) throw new Error("Supabase saveProfile not implemented yet");
  const existing = profiles.get(userId) || {};
  const merged = { ...existing, ...profile, user_id: userId, updated_at: new Date().toISOString() };
  profiles.set(userId, merged);
  return merged;
}

// Store the compiled PDF (bytes may be null when LaTeX isn't available).
export async function uploadResume(userId, { company, position, pdfBytes }) {
  if (live.supabase) throw new Error("Supabase uploadResume not implemented yet");
  const ts = Date.now();
  const path = `${userId}/${slug(company)}_${slug(position)}_${ts}.pdf`;
  return { path, url: `mock://storage/resumes/${path}`, hasPdf: Boolean(pdfBytes) };
}

export async function insertResumeVersion(row) {
  if (live.supabase) throw new Error("Supabase insertResumeVersion not implemented yet");
  const record = { id: "rv_" + Date.now().toString(36), applied_at: new Date().toISOString(), ...row };
  resumeVersions.unshift(record);
  return record;
}

export async function updateNotionRef(id, notionPageId) {
  if (live.supabase) throw new Error("Supabase updateNotionRef not implemented yet");
  const row = resumeVersions.find((r) => r.id === id);
  if (row) row.notion_page_id = notionPageId;
  return row;
}

export async function searchResumeVersions(userId, company = "") {
  if (live.supabase) throw new Error("Supabase searchResumeVersions not implemented yet");
  const q = company.trim().toLowerCase();
  return resumeVersions
    .filter((r) => r.user_id === userId)
    .filter((r) => !q || (r.company || "").toLowerCase().includes(q));
}

function slug(s = "") {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x";
}
