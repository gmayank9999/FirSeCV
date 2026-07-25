// Side panel entry point: theme, router, and boot logic.
// Each screen is a <section data-screen="NAME"> toggled via `hidden`.

import { getProfile, getTheme, setTheme } from "../lib/store.js";
import { renderOnboarding, renderExtract, revealNav } from "../ui/screens.js";

const SCREENS = ["onboarding", "extract", "review", "history"];

export function showScreen(name) {
  for (const s of SCREENS) {
    const elm = document.querySelector(`[data-screen="${s}"].screen`);
    if (elm) elm.hidden = s !== name;
  }
  document.body.dataset.screen = name;
}

// ---- theme ----
const THEMES = ["system", "light", "dark"];
const THEME_ICON = { system: "◐", light: "☀", dark: "☾" };

function applyTheme(theme) {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  const btn = document.getElementById("theme-toggle");
  if (btn) btn.textContent = THEME_ICON[theme];
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

// ---- boot ----
async function init() {
  await initTheme();
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

document.addEventListener("DOMContentLoaded", init);
