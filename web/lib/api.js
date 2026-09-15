// Backend client for the web app. Same server the extension talks to, so the
// two clients never drift: a resume approved in the side panel shows up here,
// and an application logged here is visible there.

const KEY = "jozy.session";

export const session = {
  get() {
    try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; }
  },
  set(s) { localStorage.setItem(KEY, JSON.stringify(s)); return s; },
  clear() { localStorage.removeItem(KEY); },
};

/** Thrown for any non-2xx response, carrying the server's message and status. */
export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function req(path, { method = "GET", body, auth = true } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth) {
    const s = session.get();
    if (s?.accessToken) headers.Authorization = `Bearer ${s.accessToken}`;
  }

  let res;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError("Can't reach the JOZY server. Is the backend running?", 0);
  }

  if (res.status === 404 && method === "GET") return null;
  if (!res.ok) {
    let message = `${method} ${path} failed (${res.status})`;
    try {
      const data = await res.json();
      message = data.message || data.error || message;
    } catch { /* keep the default */ }
    throw new ApiError(message, res.status);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const qs = (params) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
  return s ? "?" + s : "";
};

// ---- auth ----
export const signup = (email, password) => req("/api/auth/signup", { method: "POST", body: { email, password }, auth: false });
export const login = (email, password) => req("/api/auth/login", { method: "POST", body: { email, password }, auth: false });
export const requestPasswordReset = (email) => req("/api/auth/forgot-password", { method: "POST", body: { email }, auth: false });
export const resetPassword = (accessToken, password) =>
  req("/api/auth/reset-password", { method: "POST", body: { accessToken, password }, auth: false });
export const health = () => req("/health", { auth: false });

// ---- master profile ----
export const getProfile = () => req("/api/master-profile");
export const saveProfile = (input) => req("/api/master-profile", { method: "POST", body: input });
export const patchProfile = (patch) => req("/api/master-profile", { method: "PATCH", body: patch });

// ---- matching ----
export const getRubric = (jdText, domain = "") => req("/api/rubric", { method: "POST", body: { jdText, domain } });
export const listDomains = () => req("/api/rubric/domains");
export const reviewResume = (payload) => req("/api/review-resume", { method: "POST", body: payload });
export const generateResume = (payload) => req("/api/generate-resume", { method: "POST", body: payload });
export const approveResume = (payload) => req("/api/approve-resume", { method: "POST", body: payload });
export const interviewPrep = (payload) => req("/api/interview-prep", { method: "POST", body: payload });

// ---- application memory ----
export const overview = () => req("/api/applications/overview");
export const listStatuses = () => req("/api/applications/statuses");
export const listApplications = (filters = {}) => req(`/api/applications${qs(filters)}`);
export const getApplication = (id) => req(`/api/applications/${id}`);
export const createApplication = (body) => req("/api/applications", { method: "POST", body });
export const updateApplication = (id, body) => req(`/api/applications/${id}`, { method: "PATCH", body });
export const deleteApplication = (id) => req(`/api/applications/${id}`, { method: "DELETE" });

// ---- stored resume versions ----
export const searchResumes = async (company = "") => {
  const rows = (await req(`/api/search-resumes${qs({ company })}`)) || [];
  return rows.map((r) => ({
    id: r.id,
    applicationId: r.application_id,
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

// ---- recruiter ----
export const listRequisitions = () => req("/api/requisitions");
export const createRequisition = (body) => req("/api/requisitions", { method: "POST", body });
export const getRequisition = (id) => req(`/api/requisitions/${id}`);
export const updateRequisition = (id, body) => req(`/api/requisitions/${id}`, { method: "PATCH", body });
export const deleteRequisition = (id) => req(`/api/requisitions/${id}`, { method: "DELETE" });
export const addCandidates = (id, candidates) => req(`/api/requisitions/${id}/candidates`, { method: "POST", body: { candidates } });
export const rescore = (id) => req(`/api/requisitions/${id}/rescore`, { method: "POST", body: {} });
export const decideCandidate = (id, candidateId, decision) =>
  req(`/api/requisitions/${id}/candidates/${candidateId}`, { method: "PATCH", body: { decision } });
