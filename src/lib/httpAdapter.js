// Real backend adapter. Same surface as mockAdapter - talk to the Express API.
// Enable by flipping USE_MOCK in api.js once the backend is running.

import { getSession } from "./store.js";

const BASE = "http://localhost:3000";

async function req(path, { method = "GET", body, auth = true } = {}) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (auth) {
    const session = await getSession();
    if (session?.accessToken) headers.Authorization = `Bearer ${session.accessToken}`;
  }
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    let message = `${method} ${path} -> ${res.status}`;
    try { message = (await res.json()).message || message; } catch { /* ignore */ }
    throw new Error(message);
  }
  return res.json();
}

// ---- auth ----
export const signup = (email, password) =>
  req("/api/auth/signup", { method: "POST", body: { email, password }, auth: false });
export const login = (email, password) =>
  req("/api/auth/login", { method: "POST", body: { email, password }, auth: false });
export const requestPasswordReset = (email) =>
  req("/api/auth/forgot-password", { method: "POST", body: { email }, auth: false });

export const getMasterProfile = () => req("/api/master-profile");
export const saveMasterProfile = (input) => req("/api/master-profile", { method: "POST", body: input });
export const updateMasterProfile = (patch) => req("/api/master-profile", { method: "PATCH", body: patch });
export const extractJd = (payload) => req("/api/extract-jd", { method: "POST", body: payload });
export const generateResume = (payload) => req("/api/generate-resume", { method: "POST", body: payload });
export const approveResume = (payload) => req("/api/approve-resume", { method: "POST", body: payload });
export const interviewPrep = (payload) => req("/api/interview-prep", { method: "POST", body: payload });
// The DB returns snake_case rows; normalize to the camelCase shape the UI uses.
export const searchResumes = async ({ company = "" } = {}) => {
  const rows = (await req(`/api/search-resumes?company=${encodeURIComponent(company)}`)) || [];
  return rows.map((r) => ({
    id: r.id,
    company: r.company,
    position: r.position,
    jdText: r.jd_text,
    atsScore: r.ats_score,
    atsBreakdown: r.ats_breakdown,
    structuredContent: r.structured_content,
    resumeUrl: r.resume_url,
    latexSource: r.latex_source,
    hasPdf: Boolean(r.resume_url),
    appliedAt: r.applied_at,
  }));
};

// ---- rubric + flexible-effort matching ----
export const getRubric = (jdText, domain = "") => req("/api/rubric", { method: "POST", body: { jdText, domain } });
export const reviewResume = (payload) => req("/api/review-resume", { method: "POST", body: payload });

// ---- application memory ----
export const overview = () => req("/api/applications/overview");
export const listApplications = (filters = {}) => {
  const q = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
  return req(`/api/applications${q ? "?" + q : ""}`);
};
export const createApplication = (body) => req("/api/applications", { method: "POST", body });
export const updateApplication = (id, body) => req(`/api/applications/${id}`, { method: "PATCH", body });
