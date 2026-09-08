// Tests for application memory - the follow-up and timeline logic that makes
// a six-month reply window survivable. Runs against the in-memory store.

import test from "node:test";
import assert from "node:assert/strict";

// Pin the store to its in-memory path before anything reads config. dotenv does
// not overwrite keys that already exist, so setting these blank neutralises a
// developer's real .env and keeps the suite offline and deterministic.
process.env.SUPABASE_URL = "";
process.env.SUPABASE_SERVICE_ROLE_KEY = "";

const {
  createApplication, listApplications, getApplication, updateApplication,
  deleteApplication, overview, followUpState, STATUSES, isStatus, _resetMemory,
} = await import("../lib/applications.js");

const U = "test-user";
const OTHER = "other-user";

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

test.beforeEach(() => _resetMemory());

// ------------------------------------------------------------------- basics

test("an application can be logged without any resume being generated", async () => {
  const a = await createApplication(U, { company: "Amex", position: "Analyst" });
  assert.equal(a.company, "Amex");
  assert.equal(a.status, "applied");
  assert.equal(a.resumeVersionId, null);
  assert.equal(a.statusHistory.length, 1);
});

test("the domain is inferred when not supplied", async () => {
  const a = await createApplication(U, {
    company: "Firm", position: "Associate",
    jdText: "Contract drafting, due diligence, legal research, corporate law, LLB required",
  });
  assert.equal(a.domain, "legal");
});

test("applications are scoped to their user", async () => {
  await createApplication(U, { company: "Mine", position: "Role" });
  await createApplication(OTHER, { company: "Theirs", position: "Role" });
  const mine = await listApplications(U);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].company, "Mine");
  assert.equal(await getApplication(U, (await listApplications(OTHER))[0].id), null);
});

test("search finds an application by company, role or notes", async () => {
  await createApplication(U, { company: "Razorpay", position: "Backend Engineer", notes: "referred by Kartik" });
  await createApplication(U, { company: "Zomato", position: "Data Analyst" });
  assert.equal((await listApplications(U, { q: "razor" })).length, 1);
  assert.equal((await listApplications(U, { q: "analyst" })).length, 1);
  assert.equal((await listApplications(U, { q: "kartik" })).length, 1, "notes should be searchable");
  assert.equal((await listApplications(U, { q: "nothing" })).length, 0);
});

test("listing can filter by status", async () => {
  await createApplication(U, { company: "A", position: "R", status: "interview" });
  await createApplication(U, { company: "B", position: "R", status: "applied" });
  const interviews = await listApplications(U, { status: "interview" });
  assert.equal(interviews.length, 1);
  assert.equal(interviews[0].company, "A");
});

test("an unknown status is rejected by isStatus", () => {
  assert.ok(isStatus("offer"));
  assert.ok(!isStatus("banana"));
  assert.equal(STATUSES.length, 7);
});

// ------------------------------------------------------------------ timeline

test("a status change appends to the timeline instead of overwriting it", async () => {
  const a = await createApplication(U, { company: "Amex", position: "Analyst" });
  const b = await updateApplication(U, a.id, { status: "screening", note: "recruiter emailed" });
  const c = await updateApplication(U, a.id, { status: "interview" });
  assert.equal(c.status, "interview");
  assert.equal(c.statusHistory.length, 3, "created + two moves");
  assert.deepEqual(c.statusHistory.map((h) => h.status), ["applied", "screening", "interview"]);
  assert.equal(b.statusHistory[1].note, "recruiter emailed");
});

test("re-setting the same status does not pad the timeline", async () => {
  const a = await createApplication(U, { company: "X", position: "Y" });
  const b = await updateApplication(U, a.id, { status: "applied" });
  assert.equal(b.statusHistory.length, 1);
});

test("editing fields leaves the timeline alone", async () => {
  const a = await createApplication(U, { company: "X", position: "Y" });
  const b = await updateApplication(U, a.id, { notes: "phone screen went well", tags: ["referral"] });
  assert.equal(b.notes, "phone screen went well");
  assert.deepEqual(b.tags, ["referral"]);
  assert.equal(b.statusHistory.length, 1);
});

test("updating a missing application returns null rather than throwing", async () => {
  assert.equal(await updateApplication(U, "nope", { status: "offer" }), null);
  assert.equal(await deleteApplication(U, "nope"), false);
});

// ----------------------------------------------------------------- follow-ups

test("a fresh application does not need chasing", () => {
  const s = followUpState({ status: "applied", applied_at: daysAgo(2), updated_at: daysAgo(2) });
  assert.equal(s.needsFollowUp, false);
});

test("silence past the stage's normal window raises a follow-up", () => {
  const s = followUpState({ status: "applied", applied_at: daysAgo(40), updated_at: daysAgo(40) });
  assert.equal(s.needsFollowUp, true);
  assert.equal(s.daysSinceUpdate, 40);
  assert.match(s.followUpReason, /40 days/);
});

test("interviewing goes stale sooner than applied", () => {
  const at12 = { applied_at: daysAgo(12), updated_at: daysAgo(12) };
  assert.equal(followUpState({ ...at12, status: "interview" }).needsFollowUp, true);
  assert.equal(followUpState({ ...at12, status: "applied" }).needsFollowUp, false);
});

test("terminal states are never chased", () => {
  for (const status of ["offer", "rejected", "withdrawn"]) {
    const s = followUpState({ status, applied_at: daysAgo(400), updated_at: daysAgo(400) });
    assert.equal(s.needsFollowUp, false, status + " should not raise a follow-up");
  }
});

test("a saved-but-not-applied role is not chased for a reply", () => {
  const s = followUpState({ status: "saved", applied_at: daysAgo(90), updated_at: daysAgo(90) });
  assert.equal(s.needsFollowUp, false);
});

test("an explicit next action that has come due raises a follow-up", () => {
  const s = followUpState({
    status: "applied", applied_at: daysAgo(3), updated_at: daysAgo(3),
    next_action: "Email the recruiter", next_action_at: daysAgo(1).slice(0, 10),
  });
  assert.equal(s.needsFollowUp, true);
  assert.equal(s.followUpReason, "Email the recruiter");
});

test("a future next action does not raise a follow-up yet", () => {
  const future = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  const s = followUpState({ status: "applied", applied_at: daysAgo(3), updated_at: daysAgo(3), next_action: "Ping", next_action_at: future });
  assert.equal(s.needsFollowUp, false);
});

test("moving an application forward clears the follow-up it resolved", async () => {
  const a = await createApplication(U, {
    company: "Amex", position: "Analyst",
    nextAction: "Chase recruiter", nextActionAt: daysAgo(2).slice(0, 10),
  });
  assert.equal((await getApplication(U, a.id)).needsFollowUp, true);
  const moved = await updateApplication(U, a.id, { status: "screening" });
  assert.equal(moved.nextAction, "");
  assert.equal(moved.needsFollowUp, false);
});

test("a status move can set a new follow-up in the same patch", async () => {
  const a = await createApplication(U, { company: "Amex", position: "Analyst" });
  const moved = await updateApplication(U, a.id, {
    status: "interview", nextAction: "Prep system design", nextActionAt: daysAgo(1).slice(0, 10),
  });
  assert.equal(moved.nextAction, "Prep system design");
  assert.equal(moved.needsFollowUp, true);
});

// ------------------------------------------------------------------ overview

test("overview reports the pipeline, the funnel and what needs chasing", async () => {
  await createApplication(U, { company: "Old", position: "R", appliedAt: daysAgo(60) });
  await createApplication(U, { company: "New", position: "R" });
  await createApplication(U, { company: "Talking", position: "R", status: "interview" });
  await createApplication(U, { company: "Won", position: "R", status: "offer" });
  await createApplication(U, { company: "Bookmarked", position: "R", status: "saved" });

  const o = await overview(U);
  assert.equal(o.total, 5);
  assert.equal(o.byStatus.applied, 2);
  assert.equal(o.byStatus.offer, 1);
  assert.equal(o.byStatus.saved, 1);

  // "saved" is not an application yet, so it is out of the funnel denominator.
  assert.equal(o.funnel.applied, 4);
  assert.equal(o.funnel.callbacks, 2, "interview + offer reached a callback");
  assert.equal(o.funnel.offers, 1);
  assert.equal(o.funnel.callbackRate, 50);

  assert.equal(o.followUpCount, 1, "only the 60-day-old one is stale");
  assert.equal(o.followUps[0].company, "Old");
  assert.equal(o.longestWait.company, "Old");
});

test("overview on an empty account does not divide by zero", async () => {
  const o = await overview(U);
  assert.equal(o.total, 0);
  assert.equal(o.funnel.callbackRate, 0);
  assert.equal(o.longestWait, null);
  assert.deepEqual(o.followUps, []);
});

test("follow-ups are ordered by how long they have been waiting", async () => {
  await createApplication(U, { company: "Older", position: "R", appliedAt: daysAgo(90) });
  await createApplication(U, { company: "Old", position: "R", appliedAt: daysAgo(30) });
  const o = await overview(U);
  assert.deepEqual(o.followUps.map((a) => a.company), ["Older", "Old"]);
});
