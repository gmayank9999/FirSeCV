// Real backend adapter. Same surface as mockAdapter - talk to the Express API.
// Enable by flipping USE_MOCK in api.js once the backend is running.

const BASE = "http://localhost:3000";

async function req(path, { method = "GET", body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}`);
  return res.json();
}

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
