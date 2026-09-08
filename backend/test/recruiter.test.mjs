// Tests for the recruiter side: requisitions, stored rubrics, batch screening,
// and the human-override bookkeeping that makes the shortlist defensible.

import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = "";
process.env.SUPABASE_SERVICE_ROLE_KEY = "";

const rec = await import("../lib/recruiter.js");
const { deriveRubric } = await import("../lib/rubric.js");

const U = "recruiter-1";
const OTHER = "recruiter-2";

const JD = `Associate - Corporate Law
Requirements
- LLB from a recognised university is required
- Minimum 2 years of experience in contract drafting and corporate law
- Strong legal research and legal drafting skills
- Experience with due diligence on mergers and acquisitions`;

const STRONG = `Priya Sharma
priya@example.com
LLB, National Law University
3 years of contract drafting and corporate law. Due diligence on mergers and acquisitions.
Strong legal research and legal drafting.`;

const MIDDLING = `Aman Gupta
aman@example.com
LLB 2024. Internships in legal research and legal drafting.`;

const WEAK = `Rahul Verma
rahul@example.com
B.Tech. Software engineer with React and Node.js.`;

async function seed() {
  rec._resetMemory();
  const rubric = await deriveRubric({ jdText: JD });
  const req = await rec.createRequisition(U, { title: "Associate - Corporate Law", company: "Firm", jdText: JD, rubric });
  return req;
}

// -------------------------------------------------------------- requisitions

test("a requisition stores its rubric so screening is reproducible", async () => {
  const req = await seed();
  assert.equal(req.domain, "legal");
  assert.ok(req.rubric.criteria.length >= 4);
  assert.equal(req.rubric.criteria.reduce((n, c) => n + c.weight, 0), 100);
  assert.equal(req.status, "open");
});

test("requisitions are scoped to their owner", async () => {
  const req = await seed();
  assert.equal((await rec.listRequisitions(U)).length, 1);
  assert.equal((await rec.listRequisitions(OTHER)).length, 0);
  assert.equal(await rec.getRequisition(OTHER, req.id), null);
});

test("editing rubric weights re-normalises them to 100", async () => {
  const req = await seed();
  const updated = await rec.updateRequisition(U, req.id, {
    rubric: {
      domain: "legal",
      criteria: [
        { label: "Contract drafting", kind: "skill", weight: 90, terms: ["contract drafting"], mustHave: true },
        { label: "Legal research", kind: "skill", weight: 30, terms: ["legal research"] },
        { label: "LLB", kind: "qualification", weight: 30, terms: ["llb"], mustHave: true },
      ],
    },
  });
  assert.equal(updated.rubric.criteria.reduce((n, c) => n + c.weight, 0), 100);
  assert.ok(updated.rubric.criteria[0].weight > updated.rubric.criteria[1].weight, "proportions are preserved");
});

test("rubric terms can be supplied as a comma-separated string from a form", async () => {
  const req = await seed();
  const updated = await rec.updateRequisition(U, req.id, {
    rubric: { criteria: [{ label: "Drafting", weight: 100, terms: "contract drafting, drafting, redlining" }] },
  });
  assert.deepEqual(updated.rubric.criteria[0].terms, ["contract drafting", "drafting", "redlining"]);
});

test("deleting a requisition removes its candidates too", async () => {
  const req = await seed();
  await rec.addCandidates(U, req.id, [{ resumeText: STRONG }]);
  await rec.deleteRequisition(U, req.id);
  assert.equal(await rec.getRequisition(U, req.id), null);
  assert.equal((await rec.listCandidates(U, req.id)).length, 0);
});

// ----------------------------------------------------------------- screening

test("candidates are scored on arrival and ranked by score", async () => {
  const req = await seed();
  await rec.addCandidates(U, req.id, [
    { resumeText: WEAK }, { resumeText: STRONG }, { resumeText: MIDDLING },
  ]);
  const list = await rec.listCandidates(U, req.id);
  assert.equal(list.length, 3);
  assert.equal(list[0].name, "Priya Sharma", "strongest first");
  assert.equal(list[2].name, "Rahul Verma", "weakest last");
  assert.ok(list[0].score > list[1].score);
});

test("name and email are recovered from a pasted resume", async () => {
  const req = await seed();
  const [c] = await rec.addCandidates(U, req.id, [{ resumeText: STRONG }]);
  assert.equal(c.name, "Priya Sharma");
  assert.equal(c.email, "priya@example.com");
});

test("an explicit name beats the guess", async () => {
  const req = await seed();
  const [c] = await rec.addCandidates(U, req.id, [{ name: "Ms. P. Sharma", resumeText: STRONG }]);
  assert.equal(c.name, "Ms. P. Sharma");
});

test("every score carries its per-criterion reasoning", async () => {
  const req = await seed();
  const [c] = await rec.addCandidates(U, req.id, [{ resumeText: STRONG }]);
  assert.ok(c.breakdown.criteria.length > 0);
  assert.ok(c.breakdown.criteria.some((x) => x.matched && x.evidence), "a match must quote the resume");
  assert.ok(Array.isArray(c.breakdown.notes));
});

test("empty resumes are skipped rather than stored as zero-score noise", async () => {
  const req = await seed();
  const added = await rec.addCandidates(U, req.id, [{ resumeText: "   " }, { resumeText: STRONG }]);
  assert.equal(added.length, 1);
});

test("adding candidates to a missing requisition returns null", async () => {
  rec._resetMemory();
  assert.equal(await rec.addCandidates(U, "nope", [{ resumeText: STRONG }]), null);
});

test("re-scoring after a weight change moves the ranking", async () => {
  const req = await seed();
  await rec.addCandidates(U, req.id, [{ resumeText: STRONG }, { resumeText: MIDDLING }]);
  const before = (await rec.listCandidates(U, req.id)).find((c) => c.name === "Aman Gupta").score;

  // Make the rubric care only about what the junior candidate does have.
  await rec.updateRequisition(U, req.id, {
    rubric: { domain: "legal", criteria: [{ label: "Legal research", kind: "skill", weight: 100, terms: ["legal research"] }] },
  });
  const rescored = await rec.rescoreAll(U, req.id);
  const after = rescored.find((c) => c.name === "Aman Gupta").score;
  assert.ok(after > before, `expected the junior candidate to rise (${before} -> ${after})`);
  assert.ok(rescored.every((c) => c.rank > 0), "ranks are assigned");
});

// ------------------------------------------------------------------ decisions

test("a human decision is recorded as a human decision", async () => {
  const req = await seed();
  const [c] = await rec.addCandidates(U, req.id, [{ resumeText: STRONG }]);
  const decided = await rec.decideCandidate(U, c.id, "shortlist");
  assert.equal(decided.decision, "shortlist");
  assert.equal(decided.decidedBy, "human");
});

test("an invalid decision is rejected", async () => {
  const req = await seed();
  const [c] = await rec.addCandidates(U, req.id, [{ resumeText: STRONG }]);
  assert.equal(await rec.decideCandidate(U, c.id, "maybe"), null);
});

test("summary counts decisions and reports rubric/human agreement", async () => {
  const req = await seed();
  const added = await rec.addCandidates(U, req.id, [
    { resumeText: STRONG }, { resumeText: MIDDLING }, { resumeText: WEAK },
  ]);
  const byName = Object.fromEntries(added.map((c) => [c.name, c]));

  // A recruiter who agrees with the ranking should show high agreement.
  await rec.decideCandidate(U, byName["Priya Sharma"].id, "shortlist");
  await rec.decideCandidate(U, byName["Rahul Verma"].id, "reject");

  const s = await rec.requisitionSummary(U, req.id);
  assert.equal(s.total, 3);
  assert.equal(s.shortlisted, 1);
  assert.equal(s.rejected, 1);
  assert.equal(s.pending, 1);
  assert.equal(s.humanDecisions, 2);
  assert.equal(s.rubricAgreement, 100, "the rubric agreed with both calls");
  assert.equal(typeof s.medianScore, "number");
});

test("agreement is withheld until there is enough evidence to compute it", async () => {
  const req = await seed();
  const [c] = await rec.addCandidates(U, req.id, [{ resumeText: STRONG }]);
  assert.equal((await rec.requisitionSummary(U, req.id)).rubricAgreement, null);
  await rec.decideCandidate(U, c.id, "shortlist");
  assert.equal((await rec.requisitionSummary(U, req.id)).rubricAgreement, null, "one decision is not a correlation");
});

test("summary of an empty requisition is safe", async () => {
  const req = await seed();
  const s = await rec.requisitionSummary(U, req.id);
  assert.equal(s.total, 0);
  assert.equal(s.topScore, null);
  assert.equal(s.medianScore, null);
  assert.equal(s.rubricAgreement, null);
});
