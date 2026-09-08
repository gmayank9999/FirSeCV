// Tests for resume storage.
//
// These exist because ensureBucket() was written, exported, and then never
// called by anything - so the "resumes" bucket was never created and every
// approval died on {"code":"NoSuchBucket"}. Creating the bucket at startup is
// half the fix; the other half is that a storage failure must never cost the
// user the application record, which is the whole product.

import test from "node:test";
import assert from "node:assert/strict";

// A well-formed but fake project, so live.supabase is true and the REST paths
// are exercised. Every request is stubbed - nothing leaves the machine.
process.env.SUPABASE_URL = "https://stub-project.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "stub-service-key";

const db = await import("../lib/supabase.js");

const PDF = new Uint8Array([37, 80, 68, 70]); // "%PDF"

/** Install a fetch stub that records calls and replies from a handler. */
function stubFetch(handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET" });
    const res = await handler(String(url), init, calls.length);
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      text: async () => res.body || "",
      json: async () => JSON.parse(res.body || "{}"),
      headers: { get: () => null },
    };
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const NO_BUCKET = JSON.stringify({ statusCode: "404", error: "Bucket not found", message: "Bucket not found", code: "NoSuchBucket" });

test("a missing bucket is created and the upload retried, not failed", async () => {
  const { calls, restore } = stubFetch(async (url, init) => {
    if (url.includes("/storage/v1/bucket") && init.method === "POST") return { status: 200, body: '{"name":"resumes"}' };
    if (url.includes("/storage/v1/object/resumes/")) {
      // First upload fails with NoSuchBucket; the retry after creation succeeds.
      const uploads = calls.filter((c) => c.url.includes("/storage/v1/object/resumes/")).length;
      return uploads === 1 ? { status: 400, body: NO_BUCKET } : { status: 200, body: "{}" };
    }
    return { status: 200, body: "{}" };
  });

  try {
    const out = await db.uploadResume("user-1", { company: "Acme", position: "Engineer", pdfBytes: PDF });
    assert.equal(out.hasPdf, true, "the upload should ultimately succeed");
    assert.match(out.url, /\/storage\/v1\/object\/public\/resumes\//, "a public URL should come back");

    const bucketCreates = calls.filter((c) => c.url.includes("/storage/v1/bucket") && c.method === "POST");
    assert.equal(bucketCreates.length, 1, "the bucket should be created exactly once");
    const uploads = calls.filter((c) => c.url.includes("/storage/v1/object/resumes/"));
    assert.equal(uploads.length, 2, "the upload should be retried once after creating the bucket");
  } finally { restore(); }
});

test("a successful first upload does not touch the bucket API", async () => {
  const { calls, restore } = stubFetch(async () => ({ status: 200, body: "{}" }));
  try {
    const out = await db.uploadResume("user-1", { company: "Acme", position: "Engineer", pdfBytes: PDF });
    assert.equal(out.hasPdf, true);
    assert.equal(calls.filter((c) => c.url.includes("/storage/v1/bucket")).length, 0, "no bucket call needed on the happy path");
  } finally { restore(); }
});

test("a non-bucket upload failure is not retried and reports the status", async () => {
  const { calls, restore } = stubFetch(async () => ({ status: 413, body: "Payload too large" }));
  try {
    await assert.rejects(
      () => db.uploadResume("user-1", { company: "Acme", position: "Engineer", pdfBytes: PDF }),
      /413/,
      "the real status should reach the caller");
    assert.equal(calls.filter((c) => c.url.includes("/storage/v1/object/resumes/")).length, 1, "must not retry a non-bucket error");
  } finally { restore(); }
});

test("a retry that still fails surfaces an error rather than claiming success", async () => {
  const { restore } = stubFetch(async (url, init) => {
    if (url.includes("/storage/v1/bucket") && init.method === "POST") return { status: 200, body: "{}" };
    return { status: 400, body: NO_BUCKET };
  });
  try {
    await assert.rejects(() => db.uploadResume("u", { company: "A", position: "B", pdfBytes: PDF }), /NoSuchBucket|Bucket not found|400/);
  } finally { restore(); }
});

test("no PDF means no upload attempt at all", async () => {
  const { calls, restore } = stubFetch(async () => ({ status: 200, body: "{}" }));
  try {
    const out = await db.uploadResume("user-1", { company: "Acme", position: "Engineer", pdfBytes: null });
    assert.equal(out.hasPdf, false);
    assert.equal(out.url, "");
    assert.equal(calls.length, 0, "nothing should be sent when there is no file");
  } finally { restore(); }
});

test("ensureBucket treats an already-existing bucket as success", async () => {
  for (const [status, body] of [[409, "Duplicate"], [400, '{"error":"Key (id)=(resumes) already exists"}']]) {
    const { restore } = stubFetch(async () => ({ status, body }));
    try {
      const out = await db.ensureBucket();
      assert.equal(out.ok, true, `status ${status} should be treated as success`);
    } finally { restore(); }
  }
});

test("the storage path is namespaced per user and slugged", async () => {
  const { restore } = stubFetch(async () => ({ status: 200, body: "{}" }));
  try {
    const out = await db.uploadResume("user-42", { company: "Acme Corp!", position: "Senior Engineer", pdfBytes: PDF });
    assert.match(out.path, /^user-42\/acme-corp_senior-engineer_\d+\.pdf$/);
  } finally { restore(); }
});
