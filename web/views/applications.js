import * as api from "../lib/api.js";
import {
  el, toast, statusPill, relativeTime, formatDate, plural, spinnerButton,
  modal, confirmModal, scoreBadge, criterionList, resumePaper, chips,
} from "../lib/ui.js";
import { refresh, refreshFollowUpBadge, navigate } from "../app.js";

const STATUS_LABELS = {
  saved: "Saved", applied: "Applied", screening: "In screening",
  interview: "Interviewing", offer: "Offer", rejected: "Rejected", withdrawn: "Withdrawn",
};
const STATUS_ORDER = Object.keys(STATUS_LABELS);

// Read filters out of the hash so a filtered view is a shareable, reloadable URL.
function hashQuery() {
  const q = (location.hash.split("?")[1] || "");
  return Object.fromEntries(new URLSearchParams(q));
}

// ==================================================================== list

let searchTimer = null;

export async function renderApplications(mount) {
  const filters = hashQuery();
  const [all, statuses] = await Promise.all([
    api.listApplications({ q: filters.q || "", status: filters.status || "" }),
    api.listStatuses(),
  ]);

  const rows = filters.flagged ? all.filter((a) => a.needsFollowUp) : all;

  const search = el("input", {
    class: "input",
    type: "search",
    placeholder: "Search company, role or your notes…",
    value: filters.q || "",
  });
  search.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => setFilters({ ...filters, q: search.value.trim() || undefined }), 260);
  });

  const statusSelect = el("select", { class: "select", style: "max-width:180px" }, [
    el("option", { value: "" }, "All statuses"),
    ...statuses.map((s) => el("option", { value: s.id, selected: filters.status === s.id }, s.label)),
  ]);
  statusSelect.addEventListener("change", () =>
    setFilters({ ...filters, status: statusSelect.value || undefined }));

  const flagged = el("button", {
    class: `btn ${filters.flagged ? "btn--primary" : ""}`,
    onclick: () => setFilters({ ...filters, flagged: filters.flagged ? undefined : "1" }),
  }, "Needs chasing");

  mount.replaceChildren(el("div", { class: "page" }, [
    el("div", { class: "row row--between row--wrap" }, [
      el("div", { class: "stack stack--tight" }, [
        el("h1", { class: "title" }, "Applications"),
        el("p", { class: "subtitle" }, "Every role you applied to, whichever tool you used to apply."),
      ]),
      el("button", { class: "btn btn--primary", onclick: () => logApplicationModal() }, "Log an application"),
    ]),

    el("div", { class: "row row--wrap" }, [
      el("div", { class: "grow" }, [search]),
      statusSelect,
      flagged,
    ]),

    rows.length
      ? el("div", { class: "rows" }, rows.map(applicationRow))
      : el("div", { class: "empty" }, [
          el("p", {}, all.length
            ? "No applications match these filters."
            : "No applications yet — log one and JOZY starts remembering it for you."),
        ]),

    rows.length ? el("p", { class: "subtitle" }, `${plural(rows.length, "application")} shown.`) : null,
  ].filter(Boolean)));
}

function setFilters(filters) {
  const q = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
  navigate(`#/applications${q ? "?" + q : ""}`);
}

function applicationRow(a) {
  return el("div", {
    class: `rows__item ${a.needsFollowUp ? "is-flagged" : ""}`,
    onclick: () => { location.hash = `#/applications/${a.id}`; },
  }, [
    el("div", { class: "stack stack--tight" }, [
      el("strong", { class: "truncate" }, a.company),
      el("span", { class: "subtitle truncate" }, a.position),
    ]),
    el("span", { class: "subtitle truncate" },
      a.needsFollowUp ? a.followUpReason : (a.domain !== "general" ? a.domain : "")),
    statusPill(a.status, STATUS_LABELS[a.status]),
    el("span", { class: "subtitle" }, relativeTime(a.appliedAt)),
  ]);
}

// ================================================================== detail

export async function renderApplicationDetail(mount, [id]) {
  const app = await api.getApplication(id);
  if (!app) {
    mount.replaceChildren(el("div", { class: "page" }, [
      el("h1", { class: "title" }, "Application not found"),
      el("a", { class: "btn", href: "#/applications" }, "Back to applications"),
    ]));
    return;
  }

  // The resume that was actually sent - the answer to "what did I send them?"
  const versions = await api.searchResumes(app.company).catch(() => []);
  const sent = versions.find((v) => v.applicationId === app.id)
    || versions.find((v) => v.position === app.position)
    || null;

  mount.replaceChildren(el("div", { class: "page" }, [
    el("a", { class: "link-btn", href: "#/applications" }, "← All applications"),

    el("div", { class: "row row--between row--wrap" }, [
      el("div", { class: "stack stack--tight" }, [
        el("h1", { class: "title" }, app.position),
        el("p", { class: "subtitle" }, [
          app.company,
          `applied ${formatDate(app.appliedAt)}`,
          `${relativeTime(app.appliedAt)}`,
        ].filter(Boolean).join(" · ")),
      ]),
      el("div", { class: "row" }, [
        statusPill(app.status, STATUS_LABELS[app.status]),
        sent ? scoreBadge(sent.atsScore) : null,
      ].filter(Boolean)),
    ]),

    app.needsFollowUp ? el("div", { class: "card card--warn" }, [
      el("strong", {}, "Worth chasing"),
      el("p", { class: "subtitle" }, app.followUpReason),
    ]) : null,

    statusCard(app),
    detailsCard(app),
    sent ? sentResumeCard(sent) : noResumeCard(app),
    app.jdText ? jdCard(app) : null,
    timelineCard(app),

    el("div", { class: "row" }, [
      el("button", {
        class: "btn btn--danger",
        onclick: async () => {
          if (!(await confirmModal("Delete this application?",
            `"${app.position} at ${app.company}" and its timeline will be removed. The stored resume file is kept.`))) return;
          await api.deleteApplication(app.id);
          toast("Application deleted");
          refreshFollowUpBadge();
          navigate("#/applications");
        },
      }, "Delete application"),
    ]),
  ].filter(Boolean)));
}

function statusCard(app) {
  const buttons = STATUS_ORDER.map((s) => el("button", {
    class: `btn btn--sm ${s === app.status ? "btn--primary" : ""}`,
    onclick: async (e) => {
      if (s === app.status) return;
      spinnerButton(e.currentTarget, true);
      try {
        await api.updateApplication(app.id, { status: s });
        toast(`Moved to ${STATUS_LABELS[s]}`, "success");
        refreshFollowUpBadge();
        await refresh();
      } catch (err) {
        toast(err.message, "error");
        spinnerButton(e.currentTarget, false);
      }
    },
  }, STATUS_LABELS[s]));

  return el("div", { class: "card" }, [
    el("div", { class: "section-label" }, "Where it stands"),
    el("div", { class: "row row--wrap" }, buttons),
    el("hr", { class: "divider" }),
    followUpEditor(app),
  ]);
}

function followUpEditor(app) {
  const action = el("input", { class: "input", placeholder: "e.g. Email the recruiter", value: app.nextAction || "" });
  const when = el("input", { class: "input", type: "date", value: app.nextActionAt || "", style: "max-width:180px" });
  const save = el("button", { class: "btn" }, "Set reminder");

  save.addEventListener("click", async () => {
    spinnerButton(save, true);
    try {
      await api.updateApplication(app.id, {
        nextAction: action.value.trim(),
        nextActionAt: when.value || null,
      });
      toast("Reminder saved", "success");
      refreshFollowUpBadge();
      await refresh();
    } catch (err) {
      toast(err.message, "error");
    } finally {
      spinnerButton(save, false);
    }
  });

  return el("div", { class: "stack stack--tight" }, [
    el("div", { class: "section-label" }, "Next action"),
    el("div", { class: "row row--wrap" }, [el("div", { class: "grow" }, [action]), when, save]),
  ]);
}

function detailsCard(app) {
  const notes = el("textarea", { class: "textarea", rows: "3", placeholder: "Referral, salary discussed, who you spoke to…" }, app.notes || "");
  const url = el("input", { class: "input", placeholder: "https://…", value: app.sourceUrl || "" });
  const save = el("button", { class: "btn" }, "Save");

  save.addEventListener("click", async () => {
    spinnerButton(save, true);
    try {
      await api.updateApplication(app.id, { notes: notes.value, sourceUrl: url.value.trim() });
      toast("Saved", "success");
      await refresh();
    } catch (err) {
      toast(err.message, "error");
    } finally {
      spinnerButton(save, false);
    }
  });

  return el("div", { class: "card" }, [
    el("div", { class: "section-label" }, "Your notes"),
    notes,
    el("div", { class: "field" }, [el("label", {}, "Job posting link"), url]),
    app.sourceUrl ? el("a", { class: "link-btn", href: app.sourceUrl, target: "_blank", rel: "noopener" }, "Open the original posting ↗") : null,
    el("div", { class: "row", style: "justify-content:flex-end" }, [save]),
  ].filter(Boolean));
}

function sentResumeCard(sent) {
  const breakdown = sent.atsBreakdown || {};
  return el("div", { class: "card" }, [
    el("div", { class: "row row--between row--wrap" }, [
      el("div", { class: "stack stack--tight" }, [
        el("div", { class: "section-label" }, "The resume you actually sent"),
        el("span", { class: "subtitle" }, `Approved ${formatDate(sent.appliedAt)}`),
      ]),
      el("div", { class: "row" }, [
        scoreBadge(sent.atsScore),
        sent.hasPdf && /^https?:/.test(sent.resumeUrl || "")
          ? el("a", { class: "btn btn--sm", href: sent.resumeUrl, target: "_blank", rel: "noopener" }, "Open PDF")
          : null,
        el("button", {
          class: "btn btn--sm",
          onclick: () => modal(`${sent.position} · ${sent.company}`, resumePaper(sent.structuredContent), { wide: true }),
        }, "Preview"),
      ].filter(Boolean)),
    ]),
    breakdown.criteria?.length
      ? el("details", {}, [
          el("summary", { class: "link-btn", style: "cursor:pointer" }, "Why it scored what it scored"),
          criterionList(breakdown.criteria),
        ])
      : breakdown.matched?.length
        ? el("div", { class: "stack stack--tight" }, [
            el("div", { class: "section-label" }, "Matched"),
            chips(breakdown.matched, "matched"),
            el("div", { class: "section-label" }, "Missing"),
            chips(breakdown.missing || [], "missing"),
          ])
        : null,
  ].filter(Boolean));
}

function noResumeCard(app) {
  return el("div", { class: "card" }, [
    el("div", { class: "section-label" }, "Resume"),
    el("p", { class: "subtitle" },
      "No resume from JOZY is linked to this application. If you sent one, note which version in your notes above — " +
      "or tailor one here next time so the exact file is kept with the record."),
    el("a", { class: "btn btn--sm", href: `#/match?applicationId=${app.id}` }, "Match a resume to this role"),
  ]);
}

function jdCard(app) {
  return el("div", { class: "card" }, [
    el("details", {}, [
      el("summary", { class: "link-btn", style: "cursor:pointer" }, "The job description as it was posted"),
      el("p", { class: "subtitle", style: "white-space:pre-wrap;margin-top:10px" }, app.jdText),
    ]),
  ]);
}

function timelineCard(app) {
  const items = [...(app.statusHistory || [])].reverse();
  return el("div", { class: "card" }, [
    el("div", { class: "section-label" }, "Timeline"),
    el("div", { class: "timeline" }, items.map((h) => el("div", { class: "timeline__item" }, [
      el("div", { class: "timeline__dot", style: h.status === "rejected" ? "background:var(--danger)" : h.status === "offer" ? "background:var(--success)" : null }),
      el("div", { class: "timeline__body" }, [
        el("strong", {}, STATUS_LABELS[h.status] || h.status),
        h.note ? el("span", { class: "subtitle" }, h.note) : null,
        el("span", { class: "timeline__when" }, `${formatDate(h.at)} · ${relativeTime(h.at)}`),
      ].filter(Boolean)),
    ]))),
  ]);
}

// =========================================================== log an application

/**
 * Logging is deliberately low-friction and does not require a job description,
 * a resume, or anything JOZY generated. Backfilling applications you made
 * before you had this tool is the fastest way to make it useful, so the form
 * accepts a date in the past and infers the rest.
 */
export function logApplicationModal(prefill = {}) {
  const company = el("input", { class: "input", placeholder: "Company", value: prefill.company || "" });
  const position = el("input", { class: "input", placeholder: "Role", value: prefill.position || "" });
  const when = el("input", { class: "input", type: "date", value: (prefill.appliedAt || new Date().toISOString()).slice(0, 10) });
  const status = el("select", { class: "select" }, STATUS_ORDER.map((s) =>
    el("option", { value: s, selected: (prefill.status || "applied") === s }, STATUS_LABELS[s])));
  const url = el("input", { class: "input", placeholder: "Link to the posting (optional)", value: prefill.sourceUrl || "" });
  const jd = el("textarea", { class: "textarea", rows: "4", placeholder: "Paste the job description (optional — but it's what lets JOZY score and re-check the role later)" }, prefill.jdText || "");
  const notes = el("textarea", { class: "textarea", rows: "2", placeholder: "Notes (optional)" });

  const save = el("button", { class: "btn btn--primary" }, "Log it");

  const close = modal("Log an application", el("div", { class: "stack" }, [
    el("div", { class: "grid grid--split" }, [
      el("div", { class: "field" }, [el("label", {}, "Company"), company]),
      el("div", { class: "field" }, [el("label", {}, "Role"), position]),
    ]),
    el("div", { class: "grid grid--split" }, [
      el("div", { class: "field" }, [el("label", {}, "When did you apply?"), when]),
      el("div", { class: "field" }, [el("label", {}, "Status"), status]),
    ]),
    el("div", { class: "field" }, [el("label", {}, "Posting link"), url]),
    el("div", { class: "field" }, [el("label", {}, "Job description"), jd]),
    el("div", { class: "field" }, [el("label", {}, "Notes"), notes]),
  ]), { actions: [el("button", { class: "btn", onclick: () => close() }, "Cancel"), save] });

  save.addEventListener("click", async () => {
    if (!company.value.trim() && !position.value.trim()) {
      return toast("Add at least a company or a role", "error");
    }
    spinnerButton(save, true);
    try {
      const created = await api.createApplication({
        company: company.value.trim(),
        position: position.value.trim(),
        // Keep the time-of-day so same-day entries stay in the order they were added.
        appliedAt: new Date(when.value || Date.now()).toISOString(),
        status: status.value,
        sourceUrl: url.value.trim(),
        jdText: jd.value.trim(),
        notes: notes.value.trim(),
      });
      close();
      toast("Logged — JOZY will remember it", "success");
      refreshFollowUpBadge();
      navigate(`#/applications/${created.id}`);
    } catch (err) {
      toast(err.message, "error");
      spinnerButton(save, false);
    }
  });

  company.focus();
}
