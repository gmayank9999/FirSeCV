import * as api from "../lib/api.js";
import {
  el, toast, spinnerButton, atsRing, criterionList, modal, confirmModal,
  formatDate, relativeTime, plural, scoreBadge,
} from "../lib/ui.js";
import { refresh, navigate } from "../app.js";

// The recruiter side. Two commitments run through this screen:
//
//   1. The rubric is visible and editable BEFORE anyone is screened by it.
//      Discovery found shortlisting criteria "live in a reviewer's head"; the
//      fix is to make them an artifact you can argue with.
//   2. Human decisions are recorded as human decisions, so the gap between the
//      ranking and the actual shortlist is measurable rather than assumed.

// ================================================================ list view

export async function renderRequisitions(mount) {
  const reqs = await api.listRequisitions();

  mount.replaceChildren(el("div", { class: "page" }, [
    el("div", { class: "row row--between row--wrap" }, [
      el("div", { class: "stack stack--tight" }, [
        el("h1", { class: "title" }, "Requisitions"),
        el("p", { class: "subtitle" },
          "Open a role, agree the scoring rubric, then screen a batch of resumes against it consistently."),
      ]),
      el("button", { class: "btn btn--primary", onclick: () => newRequisitionModal() }, "New requisition"),
    ]),

    reqs.length
      ? el("div", { class: "rows" }, reqs.map((r) => el("div", {
          class: "rows__item",
          onclick: () => { location.hash = `#/recruiter/${r.id}`; },
        }, [
          el("div", { class: "stack stack--tight" }, [
            el("strong", { class: "truncate" }, r.title),
            el("span", { class: "subtitle truncate" }, r.company || "—"),
          ]),
          el("span", { class: "subtitle truncate" }, `${plural(r.rubric?.criteria?.length || 0, "criterion", "criteria")} · ${r.domain}`),
          el("span", { class: `badge ${r.status === "open" ? "status status--offer" : ""}` }, r.status),
          el("span", { class: "subtitle" }, relativeTime(r.createdAt)),
        ])))
      : el("div", { class: "empty" }, [
          el("p", {}, "No requisitions yet."),
          el("p", { class: "subtitle" },
            "Paste a job description and JOZY drafts the weighted rubric for it — then you adjust the weights before screening anyone."),
        ]),
  ]));
}

function newRequisitionModal() {
  const title = el("input", { class: "input", placeholder: "e.g. Associate — Corporate Law" });
  const company = el("input", { class: "input", placeholder: "Company" });
  const jd = el("textarea", { class: "textarea", rows: "9", placeholder: "Paste the job description — the rubric is drafted from this." });
  const create = el("button", { class: "btn btn--primary" }, "Draft the rubric");

  const close = modal("New requisition", el("div", { class: "stack" }, [
    el("div", { class: "grid grid--split" }, [
      el("div", { class: "field" }, [el("label", {}, "Role title"), title]),
      el("div", { class: "field" }, [el("label", {}, "Company"), company]),
    ]),
    el("div", { class: "field" }, [el("label", {}, "Job description"), jd]),
    el("p", { class: "subtitle" },
      "JOZY drafts weighted criteria from the posting. Nothing is screened until you have reviewed them."),
  ]), { wide: true, actions: [el("button", { class: "btn", onclick: () => close() }, "Cancel"), create] });

  create.addEventListener("click", async () => {
    if (!title.value.trim() && !jd.value.trim()) return toast("Add a title or a job description", "error");
    spinnerButton(create, true);
    try {
      const req = await api.createRequisition({
        title: title.value.trim(), company: company.value.trim(), jdText: jd.value.trim(),
      });
      close();
      navigate(`#/recruiter/${req.id}`);
    } catch (err) {
      toast(err.message, "error");
      spinnerButton(create, false);
    }
  });

  title.focus();
}

// ============================================================== detail view

export async function renderRequisitionDetail(mount, [id]) {
  const data = await api.getRequisition(id);
  if (!data) {
    mount.replaceChildren(el("div", { class: "page" }, [
      el("h1", { class: "title" }, "Requisition not found"),
      el("a", { class: "btn", href: "#/recruiter" }, "Back to requisitions"),
    ]));
    return;
  }

  const { requisition: req, candidates, summary } = data;

  mount.replaceChildren(el("div", { class: "page page--wide" }, [
    el("a", { class: "link-btn", href: "#/recruiter" }, "← All requisitions"),

    el("div", { class: "row row--between row--wrap" }, [
      el("div", { class: "stack stack--tight" }, [
        el("h1", { class: "title" }, req.title),
        el("p", { class: "subtitle" },
          [req.company, `${req.domain} role`, `opened ${formatDate(req.createdAt)}`].filter(Boolean).join(" · ")),
      ]),
      el("div", { class: "row" }, [
        el("button", { class: "btn", onclick: () => addCandidatesModal(req.id) }, "Add resumes"),
        el("button", {
          class: "btn btn--danger",
          onclick: async () => {
            if (!(await confirmModal("Delete this requisition?",
              `"${req.title}" and its ${plural(summary.total, "candidate")} will be removed.`))) return;
            await api.deleteRequisition(req.id);
            toast("Requisition deleted");
            navigate("#/recruiter");
          },
        }, "Delete"),
      ]),
    ]),

    summaryCard(summary),
    rubricEditor(req),
    shortlistCard(req, candidates),
  ]));
}

function summaryCard(s) {
  return el("div", { class: "grid grid--4" }, [
    statTile(String(s.total), "Resumes screened"),
    statTile(String(s.shortlisted), "Shortlisted", s.pending ? `${s.pending} still undecided` : "All reviewed"),
    statTile(s.medianScore === null ? "—" : String(s.medianScore), "Median score", s.topScore === null ? null : `top ${s.topScore}`),
    statTile(
      s.rubricAgreement === null ? "—" : `${s.rubricAgreement}%`,
      "Rubric agrees with you",
      s.rubricAgreement === null
        ? "Needs 2+ decisions"
        : `across ${plural(s.humanDecisions, "call")}`),
  ]);
}

function statTile(num, label, hint) {
  return el("div", { class: "card card--flat" }, [
    el("div", { class: "stat" }, [
      el("div", { class: "stat__num" }, num),
      el("div", { class: "stat__label" }, label),
      hint ? el("div", { class: "stat__hint" }, hint) : null,
    ].filter(Boolean)),
  ]);
}

// ---------------------------------------------------------- rubric editing

function rubricEditor(req) {
  // Work on a copy so an abandoned edit never touches stored scores.
  const draft = JSON.parse(JSON.stringify(req.rubric));
  const body = el("div", { class: "stack" });
  const save = el("button", { class: "btn btn--primary" }, "Save weights & re-score everyone");

  const total = () => draft.criteria.reduce((n, c) => n + (Number(c.weight) || 0), 0);

  function drawRows() {
    body.replaceChildren(...draft.criteria.map((c, i) => {
      const weight = el("input", { class: "input input--sm", type: "number", min: "1", max: "100", value: c.weight, style: "width:70px" });
      weight.addEventListener("input", () => { c.weight = Number(weight.value) || 1; drawTotal(); });

      const label = el("input", { class: "input input--sm", value: c.label });
      label.addEventListener("input", () => { c.label = label.value; });

      const terms = el("input", { class: "input input--sm", value: (c.terms || []).join(", "), placeholder: "words that evidence this" });
      terms.addEventListener("input", () => { c.terms = terms.value.split(",").map((t) => t.trim()).filter(Boolean); });

      const must = el("input", { type: "checkbox", checked: c.mustHave });
      must.addEventListener("change", () => { c.mustHave = must.checked; });

      return el("div", { class: "card card--flat card--pad-sm" }, [
        el("div", { class: "row row--wrap" }, [
          el("div", { class: "grow" }, [label]),
          weight,
          el("label", { class: "row subtitle", style: "gap:4px;white-space:nowrap" }, [must, "must have"]),
          el("button", {
            class: "btn btn--sm btn--danger",
            onclick: () => { draft.criteria.splice(i, 1); drawRows(); drawTotal(); },
            title: "Remove criterion",
          }, "×"),
        ]),
        terms,
      ]);
    }));
  }

  const totalLine = el("span", { class: "subtitle" });
  function drawTotal() {
    const t = total();
    totalLine.textContent = t === 100
      ? "Weights total 100."
      : `Weights total ${t} — they'll be rescaled to 100 on save, keeping these proportions.`;
  }

  save.addEventListener("click", async () => {
    if (!draft.criteria.length) return toast("A rubric needs at least one criterion", "error");
    spinnerButton(save, true);
    try {
      await api.updateRequisition(req.id, { rubric: draft });
      toast("Rubric saved — every candidate re-scored", "success");
      await refresh();
    } catch (err) {
      toast(err.message, "error");
      spinnerButton(save, false);
    }
  });

  drawRows();
  drawTotal();

  return el("div", { class: "card" }, [
    el("div", { class: "row row--between row--wrap" }, [
      el("div", { class: "stack stack--tight" }, [
        el("h2", { class: "title title--sm" }, "Scoring rubric"),
        el("p", { class: "subtitle" },
          "This is the whole basis of the shortlist. Change it and every candidate is re-scored, so the ranking " +
          "always matches the criteria on screen."),
      ]),
      el("button", {
        class: "btn btn--sm",
        onclick: () => {
          draft.criteria.push({ id: "c" + (draft.criteria.length + 1), label: "New criterion", kind: "skill", weight: 10, terms: [], mustHave: false });
          drawRows(); drawTotal();
        },
      }, "Add criterion"),
    ]),
    body,
    el("div", { class: "row row--between row--wrap" }, [totalLine, save]),
  ]);
}

// --------------------------------------------------------------- shortlist

function shortlistCard(req, candidates) {
  if (!candidates.length) {
    return el("div", { class: "card" }, [
      el("h2", { class: "title title--sm" }, "Candidates"),
      el("div", { class: "empty" }, [
        el("p", {}, "No resumes screened yet."),
        el("button", { class: "btn btn--primary", onclick: () => addCandidatesModal(req.id) }, "Add resumes"),
      ]),
    ]);
  }

  return el("div", { class: "card" }, [
    el("div", { class: "row row--between row--wrap" }, [
      el("h2", { class: "title title--sm" }, `Shortlist · ${plural(candidates.length, "candidate")}`),
      el("span", { class: "subtitle" }, "Ranked by the rubric above. You decide."),
    ]),
    el("div", { class: "rows" }, candidates.map((c, i) => candidateRow(req, c, i + 1))),
  ]);
}

function candidateRow(req, c, rank) {
  const decide = async (decision, btn) => {
    spinnerButton(btn, true);
    try {
      await api.decideCandidate(req.id, c.id, decision);
      await refresh();
    } catch (err) {
      toast(err.message, "error");
      spinnerButton(btn, false);
    }
  };

  const shortlistBtn = el("button", { class: `btn btn--sm ${c.decision === "shortlist" ? "btn--primary" : "btn--success"}` },
    c.decision === "shortlist" ? "Shortlisted" : "Shortlist");
  shortlistBtn.addEventListener("click", (e) => { e.stopPropagation(); decide("shortlist", shortlistBtn); });

  const rejectBtn = el("button", { class: `btn btn--sm ${c.decision === "reject" ? "btn--primary" : "btn--danger"}` },
    c.decision === "reject" ? "Rejected" : "Reject");
  rejectBtn.addEventListener("click", (e) => { e.stopPropagation(); decide("reject", rejectBtn); });

  const gaps = c.breakdown?.mustHaveGaps || [];

  return el("div", {
    class: `rows__item ${gaps.length ? "is-flagged" : ""}`,
    onclick: () => candidateModal(c),
  }, [
    el("div", { class: "stack stack--tight" }, [
      el("strong", { class: "truncate" }, `${rank}. ${c.name}`),
      el("span", { class: "subtitle truncate" }, c.email || "no email found"),
    ]),
    el("span", { class: "subtitle truncate" },
      gaps.length ? `Missing: ${gaps.join(", ")}` : `${c.breakdown?.criteria?.filter((x) => x.matched).length || 0} criteria evidenced`),
    scoreBadge(c.score, "Score"),
    el("div", { class: "row" }, [shortlistBtn, rejectBtn]),
  ]);
}

function candidateModal(c) {
  modal(c.name, el("div", { class: "stack" }, [
    el("div", { class: "row" }, [
      atsRing(c.score, 68, "Score"),
      el("div", { class: "stack stack--tight" }, [
        el("span", { class: "subtitle" }, c.email || "no email found"),
        el("span", { class: "subtitle" }, `Added ${relativeTime(c.createdAt)} · ${c.decision}${c.decidedBy === "human" ? " (your call)" : ""}`),
      ]),
    ]),
    el("div", { class: "section-label" }, "Why this score"),
    criterionList(c.breakdown?.criteria || []),
    el("details", {}, [
      el("summary", { class: "link-btn", style: "cursor:pointer" }, "The resume as submitted"),
      el("p", { class: "subtitle", style: "white-space:pre-wrap;margin-top:10px" }, c.resumeText),
    ]),
  ]), { wide: true });
}

// ------------------------------------------------------------ adding resumes

/**
 * Resumes arrive as text, one per box or split from a single paste. A file
 * picker is offered for plain-text and markdown files; PDFs are not parsed in
 * the browser, so the honest instruction is to paste their text.
 */
function addCandidatesModal(reqId) {
  const boxes = el("div", { class: "stack" });
  const rows = [];

  function addRow(prefill = "") {
    const name = el("input", { class: "input input--sm", placeholder: "Name (optional — read from the resume if blank)" });
    const text = el("textarea", { class: "textarea", rows: "5", placeholder: "Paste the resume text…" }, prefill);
    const row = { name, text };
    rows.push(row);
    boxes.appendChild(el("div", { class: "card card--flat card--pad-sm" }, [
      el("div", { class: "row" }, [
        el("div", { class: "grow" }, [name]),
        el("button", {
          class: "btn btn--sm btn--danger",
          onclick: (e) => { e.currentTarget.closest(".card").remove(); row.removed = true; },
        }, "×"),
      ]),
      text,
    ]));
  }

  const file = el("input", { type: "file", accept: ".txt,.md,text/plain", multiple: true, style: "display:none" });
  file.addEventListener("change", async () => {
    for (const f of file.files) addRow(await f.text());
    toast(`Loaded ${plural(file.files.length, "file")}`, "success");
  });

  const save = el("button", { class: "btn btn--primary" }, "Screen these resumes");

  const close = modal("Add resumes", el("div", { class: "stack" }, [
    el("p", { class: "subtitle" },
      "Each resume is scored against this requisition's rubric the moment it lands. " +
      "Paste the text — PDFs aren't read in the browser."),
    boxes,
    el("div", { class: "row" }, [
      el("button", { class: "btn btn--sm", onclick: () => addRow() }, "Add another"),
      el("button", { class: "btn btn--sm", onclick: () => file.click() }, "Load .txt files"),
      file,
    ]),
  ]), { wide: true, actions: [el("button", { class: "btn", onclick: () => close() }, "Cancel"), save] });

  save.addEventListener("click", async () => {
    const payload = rows
      .filter((r) => !r.removed && r.text.value.trim())
      .map((r) => ({ name: r.name.value.trim(), resumeText: r.text.value.trim() }));
    if (!payload.length) return toast("Paste at least one resume", "error");

    spinnerButton(save, true);
    try {
      await api.addCandidates(reqId, payload);
      close();
      toast(`Screened ${plural(payload.length, "resume")}`, "success");
      await refresh();
    } catch (err) {
      toast(err.message, "error");
      spinnerButton(save, false);
    }
  });

  addRow();
}
