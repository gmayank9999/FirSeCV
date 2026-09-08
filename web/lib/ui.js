// Dependency-free UI primitives shared by every view.

/** el("div", { class: "x", onclick: fn }, [children | strings]) */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, "");
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    node.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  return node;
}

export function toast(message, type = "info") {
  const host = document.getElementById("toasts");
  if (!host) return;
  const node = el("div", { class: `toast toast--${type}` }, message);
  host.appendChild(node);
  setTimeout(() => {
    node.classList.add("is-leaving");
    setTimeout(() => node.remove(), 220);
  }, 3200);
}

export function skeleton(count = 3) {
  return el("div", { class: "stack" }, Array.from({ length: count }, (_, i) =>
    el("div", { class: "skeleton", style: `width:${92 - i * 11}%` })));
}

export function spinnerButton(btn, on) {
  if (!btn) return;
  btn.classList.toggle("is-loading", Boolean(on));
  btn.disabled = Boolean(on);
}

/** Circular score ring, coloured by band. */
export function atsRing(score, size = 68, caption = "Match") {
  const n = Math.max(0, Math.min(100, Math.round(score || 0)));
  const stroke = 6;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const color = scoreColor(n);
  const wrap = el("div", { class: "ats-ring", style: `width:${size}px;height:${size}px` });
  wrap.innerHTML = `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <circle class="ats-ring__track" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}"></circle>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}" stroke-linecap="round"
        stroke="${color}" stroke-dasharray="${circ}" stroke-dashoffset="${circ * (1 - n / 100)}"></circle>
    </svg>
    <div class="ats-ring__label" style="inset:0">
      <div class="ats-ring__num" style="color:${color}">${n}</div>
      <div class="ats-ring__cap">${caption}</div>
    </div>`;
  wrap.setAttribute("role", "img");
  wrap.setAttribute("aria-label", `${caption} score ${n} out of 100`);
  return wrap;
}

export function scoreColor(n) {
  return n >= 75 ? "var(--success)" : n >= 50 ? "var(--amber)" : "var(--danger)";
}

export function scoreBadge(score, label = "Match") {
  if (score === null || score === undefined) return el("span", { class: "badge" }, `${label} —`);
  const c = scoreColor(score);
  return el("span", {
    class: "badge",
    style: `background:color-mix(in srgb, ${c} 15%, transparent);color:${c}`,
  }, `${label} ${score}`);
}

export function chips(list = [], variant = "") {
  if (!list.length) return el("span", { class: "subtitle" }, "—");
  return el("div", { class: "chips" }, list.map((k) => el("span", { class: `chip ${variant ? "chip--" + variant : ""}` }, k)));
}

export function statusPill(status, label) {
  return el("span", { class: `badge status status--${status}` }, label || status);
}

/**
 * Render a scored rubric: one row per criterion, with its weight, whether it
 * was evidenced, and the quote that evidences it. This component is the
 * product's transparency promise made visible, so it is used unchanged on both
 * the applicant's screen and the recruiter's.
 */
export function criterionList(criteria = [], { showEvidence = true } = {}) {
  if (!criteria.length) return el("p", { class: "subtitle" }, "No criteria yet.");
  const max = Math.max(...criteria.map((c) => c.weight || 0), 1);
  return el("div", {}, criteria.map((c) => el("div", { class: "criterion" }, [
    el("div", { class: "criterion__head" }, [
      el("span", { class: "criterion__label" }, c.label),
      c.mustHave ? el("span", { class: "chip chip--must" }, "must have") : null,
      el("span", { class: "chip" }, c.kind || "skill"),
      el("span", { class: "criterion__weight" }, `${c.weight} pts`),
      el("span", {
        class: `chip ${c.matched ? "chip--matched" : "chip--missing"}`,
      }, c.matched ? "evidenced" : "not found"),
    ]),
    el("div", { class: "criterion__bar" }, [
      el("div", {
        class: `criterion__fill ${c.matched ? "" : "criterion__fill--miss"}`,
        style: `width:${Math.round(((c.weight || 0) / max) * 100)}%`,
      }),
    ]),
    showEvidence && c.evidence ? el("div", { class: "criterion__evidence" }, `"${c.evidence}"`) : null,
    showEvidence && !c.matched && c.terms?.length
      ? el("div", { class: "subtitle" }, `Looked for: ${c.terms.join(", ")}`)
      : null,
  ])));
}

/** A dismissible modal. Returns a close() function. */
export function modal(title, body, { wide = false, actions = [] } = {}) {
  const box = el("div", { class: `modal ${wide ? "modal--wide" : ""}` }, [
    el("div", { class: "row row--between" }, [
      el("h2", { class: "title title--sm" }, title),
      el("button", { class: "icon-btn", onclick: () => close(), "aria-label": "Close" }, "×"),
    ]),
    body,
    actions.length ? el("div", { class: "row", style: "justify-content:flex-end" }, actions) : null,
  ]);
  const backdrop = el("div", { class: "modal-backdrop", onclick: (e) => { if (e.target === backdrop) close(); } }, [box]);
  const onKey = (e) => { if (e.key === "Escape") close(); };

  function close() {
    document.removeEventListener("keydown", onKey);
    backdrop.remove();
  }
  document.addEventListener("keydown", onKey);
  document.body.appendChild(backdrop);
  return close;
}

/** Ask before doing something destructive. Resolves to true/false. */
export function confirmModal(title, message, confirmLabel = "Delete") {
  return new Promise((resolve) => {
    const close = modal(title, el("p", { class: "subtitle" }, message), {
      actions: [
        el("button", { class: "btn", onclick: () => { close(); resolve(false); } }, "Cancel"),
        el("button", { class: "btn btn--danger", onclick: () => { close(); resolve(true); } }, confirmLabel),
      ],
    });
  });
}

// ------------------------------------------------------------------ formatting

export function formatDate(iso) {
  const d = new Date(iso);
  return isNaN(d) ? "—" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** "3 days ago" - the unit people actually think in when chasing a reply. */
export function relativeTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months > 1 ? "s" : ""} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years > 1 ? "s" : ""} ago`;
}

export function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many || one + "s"}`;
}

/** Render the same resume shape the extension previews. */
export function resumePaper(sc) {
  if (!sc) return el("div", { class: "empty" }, "No resume content stored for this entry.");
  const paper = el("div", { class: "resume-paper" }, [
    el("h1", {}, sc.header?.fullName || sc.fullName || "Your Name"),
    sc.header?.contactLine ? el("div", { class: "resume-contact" }, sc.header.contactLine) : null,
  ]);

  const section = (heading, entries) =>
    entries.length ? el("div", {}, [el("h2", {}, heading), ...entries]) : null;

  const entry = (title, meta, bullets, sub) => el("div", { class: "resume-entry" }, [
    el("div", { class: "resume-entry__head" }, [
      el("span", { class: "resume-entry__title" }, title),
      meta ? el("span", { class: "resume-entry__meta" }, meta) : null,
    ]),
    sub ? el("div", {}, sub) : null,
    bullets?.length ? el("ul", {}, bullets.map((b) => el("li", {}, b))) : null,
  ]);

  const sections = [
    section("Experience", (sc.experience || []).map((e) =>
      entry(`${e.role || ""}${e.company ? " · " + e.company : ""}`, e.dates, e.bullets))),
    section("Projects", (sc.projects || []).map((p) => entry(p.name || "", p.tech, p.bullets))),
    section("Skills", (sc.skills || []).map((s) =>
      el("div", { class: "resume-entry" }, [
        el("span", { class: "resume-entry__title" }, `${s.category}: `),
        (s.items || []).join(", "),
      ]))),
    section("Education", (sc.education || []).map((ed) =>
      entry(ed.institution || "", ed.dates, null, ed.degree))),
  ];
  for (const s of sections) if (s) paper.appendChild(s);
  return paper;
}
