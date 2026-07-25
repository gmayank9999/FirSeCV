import { Router } from "express";
import * as auth from "../lib/auth.js";

export const authRoutes = Router();

function sessionShape(data) {
  return {
    accessToken: data.access_token || null,
    user: data.user ? { id: data.user.id, email: data.user.email } : null,
  };
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
