// Supabase Auth (GoTrue) helpers. The backend proxies auth so the extension
// only ever talks to this server. When Supabase is not configured, a single
// demo user is used so the app still runs.

import { config, live, DEMO_USER } from "../config.js";

function authHeaders() {
  return { apikey: config.supabase.serviceKey, "Content-Type": "application/json" };
}

function readErr(data, status) {
  return data?.msg || data?.error_description || data?.error || `auth error ${status}`;
}

export async function signUp(email, password) {
  const redirectUrl = `http://localhost:${config.port}/api/auth/verified`;
  const res = await fetch(`${config.supabase.url}/auth/v1/signup`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      email,
      password,
      options: { email_redirect_to: redirectUrl }
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(readErr(data, res.status));
  return data; // { access_token?, user } — no token when email confirmation is required
}

export async function signIn(email, password) {
  const res = await fetch(`${config.supabase.url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(readErr(data, res.status));
  return data; // { access_token, refresh_token, user }
}

// Resolve an access token to a user id (verified against Supabase). Falls back
// to the demo user when auth is off or the token is missing/invalid. Cached
// briefly to avoid a network round trip on every request.
const cache = new Map(); // token -> { id, ts }
export async function userIdFromToken(token) {
  if (!live.supabase || !token) return DEMO_USER;
  const hit = cache.get(token);
  if (hit && Date.now() - hit.ts < 60000) return hit.id;
  try {
    const res = await fetch(`${config.supabase.url}/auth/v1/user`, {
      headers: { apikey: config.supabase.serviceKey, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return DEMO_USER;
    const user = await res.json();
    if (user?.id) {
      cache.set(token, { id: user.id, ts: Date.now() });
      return user.id;
    }
  } catch {
    /* fall through */
  }
  return DEMO_USER;
}
