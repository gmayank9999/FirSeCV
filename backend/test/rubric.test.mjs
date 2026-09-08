// Tests for the shared rubric engine. Run with: npm test
//
// These run entirely offline (no API key), which is the point: the local
// derivation path is what every user hits before a model is configured, so it
// is the path that has to be correct.

import test from "node:test";
import assert from "node:assert/strict";
import { deriveRubric, scoreAgainstRubric, detectDomain, rankCandidates, rebalance } from "../lib/rubric.js";

const LEGAL_JD = `Associate - Corporate Law
Responsibilities
- Draft and review commercial contracts and shareholder agreements
- Support due diligence on mergers and acquisitions transactions
- Prepare legal opinions and memorandum for clients
Requirements
- LLB from a recognised university is required
- Minimum 2 years of experience in contract drafting and corporate law
- Enrolled with the Bar Council of India (mandatory)
- Strong legal research and legal drafting skills
- Familiarity with the Companies Act
- Knowledge of data protection law preferred`;

const FINANCE_JD = `Financial Analyst
Requirements
- CA or CFA required
- 3+ years in financial modelling and valuation
- Advanced Excel and variance analysis
- Experience with IFRS and statutory audit
- Exposure to equity research preferred`;

// A domain none of the lexicons know about - proves the fallback generalises.
const CULINARY_JD = `Pastry Chef
Requirements
- Must have 4 years of experience in viennoiserie and laminated dough
- Food safety certification required
- Experience with chocolate tempering and sugar work
- Ability to manage a brigade during service`;

const LEGAL_RESUME = `Priya Sharma
LLB, National Law University, 2021
Associate - 3 years of experience in contract drafting and corporate law.
Ran due diligence on mergers and acquisitions transactions.
Drafted legal opinions and memorandum. Enrolled with the Bar Council of India.
Strong legal research skills. Advised on Companies Act compliance.`;

const JUNIOR_LEGAL_RESUME = `Aman Gupta
LLB 2024 graduate. Internships covering legal research and legal drafting.
Moot court winner. Assisted on contract drafting for a small firm.`;

const SOFTWARE_RESUME = `Rahul Verma
B.Tech Computer Science
Software engineer with React, Node.js and AWS. Built microservices and CI/CD pipelines.`;

// ------------------------------------------------------------ domain detection

test("detects a legal posting rather than defaulting to tech", () => {
  assert.equal(detectDomain(LEGAL_JD), "legal");
});

test("detects a finance posting", () => {
  assert.equal(detectDomain(FINANCE_JD), "finance");
});

test("falls back to 'general' instead of guessing on unknown vocabulary", () => {
  assert.equal(detectDomain(CULINARY_JD), "general");
});

test("a single stray keyword does not label a whole posting", () => {
  assert.equal(detectDomain("We need someone organised who can use Excel occasionally."), "general");
});

// ------------------------------------------------------------ rubric structure

for (const [name, jd] of [["legal", LEGAL_JD], ["finance", FINANCE_JD], ["culinary", CULINARY_JD]]) {
  test(`${name} rubric is well-formed`, async () => {
    const r = await deriveRubric({ jdText: jd });
    assert.ok(r.criteria.length >= 4, "expected at least 4 criteria, got " + r.criteria.length);
    assert.equal(r.criteria.reduce((n, c) => n + c.weight, 0), 100, "weights must sum to exactly 100");
    for (const c of r.criteria) {
      assert.ok(c.label && c.label.length <= 80, "label must be present and short: " + c.label);
      assert.ok(c.weight >= 1, "every criterion carries weight");
      assert.ok(c.terms.length >= 1, "every criterion needs at least one searchable term");
    }
  });
}

test("no two criteria describe the same requirement", async () => {
  const r = await deriveRubric({ jdText: LEGAL_JD });
  const labels = r.criteria.map((c) => c.label.toLowerCase());
  assert.equal(new Set(labels).size, labels.length, "duplicate labels: " + labels.join(" | "));
  // The specific regression: "LLB" appearing both as a degree and as a lexicon skill.
  const llb = r.criteria.filter((c) => c.terms.some((t) => t === "llb"));
  assert.equal(llb.length, 1, "LLB must contribute weight exactly once, found " + llb.length);
});

test("scaffolding phrases do not become criteria", async () => {
  const r = await deriveRubric({ jdText: LEGAL_JD });
  const labels = r.criteria.map((c) => c.label.toLowerCase());
  // "recognised university" modifies the LLB requirement; as its own criterion
  // it double-counts LLB and, being unmeetable, caps every candidate's score.
  assert.ok(!labels.some((l) => l.includes("university")), "got: " + labels.join(" | "));
  assert.ok(!labels.some((l) => l.includes("recognised")), "got: " + labels.join(" | "));
});

test("n-grams straddling a conjunction do not become criteria", async () => {
  const r = await deriveRubric({ jdText: LEGAL_JD });
  const labels = r.criteria.map((c) => c.label.toLowerCase());
  // Cut out of "legal research and legal drafting" - not a real requirement.
  assert.ok(!labels.includes("research and legal"), "got: " + labels.join(" | "));
  for (const l of labels) {
    assert.ok(!/^(and|or|the|of|to|with|in|for) | (and|or|the|of|to|with|in|for)$/.test(l),
      "criterion should not begin or end on a stopword: " + l);
  }
});

test("real vocabulary containing 'and' survives the conjunction filter", async () => {
  const r = await deriveRubric({ jdText: LEGAL_JD });
  const labels = r.criteria.map((c) => c.label.toLowerCase());
  assert.ok(labels.includes("mergers and acquisitions"), "got: " + labels.join(" | "));
});

test("qualification labels are readable, not raw sentence fragments", async () => {
  const r = await deriveRubric({ jdText: LEGAL_JD });
  const llb = r.criteria.find((c) => c.terms.includes("llb"));
  assert.equal(llb.label, "LLB");
});

test("stated hard requirements are marked mustHave", async () => {
  const r = await deriveRubric({ jdText: LEGAL_JD });
  const mustHaves = r.criteria.filter((c) => c.mustHave).map((c) => c.label);
  assert.ok(mustHaves.length >= 1, "expected at least one hard requirement");
  assert.ok(mustHaves.includes("LLB"), "LLB is 'required' in the JD: " + mustHaves.join(", "));
});

test("an unknown domain still produces usable criteria from the text itself", async () => {
  const r = await deriveRubric({ jdText: CULINARY_JD });
  const blob = r.criteria.map((c) => c.terms.join(" ")).join(" ");
  assert.match(blob, /viennoiserie|laminated|chocolate|brigade|food safety/i);
});

// -------------------------------------------------------------------- scoring

test("ranks a matching resume above a mismatched one", async () => {
  const r = await deriveRubric({ jdText: LEGAL_JD });
  const strong = scoreAgainstRubric(r, LEGAL_RESUME).score;
  const junior = scoreAgainstRubric(r, JUNIOR_LEGAL_RESUME).score;
  const off = scoreAgainstRubric(r, SOFTWARE_RESUME).score;
  assert.ok(strong > junior, `strong (${strong}) should beat junior (${junior})`);
  assert.ok(junior > off, `junior (${junior}) should beat off-domain (${off})`);
});

test("a missing hard requirement caps the score", async () => {
  const r = await deriveRubric({ jdText: LEGAL_JD });
  const s = scoreAgainstRubric(r, SOFTWARE_RESUME);
  assert.ok(s.mustHaveGaps.length > 0, "software resume should miss the legal hard requirements");
  assert.ok(s.score <= 60, "score should be capped when hard requirements are unmet, got " + s.score);
});

test("every point of a score is traceable to a criterion", async () => {
  const r = await deriveRubric({ jdText: LEGAL_JD });
  const s = scoreAgainstRubric(r, LEGAL_RESUME);
  assert.equal(s.criteria.length, r.criteria.length);
  for (const c of s.criteria) {
    assert.equal(typeof c.contribution, "number");
    assert.ok(c.contribution <= c.weight, "a criterion cannot earn more than its weight");
    if (c.matched) assert.ok(c.evidence.length > 0, "a matched criterion must quote its evidence: " + c.label);
  }
});

test("scores stay inside 0-99", async () => {
  const r = await deriveRubric({ jdText: FINANCE_JD });
  for (const txt of [LEGAL_RESUME, SOFTWARE_RESUME, "", "CA CFA financial modelling valuation advanced excel variance analysis IFRS statutory audit equity research"]) {
    const s = scoreAgainstRubric(r, txt);
    assert.ok(s.score >= 0 && s.score <= 99, "out of range: " + s.score);
  }
});

test("an empty rubric scores 0 rather than throwing", () => {
  const s = scoreAgainstRubric({ criteria: [] }, LEGAL_RESUME);
  assert.equal(s.score, 0);
  assert.ok(s.notes.length > 0);
});

test("back-compatible matched/missing lists are populated", async () => {
  const r = await deriveRubric({ jdText: LEGAL_JD });
  const s = scoreAgainstRubric(r, LEGAL_RESUME);
  assert.ok(Array.isArray(s.matched) && s.matched.length > 0);
  assert.ok(Array.isArray(s.missing));
  assert.ok(Array.isArray(s.notes) && s.notes.length > 0);
});

test("structured resume content scores the same as its flattened text", async () => {
  const r = await deriveRubric({ jdText: LEGAL_JD });
  const structured = {
    header: { fullName: "Priya Sharma" },
    experience: [{ company: "Firm", role: "Associate", dates: "2021-2024", bullets: ["Contract drafting and corporate law", "Due diligence on mergers and acquisitions"] }],
    skills: [{ category: "Legal", items: ["legal research", "legal drafting"] }],
    education: [{ institution: "NLU", degree: "LLB", dates: "2021" }],
  };
  const s = scoreAgainstRubric(r, structured);
  assert.ok(s.score > 0, "structured content must be readable by the scorer");
  assert.ok(s.criteria.some((c) => c.matched && c.label === "LLB"), "education should evidence the degree");
});

// ------------------------------------------------------------------- ranking

test("rankCandidates orders a batch and is deterministic", async () => {
  const r = await deriveRubric({ jdText: LEGAL_JD });
  const batch = [
    { id: "a", name: "Rahul", resume_text: SOFTWARE_RESUME },
    { id: "b", name: "Priya", resume_text: LEGAL_RESUME },
    { id: "c", name: "Aman", resume_text: JUNIOR_LEGAL_RESUME },
  ];
  const first = rankCandidates(r, batch);
  assert.equal(first[0].name, "Priya");
  assert.equal(first[0].rank, 1);
  assert.equal(first[2].name, "Rahul");
  // Same input, shuffled, must produce the same order.
  const second = rankCandidates(r, [batch[2], batch[0], batch[1]]);
  assert.deepEqual(first.map((c) => c.id), second.map((c) => c.id));
});

test("rankCandidates attaches the reasoning, not just a number", async () => {
  const r = await deriveRubric({ jdText: LEGAL_JD });
  const [top] = rankCandidates(r, [{ id: "b", name: "Priya", resume_text: LEGAL_RESUME }]);
  assert.ok(top.breakdown.criteria.length > 0);
  assert.ok(top.breakdown.criteria.some((c) => c.evidence));
});

// ------------------------------------------------------------------ rebalance

test("rebalance always totals 100", () => {
  for (const input of [
    [{ weight: 1 }, { weight: 1 }, { weight: 1 }],
    [{ weight: 50 }, { weight: 3 }],
    [{ weight: 0 }, { weight: 0 }],
    [{ weight: 7 }],
  ]) {
    assert.equal(rebalance(input).reduce((n, c) => n + c.weight, 0), 100, JSON.stringify(input));
  }
  assert.deepEqual(rebalance([]), []);
});

// --------------------------------------------------------------- LLM handling

test("a failing model falls back to the local rubric instead of erroring", async () => {
  const r = await deriveRubric({ jdText: LEGAL_JD, llm: async () => { throw new Error("429 rate limited"); } });
  assert.equal(r.source, "local");
  assert.ok(r.criteria.length >= 4);
});

test("a model returning junk falls back rather than producing a broken rubric", async () => {
  const r = await deriveRubric({ jdText: LEGAL_JD, llm: async () => ({ criteria: [{ nope: 1 }] }) });
  assert.equal(r.source, "local");
});

test("a good model response is normalised to sum 100", async () => {
  const r = await deriveRubric({
    jdText: LEGAL_JD,
    llm: async () => ({
      domain: "legal",
      criteria: [
        { label: "Contract drafting", kind: "skill", weight: 40, terms: ["contract drafting", "drafting"], mustHave: true },
        { label: "Due diligence", kind: "skill", weight: 35, terms: ["due diligence"] },
        { label: "LLB", kind: "qualification", weight: 55, terms: ["llb"], mustHave: true },
      ],
    }),
  });
  assert.equal(r.source, "llm");
  assert.equal(r.criteria.reduce((n, c) => n + c.weight, 0), 100);
});
