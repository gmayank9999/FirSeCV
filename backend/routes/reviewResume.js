import { Router } from "express";
import * as db from "../lib/supabase.js";
import { deriveRubric, scoreAgainstRubric, resumeToText } from "../lib/rubric.js";
import { callLlmJson, hasLlm, jsonPrompt } from "../lib/gemini.js";

export const reviewResume = Router();

// POST /api/review-resume
// { jdText, structuredContent?, rubric? }
// -> { rubric, atsScore, atsBreakdown, suggestions[] }
//
// Quick review is the low-effort half of the "flexible effort" finding: users
// said plainly that not every application deserves a full rewrite, they just
// want to know whether the resume they already have is good enough for this
// posting. So this endpoint diagnoses and advises - it never rewrites. The
// resume you get back is the resume you sent in.
reviewResume.post("/", async (req, res, next) => {
  try {
    const { jdText = "", structuredContent = null, rubric: providedRubric = null } = req.body || {};
    if (!jdText.trim()) return res.status(400).json({ error: "missing_jd" });

    const resume = structuredContent || (await db.getProfile(req.userId));
    if (!resume) {
      return res.status(400).json({ error: "no_resume", message: "Set up your Master Data or pass structuredContent." });
    }

    const rubric = providedRubric && providedRubric.criteria?.length
      ? providedRubric
      : await deriveRubric({ jdText, llm: jsonPrompt() });

    const atsBreakdown = scoreAgainstRubric(rubric, resume);
    const suggestions = await buildSuggestions({ rubric, atsBreakdown, resume, jdText });

    res.json({ rubric, atsScore: atsBreakdown.score, atsBreakdown, suggestions });
  } catch (e) { next(e); }
});

/**
 * Turn the score's gaps into specific, actionable edits, heaviest gap first.
 * The local path is not a placeholder: it names the criterion, its point value
 * and where the edit belongs, which is most of the value without a model.
 */
async function buildSuggestions({ rubric, atsBreakdown, resume, jdText }) {
  const gaps = atsBreakdown.criteria
    .filter((c) => !c.matched)
    .sort((a, b) => (b.mustHave ? 1 : 0) - (a.mustHave ? 1 : 0) || b.weight - a.weight)
    .slice(0, 5);

  const thin = atsBreakdown.criteria
    .filter((c) => c.matched && c.matchedTerms.length === 1 && c.weight >= 12)
    .slice(0, 2);

  if (hasLlm()) {
    try {
      const prompt =
        "You are reviewing a resume against a job description. The resume will NOT be rewritten - give the " +
        "candidate specific edits they can make themselves.\n\n" +
        "Return ONLY JSON: {\"suggestions\": [{\"criterion\": string, \"action\": string, \"where\": string, \"impact\": number}]}\n" +
        "- \"action\" is one concrete sentence: what to add or reword, phrased so they could paste it in.\n" +
        "- \"where\" names the section or bullet to change (e.g. \"Skills\", \"Experience - Acme, bullet 2\").\n" +
        "- \"impact\" is the rubric points at stake for that criterion.\n" +
        "- Never suggest claiming experience the resume does not show. If a gap cannot be closed honestly, " +
        "say so in \"action\" and suggest the closest truthful framing.\n\n" +
        "UNMET CRITERIA (label, points, hard requirement?):\n" +
        gaps.map((c) => `- ${c.label} (${c.weight} pts${c.mustHave ? ", HARD REQUIREMENT" : ""})`).join("\n") +
        (thin.length ? "\n\nMENTIONED ONLY ONCE:\n" + thin.map((c) => `- ${c.label} (${c.weight} pts)`).join("\n") : "") +
        "\n\nJOB DESCRIPTION:\n" + jdText.slice(0, 4000) +
        "\n\nRESUME:\n" + resumeToText(resume).slice(0, 5000);

      const out = await callLlmJson(prompt);
      const list = (out?.suggestions || [])
        .filter((s) => s && s.action)
        .slice(0, 7)
        .map((s) => ({
          criterion: String(s.criterion || "").slice(0, 80),
          action: String(s.action).slice(0, 400),
          where: String(s.where || "").slice(0, 80),
          impact: Number(s.impact) || 0,
        }));
      if (list.length) return list;
    } catch (e) {
      console.warn("[JOZY] review suggestions fell back to local: " + e.message);
    }
  }

  const local = gaps.map((c) => ({
    criterion: c.label,
    action: c.mustHave
      ? `This posting states "${c.label}" as a hard requirement and your resume does not evidence it. If you do have it, name it explicitly; if you do not, this application is a long shot.`
      : `Nothing in your resume evidences "${c.label}". If it is true of you, work it into a bullet with a concrete result rather than adding it to a skills list.`,
    where: c.kind === "qualification" ? "Education / Certifications" : c.kind === "responsibility" ? "Experience" : "Skills or Experience",
    impact: c.weight,
  }));

  for (const c of thin) {
    local.push({
      criterion: c.label,
      action: `"${c.label}" appears once and carries ${c.weight} points. A second, concrete mention in your experience bullets would make it read as real depth rather than a keyword.`,
      where: "Experience",
      impact: Math.round(c.weight * 0.25),
    });
  }

  if (!local.length) {
    local.push({
      criterion: "Overall",
      action: `Your resume already evidences every criterion in this rubric (score ${atsBreakdown.score}). Send it as is - a rewrite is not worth your time on this one.`,
      where: "",
      impact: 0,
    });
  }
  return local;
}
