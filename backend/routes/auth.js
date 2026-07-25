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

// POST /api/auth/signup — { email, password }
authRoutes.post("/signup", async (req, res) => {
  try {
    const { email = "", password = "" } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "email_password_required" });
    const data = await auth.signUp(email, password);
    const out = sessionShape(data);
    res.json({ ...out, needsConfirmation: !out.accessToken });
  } catch (e) {
    res.status(400).json({ error: "signup_failed", message: e.message });
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
    res.status(401).json({ error: "login_failed", message: e.message });
  }
});
