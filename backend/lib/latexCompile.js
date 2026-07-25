// Populate the LaTeX template with generated content and (when a TeX engine is
// installed) compile it to PDF. Without an engine, the .tex source is returned
// and PDF compilation is skipped - the pipeline degrades gracefully.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdtemp, readFile as read } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";

const run = promisify(execFile);
const TEMPLATE = fileURLToPath(new URL("../templates/template.tex", import.meta.url));
const LOCAL_TECTONIC = fileURLToPath(new URL("../bin/tectonic.exe", import.meta.url));

// Prefer the bundled tectonic binary; otherwise use whatever is on PATH.
function resolveEngine() {
  if (config.latex.engine !== "pdflatex" && existsSync(LOCAL_TECTONIC)) {
    return { cmd: LOCAL_TECTONIC, kind: "tectonic" };
  }
  return { cmd: config.latex.engine, kind: config.latex.engine.includes("pdflatex") ? "pdflatex" : "tectonic" };
}

const esc = (s = "") =>
  String(s).replace(/([&%$#_{}])/g, "\\$1").replace(/~/g, "\\textasciitilde{}").replace(/\^/g, "\\textasciicircum{}");

function itemize(bullets = []) {
  if (!bullets.length) return "";
  return "\\begin{itemize}\n" + bullets.map((b) => `  \\item ${esc(b)}`).join("\n") + "\n\\end{itemize}";
}

function experienceBlock(entries = []) {
  return entries.map((e) =>
    `\\resumeEntry{${esc(e.role)}}{${esc(e.company)}}{${esc(e.dates)}}\n${itemize(e.bullets)}`).join("\n\n");
}
function projectBlock(entries = []) {
  return entries.map((p) =>
    `\\resumeEntry{${esc(p.name)}}{${esc(p.tech)}}{}\n${itemize(p.bullets)}`).join("\n\n");
}
function skillsBlock(groups = []) {
  return groups.map((s) => `\\textbf{${esc(s.category)}:} ${esc((s.items || []).join(", "))} \\\\`).join("\n");
}
function educationBlock(entries = []) {
  return entries.map((ed) => `\\resumeEntry{${esc(ed.institution)}}{${esc(ed.degree)}}{${esc(ed.dates)}}`).join("\n\n");
}

/** Fill the template with structured content and return the .tex string. */
export async function populateTemplate(sc) {
  const tpl = await readFile(TEMPLATE, "utf8");
  return tpl
    .replaceAll("{{FULL_NAME}}", esc(sc.header?.fullName || "Your Name"))
    .replaceAll("{{CONTACT_LINE}}", esc(sc.header?.contactLine || ""))
    .replaceAll("{{EXPERIENCE_BLOCK}}", experienceBlock(sc.experience))
    .replaceAll("{{PROJECTS_BLOCK}}", projectBlock(sc.projects))
    .replaceAll("{{SKILLS_BLOCK}}", skillsBlock(sc.skills))
    .replaceAll("{{EDUCATION_BLOCK}}", educationBlock(sc.education));
}

/** Compile .tex to a PDF Buffer. Returns null if no engine is available. */
export async function compileToPdf(tex) {
  const { cmd, kind } = resolveEngine();
  try {
    const dir = await mkdtemp(join(tmpdir(), "firsecv-"));
    const texPath = join(dir, "resume.tex");
    await writeFile(texPath, tex, "utf8");
    if (kind === "tectonic") {
      await run(cmd, ["--outdir", dir, "--keep-logs", texPath], { timeout: 60000 });
    } else {
      await run(cmd, ["-interaction=nonstopmode", "-output-directory", dir, texPath], { timeout: 60000 });
    }
    return await read(join(dir, "resume.pdf"));
  } catch (err) {
    // Engine missing or compile failed - caller stores the .tex source instead.
    console.warn("[FirSeCV] LaTeX compile failed:", err.message);
    return null;
  }
}
