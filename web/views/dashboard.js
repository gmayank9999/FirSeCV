import * as api from "../lib/api.js";
import { el, statusPill, relativeTime, plural } from "../lib/ui.js";
import { logApplicationModal } from "./applications.js";

// The dashboard leads with follow-ups rather than with a "tailor a resume"
// button on purpose. Discovery was blunt about it: the pain people described
// was not the 30 minutes of tailoring, it was the reply that arrives 19-24
// weeks later against a memory that has already failed. So the first thing the
// product shows you is what you are about to forget.

const STATUS_LABELS = {
  saved: "Saved", applied: "Applied", screening: "In screening",
  interview: "Interviewing", offer: "Offer", rejected: "Rejected", withdrawn: "Withdrawn",
};

export async function renderDashboard(mount) {
  const o = await api.overview();

  const page = el("div", { class: "page" }, [
    el("div", { class: "row row--between row--wrap" }, [
      el("div", { class: "stack stack--tight" }, [
        el("h1", { class: "title" }, "Your job search"),
        el("p", { class: "subtitle" }, o.total
          ? `${plural(o.total, "application")} remembered — searchable, with the exact resume you sent.`
          : "Nothing tracked yet. Log your first application to start building memory."),
      ]),
      el("div", { class: "row" }, [
        el("button", { class: "btn", onclick: () => logApplicationModal() }, "Log an application"),
        el("a", { class: "btn btn--primary", href: "#/match" }, "Match a role"),
      ]),
    ]),

    o.total === 0 ? emptyState() : null,
    o.total > 0 ? funnelCard(o) : null,
    o.followUpCount > 0 ? followUpCard(o) : null,
    o.total > 0 ? pipelineCard(o) : null,
    o.longestWait ? longestWaitCard(o.longestWait) : null,
    o.recent.length ? recentCard(o.recent) : null,
  ].filter(Boolean));

  mount.replaceChildren(page);
}

function emptyState() {
  return el("div", { class: "card" }, [
    el("h2", { class: "title title--sm" }, "Start with what you have already sent"),
    el("p", { class: "subtitle" },
      "JOZY is most useful when it remembers applications you made before you had it. Log a few from " +
      "the last couple of months — company, role, roughly when — and the follow-up tracking starts working immediately."),
    el("div", { class: "row row--wrap" }, [
      el("button", { class: "btn btn--primary", onclick: () => logApplicationModal() }, "Log an application"),
      el("a", { class: "btn", href: "#/match" }, "Check a resume against a job description"),
      el("a", { class: "btn", href: "#/profile" }, "Set up your master profile"),
    ]),
  ]);
}

function funnelCard(o) {
  const { applied, callbacks, offers, callbackRate } = o.funnel;
  return el("div", { class: "grid grid--4" }, [
    stat(String(applied), "Applications sent", null),
    stat(String(callbacks), "Reached a callback", callbackRate ? `${callbackRate}% of applications` : null),
    stat(String(offers), "Offers", null),
    stat(String(o.followUpCount), "Need chasing", o.followUpCount ? "See below" : "All current", o.followUpCount ? "var(--amber)" : null),
  ]);
}

function stat(num, label, hint, color) {
  return el("div", { class: "card card--flat" }, [
    el("div", { class: "stat" }, [
      el("div", { class: "stat__num", style: color ? `color:${color}` : null }, num),
      el("div", { class: "stat__label" }, label),
      hint ? el("div", { class: "stat__hint" }, hint) : null,
    ]),
  ]);
}

function followUpCard(o) {
  return el("div", { class: "card card--warn" }, [
    el("div", { class: "row row--between" }, [
      el("h2", { class: "title title--sm" }, `${plural(o.followUpCount, "application")} waiting on you`),
      el("a", { class: "link-btn", href: "#/applications?flagged=1" }, "See all"),
    ]),
    el("div", { class: "rows" }, o.followUps.slice(0, 6).map((a) =>
      el("div", {
        class: "rows__item is-flagged",
        onclick: () => { location.hash = `#/applications/${a.id}`; },
      }, [
        el("div", { class: "stack stack--tight" }, [
          el("strong", { class: "truncate" }, a.company),
          el("span", { class: "subtitle truncate" }, a.position),
        ]),
        el("span", { class: "subtitle truncate" }, a.followUpReason),
        statusPill(a.status, STATUS_LABELS[a.status]),
        el("span", { class: "subtitle" }, relativeTime(a.updatedAt || a.appliedAt)),
      ]))),
  ]);
}

function pipelineCard(o) {
  const order = ["saved", "applied", "screening", "interview", "offer", "rejected"];
  const present = order.filter((s) => o.byStatus[s]);
  return el("div", { class: "card" }, [
    el("div", { class: "section-label" }, "Pipeline"),
    el("div", { class: "row row--wrap" }, present.map((s) =>
      el("a", {
        class: "chip",
        href: `#/applications?status=${s}`,
        style: "text-decoration:none",
      }, `${STATUS_LABELS[s]} · ${o.byStatus[s]}`))),
  ]);
}

function longestWaitCard(a) {
  return el("div", { class: "card" }, [
    el("div", { class: "section-label" }, "Longest open wait"),
    el("div", { class: "row row--between row--wrap" }, [
      el("div", { class: "stack stack--tight" }, [
        el("strong", {}, `${a.position} · ${a.company}`),
        el("span", { class: "subtitle" },
          `Applied ${relativeTime(a.appliedAt)} — still ${STATUS_LABELS[a.status].toLowerCase()}.`),
      ]),
      el("a", { class: "btn btn--sm", href: `#/applications/${a.id}` }, "Open"),
    ]),
    el("p", { class: "subtitle" },
      "Replies of 19–24 weeks are normal. This entry keeps the job description and the exact resume you sent, " +
      "so a callback months from now doesn't catch you cold."),
  ]);
}

function recentCard(recent) {
  return el("div", { class: "card" }, [
    el("div", { class: "row row--between" }, [
      el("div", { class: "section-label" }, "Recently logged"),
      el("a", { class: "link-btn", href: "#/applications" }, "All applications"),
    ]),
    el("div", { class: "rows" }, recent.map((a) =>
      el("div", {
        class: "rows__item",
        onclick: () => { location.hash = `#/applications/${a.id}`; },
      }, [
        el("div", { class: "stack stack--tight" }, [
          el("strong", { class: "truncate" }, a.company),
          el("span", { class: "subtitle truncate" }, a.position),
        ]),
        el("span", { class: "subtitle truncate" }, a.domain !== "general" ? a.domain : ""),
        statusPill(a.status, STATUS_LABELS[a.status]),
        el("span", { class: "subtitle" }, relativeTime(a.appliedAt)),
      ]))),
  ]);
}
