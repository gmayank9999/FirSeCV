import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config, live } from "./config.js";
import { masterProfile } from "./routes/masterProfile.js";
import { extractJd } from "./routes/extractJd.js";
import { generateResume } from "./routes/generateResume.js";
import { reviewResume } from "./routes/reviewResume.js";
import { approveResume } from "./routes/approveResume.js";
import { searchResumes } from "./routes/searchResumes.js";
import { interviewPrep } from "./routes/interviewPrep.js";
import { applications } from "./routes/applications.js";
import { requisitions } from "./routes/requisitions.js";
import { rubricRoutes } from "./routes/rubric.js";
import { authRoutes } from "./routes/auth.js";
import { userIdFromToken } from "./lib/auth.js";
import * as db from "./lib/supabase.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(__dirname, "..", "web");

const app = express();
app.use(cors()); // the extension calls from a chrome-extension:// origin
// Resume batches on the recruiter side are the largest payload we accept.
app.use(express.json({ limit: "8mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, integrations: live });
});

app.use("/api/auth", authRoutes);

// Resolve the bearer token to a user id for every data request (falls back to
// the demo user when auth is off or no token is sent).
app.use("/api", async (req, _res, next) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  req.userId = await userIdFromToken(token);
  next();
});

// ---- job-seeker side ----
app.use("/api/master-profile", masterProfile);
app.use("/api/extract-jd", extractJd);
app.use("/api/rubric", rubricRoutes);
app.use("/api/generate-resume", generateResume);   // full tailor
app.use("/api/review-resume", reviewResume);       // quick review
app.use("/api/approve-resume", approveResume);
app.use("/api/search-resumes", searchResumes);
app.use("/api/interview-prep", interviewPrep);
app.use("/api/applications", applications);        // application memory

// ---- recruiter side ----
app.use("/api/requisitions", requisitions);

// ---- web app ----
// JOZY is not only a browser extension: the same backend serves a standalone
// web app, so the extension is one way in rather than the whole product.
app.use(express.static(WEB_DIR));
// Icons and images are shared with the extension - serve them from one place.
app.use("/assets", express.static(path.join(__dirname, "..", "assets")));
app.get(/^\/(?!api\/|health).*/, (_req, res) => {
  res.sendFile(path.join(WEB_DIR, "index.html"));
});

// Central error handler - every route forwards thrown errors here.
app.use((err, _req, res, _next) => {
  console.error("[JOZY]", err.message);
  res.status(500).json({ error: "server_error", message: err.message });
});

app.listen(config.port, async () => {
  const modes = Object.entries(live).map(([k, v]) => `${k}:${v ? "live" : "mock"}`).join("  ");
  console.log(`JOZY backend on http://localhost:${config.port}  [${modes}]`);
  console.log(`Web app: http://localhost:${config.port}/`);

  // Create the storage bucket approvals upload into. Non-fatal: a failure here
  // must not stop the server, and uploadResume creates the bucket on demand if
  // this did not run or did not work.
  try {
    const result = await db.ensureBucket();
    if (result.created) console.log(`Created the "resumes" storage bucket.`);
  } catch (e) {
    console.warn(`[JOZY] could not ensure the "resumes" storage bucket: ${e.message}`);
    console.warn(`[JOZY] resume PDFs will not upload until it exists - create a public bucket named "resumes" in Supabase Storage.`);
  }
});
