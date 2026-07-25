import express from "express";
import cors from "cors";
import { config, live } from "./config.js";
import { masterProfile } from "./routes/masterProfile.js";
import { extractJd } from "./routes/extractJd.js";
import { generateResume } from "./routes/generateResume.js";
import { approveResume } from "./routes/approveResume.js";
import { searchResumes } from "./routes/searchResumes.js";
import { interviewPrep } from "./routes/interviewPrep.js";
import { authRoutes } from "./routes/auth.js";
import { userIdFromToken } from "./lib/auth.js";

const app = express();
app.use(cors()); // extension calls from a chrome-extension:// origin
app.use(express.json({ limit: "1mb" }));

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

app.use("/api/master-profile", masterProfile);
app.use("/api/extract-jd", extractJd);
app.use("/api/generate-resume", generateResume);
app.use("/api/approve-resume", approveResume);
app.use("/api/search-resumes", searchResumes);
app.use("/api/interview-prep", interviewPrep);

// Central error handler - every route forwards thrown errors here.
app.use((err, _req, res, _next) => {
  console.error("[FirSeCV]", err.message);
  res.status(500).json({ error: "server_error", message: err.message });
});

app.listen(config.port, () => {
  const modes = Object.entries(live).map(([k, v]) => `${k}:${v ? "live" : "mock"}`).join("  ");
  console.log(`FirSeCV backend on http://localhost:${config.port}  [${modes}]`);
});
