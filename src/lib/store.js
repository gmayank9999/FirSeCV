// Durable + in-memory state for the side panel.
// Durable bits live in chrome.storage.local; the UI reads/writes only through here.

const S = chrome.storage.local;
const get = (k) => new Promise((r) => S.get(k, (v) => r(v[k])));
const set = (k, val) => new Promise((r) => S.set({ [k]: val }, () => r(val)));

// In-memory scratch state for the current flow (not persisted).
export const store = {
  profile: null,
  currentJd: null, // { company, position, jdText }
  currentResume: null, // { structuredContent, atsScore, atsBreakdown }
  screen: "extract",
};

// ---- master profile ----
export const getProfile = () => get("masterProfile").then((v) => v ?? null);
export const setProfile = (p) => set("masterProfile", p).then((v) => (store.profile = v));

// ---- application history (newest first) ----
export const getHistory = () => get("resumeHistory").then((v) => v ?? []);
export const addHistory = async (row) => {
  const list = await getHistory();
  list.unshift(row);
  await set("resumeHistory", list);
  return list;
};

// ---- theme ("light" | "dark" | "system") ----
export const getTheme = () => get("theme").then((v) => v ?? "system");
export const setTheme = (t) => set("theme", t);

// ---- auth session ({ accessToken, user: { id, email } }) ----
export const getSession = () => get("session").then((v) => v ?? null);
export const setSession = (s) => set("session", s);
export const clearSession = () =>
  new Promise((r) => S.remove(["session", "masterProfile", "resumeHistory"], r));
