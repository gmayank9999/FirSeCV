import * as api from "../lib/api.js";
import { el, toast, spinnerButton, plural } from "../lib/ui.js";
import { refresh } from "../app.js";

// The master profile is the thing chat tools cannot hold: a structured record
// of your background that survives between applications instead of being
// retyped into a fresh session every time.

export async function renderProfile(mount) {
  const profile = await api.getProfile();
  mount.replaceChildren(el("div", { class: "page" }, [
    el("div", { class: "stack stack--tight" }, [
      el("h1", { class: "title" }, "Master profile"),
      el("p", { class: "subtitle" },
        "Set this up once. Every tailored resume is written from it, and every quick review is scored against it — " +
        "so you never paste your background into a chat box again."),
    ]),
    profile ? profileEditor(profile) : importCard(),
  ]));
}

function importCard() {
  const paste = el("textarea", { class: "textarea", rows: "12", placeholder: "Paste your current resume here…" });
  const parse = el("button", { class: "btn btn--primary" }, "Import my resume");
  const blank = el("button", { class: "link-btn" }, "or start from an empty profile");

  parse.addEventListener("click", async () => {
    if (!paste.value.trim()) return toast("Paste your resume text first", "error");
    spinnerButton(parse, true);
    try {
      await api.saveProfile({ resumeText: paste.value.trim() });
      toast("Imported — check the details below", "success");
      await refresh();
    } catch (err) {
      toast(err.message, "error");
      spinnerButton(parse, false);
    }
  });

  blank.addEventListener("click", async () => {
    await api.saveProfile({
      fullName: "", email: "", phone: "", location: "",
      links: { linkedin: "", github: "", portfolio: "" },
      education: [], experience: [], projects: [], skills: [], certifications: [], achievements: [],
    });
    await refresh();
  });

  return el("div", { class: "card" }, [
    el("div", { class: "field" }, [el("label", {}, "Your resume"), paste]),
    el("div", { class: "row row--between row--wrap" }, [blank, parse]),
  ]);
}

function profileEditor(profile) {
  const draft = JSON.parse(JSON.stringify(profile));
  draft.links = draft.links || { linkedin: "", github: "", portfolio: "" };
  for (const key of ["experience", "projects", "education", "skills", "certifications", "achievements"]) {
    draft[key] = Array.isArray(draft[key]) ? draft[key] : [];
  }

  const save = el("button", { class: "btn btn--primary" }, "Save profile");
  save.addEventListener("click", async () => {
    spinnerButton(save, true);
    try {
      await api.patchProfile(draft);
      toast("Profile saved", "success");
    } catch (err) {
      toast(err.message, "error");
    } finally {
      spinnerButton(save, false);
    }
  });

  const text = (label, value, onInput, type = "text") => {
    const input = el("input", { class: "input", type, value: value || "" });
    input.addEventListener("input", () => onInput(input.value));
    return el("div", { class: "field" }, [el("label", {}, label), input]);
  };

  return el("div", { class: "stack" }, [
    el("div", { class: "card" }, [
      el("div", { class: "section-label" }, "Contact details"),
      el("div", { class: "grid grid--split" }, [
        text("Full name", draft.fullName, (v) => (draft.fullName = v)),
        text("Email", draft.email, (v) => (draft.email = v), "email"),
        text("Phone", draft.phone, (v) => (draft.phone = v)),
        text("Location", draft.location, (v) => (draft.location = v)),
        text("LinkedIn", draft.links.linkedin, (v) => (draft.links.linkedin = v), "url"),
        text("GitHub / portfolio", draft.links.github, (v) => (draft.links.github = v), "url"),
      ]),
      el("div", { class: "row", style: "justify-content:flex-end" }, [save]),
    ]),

    summaryCard(draft),
    collectionSection("Experience", draft.experience, [["Role", "role"], ["Company", "company"], ["Dates", "dates"]],
      () => ({ role: "", company: "", dates: "", bullets: [] }), true),
    collectionSection("Projects", draft.projects, [["Project name", "name"], ["Technologies", "tech"]],
      () => ({ name: "", tech: "", bullets: [] }), true),
    collectionSection("Education", draft.education, [["Institution", "institution"], ["Degree", "degree"], ["Field of study", "field"], ["Dates", "dates"]],
      () => ({ institution: "", degree: "", field: "", dates: "" })),
    skillsSection(draft),
    collectionSection("Certifications", draft.certifications, [["Certification", "name"], ["Issuer / year", "details"]],
      () => ({ name: "", details: "" })),
    collectionSection("Achievements", draft.achievements, [["Achievement", "text"]], () => ({ text: "" })),
    el("div", { class: "row", style: "justify-content:flex-end" }, [save]),
  ]);
}

function summaryCard(d) {
  const counts = [
    d.experience?.length ? plural(d.experience.length, "role") : null,
    d.projects?.length ? plural(d.projects.length, "project") : null,
    d.education?.length ? plural(d.education.length, "qualification") : null,
    (d.skills || []).reduce((n, s) => n + (s.items?.length || 0), 0)
      ? plural((d.skills || []).reduce((n, s) => n + (s.items?.length || 0), 0), "skill") : null,
  ].filter(Boolean);

  return el("div", { class: "card card--tint" }, [
    el("strong", {}, counts.length ? `On file: ${counts.join(", ")}.` : "Your profile is empty."),
    el("p", { class: "subtitle" }, counts.length
      ? "This is what a tailored resume gets written from. Facts here are never invented — if something is missing, add it."
      : "Import a resume above, or add your experience and projects, before tailoring anything."),
  ]);
}

/** Edit a collection locally; Save profile is the single durable action. */
function collectionSection(heading, items, fields, makeItem, hasBullets = false) {
  const body = el("div", { class: "stack stack--tight" });
  const draw = () => body.replaceChildren(...items.map((item, index) => {
    const inputs = fields.map(([label, key]) => {
      const input = el("input", { class: "input input--sm", value: item[key] || "", placeholder: label });
      input.addEventListener("input", () => { item[key] = input.value; });
      return el("div", { class: "field" }, [el("label", {}, label), input]);
    });
    const bulletField = hasBullets ? (() => {
      const area = el("textarea", { class: "textarea", rows: "4", value: (item.bullets || []).join("\n"), placeholder: "One accomplishment per line" });
      area.addEventListener("input", () => { item.bullets = area.value.split("\n").map((b) => b.trim()).filter(Boolean); });
      return el("div", { class: "field" }, [el("label", {}, "Accomplishments"), area]);
    })() : null;
    return el("div", { class: "card card--flat card--pad-sm stack stack--tight" }, [
      el("div", { class: "row", style: "justify-content:flex-end" }, [
        el("button", { class: "btn btn--sm btn--danger", type: "button", onclick: () => { items.splice(index, 1); draw(); } }, "Remove"),
      ]),
      el("div", { class: "grid grid--split" }, inputs),
      bulletField,
    ].filter(Boolean));
  }));
  draw();
  return el("div", { class: "card" }, [
    el("div", { class: "row row--between row--wrap" }, [
      el("div", { class: "stack stack--tight" }, [
        el("div", { class: "section-label" }, heading),
        el("span", { class: "subtitle" }, items.length ? "Edit the facts tailoring can use." : `No ${heading.toLowerCase()} yet.`),
      ]),
      el("button", { class: "btn btn--sm", type: "button", onclick: () => { items.push(makeItem()); draw(); } }, `Add ${heading.slice(0, -1)}`),
    ]),
    body,
  ]);
}

function skillsSection(draft) {
  const groups = draft.skills || [];
  const body = el("div", { class: "stack stack--tight" });
  const draw = () => body.replaceChildren(...groups.map((g, index) => {
    const category = el("input", { class: "input input--sm", value: g.category || "", placeholder: "Category, e.g. Tools" });
    const items = el("input", { class: "input input--sm", value: (g.items || []).join(", "), placeholder: "Skills, separated by commas" });
    category.addEventListener("input", () => { g.category = category.value; });
    items.addEventListener("input", () => { g.items = items.value.split(",").map((s) => s.trim()).filter(Boolean); });
    return el("div", { class: "card card--flat card--pad-sm" }, [
      el("div", { class: "grid grid--split" }, [
        el("div", { class: "field" }, [el("label", {}, "Category"), category]),
        el("div", { class: "field" }, [el("label", {}, "Skills"), items]),
      ]),
      el("div", { class: "row", style: "justify-content:flex-end;margin-top:8px" }, [
        el("button", { class: "btn btn--sm btn--danger", type: "button", onclick: () => { groups.splice(index, 1); draw(); } }, "Remove"),
      ]),
    ]);
  }));
  draw();
  return el("div", { class: "card" }, [
    el("div", { class: "row row--between row--wrap" }, [
      el("div", { class: "stack stack--tight" }, [
        el("div", { class: "section-label" }, "Skills"),
        el("span", { class: "subtitle" }, "Use categories to keep a tailored resume readable."),
      ]),
      el("button", { class: "btn btn--sm", type: "button", onclick: () => { groups.push({ category: "Skills", items: [] }); draw(); } }, "Add category"),
    ]),
    body,
  ]);
}
