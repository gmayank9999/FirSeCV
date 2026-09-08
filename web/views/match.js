import * as api from "../lib/api.js";
import {
  el, toast, spinnerButton, atsRing, criterionList, resumePaper,
  skeleton, modal, plural,
} from "../lib/ui.js";
import { refreshFollowUpBadge, navigate } from "../app.js";

// "Not every application needs full tailoring, sometimes I just want it
// reviewed." That sentence from the interviews is the whole design of this
// screen: one job description, then an explicit choice of how much effort to
// spend on it. Neither path is the default, because neither is always right.

const state = {
  company: "",
  position: "",
  sourceUrl: "",
  jdText: "",
  applicationId: null,
  rubric: null,
  review: null,     // quick-review result
  tailored: null,   // full-tailor result
  refineLog: [],
};

function hashQuery() {
  return Object.fromEntries(new URLSearchParams(location.hash.split("?")[1] || ""));
}

export async function renderMatch(mount) {
  const q = hashQuery();
  // Arriving from an application: pre-fill from what we already remember.
  if (q.applicationId && q.applicationId !== state.applicationId) {
    const app = await api.getApplication(q.applicationId).catch(() => null);
    if (app) {
      Object.assign(state, {
        applicationId: app.id, company: app.company, position: app.position,
        jdText: app.jdText, sourceUrl: app.sourceUrl,
        rubric: null, review: null, tailored: null, refineLog: [],
      });
    }
  }
  draw(mount);
}

function draw(mount) {
  mount.replaceChildren(el("div", { class: "page" }, [
    el("div", { class: "stack stack--tight" }, [
      el("h1", { class: "title" }, "Match a role"),
      el("p", { class: "subtitle" },
        "Paste a job description. JOZY turns it into the weighted criteria a recruiter would actually screen " +
        "against — then you decide whether this one is worth a full rewrite or just a check."),
    ]),
    jdCard(mount),
    state.rubric ? rubricCard(mount) : null,
    state.review ? reviewCard(mount) : null,
    state.tailored ? tailoredCard(mount) : null,
  ].filter(Boolean)));
}

// ------------------------------------------------------------------ step 1

function jdCard(mount) {
  const company = el("input", { class: "input", placeholder: "Company", value: state.company });
  const position = el("input", { class: "input", placeholder: "Role", value: state.position });
  const jd = el("textarea", { class: "textarea", rows: "9", placeholder: "Paste the full job description here…" }, state.jdText);
  const analyse = el("button", { class: "btn btn--primary" }, state.rubric ? "Re-analyse" : "Analyse this role");

  for (const [input, key] of [[company, "company"], [position, "position"], [jd, "jdText"]]) {
    input.addEventListener("input", () => { state[key] = input.value; });
  }

  analyse.addEventListener("click", async () => {
    if (!jd.value.trim()) return toast("Paste a job description first", "error");
    spinnerButton(analyse, true);
    try {
      state.rubric = await api.getRubric(jd.value.trim());
      state.review = null;
      state.tailored = null;
      state.refineLog = [];
      draw(mount);
    } catch (err) {
      toast(err.message, "error");
    } finally {
      spinnerButton(analyse, false);
    }
  });

  return el("div", { class: "card" }, [
    el("div", { class: "grid grid--split" }, [
      el("div", { class: "field" }, [el("label", {}, "Company"), company]),
      el("div", { class: "field" }, [el("label", {}, "Role"), position]),
    ]),
    el("div", { class: "field" }, [el("label", {}, "Job description"), jd]),
    el("div", { class: "row", style: "justify-content:flex-end" }, [analyse]),
  ]);
}

// ------------------------------------------------------------------ step 2

function rubricCard(mount) {
  const { rubric } = state;
  const quick = el("button", { class: "btn btn--lg" }, "Quick review");
  const full = el("button", { class: "btn btn--primary btn--lg" }, "Full tailor");

  quick.addEventListener("click", async () => {
    spinnerButton(quick, true);
    try {
      state.review = await api.reviewResume({ jdText: state.jdText, rubric });
      state.tailored = null;
      draw(mount);
      scrollToResult();
    } catch (err) {
      toast(err.message === "Set up your Master Data or pass structuredContent."
        ? "Set up your master profile first — that's the resume being reviewed."
        : err.message, "error");
    } finally {
      spinnerButton(quick, false);
    }
  });

  full.addEventListener("click", async () => {
    spinnerButton(full, true);
    const host = document.getElementById("match-result");
    if (host) host.replaceChildren(el("div", { class: "card" }, [skeleton(6)]));
    try {
      state.tailored = await api.generateResume({
        company: state.company, position: state.position, jdText: state.jdText, rubric,
      });
      state.review = null;
      state.refineLog = [];
      draw(mount);
      scrollToResult();
    } catch (err) {
      toast(err.message, "error");
    } finally {
      spinnerButton(full, false);
    }
  });

  const mustHaves = rubric.criteria.filter((c) => c.mustHave);

  return el("div", { class: "card" }, [
    el("div", { class: "row row--between row--wrap" }, [
      el("div", { class: "stack stack--tight" }, [
        el("div", { class: "section-label" }, "What this posting is actually asking for"),
        el("span", { class: "subtitle" },
          `${plural(rubric.criteria.length, "criterion", "criteria")}, weighted to 100 · read as a ` +
          `${rubric.domain} role · ${rubric.source === "llm" ? "model-derived" : "derived offline"}`),
      ]),
      el("div", { class: "row" }, [quick, full]),
    ]),

    mustHaves.length ? el("p", { class: "subtitle" },
      `Hard requirement${mustHaves.length > 1 ? "s" : ""}: ${mustHaves.map((c) => c.label).join(", ")}. ` +
      "Missing one of these caps the score, because in practice it usually ends the application.") : null,

    el("details", { open: true }, [
      el("summary", { class: "link-btn", style: "cursor:pointer" }, "See the criteria"),
      criterionList(rubric.criteria.map((c) => ({ ...c, matched: undefined })), { showEvidence: false }),
    ]),

    el("p", { class: "subtitle" },
      "Quick review scores the resume you already have and tells you what to change. " +
      "Full tailor rewrites it from your master profile against these criteria."),
  ].filter(Boolean));
}

function scrollToResult() {
  requestAnimationFrame(() => {
    document.getElementById("match-result")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

// --------------------------------------------------------- quick review result

function reviewCard() {
  const { review } = state;
  const b = review.atsBreakdown;

  return el("div", { class: "card", id: "match-result" }, [
    el("div", { class: "row row--between row--wrap" }, [
      el("div", { class: "row" }, [
        atsRing(review.atsScore),
        el("div", { class: "stack stack--tight" }, [
          el("h2", { class: "title title--sm" }, "Quick review"),
          el("span", { class: "subtitle" },
            `Your existing resume, unchanged, against this posting. ` +
            `${b.criteria.filter((c) => c.matched).length} of ${b.criteria.length} criteria evidenced.`),
        ]),
      ]),
      el("button", { class: "btn", onclick: () => logFromMatch() }, "Log this application"),
    ]),

    b.mustHaveGaps?.length ? el("div", { class: "card card--warn card--pad-sm" }, [
      el("strong", {}, "Hard requirements you don't evidence"),
      el("p", { class: "subtitle" }, b.mustHaveGaps.join(", ")),
    ]) : null,

    el("div", { class: "stack stack--tight" }, [
      el("div", { class: "section-label" }, "What to change"),
      ...review.suggestions.map((s) => el("div", { class: "card card--flat card--pad-sm" }, [
        el("div", { class: "row row--between" }, [
          el("strong", {}, s.criterion || "Suggestion"),
          s.impact ? el("span", { class: "badge" }, `+${s.impact} pts`) : null,
        ].filter(Boolean)),
        el("p", {}, s.action),
        s.where ? el("span", { class: "subtitle" }, `Where: ${s.where}`) : null,
      ].filter(Boolean))),
    ]),

    el("details", {}, [
      el("summary", { class: "link-btn", style: "cursor:pointer" }, "Full scoring breakdown"),
      criterionList(b.criteria),
    ]),

    el("ul", { class: "subtitle" }, (b.notes || []).map((n) => el("li", {}, n))),
  ].filter(Boolean));
}

// --------------------------------------------------------- full tailor result

function tailoredCard(mount) {
  const { tailored } = state;
  const b = tailored.atsBreakdown;

  const refineInput = el("input", { class: "input", placeholder: 'e.g. "shorten the projects section" or "emphasise litigation"' });
  const refineBtn = el("button", { class: "btn" }, "Refine");

  const refine = async () => {
    const msg = refineInput.value.trim();
    if (!msg) return;
    refineInput.value = "";
    spinnerButton(refineBtn, true);
    try {
      const next = await api.generateResume({
        company: state.company, position: state.position, jdText: state.jdText,
        rubric: state.rubric,
        revisionInstruction: msg,
        previousContent: tailored.structuredContent,
      });
      state.refineLog.push({ ask: msg, from: tailored.atsScore, to: next.atsScore });
      state.tailored = next;
      draw(mount);
    } catch (err) {
      toast(err.message, "error");
    } finally {
      spinnerButton(refineBtn, false);
    }
  };
  refineBtn.addEventListener("click", refine);
  refineInput.addEventListener("keydown", (e) => e.key === "Enter" && refine());

  const approve = el("button", { class: "btn btn--primary btn--lg" }, "Approve & remember this application");
  approve.addEventListener("click", async () => {
    if (!state.company.trim() || !state.position.trim()) {
      return toast("Add the company and role before approving — they're how you'll find this later", "error");
    }
    spinnerButton(approve, true);
    try {
      const saved = await api.approveResume({
        company: state.company.trim(),
        position: state.position.trim(),
        jdText: state.jdText,
        sourceUrl: state.sourceUrl,
        applicationId: state.applicationId,
        atsScore: tailored.atsScore,
        atsBreakdown: b,
        structuredContent: tailored.structuredContent,
      });
      toast("Saved — the exact resume is now tied to this application", "success");
      refreshFollowUpBadge();
      navigate(`#/applications/${saved.applicationId}`);
    } catch (err) {
      toast(err.message, "error");
      spinnerButton(approve, false);
    }
  });

  return el("div", { class: "card", id: "match-result" }, [
    el("div", { class: "row row--between row--wrap" }, [
      el("div", { class: "row" }, [
        atsRing(tailored.atsScore),
        el("div", { class: "stack stack--tight" }, [
          el("h2", { class: "title title--sm" }, "Tailored resume"),
          el("span", { class: "subtitle" },
            `${b.criteria.filter((c) => c.matched).length} of ${b.criteria.length} criteria evidenced.`),
        ]),
      ]),
      el("div", { class: "row" }, [
        el("button", {
          class: "btn",
          onclick: () => modal("Resume preview", resumePaper(tailored.structuredContent), { wide: true }),
        }, "Full preview"),
        el("button", { class: "btn", onclick: () => prepModal() }, "Interview prep"),
      ]),
    ]),

    resumePaper(tailored.structuredContent),

    el("div", { class: "card card--flat" }, [
      el("div", { class: "section-label" }, "Refine it"),
      ...state.refineLog.map((r) => el("p", { class: "subtitle" },
        `"${r.ask}" → ${r.from} to ${r.to}`)),
      el("div", { class: "row" }, [el("div", { class: "grow" }, [refineInput]), refineBtn]),
    ]),

    el("details", {}, [
      el("summary", { class: "link-btn", style: "cursor:pointer" }, "Full scoring breakdown"),
      criterionList(b.criteria),
    ]),

    approve,
  ]);
}

async function prepModal() {
  const body = el("div", {}, [skeleton(6)]);
  modal("Interview prep", body, { wide: true });
  try {
    const prep = await api.interviewPrep({
      company: state.company, position: state.position, jdText: state.jdText,
      structuredContent: state.tailored?.structuredContent,
    });
    const qList = (title, items) => !items?.length ? null : el("div", { class: "stack stack--tight" }, [
      el("div", { class: "section-label" }, title),
      ...items.map((q) => el("div", { class: "card card--flat card--pad-sm" }, [
        el("strong", {}, q.question),
        q.tip ? el("span", { class: "subtitle" }, q.tip) : null,
      ].filter(Boolean))),
    ]);
    const bullets = (title, items) => !items?.length ? null : el("div", { class: "stack stack--tight" }, [
      el("div", { class: "section-label" }, title),
      el("ul", {}, items.map((t) => el("li", {}, t))),
    ]);
    body.replaceChildren(...[
      qList("Likely technical questions", prep.technicalQuestions),
      qList("Behavioural questions", prep.behavioralQuestions),
      bullets("Questions to ask them", prep.questionsToAsk),
      bullets("Brush up on", prep.focusAreas),
    ].filter(Boolean));
  } catch (err) {
    body.replaceChildren(el("p", { class: "subtitle" }, err.message));
  }
}

// ------------------------------------------------------------------ shared

/** Log the application from a quick review, where no resume is being stored. */
async function logFromMatch() {
  if (!state.company.trim() && !state.position.trim()) {
    return toast("Add the company or role first", "error");
  }
  try {
    const created = await api.createApplication({
      company: state.company.trim(),
      position: state.position.trim(),
      jdText: state.jdText,
      sourceUrl: state.sourceUrl,
      domain: state.rubric?.domain,
    });
    toast("Logged", "success");
    refreshFollowUpBadge();
    navigate(`#/applications/${created.id}`);
  } catch (err) {
    toast(err.message, "error");
  }
}
