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
    listSection("Experience", draft.experience, (e) => `${e.role || "Role"} · ${e.company || "Company"}`, (e) => e.dates, (e) => e.bullets),
    listSection("Projects", draft.projects, (p) => p.name || "Project", (p) => p.tech, (p) => p.bullets),
    listSection("Education", draft.education, (ed) => ed.institution || "Institution", (ed) => ed.dates, () => null,
      (ed) => [ed.degree, ed.field].filter(Boolean).join(", ")),
    skillsSection(draft),
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

/** Read-only rendering of the parsed sections, with inline bullet editing. */
function listSection(heading, items = [], title, meta, bullets, sub) {
  if (!items.length) {
    return el("div", { class: "card" }, [
      el("div", { class: "section-label" }, heading),
      el("p", { class: "subtitle" }, `No ${heading.toLowerCase()} captured.`),
    ]);
  }
  return el("div", { class: "card" }, [
    el("div", { class: "section-label" }, heading),
    ...items.map((it) => el("div", { class: "card card--flat card--pad-sm" }, [
      el("div", { class: "row row--between row--wrap" }, [
        el("strong", {}, title(it)),
        meta(it) ? el("span", { class: "subtitle" }, meta(it)) : null,
      ].filter(Boolean)),
      sub && sub(it) ? el("span", { class: "subtitle" }, sub(it)) : null,
      bullets(it)?.length ? el("ul", { class: "subtitle" }, bullets(it).map((b) => el("li", {}, b))) : null,
    ].filter(Boolean))),
  ]);
}

function skillsSection(draft) {
  const groups = draft.skills || [];
  if (!groups.length) {
    return el("div", { class: "card" }, [
      el("div", { class: "section-label" }, "Skills"),
      el("p", { class: "subtitle" }, "No skills captured."),
    ]);
  }
  return el("div", { class: "card" }, [
    el("div", { class: "section-label" }, "Skills"),
    ...groups.map((g) => {
      const input = el("input", { class: "input input--sm", value: (g.items || []).join(", ") });
      input.addEventListener("input", () => {
        g.items = input.value.split(",").map((s) => s.trim()).filter(Boolean);
      });
      return el("div", { class: "field" }, [el("label", {}, g.category || "Skills"), input]);
    }),
    el("p", { class: "subtitle" }, "Edits here are saved with the Save profile button above."),
  ]);
}
