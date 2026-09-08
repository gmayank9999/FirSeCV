// App shell: theme, session, hash router.

import * as api from "./lib/api.js";
import { el, toast, skeleton } from "./lib/ui.js";
import { renderAuth } from "./views/auth.js";
import { renderDashboard } from "./views/dashboard.js";
import { renderApplications, renderApplicationDetail } from "./views/applications.js";
import { renderMatch } from "./views/match.js";
import { renderProfile } from "./views/profile.js";
import { renderRequisitions, renderRequisitionDetail } from "./views/recruiter.js";

const main = () => document.getElementById("main");

// route name -> (mount, params) => void
const ROUTES = {
  dashboard: renderDashboard,
  applications: renderApplications,
  application: renderApplicationDetail,
  match: renderMatch,
  profile: renderProfile,
  recruiter: renderRequisitions,
  requisition: renderRequisitionDetail,
};

// ------------------------------------------------------------------- theme

const THEMES = ["system", "light", "dark"];
const THEME_ICON = {
  system: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>`,
  light: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></svg>`,
  dark: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`,
};

function applyTheme(theme) {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  const btn = document.getElementById("theme-toggle");
  if (btn) btn.innerHTML = THEME_ICON[theme];
}

function initTheme() {
  applyTheme(localStorage.getItem("jozy.theme") || "system");
  document.getElementById("theme-toggle").addEventListener("click", () => {
    const now = localStorage.getItem("jozy.theme") || "system";
    const next = THEMES[(THEMES.indexOf(now) + 1) % THEMES.length];
    localStorage.setItem("jozy.theme", next);
    applyTheme(next);
  });
}

// ------------------------------------------------------------------ routing

/** "#/applications/app_123" -> { name: "application", params: ["app_123"] } */
function parseHash() {
  const raw = (location.hash || "#/dashboard").replace(/^#\/?/, "");
  const [head, ...params] = raw.split("/").filter(Boolean);
  if (!head) return { name: "dashboard", params: [] };
  // A detail route is the singular of its list route plus an id.
  if (head === "applications" && params[0]) return { name: "application", params };
  if (head === "recruiter" && params[0]) return { name: "requisition", params };
  return { name: ROUTES[head] ? head : "dashboard", params };
}

function markActiveNav(name) {
  const active = { application: "applications", requisition: "recruiter" }[name] || name;
  for (const link of document.querySelectorAll(".nav__link")) {
    link.classList.toggle("is-active", link.dataset.route === active);
  }
}

let renderToken = 0;

async function route() {
  const { name, params } = parseHash();
  markActiveNav(name);

  const mount = main();
  mount.replaceChildren(el("div", { class: "page" }, [skeleton(5)]));
  mount.scrollTop = 0;

  // Guard against a slow render landing after the user has navigated away.
  const token = ++renderToken;
  try {
    await ROUTES[name](mount, params);
  } catch (err) {
    if (token !== renderToken) return;
    console.error(err);
    mount.replaceChildren(el("div", { class: "page" }, [
      el("h1", { class: "title" }, "Something went wrong"),
      el("div", { class: "card" }, [
        el("p", {}, err.message || "Unexpected error."),
        el("div", { class: "row" }, [
          el("button", { class: "btn", onclick: () => route() }, "Try again"),
          el("a", { class: "btn", href: "#/dashboard" }, "Back to dashboard"),
        ]),
      ]),
    ]));
  }
}

/** Re-render the current route - views call this after they change data. */
export function refresh() {
  return route();
}

export function navigate(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

// --------------------------------------------------------------- follow-ups

/** Keep the sidebar badge honest about how many things need chasing. */
export async function refreshFollowUpBadge() {
  const badge = document.getElementById("followup-badge");
  if (!badge) return;
  try {
    const o = await api.overview();
    badge.textContent = String(o.followUpCount || 0);
    badge.hidden = !o.followUpCount;
  } catch {
    badge.hidden = true;
  }
}

// ------------------------------------------------------------------- session

export async function enterApp() {
  document.getElementById("boot").hidden = true;
  document.getElementById("auth").hidden = true;
  document.getElementById("app").hidden = false;

  const s = api.session.get();
  document.getElementById("user-email").textContent = s?.user?.email || "Demo mode";

  await route();
  refreshFollowUpBadge();
}

function showAuth() {
  document.getElementById("boot").hidden = true;
  document.getElementById("app").hidden = true;
  const host = document.getElementById("auth");
  host.hidden = false;
  renderAuth(host, enterApp);
}

function initLogout() {
  document.getElementById("logout").addEventListener("click", () => {
    api.session.clear();
    location.hash = "#/dashboard";
    showAuth();
  });
}

// ---------------------------------------------------------------------- boot

async function boot() {
  initTheme();
  initLogout();
  window.addEventListener("hashchange", route);

  // If the backend runs without Supabase it serves a shared demo user and never
  // requires a login - so don't put an auth wall in front of a server that has
  // no accounts to authenticate against.
  let authRequired = true;
  try {
    const h = await api.health();
    authRequired = Boolean(h?.integrations?.supabase);
  } catch {
    toast("Can't reach the JOZY backend. Start it with: cd backend && npm start", "error");
    authRequired = false;
  }

  if (!authRequired || api.session.get()?.accessToken) await enterApp();
  else showAuth();
}

boot();
