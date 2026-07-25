// Screen render functions. Each mounts into its <section data-screen="...">.
// Screens talk to the backend only through api.js and to state through store.js.

import * as api from "../lib/api.js";
import { store, setProfile, setSession, getSession } from "../lib/store.js";
import { scrapePage } from "../lib/extract.js";
import { toast, spinnerButton, atsRing, keywordChips, skeleton, el } from "./components.js";
import { showScreen, afterLogin } from "../sidepanel/sidepanel.js";

const mount = (name) => document.querySelector(`[data-screen="${name}"].screen`);

// ===================================================================== auth

export function renderAuth() {
  const root = mount("auth");
  root.replaceChildren();
  let mode = "login"; // or "signup"

  const email = el("input", { type: "email", class: "input", placeholder: "you@example.com" });
  const password = el("input", { type: "password", class: "input", placeholder: "Password" });
  const submit = el("button", { class: "btn btn--primary btn--block btn--lg" }, "Log in");
  const toggle = el("button", { class: "link-btn" }, "New here? Create an account");
  const title = el("h1", { class: "title" }, "Welcome back");
  const subtitle = el("p", { class: "subtitle" }, "Log in to your FirSeCV account.");

  const setMode = (m) => {
    mode = m;
    title.textContent = m === "login" ? "Welcome back" : "Create your account";
    subtitle.textContent = m === "login" ? "Log in to your FirSeCV account." : "Sign up to save your resumes and tracker.";
    submit.textContent = m === "login" ? "Log in" : "Sign up";
    toggle.textContent = m === "login" ? "New here? Create an account" : "Have an account? Log in";
  };

  toggle.addEventListener("click", () => setMode(mode === "login" ? "signup" : "login"));

  const doAuth = async () => {
    const e = email.value.trim();
    const p = password.value;
    if (!e || !p) return toast("Enter your email and password", "error");
    if (p.length < 6) return toast("Password must be at least 6 characters", "error");
    spinnerButton(submit, true);
    try {
      const result = mode === "login" ? await api.login(e, p) : await api.signup(e, p);
      if (!result.accessToken) {
        // Signup with email confirmation enabled: no session yet.
        toast("Account created. Check your email to confirm, then log in.", "success");
        setMode("login");
        return;
      }
      await setSession({ accessToken: result.accessToken, user: result.user });
      toast(mode === "login" ? "Logged in" : "Account created", "success");
      await afterLogin();
    } catch (err) {
      toast(err.message || "Authentication failed", "error");
    } finally {
      spinnerButton(submit, false);
    }
  };

  submit.addEventListener("click", doAuth);
  password.addEventListener("keydown", (ev) => ev.key === "Enter" && doAuth());

  root.appendChild(el("div", { class: "stack", style: "margin-top:8px" }, [
    el("div", { class: "brand", style: "justify-content:center" }, [
      el("span", { class: "brand__mark", style: "width:40px;height:40px;font-size:16px" }, "FS"),
    ]),
    el("div", { class: "stack", style: "text-align:center;gap:2px" }, [title, subtitle]),
    el("div", { class: "card stack" }, [
      el("div", { class: "field" }, [el("label", {}, "Email"), email]),
      el("div", { class: "field" }, [el("label", {}, "Password"), password]),
      submit,
      el("div", { class: "row", style: "justify-content:center" }, [toggle]),
    ]),
  ]));
}

// ================================================================ onboarding

let onboardingDraft = null;

export function renderOnboarding() {
  const root = mount("onboarding");
  root.replaceChildren();

  root.appendChild(el("div", { class: "stack" }, [
    el("h1", { class: "title" }, "Set up your Master Data"),
    el("p", { class: "subtitle" }, "Paste your current resume - FirSeCV structures it once, then reuses it for every tailored resume. You can edit anything below."),
  ]));

  const paste = el("textarea", { class: "textarea", placeholder: "Paste your resume text here...", rows: "7" });
  const parseBtn = el("button", { class: "btn btn--primary" }, "Parse resume");
  const identity = el("div", { class: "stack" });
  const manualLink = el("button", { class: "link-btn" }, "or fill it in manually");

  parseBtn.addEventListener("click", async () => {
    const text = paste.value.trim();
    if (!text) return toast("Paste some resume text first", "error");
    spinnerButton(parseBtn, true);
    try {
      onboardingDraft = await api.saveMasterProfile({ resumeText: text });
      renderIdentity(identity);
      toast("Parsed - review the details", "success");
    } catch {
      toast("Could not parse resume", "error");
    } finally {
      spinnerButton(parseBtn, false);
    }
  });

  manualLink.addEventListener("click", () => {
    onboardingDraft = onboardingDraft || blankProfile();
    renderIdentity(identity);
  });

  root.appendChild(el("div", { class: "card stack" }, [
    el("div", { class: "field" }, [el("label", {}, "Your resume"), paste]),
    el("div", { class: "row row--between" }, [parseBtn, manualLink]),
  ]));
  root.appendChild(identity);
}

function blankProfile() {
  return {
    fullName: "", email: "", phone: "", location: "",
    links: { linkedin: "", github: "", portfolio: "" },
    education: [], experience: [], projects: [], skills: [], certifications: [], achievements: [],
  };
}

function field(label, value, onInput) {
  const input = el("input", { type: "text", class: "input", value: value || "" });
  input.addEventListener("input", () => onInput(input.value));
  return el("div", { class: "field" }, [el("label", {}, label), input]);
}

function renderIdentity(container) {
  const d = onboardingDraft;
  d.links = d.links || { linkedin: "", github: "", portfolio: "" };
  const note = summarizeParsed(d);
  container.replaceChildren(
    el("div", { class: "card stack" }, [
      el("div", { class: "section-label" }, "Contact details"),
      field("Full name", d.fullName, (v) => (d.fullName = v)),
      field("Email", d.email, (v) => (d.email = v)),
      field("Phone", d.phone, (v) => (d.phone = v)),
      field("Location", d.location, (v) => (d.location = v)),
      field("LinkedIn", d.links.linkedin, (v) => (d.links.linkedin = v)),
      field("GitHub", d.links.github, (v) => (d.links.github = v)),
      note ? el("p", { class: "subtitle" }, note) : null,
      el("button", { class: "btn btn--primary btn--block btn--lg", onclick: saveOnboarding }, "Save & continue"),
    ])
  );
}

function summarizeParsed(d) {
  const bits = [];
  if (d.experience?.length) bits.push(`${d.experience.length} experience`);
  if (d.projects?.length) bits.push(`${d.projects.length} project(s)`);
  const skills = (d.skills || []).reduce((n, s) => n + (s.items?.length || 0), 0);
  if (skills) bits.push(`${skills} skill(s)`);
  return bits.length ? `Also captured: ${bits.join(", ")}. You can refine these later.` : "";
}

async function saveOnboarding() {
  if (!onboardingDraft.fullName) return toast("Add your name to continue", "error");
  await setProfile(onboardingDraft);
  toast("Master Data saved", "success");
  renderExtract();
  showScreen("extract");
  revealNav();
}

// =================================================================== extract

export function renderExtract() {
  const root = mount("extract");
  root.replaceChildren();

  const company = el("input", { type: "text", class: "input", placeholder: "Company" });
  const position = el("input", { type: "text", class: "input", placeholder: "Position" });
  const jd = el("textarea", { class: "textarea", rows: "8", placeholder: "The job description will appear here after you extract it - edit freely." });

  const genBtn = el("button", { class: "btn btn--primary btn--block btn--lg" }, "Generate resume");
  genBtn.disabled = true;

  const syncGen = () => (genBtn.disabled = !jd.value.trim());
  jd.addEventListener("input", syncGen);

  const extractBtn = el("button", { class: "btn btn--primary btn--block btn--lg" }, "Extract JD from this page");
  extractBtn.addEventListener("click", async () => {
    spinnerButton(extractBtn, true);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error("no tab");
      const [{ result } = {}] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: scrapePage });
      if (!result?.rawPageText) throw new Error("empty");
      const parsed = await api.extractJd(result);
      company.value = parsed.company;
      position.value = parsed.position;
      jd.value = parsed.jdText;
      syncGen();
      toast("Job description extracted - confirm the details", "success");
    } catch {
      toast("Couldn't read this page. Paste the JD manually.", "error");
    } finally {
      spinnerButton(extractBtn, false);
    }
  });

  genBtn.addEventListener("click", async () => {
    store.currentJd = { company: company.value.trim(), position: position.value.trim(), jdText: jd.value.trim() };
    reviewChat = [];
    spinnerButton(genBtn, true);
    renderReviewLoading();
    showScreen("review");
    try {
      store.currentResume = await api.generateResume(store.currentJd);
      renderReview();
    } catch {
      toast("Generation failed - try again", "error");
      showScreen("extract");
    } finally {
      spinnerButton(genBtn, false);
    }
  });

  root.appendChild(el("div", { class: "stack" }, [
    el("h1", { class: "title" }, "Tailor a resume"),
    el("p", { class: "subtitle" }, "Open a job posting, then extract its description. Confirm the details and generate."),
  ]));
  root.appendChild(el("div", { class: "card stack" }, [
    extractBtn,
    el("hr", { class: "divider" }),
    el("div", { class: "field" }, [el("label", {}, "Company"), company]),
    el("div", { class: "field" }, [el("label", {}, "Position"), position]),
    el("div", { class: "field" }, [el("label", {}, "Job description"), jd]),
    genBtn,
  ]));
  revealNav();
}

// ==================================================================== review

let reviewChat = []; // { role: "user" | "system", text } - persists across refines

function renderReviewLoading() {
  const root = mount("review");
  root.replaceChildren(
    el("div", { class: "stack" }, [
      el("h1", { class: "title" }, "Generating your resume..."),
      el("div", { class: "card" }, [skeleton(6)]),
    ])
  );
}

export function renderReview() {
  const root = mount("review");
  const { structuredContent: sc, atsScore, atsBreakdown } = store.currentResume;
  root.replaceChildren();

  // ATS summary
  const ats = el("div", { class: "card row", style: "align-items:flex-start" }, [
    atsRing(atsScore),
    el("div", { class: "stack", style: "flex:1" }, [
      el("div", { class: "section-label" }, "Matched keywords"),
      keywordChips(atsBreakdown.matched, "matched"),
      el("div", { class: "section-label" }, "Missing keywords"),
      keywordChips(atsBreakdown.missing, "missing"),
    ]),
  ]);

  const notes = el("ul", { class: "stack", style: "margin:0;padding-left:18px;color:var(--muted);font-size:12px" },
    (atsBreakdown.notes || []).map((n) => el("li", {}, n)));

  // Chat / refine
  const chatLog = el("div", { class: "stack" },
    reviewChat.map((m) => el("div", {
      class: m.role === "user" ? "chip" : "subtitle",
      style: m.role === "user" ? "align-self:flex-end" : "",
    }, m.text)));
  const chatInput = el("input", { type: "text", class: "input", placeholder: "e.g. \"shorten the projects section\"" });
  const refineBtn = el("button", { class: "btn btn--primary" }, "Refine");

  const refine = async () => {
    const msg = chatInput.value.trim();
    if (!msg) return;
    chatInput.value = "";
    reviewChat.push({ role: "user", text: msg });
    spinnerButton(refineBtn, true);
    try {
      store.currentResume = await api.generateResume({
        ...store.currentJd,
        revisionInstruction: msg,
        previousContent: sc,
      });
      reviewChat.push({ role: "system", text: `Updated - ATS now ${store.currentResume.atsScore}.` });
      renderReview();
    } catch {
      toast("Revision failed", "error");
    } finally {
      spinnerButton(refineBtn, false);
    }
  };
  refineBtn.addEventListener("click", refine);
  chatInput.addEventListener("keydown", (e) => e.key === "Enter" && refine());

  const approveBtn = el("button", { class: "btn btn--primary btn--block btn--lg" }, "Approve & save to tracker");
  approveBtn.addEventListener("click", async () => {
    spinnerButton(approveBtn, true);
    try {
      await api.approveResume({ ...store.currentJd, atsScore, atsBreakdown, structuredContent: sc });
      toast("Saved to your application tracker", "success");
      renderHistory();
      showScreen("history");
    } catch {
      toast("Could not save", "error");
    } finally {
      spinnerButton(approveBtn, false);
    }
  });

  root.appendChild(el("div", { class: "row row--between" }, [
    el("h1", { class: "title" }, store.currentJd.position || "Resume preview"),
    el("button", { class: "link-btn", onclick: () => showScreen("extract") }, "← Edit JD"),
  ]));
  root.appendChild(ats);
  root.appendChild(el("div", { class: "card stack" }, [el("div", { class: "section-label" }, "ATS notes"), notes]));
  root.appendChild(resumePaper(sc));
  root.appendChild(el("div", { class: "card stack" }, [
    el("div", { class: "section-label" }, "Refine with chat"),
    chatLog,
    el("div", { class: "row" }, [chatInput, refineBtn]),
  ]));
  root.appendChild(el("button", {
    class: "btn btn--block btn--lg",
    onclick: () => renderInterviewPrep({ ...store.currentJd, structuredContent: sc }, "review", renderReview),
  }, "Interview prep for this role"));
  root.appendChild(approveBtn);
}

function resumePaper(sc) {
  const paper = el("div", { class: "resume-paper" });
  paper.appendChild(el("h1", {}, sc.header?.fullName || "Your Name"));
  if (sc.header?.contactLine) paper.appendChild(el("div", { class: "resume-contact" }, sc.header.contactLine));

  const section = (title, entries) => {
    if (!entries?.length) return null;
    const s = el("div", { class: "resume-section" }, [el("h2", {}, title)]);
    for (const e of entries) s.appendChild(e);
    return s;
  };

  const expEntries = (sc.experience || []).map((e) =>
    el("div", { class: "resume-entry" }, [
      el("div", { class: "resume-entry__head" }, [
        el("span", { class: "resume-entry__title" }, `${e.role || ""}${e.company ? " · " + e.company : ""}`),
        el("span", { class: "resume-entry__meta" }, e.dates || ""),
      ]),
      el("ul", {}, (e.bullets || []).map((b) => el("li", {}, b))),
    ])
  );

  const projEntries = (sc.projects || []).map((p) =>
    el("div", { class: "resume-entry" }, [
      el("div", { class: "resume-entry__head" }, [
        el("span", { class: "resume-entry__title" }, p.name || ""),
        el("span", { class: "resume-entry__meta" }, p.tech || ""),
      ]),
      el("ul", {}, (p.bullets || []).map((b) => el("li", {}, b))),
    ])
  );

  const skillEntries = (sc.skills || []).map((s) =>
    el("div", { class: "resume-entry" }, [
      el("span", { class: "resume-entry__title" }, `${s.category}: `),
      document.createTextNode((s.items || []).join(", ")),
    ])
  );

  const eduEntries = (sc.education || []).map((ed) =>
    el("div", { class: "resume-entry" }, [
      el("div", { class: "resume-entry__head" }, [
        el("span", { class: "resume-entry__title" }, ed.institution || ""),
        el("span", { class: "resume-entry__meta" }, ed.dates || ""),
      ]),
      el("div", {}, ed.degree || ""),
    ])
  );

  for (const s of [
    section("Experience", expEntries),
    section("Projects", projEntries),
    section("Skills", skillEntries),
    section("Education", eduEntries),
  ]) if (s) paper.appendChild(s);

  return paper;
}

// =================================================================== history

let historyTimer = null;

export function renderHistory() {
  const root = mount("history");
  root.replaceChildren();

  const search = el("input", { type: "text", class: "input", placeholder: "Search by company..." });
  const list = el("div", { class: "stack" });

  const load = async (q = "") => {
    list.replaceChildren(skeleton(3));
    try {
      const rows = await api.searchResumes({ company: q });
      renderHistoryList(list, rows);
    } catch {
      toast("Could not load history", "error");
    }
  };

  search.addEventListener("input", () => {
    clearTimeout(historyTimer);
    historyTimer = setTimeout(() => load(search.value.trim()), 250);
  });

  const header = el("h1", { class: "title" }, "Application history");
  getSession().then(s => {
    if (s?.user?.email) header.textContent = `History (${s.user.email})`;
  });

  root.appendChild(header);
  root.appendChild(el("div", { class: "field" }, [search]));
  root.appendChild(list);
  load();
  revealNav();
}

function renderHistoryList(list, rows) {
  if (!rows.length) {
    list.replaceChildren(el("div", { class: "empty" }, [
      el("div", { class: "empty__icon" }, "🗂️"),
      el("p", {}, "No applications yet. Approve a resume to track it here."),
    ]));
    return;
  }
  list.replaceChildren(...rows.map((r) => {
    const card = el("div", { class: "card row row--between", style: "cursor:pointer" }, [
      el("div", { class: "stack", style: "gap:2px" }, [
        el("strong", {}, r.company || "-"),
        el("span", { class: "subtitle" }, r.position || ""),
        el("span", { class: "subtitle" }, formatDate(r.appliedAt)),
      ]),
      el("div", { class: "stack", style: "align-items:flex-end;gap:6px" }, [
        scoreBadge(r.atsScore),
        el("span", { class: "link-btn" }, "Open →"),
      ]),
    ]);
    card.addEventListener("click", () => renderResumeDetail(r));
    return card;
  }));
}

function formatDate(iso) {
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function scoreBadge(score) {
  const band = score >= 80 ? "var(--success)" : score >= 60 ? "var(--amber)" : "var(--danger)";
  return el("span", { class: "badge", style: `background:color-mix(in srgb, ${band} 16%, transparent);color:${band}` },
    score != null ? `ATS ${score}` : "ATS -");
}

// ------------------------------------------------------------- resume detail

function renderResumeDetail(r) {
  const root = mount("history");
  root.replaceChildren();

  root.appendChild(el("div", { class: "row row--between" }, [
    el("button", { class: "link-btn", onclick: () => { renderHistory(); } }, "← History"),
    scoreBadge(r.atsScore),
  ]));
  root.appendChild(el("div", { class: "stack", style: "gap:2px" }, [
    el("h1", { class: "title" }, r.position || "Resume"),
    el("span", { class: "subtitle" }, [r.company, formatDate(r.appliedAt)].filter(Boolean).join("  |  ")),
  ]));

  // ATS breakdown (same as the approval screen), when it was stored
  if (r.atsBreakdown) {
    root.appendChild(el("div", { class: "card row", style: "align-items:flex-start" }, [
      atsRing(r.atsScore),
      el("div", { class: "stack", style: "flex:1" }, [
        el("div", { class: "section-label" }, "Matched keywords"),
        keywordChips(r.atsBreakdown.matched, "matched"),
        el("div", { class: "section-label" }, "Missing keywords"),
        keywordChips(r.atsBreakdown.missing, "missing"),
      ]),
    ]));
    if (r.atsBreakdown.notes?.length) {
      root.appendChild(el("div", { class: "card stack" }, [
        el("div", { class: "section-label" }, "ATS notes"),
        el("ul", { style: "margin:0;padding-left:18px;color:var(--muted);font-size:12px" },
          r.atsBreakdown.notes.map((n) => el("li", {}, n))),
      ]));
    }
  }

  // Download / open actions
  const actions = el("div", { class: "row" });
  const dl = el("button", { class: "btn btn--primary btn--block btn--lg" }, r.hasPdf ? "Download PDF" : "Download resume");
  dl.addEventListener("click", () => downloadResume(r, dl));
  actions.appendChild(dl);
  if (r.hasPdf && /^https?:/.test(r.resumeUrl || "")) {
    actions.appendChild(el("button", { class: "btn btn--lg", onclick: () => window.open(r.resumeUrl, "_blank") }, "Open in tab"));
  }
  root.appendChild(actions);

  root.appendChild(el("button", {
    class: "btn btn--block btn--lg",
    onclick: () => renderInterviewPrep(
      { company: r.company, position: r.position, jdText: r.jdText, structuredContent: r.structuredContent },
      "history", () => renderResumeDetail(r)),
  }, "Interview prep for this role"));

  // Resume preview exactly as approved
  if (r.structuredContent) {
    root.appendChild(resumePaper(r.structuredContent));
  } else {
    root.appendChild(el("div", { class: "card subtitle" }, "Preview wasn't stored for this earlier entry - the file is still downloadable above."));
  }
}

// -------------------------------------------------------- interview prep

async function renderInterviewPrep(ctx, mountName, onBack) {
  const root = mount(mountName);
  root.replaceChildren(
    el("div", { class: "row row--between" }, [
      el("button", { class: "link-btn", onclick: onBack }, "< Back"),
      el("span", { class: "section-label" }, "Interview prep"),
    ]),
    el("h1", { class: "title" }, "Preparing your interview prep..."),
    el("div", { class: "card" }, [skeleton(6)]),
  );
  try {
    const prep = await api.interviewPrep(ctx);
    renderPrepView(root, ctx, prep, onBack);
  } catch {
    toast("Could not generate interview prep", "error");
    onBack();
  }
}

function renderPrepView(root, ctx, prep, onBack) {
  root.replaceChildren();
  root.appendChild(el("div", { class: "row row--between" }, [
    el("button", { class: "link-btn", onclick: onBack }, "< Back"),
    el("span", { class: "section-label" }, "Interview prep"),
  ]));
  root.appendChild(el("div", { class: "stack", style: "gap:2px" }, [
    el("h1", { class: "title" }, "Interview prep"),
    el("span", { class: "subtitle" }, [ctx.position, ctx.company].filter(Boolean).join(" at ")),
  ]));

  const qCard = (title, items) => !items?.length ? null : el("div", { class: "card stack" }, [
    el("div", { class: "section-label" }, title),
    ...items.map((it) => el("div", { class: "stack", style: "gap:2px" }, [
      el("strong", { style: "font-weight:600" }, it.question),
      it.tip ? el("span", { class: "subtitle" }, it.tip) : null,
    ])),
  ]);
  const listCard = (title, items) => !items?.length ? null : el("div", { class: "card stack" }, [
    el("div", { class: "section-label" }, title),
    el("ul", { style: "margin:0;padding-left:18px" }, items.map((t) => el("li", { style: "margin-bottom:4px" }, t))),
  ]);

  for (const c of [
    qCard("Likely technical questions", prep.technicalQuestions),
    qCard("Behavioral questions", prep.behavioralQuestions),
    listCard("Smart questions to ask them", prep.questionsToAsk),
    listCard("Focus areas to brush up on", prep.focusAreas),
  ]) if (c) root.appendChild(c);
}

async function downloadResume(r, btn) {
  spinnerButton(btn, true);
  try {
    const base = `${slugify(r.company)}_${slugify(r.position)}`;
    if (r.hasPdf && /^https?:/.test(r.resumeUrl || "")) {
      const res = await fetch(r.resumeUrl);
      if (!res.ok) throw new Error("fetch failed");
      triggerDownload(await res.blob(), `${base}.pdf`);
    } else if (r.latexSource) {
      triggerDownload(new Blob([r.latexSource], { type: "application/x-tex" }), `${base}.tex`);
    } else {
      toast("No downloadable file stored for this resume", "error");
    }
  } catch {
    toast("Download failed", "error");
  } finally {
    spinnerButton(btn, false);
  }
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function slugify(s = "") {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "resume";
}

// ======================================================================= nav

let navWired = false;

export function revealNav() {
  const newBtn = document.getElementById("nav-new");
  const histBtn = document.getElementById("nav-history");
  if (newBtn) newBtn.hidden = false;
  if (histBtn) histBtn.hidden = false;
  if (navWired) return;
  navWired = true;
  newBtn?.addEventListener("click", () => { renderExtract(); showScreen("extract"); });
  histBtn?.addEventListener("click", () => { renderHistory(); showScreen("history"); });
}
