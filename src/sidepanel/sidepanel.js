// Side panel entry point: theme, router, auth, and boot logic.
// Each screen is a <section data-screen="NAME"> toggled via `hidden`.

import { getProfile, getTheme, setTheme, getSession, clearSession } from "../lib/store.js";
import { renderAuth, renderOnboarding, renderExtract, revealNav } from "../ui/screens.js";

const SCREENS = ["auth", "onboarding", "extract", "review", "history"];

export function showScreen(name) {
  for (const s of SCREENS) {
    const elm = document.querySelector(`[data-screen="${s}"].screen`);
    if (elm) elm.hidden = s !== name;
  }
  document.body.dataset.screen = name;
}

// ---- theme ----
const THEMES = ["system", "light", "dark"];
const THEME_SVG = {
  system: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>`,
  light: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`,
  dark: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`
};

function applyTheme(theme) {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  const btn = document.getElementById("theme-toggle");
  if (btn) btn.innerHTML = THEME_SVG[theme];
}

async function initTheme() {
  const current = await getTheme();
  applyTheme(current);
  document.getElementById("theme-toggle")?.addEventListener("click", async () => {
    const now = await getTheme();
    const next = THEMES[(THEMES.indexOf(now) + 1) % THEMES.length];
    await setTheme(next);
    applyTheme(next);
  });
}

// ---- auth-aware chrome (logout button) ----
function setLoggedInChrome(on) {
  const logout = document.getElementById("logout");
  if (logout) logout.hidden = !on;
}

// Called after a successful login/signup: decide onboarding vs main app.
export async function afterLogin() {
  setLoggedInChrome(true);
  const profile = await getProfile();
  if (!profile) {
    renderOnboarding();
    showScreen("onboarding");
  } else {
    renderExtract();
    showScreen("extract");
    revealNav();
  }
}

function initLogout() {
  document.getElementById("logout")?.addEventListener("click", async () => {
    await clearSession();
    setLoggedInChrome(false);
    document.getElementById("nav-new").hidden = true;
    document.getElementById("nav-history").hidden = true;
    renderAuth();
    showScreen("auth");
  });
}

// ---- boot ----
async function init() {
  await initTheme();
  initLogout();
  const session = await getSession();
  if (!session?.accessToken) {
    setLoggedInChrome(false);
    renderAuth();
    showScreen("auth");
  } else {
    await afterLogin();
  }
}

document.addEventListener("DOMContentLoaded", init);
