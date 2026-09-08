# JOZY — product direction

The record of *why* the codebase is shaped the way it is. Written from the
Week-1 Venture Audit and the Customer & Need Discovery deck.

## The pivot

JOZY started as a Chrome extension that tailors a resume to a job description.
Discovery moved it off that premise.

| We assumed | Interviews showed |
|---|---|
| The pain is 20–30 min of tailoring per application | The pain is **memory loss across a 19–24 week reply window** |
| Everyone wants a full rewrite every time | *"Not every application needs full tailoring, sometimes I just want it reviewed"* |
| Keyword matching is a solved commodity | Generic ATS logic **assumes tech roles** and fails for law |
| One customer: the job seeker | The recruiter has **the same problem from the other end** |

The strongest single piece of evidence: a candidate applied to Amex in January
and was called in July — six months later — with no reliable memory of what
they had sent. Concrete, dated, and unaddressed by any competitor.

## What that means in code

**1. Applications, not resumes, are the core model.**
`backend/lib/applications.js` is independent of resume generation. An
application can be logged from anywhere, backfilled with a past date, and
carries an append-only `status_history`. The dashboard leads with follow-ups
due, not with a "tailor a resume" button. Follow-up thresholds (21 / 14 / 10
days by stage) are calibrated to the reply windows people reported, not to a
generic "chase after a week" rule that would only produce noise.

**2. Effort is an explicit choice.**
Two endpoints, neither of them the default: `POST /api/review-resume` diagnoses
and advises without ever rewriting; `POST /api/generate-resume` rewrites from
the master profile. The UI presents them side by side.

**3. The scorer is domain-aware and explainable.**
`backend/lib/rubric.js` carries vocabularies for law, finance, healthcare,
marketing, sales, design, operations, HR and education, plus a general path
that derives criteria from the posting's own language. Every score decomposes
into named, weighted criteria with a quote from the resume as evidence.

**4. One engine serves both sides.**
`scoreAgainstRubric()` powers the applicant's match score; `rankCandidates()`
powers the recruiter's shortlist. Same function, same rubric shape. This is
what makes the two-sided thesis testable: the recruiter workspace reports
`rubricAgreement`, the percentage of a recruiter's real shortlist/reject calls
that the rubric ranking agreed with. The roadmap's success indicator — *"ATS
score correlates with recruiter manual shortlisting"* — is computed live rather
than asserted in a deck.

**5. JOZY is not the extension.**
`web/` is a standalone app on the same backend. The side panel is one way in —
the fastest one when you are already on a posting — but the dashboard,
backfilling history, and the whole recruiter side live in the web app.

## Deliberate design decisions

- **A missing hard requirement caps the score** rather than deducting from it.
  A posting that says "LLB required" is not asking for 80% of an LLB.
- **The rubric is stored on the requisition**, not recomputed per screening
  run, so a shortlist stays reproducible and defensible months later.
- **Recruiters edit weights before anyone is screened.** Discovery found
  shortlisting criteria "live in a reviewer's head"; the fix is to make them an
  artifact you can argue with.
- **Human decisions are tagged `decided_by: "human"`**, because the gap between
  the ranking and the actual shortlist is the metric — and it is only
  measurable if overrides are distinguishable.
- **The rubric is reused across a refine loop.** Re-deriving it each iteration
  would let the target move, so a better resume could score lower for no reason
  the user can see.
- **The offline path is the tested path.** It is what every user hits before
  adding an API key.

## Still unvalidated

These are hypotheses the code is *built on*, not findings:

1. **Memory-first beats speed-first as positioning.** Open question from the
   deck: does "never lose track of what you applied to" pull harder than
   "tailor in 2 minutes"? The product commits to memory-first; the messaging
   test has not been run.
2. **The recruiter need.** Built on hackathon feedback and secondary research.
   No structured recruiter interviews completed — the #1 bottleneck flagged in
   the Week-1 audit. `rubricAgreement` is the instrument; it needs subjects.
3. **Domain breadth.** The law example drove the domain-aware design from a
   single data point. Whether other non-tech fields hit the same wall is
   untested.
4. **Willingness to pay** in the stated ₹100–1000 range, and whether model
   choice is about cost control or output quality.
