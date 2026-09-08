import { Router } from "express";
import * as apps from "../lib/applications.js";

export const applications = Router();

// GET /api/applications/overview - dashboard payload (pipeline, follow-ups, funnel).
// Declared before "/:id" so "overview" is not read as an application id.
applications.get("/overview", async (req, res, next) => {
  try {
    res.json(await apps.overview(req.userId));
  } catch (e) { next(e); }
});

// GET /api/applications/statuses - the pipeline vocabulary, for building UI.
applications.get("/statuses", (_req, res) => {
  res.json(apps.STATUSES);
});

// GET /api/applications?q=&status=&domain=
applications.get("/", async (req, res, next) => {
  try {
    res.json(await apps.listApplications(req.userId, {
      q: String(req.query.q || ""),
      status: String(req.query.status || ""),
      domain: String(req.query.domain || ""),
    }));
  } catch (e) { next(e); }
});

// GET /api/applications/:id
applications.get("/:id", async (req, res, next) => {
  try {
    const row = await apps.getApplication(req.userId, req.params.id);
    if (!row) return res.status(404).json({ error: "not_found" });
    res.json(row);
  } catch (e) { next(e); }
});

// POST /api/applications - log an application from anywhere, tailored here or not.
applications.post("/", async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!body.company && !body.position) {
      return res.status(400).json({ error: "missing_fields", message: "A company or a position is required." });
    }
    res.status(201).json(await apps.createApplication(req.userId, body));
  } catch (e) { next(e); }
});

// PATCH /api/applications/:id - fields, or a status move that appends to the timeline.
applications.patch("/:id", async (req, res, next) => {
  try {
    const body = req.body || {};
    if (body.status && !apps.isStatus(body.status)) {
      return res.status(400).json({ error: "bad_status", message: `Unknown status "${body.status}".` });
    }
    const row = await apps.updateApplication(req.userId, req.params.id, body);
    if (!row) return res.status(404).json({ error: "not_found" });
    res.json(row);
  } catch (e) { next(e); }
});

// DELETE /api/applications/:id
applications.delete("/:id", async (req, res, next) => {
  try {
    const ok = await apps.deleteApplication(req.userId, req.params.id);
    if (!ok) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true });
  } catch (e) { next(e); }
});
