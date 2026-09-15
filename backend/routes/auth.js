import { Router } from "express";
import * as auth from "../lib/auth.js";

export const authRoutes = Router();

function sessionShape(data) {
  return {
    accessToken: data.access_token || null,
    user: data.user ? { id: data.user.id, email: data.user.email } : null,
  };
}

// GET /api/auth/verified — target for Supabase email redirect
authRoutes.get("/verified", (req, res) => {
  res.send(`
    <html>
      <body style="font-family:sans-serif; display:flex; align-items:center; justify-content:center; height:100vh; background:#ffffff; color:#37352f;">
        <div style="text-align:center; padding:2rem; border-radius:8px; border:1px solid rgba(55,53,47,0.16); box-shadow:rgba(15,15,15,0.05) 0px 0px 0px 1px, rgba(15,15,15,0.1) 0px 3px 6px;">
          <h1 style="margin-top:0; color:#0f7b6c;">Verified Successfully!</h1>
          <p>Your email has been verified. You can now close this tab and log in from the extension.</p>
        </div>
      </body>
    </html>
  `);
});

// A server that cannot reach its auth provider is unavailable (503), not a
// client sending bad credentials (400/401). Conflating the two is what made a
// deleted Supabase project look like a rejected signup.
function fail(res, e, fallbackStatus, fallbackError) {
  if (e.code === "auth_unavailable") {
    console.error("[JOZY] auth unavailable:", e.message);
    return res.status(503).json({ error: "auth_unavailable", message: e.message });
  }
  res.status(fallbackStatus).json({ error: fallbackError, message: e.message });
}

// POST /api/auth/signup — { email, password }
authRoutes.post("/signup", async (req, res) => {
  try {
    const { email = "", password = "" } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "email_password_required" });
    const data = await auth.signUp(email, password);
    const out = sessionShape(data);
    res.json({ ...out, needsConfirmation: !out.accessToken });
  } catch (e) {
    fail(res, e, 400, "signup_failed");
  }
});

// POST /api/auth/login — { email, password }
authRoutes.post("/login", async (req, res) => {
  try {
    const { email = "", password = "" } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "email_password_required" });
    const data = await auth.signIn(email, password);
    res.json(sessionShape(data));
  } catch (e) {
    fail(res, e, 401, "login_failed");
  }
});

// Always phrase a successful request generically on the client. Supabase
// deliberately does not disclose whether an email belongs to an account.
authRoutes.post("/forgot-password", async (req, res) => {
  try {
    const { email = "" } = req.body || {};
    if (!email.trim()) return res.status(400).json({ error: "email_required", message: "Enter your email address." });
    await auth.requestPasswordReset(email.trim());
    res.json({ ok: true });
  } catch (e) {
    fail(res, e, 400, "password_reset_failed");
  }
});

// The recovery access token arrives in the URL fragment on /reset-password.
// It is posted directly to this one-purpose endpoint and never persisted.
authRoutes.post("/reset-password", async (req, res) => {
  try {
    const { accessToken = "", password = "" } = req.body || {};
    if (!accessToken) return res.status(400).json({ error: "invalid_recovery", message: "This reset link is missing or has expired." });
    if (password.length < 6) return res.status(400).json({ error: "weak_password", message: "Password must be at least 6 characters." });
    await auth.resetPassword(accessToken, password);
    res.json({ ok: true });
  } catch (e) {
    fail(res, e, 400, "password_reset_failed");
  }
});
