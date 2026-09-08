// Tests for auth failure reporting.
//
// These exist because a real incident was hard to diagnose: a deleted Supabase
// project surfaced to the user as {"error":"signup_failed","message":"fetch
// failed"}, which says nothing about what broke or what to do. The two helpers
// under test are pure so the diagnosis logic can be checked without a network
// or a particular .env.

import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = "";
process.env.SUPABASE_SERVICE_ROLE_KEY = "";

const { authUnavailableReason, describeAuthFetchFailure } = await import("../lib/auth.js");

const LIVE = { url: "https://abcdefghijklmnop.supabase.co", serviceKey: "service-role-key" };

// ------------------------------------------------- auth not configured at all

test("auth reports itself unavailable when Supabase is not configured", () => {
  const reason = authUnavailableReason({ url: "", serviceKey: "" });
  assert.ok(reason, "expected a reason string");
  assert.match(reason, /demo mode/i, "should tell the user they can proceed without logging in");
  assert.match(reason, /SUPABASE_URL/, "should name the missing setting");
});

test("a half-configured Supabase is treated as unavailable, not attempted", () => {
  assert.ok(authUnavailableReason({ url: LIVE.url, serviceKey: "" }));
  assert.ok(authUnavailableReason({ url: "", serviceKey: LIVE.serviceKey }));
});

test("a fully configured Supabase reports no reason", () => {
  assert.equal(authUnavailableReason(LIVE), null);
});

// ------------------------------------------------------ network failure shape

/** Build the error undici actually throws, with its nested cause. */
function fetchError(code) {
  const err = new TypeError("fetch failed");
  err.cause = Object.assign(new Error(code), { code });
  return err;
}

test("a missing project hostname is explained, not passed through as 'fetch failed'", () => {
  const msg = describeAuthFetchFailure(fetchError("ENOTFOUND"), LIVE.url);
  assert.doesNotMatch(msg, /^fetch failed$/, "the opaque message must not survive");
  assert.match(msg, /abcdefghijklmnop\.supabase\.co/, "should name the host that failed");
  assert.match(msg, /deleted|paused|does not exist|no longer/i, "should state the likely cause");
  assert.match(msg, /SUPABASE_URL/, "should point at the setting to check");
});

test("a refused connection is distinguished from a missing host", () => {
  const msg = describeAuthFetchFailure(fetchError("ECONNREFUSED"), LIVE.url);
  assert.match(msg, /refused/i);
  assert.doesNotMatch(msg, /deleted/i, "a refused connection is not a deleted project");
});

test("a timeout is distinguished and mentions connectivity", () => {
  for (const code of ["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"]) {
    const msg = describeAuthFetchFailure(fetchError(code), LIVE.url);
    assert.match(msg, /timed out/i, code);
  }
});

test("an unrecognised failure still names the host and stays actionable", () => {
  const msg = describeAuthFetchFailure(fetchError("ECONNRESET"), LIVE.url);
  assert.match(msg, /abcdefghijklmnop\.supabase\.co/);
  assert.match(msg, /ECONNRESET/, "keep the underlying code for support");
});

test("a malformed URL does not crash the explainer", () => {
  const msg = describeAuthFetchFailure(fetchError("ENOTFOUND"), "not a url");
  assert.ok(typeof msg === "string" && msg.length > 0);
});

test("an error with no cause is still described", () => {
  const msg = describeAuthFetchFailure(new TypeError("fetch failed"), LIVE.url);
  assert.ok(typeof msg === "string" && msg.length > 0);
  assert.doesNotMatch(msg, /^fetch failed$/);
});
