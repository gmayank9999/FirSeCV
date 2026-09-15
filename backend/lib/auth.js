// Supabase Auth (GoTrue) helpers. The backend proxies auth so the clients
// only ever talk to this server. When Supabase is not configured, a single
// demo user is used so the app still runs.

import { config, live, DEMO_USER } from "../config.js";

function authHeaders() {
  return { apikey: config.supabase.serviceKey, "Content-Type": "application/json" };
}

function readErr(data, status) {
  return data?.msg || data?.error_description || data?.error || `auth error ${status}`;
}

/** The project hostname, for error messages. Never throws on a bad URL. */
function hostOf(url) {
  try { return new URL(url).host; } catch { return url || "(no SUPABASE_URL set)"; }
}

/**
 * Why sign-in/sign-up cannot run, or null if they can.
 *
 * Every other integration in JOZY degrades to a local fallback when its key is
 * missing; auth cannot (there is nothing to authenticate against), so it must
 * at least say so clearly instead of fetching an empty URL.
 */
export function authUnavailableReason(supabase = config.supabase) {
  if (!supabase?.url || !supabase?.serviceKey) {
    return "Accounts are not configured on this server (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY " +
      "must both be set). JOZY is running in single-user demo mode - you can use it without logging in.";
  }
  return null;
}

/**
 * Turn an opaque `fetch failed` into something a person can act on.
 *
 * undici reports every network problem as TypeError("fetch failed") with the
 * real reason on `.cause.code`. Surfacing that raw cost real debugging time
 * when a Supabase project was deleted, so the cause is named here instead.
 */
export function describeAuthFetchFailure(err, url = config.supabase.url) {
  const host = hostOf(url);
  const code = err?.cause?.code || err?.code || "";

  switch (code) {
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return `Can't reach your Supabase project at ${host} - that hostname does not resolve. ` +
        `The project has most likely been deleted or paused, or SUPABASE_URL is wrong. ` +
        `Check it at https://supabase.com/dashboard, or clear SUPABASE_URL to run in demo mode.`;
    case "ECONNREFUSED":
      return `Connection refused by ${host}. The host resolved but nothing accepted the connection - ` +
        `check SUPABASE_URL, and whether the project is paused.`;
    case "ETIMEDOUT":
    case "UND_ERR_CONNECT_TIMEOUT":
      return `Connection to ${host} timed out. Check your internet connection, VPN or proxy.`;
    case "CERT_HAS_EXPIRED":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
      return `TLS verification failed for ${host} (${code}). A proxy may be intercepting HTTPS.`;
    default:
      return `Can't reach your Supabase project at ${host}` +
        (code ? ` (${code})` : ` (${err?.message || "unknown network error"})`) +
        `. Check your connection and SUPABASE_URL.`;
  }
}

/** Marks errors the caller should report as "service unavailable", not "bad credentials". */
function unavailable(message) {
  return Object.assign(new Error(message), { code: "auth_unavailable" });
}

/** One place where every GoTrue call goes out, so every failure is explained once. */
async function authFetch(path, init) {
  const reason = authUnavailableReason();
  if (reason) throw unavailable(reason);
  try {
    return await fetch(`${config.supabase.url}${path}`, init);
  } catch (e) {
    throw unavailable(describeAuthFetchFailure(e));
  }
}

export async function signUp(email, password) {
  const redirectUrl = `http://localhost:${config.port}/api/auth/verified`;
  const res = await authFetch("/auth/v1/signup", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      email,
      password,
      options: { email_redirect_to: redirectUrl },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(readErr(data, res.status));
  return data; // { access_token?, user } — no token when email confirmation is required
}

export async function signIn(email, password) {
  const res = await authFetch("/auth/v1/token?grant_type=password", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(readErr(data, res.status));
  return data; // { access_token, refresh_token, user }
}

/** Send a password-recovery email. The reset is completed in the web app,
 * because an email link cannot reliably return to a Chrome side panel. */
export async function requestPasswordReset(email) {
  const redirectTo = `http://localhost:${config.port}/reset-password`;
  // GoTrue reads redirect_to from the query string. Sending an SDK-shaped
  // `options.redirectTo` body is silently ignored and sends people to Site URL
  // (the login page), which is exactly the fallback we must avoid here.
  const res = await authFetch(`/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ email }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(readErr(data, res.status));
  return data;
}

/** A recovery link supplies a short-lived access token. Exchange it only for
 * the requested password update; never store this token on the server. */
export async function resetPassword(accessToken, password) {
  const res = await authFetch("/auth/v1/user", {
    method: "PUT",
    headers: { ...authHeaders(), Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(readErr(data, res.status));
  return data;
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
    // Data requests must not fail closed on a transient auth outage - the
    // signup/login routes are where an unreachable project gets reported.
  }
  return DEMO_USER;
}
