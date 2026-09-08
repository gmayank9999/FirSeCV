import { Router } from "express";
import * as rec from "../lib/recruiter.js";
import { deriveRubric } from "../lib/rubric.js";
import { jsonPrompt } from "../lib/gemini.js";

export const requisitions = Router();

// POST /api/requisitions - open a role. The rubric is derived from the JD up
// front and stored, so screening is reproducible rather than recomputed.
requisitions.post("/", async (req, res, next) => {
  try {
    const { title = "", company = "", jdText = "" } = req.body || {};
    if (!title.trim() && !jdText.trim()) {
      return res.status(400).json({ error: "missing_fields", message: "A title or a job description is required." });
    }
    const rubric = await deriveRubric({ jdText, llm: jsonPrompt() });
    res.status(201).json(await rec.createRequisition(req.userId, { title, company, jdText, rubric }));
  } catch (e) { next(e); }
});

// GET /api/requisitions
requisitions.get("/", async (req, res, next) => {
  try {
    res.json(await rec.listRequisitions(req.userId));
  } catch (e) { next(e); }
});

// GET /api/requisitions/:id - the role, its rubric, its ranked candidates, and
// the screening summary in one payload (the whole workspace view).
requisitions.get("/:id", async (req, res, next) => {
  try {
    const requisition = await rec.getRequisition(req.userId, req.params.id);
    if (!requisition) return res.status(404).json({ error: "not_found" });
    const [candidates, summary] = await Promise.all([
      rec.listCandidates(req.userId, req.params.id),
      rec.requisitionSummary(req.userId, req.params.id),
    ]);
    res.json({ requisition, candidates, summary });
  } catch (e) { next(e); }
});

// PATCH /api/requisitions/:id - edit details or rubric weights. Editing the
// rubric re-scores every candidate so the shortlist matches what is on screen.
requisitions.patch("/:id", async (req, res, next) => {
  try {
    const updated = await rec.updateRequisition(req.userId, req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: "not_found" });
    const candidates = (req.body || {}).rubric
      ? await rec.rescoreAll(req.userId, req.params.id)
      : await rec.listCandidates(req.userId, req.params.id);
    res.json({ requisition: updated, candidates, summary: await rec.requisitionSummary(req.userId, req.params.id) });
  } catch (e) { next(e); }
});

// DELETE /api/requisitions/:id
requisitions.delete("/:id", async (req, res, next) => {
  try {
    await rec.deleteRequisition(req.userId, req.params.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// POST /api/requisitions/:id/candidates - { candidates: [{ name?, email?, resumeText }] }
// Scored on arrival against the stored rubric.
requisitions.post("/:id/candidates", async (req, res, next) => {
  try {
    const body = req.body || {};
    const list = Array.isArray(body.candidates)
      ? body.candidates
      : (body.resumeText ? [body] : []);
    if (!list.length) return res.status(400).json({ error: "no_candidates" });
    const added = await rec.addCandidates(req.userId, req.params.id, list);
    if (added === null) return res.status(404).json({ error: "not_found" });
    res.status(201).json({
      added,
      candidates: await rec.listCandidates(req.userId, req.params.id),
      summary: await rec.requisitionSummary(req.userId, req.params.id),
    });
  } catch (e) { next(e); }
});

// POST /api/requisitions/:id/rescore - re-run every candidate against the rubric.
requisitions.post("/:id/rescore", async (req, res, next) => {
  try {
    const candidates = await rec.rescoreAll(req.userId, req.params.id);
    if (candidates === null) return res.status(404).json({ error: "not_found" });
    res.json({ candidates, summary: await rec.requisitionSummary(req.userId, req.params.id) });
  } catch (e) { next(e); }
});

// PATCH /api/requisitions/:id/candidates/:candidateId - { decision }
requisitions.patch("/:id/candidates/:candidateId", async (req, res, next) => {
  try {
    const { decision } = req.body || {};
    const updated = await rec.decideCandidate(req.userId, req.params.candidateId, decision);
    if (!updated) return res.status(400).json({ error: "bad_decision", message: `decision must be one of ${rec.DECISIONS.join(", ")}` });
    res.json({ candidate: updated, summary: await rec.requisitionSummary(req.userId, req.params.id) });
  } catch (e) { next(e); }
});
