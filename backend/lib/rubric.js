// The rubric engine - JOZY's shared scoring core.
//
// One idea powers both sides of the product: a job description is turned into an
// explicit, weighted list of criteria (the rubric), and any resume is then scored
// against that rubric with per-criterion evidence.
//
//   job seeker  -> "how well does MY resume match this JD, and what is missing?"
//   recruiter   -> "rank THESE resumes against this JD, and show me why"
//
// Because it is literally the same function, a recruiter's shortlist and an
// applicant's ATS score are directly comparable - which is what makes the
// two-sided thesis testable rather than just asserted.
//
// Two deliberate departures from the old keyword scorer:
//   1. Domain-aware. Lexicons cover law, finance, healthcare, marketing, ops and
//      more, so the logic does not silently assume a software role.
//   2. Transparent. Every point in a score traces back to a named criterion with
//      a weight and a quote from the resume, so a decision can be defended.

// ---------------------------------------------------------------- lexicons

// Terms that identify a domain AND act as high-confidence rubric criteria for it.
// Multi-word entries are matched as phrases.
export const DOMAIN_LEXICONS = {
  tech: [
    "javascript", "typescript", "python", "java", "golang", "rust", "c++", "c#", "ruby", "php", "kotlin", "swift",
    "react", "angular", "vue", "next.js", "node.js", "django", "flask", "spring boot", "rails", ".net",
    "sql", "postgresql", "mysql", "mongodb", "redis", "elasticsearch", "kafka", "rabbitmq", "graphql", "rest api",
    "aws", "azure", "gcp", "docker", "kubernetes", "terraform", "ci/cd", "jenkins", "github actions",
    "machine learning", "deep learning", "nlp", "pytorch", "tensorflow", "pandas", "numpy", "data pipeline",
    "microservices", "distributed systems", "system design", "unit testing", "code review", "agile", "scrum", "git",
  ],
  legal: [
    "litigation", "arbitration", "mediation", "due diligence", "compliance", "regulatory", "contract drafting",
    "contract negotiation", "corporate law", "intellectual property", "trademark", "patent", "copyright",
    "mergers and acquisitions", "m&a", "legal research", "legal drafting", "case law", "statutory interpretation",
    "bar council", "advocate", "counsel", "llb", "llm", "juris doctor", "moot court", "legal opinion",
    "memorandum", "affidavit", "pleadings", "civil procedure", "criminal procedure", "conveyancing",
    "companies act", "gdpr", "data protection", "employment law", "tax law", "real estate law",
  ],
  finance: [
    "financial modelling", "financial modeling", "valuation", "dcf", "equity research", "investment banking",
    "portfolio management", "risk management", "underwriting", "credit analysis", "budgeting", "forecasting",
    "variance analysis", "reconciliation", "accounts payable", "accounts receivable", "general ledger",
    "ifrs", "gaap", "ind as", "taxation", "gst", "audit", "internal audit", "statutory audit", "sox",
    "advanced excel", "tally", "sap fico", "quickbooks", "bloomberg", "capital markets",
    "cfa", "cpa", "acca", "balance sheet", "cash flow", "chartered accountant",
  ],
  healthcare: [
    "patient care", "clinical", "diagnosis", "treatment plan", "triage", "phlebotomy", "vitals",
    "electronic health record", "ehr", "emr", "hipaa", "icd-10", "cpt coding", "medical coding", "medical billing",
    "pharmacovigilance", "clinical trials", "regulatory affairs", "nursing", "bls", "acls",
    "infection control", "medication administration", "care plan", "mbbs", "bds", "pharmacy", "radiology",
  ],
  marketing: [
    "seo", "sem", "content marketing", "copywriting", "social media", "google analytics", "google ads",
    "meta ads", "performance marketing", "campaign management", "brand strategy", "market research",
    "email marketing", "marketing automation", "hubspot", "crm", "a/b testing",
    "conversion rate", "customer acquisition", "roas", "influencer marketing", "go to market", "customer experience",
  ],
  sales: [
    "lead generation", "prospecting", "cold calling", "pipeline management", "quota", "b2b sales", "b2c sales",
    "account management", "key accounts", "client relationship", "negotiation", "closing", "upselling",
    "cross-selling", "salesforce", "territory management", "channel partners", "revenue growth",
  ],
  design: [
    "figma", "sketch", "adobe xd", "photoshop", "illustrator", "after effects", "wireframing", "prototyping",
    "user research", "usability testing", "design system", "interaction design", "visual design",
    "typography", "information architecture", "user flows", "accessibility", "wcag", "motion design", "user experience",
  ],
  operations: [
    "supply chain", "logistics", "procurement", "vendor management", "inventory management", "warehouse",
    "lean", "six sigma", "kaizen", "process improvement", "quality assurance", "erp",
    "demand planning", "cost reduction", "capacity planning", "fulfilment", "fulfillment", "last mile",
  ],
  hr: [
    "talent acquisition", "recruitment", "sourcing", "screening", "onboarding", "employee engagement",
    "performance management", "hris", "payroll", "compensation", "benefits", "employee relations",
    "learning and development", "succession planning", "labour law", "workday", "linkedin recruiter",
  ],
  education: [
    "curriculum", "lesson planning", "pedagogy", "classroom management", "assessment", "student engagement",
    "learning outcomes", "instructional design", "e-learning", "moodle", "special education",
    "ctet", "teaching", "tutoring", "academic research", "publication",
  ],
};

// Qualification signals are domain-independent: degrees, licences, certifications.
const QUALIFICATION_PATTERNS = [
  /\b(bachelor'?s?|master'?s?|phd|doctorate|b\.?tech|m\.?tech|b\.?sc|m\.?sc|b\.?com|m\.?com|mba|bba|llb|llm|mbbs|b\.?ed|m\.?ed)\b[^.\n]{0,60}/gi,
  /\b(certified|certification|certificate|licensed|licence|license|accredited|chartered|registered)\b[^.\n]{0,60}/gi,
  /\b\d+\+?\s*(?:-\s*\d+\s*)?years?\b[^.\n]{0,60}/gi,
];

// Phrases that mark a line as a hard requirement rather than a nice-to-have.
const MUST_HAVE = /\b(must have|must be|required|requires|mandatory|minimum|at least|essential)\b/i;
const NICE_TO_HAVE = /\b(nice to have|preferred|bonus|desirable|good to have|advantage)\b/i;

// Lines that introduce the part of a JD that actually states requirements.
const REQUIREMENT_HEADING = /^(requirement|qualification|what you need|what we need|what you bring|who you are|skill|eligibility|desired|must have|you have|about you|key skill)/i;
const RESPONSIBILITY_HEADING = /^(responsibilit|what you will do|role overview|duties|the job|day to day|key result|deliverable|about the role)/i;

// Phrases whose head noun is scaffolding rather than a requirement. Without
// this, "LLB from a recognised university" yields both "LLB" and "recognised
// university" - the second double-counts the first and, because almost no
// resume contains the words "recognised university", becomes an unmeetable
// hard requirement that unfairly caps every candidate.
const GENERIC_HEADS = new Set(
  ("university college institution degree candidate candidates applicant applicants environment " +
   "team teams company organisation organization background role roles position opportunity " +
   "requirement requirements responsibility responsibilities ability abilities skill skills " +
   "knowledge understanding experience work job basis").split(" ")
);

const STOPWORDS = new Set(
  ("a an and or the to of in on for with as at by from is are be been being we you our your they them their this that " +
   "these those it its will would should could can may might have has had do does did not no if then than so such " +
   "work works working team teams job role roles description responsibilities requirements about experience " +
   "years year strong good great excellent ability able skills skill knowledge understanding etc including include " +
   "across within into over under more most other others new all any both each few own same very just also who whom " +
   "what when where why how while during before after between per via using use used company candidate candidates " +
   "opportunity position apply application applicants join looking seeking ideal preferred plus well").split(" ")
);

// ------------------------------------------------------------------ helpers

const norm = (s = "") => String(s).toLowerCase().replace(/\s+/g, " ").trim();

/** Escape a term for use inside a RegExp. */
function esc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Does `haystack` contain `term`? Word-boundary aware, but tolerant of the
 * punctuation that shows up in real skill names (c++, .net, ci/cd, node.js).
 */
export function containsTerm(haystack, term) {
  const t = norm(term);
  if (!t) return false;
  const pattern = t.split(/\s+/).map(esc).join("\\s+");
  // \b does not behave next to +, #, . or / - fall back to a plain substring test.
  const boundarySafe = /^[a-z0-9 ]+$/.test(t);
  const re = boundarySafe ? new RegExp("\\b" + pattern + "\\b", "i") : new RegExp(pattern, "i");
  return re.test(haystack);
}

/** The line around the first occurrence of a term - the receipt for a match. */
export function evidenceFor(text, term) {
  const t = norm(term);
  if (!t) return "";
  const idx = norm(text).indexOf(t.split(/\s+/)[0]);
  if (idx < 0) return "";
  const start = Math.max(0, text.lastIndexOf("\n", idx) + 1);
  let end = text.indexOf("\n", idx);
  if (end < 0) end = text.length;
  const line = text.slice(start, Math.min(end, start + 240)).trim();
  return line.length > 200 ? line.slice(0, 197) + "..." : line;
}

/** Flatten any resume shape (structured content, master profile, text) to text. */
export function resumeToText(sc) {
  if (!sc) return "";
  if (typeof sc === "string") return sc;
  const parts = [];
  const push = (...xs) => xs.forEach((x) => x && parts.push(String(x)));
  push(sc.fullName, sc.header && sc.header.fullName, sc.summary, sc.header && sc.header.contactLine);
  for (const e of sc.experience || []) push(e.role, e.company, e.dates, ...(e.bullets || []));
  for (const p of sc.projects || []) push(p.name, p.tech, ...(p.bullets || []));
  for (const s of sc.skills || []) push(s.category, ...(s.items || []));
  for (const ed of sc.education || []) push(ed.institution, ed.degree, ed.field, ed.dates);
  for (const c of sc.certifications || []) push(c.name, c.issuer);
  push(...(sc.achievements || []));
  if (sc._rawResume) push(sc._rawResume);
  return parts.join("\n");
}

/** Which domain does this text read as? Returns the best-scoring lexicon. */
export function detectDomain(text = "") {
  const hay = norm(text);
  let best = { domain: "general", hits: 0 };
  for (const [domain, terms] of Object.entries(DOMAIN_LEXICONS)) {
    let hits = 0;
    for (const t of terms) if (containsTerm(hay, t)) hits++;
    if (hits > best.hits) best = { domain, hits };
  }
  // One stray word should not label a whole posting.
  return best.hits >= 2 ? best.domain : "general";
}

// --------------------------------------------------------- rubric derivation

/**
 * Turn a job description into a weighted, explainable rubric.
 * Shape: { domain, criteria: [{ id, label, kind, weight, terms, mustHave }], source }
 *
 * `llm` is an optional async (prompt) => object used when a model is configured;
 * the local path below runs whenever it is absent or fails, so the whole product
 * works with no API key at all.
 */
export async function deriveRubric({ jdText = "", domain = "", llm = null } = {}) {
  const resolvedDomain = domain || detectDomain(jdText);
  if (llm) {
    try {
      const out = await llm(rubricPrompt(jdText, resolvedDomain));
      const criteria = normalizeCriteria(out && out.criteria);
      if (criteria.length >= 3) {
        return { domain: (out && out.domain) || resolvedDomain, criteria, source: "llm" };
      }
    } catch (e) {
      console.warn("[JOZY] rubric LLM fell back to local: " + e.message);
    }
  }
  return { domain: resolvedDomain, criteria: deriveRubricLocal(jdText, resolvedDomain), source: "local" };
}

function rubricPrompt(jdText, domain) {
  return (
    "You are a hiring analyst. Read the job description and produce the explicit scoring rubric a fair " +
    "recruiter would use to screen resumes for it. This role appears to be in the \"" + domain + "\" domain - use " +
    "the vocabulary of THAT field, not software, unless the posting is genuinely technical.\n\n" +
    "Return ONLY JSON: {\"domain\": string, \"criteria\": [{\"label\": string, " +
    "\"kind\": \"skill\"|\"qualification\"|\"experience\"|\"responsibility\", \"weight\": number, " +
    "\"terms\": string[], \"mustHave\": boolean}]}\n\n" +
    "Rules:\n" +
    "- 6 to 10 criteria, each one thing a resume can plausibly evidence.\n" +
    "- \"weight\" is that criterion's share of the score; all weights must sum to 100.\n" +
    "- \"terms\" lists 2-6 concrete words or phrases (synonyms, abbreviations, tools) whose presence in a resume evidences the criterion.\n" +
    "- \"mustHave\" is true only for stated hard requirements (licences, degrees, minimum years).\n" +
    "- Do not invent requirements the posting does not state.\n\n" +
    "JOB DESCRIPTION:\n" + String(jdText).slice(0, 9000)
  );
}

/** Coerce whatever the model returned into valid, normalized criteria. */
function normalizeCriteria(raw) {
  const list = (Array.isArray(raw) ? raw : [])
    .filter((c) => c && typeof c.label === "string" && c.label.trim())
    .slice(0, 12)
    .map((c, i) => ({
      id: "c" + (i + 1),
      label: c.label.trim().slice(0, 80),
      kind: ["skill", "qualification", "experience", "responsibility"].includes(c.kind) ? c.kind : "skill",
      weight: Number(c.weight) > 0 ? Number(c.weight) : 10,
      terms: [...new Set([c.label, ...(Array.isArray(c.terms) ? c.terms : [])].map(norm).filter(Boolean))].slice(0, 8),
      mustHave: Boolean(c.mustHave),
    }));
  return rebalance(list);
}

/** Normalize weights to sum to exactly 100, keeping relative proportions. */
export function rebalance(criteria) {
  const list = Array.isArray(criteria) ? criteria : [];
  if (!list.length) return [];
  const total = list.reduce((n, c) => n + (Number(c.weight) || 0), 0);
  if (!total) return list.map((c) => ({ ...c, weight: Math.max(1, Math.round(100 / list.length)) }));
  let running = 0;
  return list.map((c, i) => {
    // Give the last criterion the remainder so the total is exactly 100.
    const w = i === list.length - 1
      ? Math.max(1, 100 - running)
      : Math.max(1, Math.round(((Number(c.weight) || 0) / total) * 100));
    running += w;
    return { ...c, weight: w };
  });
}

// ---- local derivation (no model required) ----

function deriveRubricLocal(jdText = "", domain = "general") {
  const text = String(jdText);
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const requirementLines = requirementSection(lines);
  const hay = norm(text);
  const candidates = [];

  // Never let the same requirement enter the rubric twice under two names -
  // duplicates silently double that requirement's share of the score.
  const add = (cand) => {
    const terms = [...new Set(cand.terms.map(norm).filter(Boolean))];
    const twin = candidates.find((c) =>
      c.terms.some((t) => terms.includes(t)) ||
      containsTerm(c.label, cand.label) ||
      containsTerm(cand.label, c.label));
    if (twin) {
      // Keep the more specific label (the shorter one reads better as a criterion).
      if (cand.label.length < twin.label.length && cand.kind === twin.kind) twin.label = cand.label;
      twin.base = Math.max(twin.base, cand.base);
      twin.mustHave = twin.mustHave || cand.mustHave;
      twin.demoted = twin.demoted && cand.demoted;
      twin.terms = [...new Set([...twin.terms, ...terms])];
      return;
    }
    candidates.push({ ...cand, terms });
  };

  // 1. Hard qualifications first - degrees, licences, years of experience.
  //    These are the least negotiable, so they claim their label before a
  //    lexicon hit on the same word can.
  for (const pattern of QUALIFICATION_PATTERNS) {
    for (const m of text.matchAll(pattern)) {
      const phrase = m[0].trim().replace(/\s+/g, " ");
      if (phrase.length < 3 || phrase.length > 70) continue;
      add({
        label: qualificationLabel(phrase),
        kind: "qualification",
        base: 16,
        terms: qualificationTerms(phrase),
        mustHave: MUST_HAVE.test(phrase) || MUST_HAVE.test(lineFor(lines, phrase)),
        demoted: NICE_TO_HAVE.test(phrase),
      });
    }
  }

  // 2. Domain vocabulary present in the posting - the highest-confidence signal
  //    that a requirement is real and not incidental prose.
  const lexicon = DOMAIN_LEXICONS[domain] || [];
  for (const term of lexicon) {
    if (!containsTerm(hay, term)) continue;
    const line = lineFor(lines, term);
    add({
      label: titleCase(term),
      kind: "skill",
      base: 14,
      terms: [term, ...synonyms(term)],
      mustHave: MUST_HAVE.test(line),
      demoted: NICE_TO_HAVE.test(line),
    });
  }

  // 3. Salient multi-word phrases from the requirements section - this is what
  //    catches a domain the lexicons have never heard of.
  for (const [phrase, count] of topPhrases(requirementLines.join("\n"), 8)) {
    if (isNoisePhrase(phrase)) continue;
    const line = lineFor(requirementLines, phrase);
    add({
      label: titleCase(phrase),
      kind: /\b(manage|lead|develop|build|coordinate|drive|own|deliver|support)\b/i.test(line) ? "responsibility" : "skill",
      base: 8 + Math.min(4, count),
      terms: [phrase],
      mustHave: MUST_HAVE.test(line),
      demoted: NICE_TO_HAVE.test(line),
    });
  }

  // 4. Last resort for a very thin posting: salient single words.
  if (candidates.length < 4) {
    for (const [word, count] of topWords(text, 8)) {
      add({ label: titleCase(word), kind: "skill", base: 6 + Math.min(4, count), terms: [word], mustHave: false, demoted: false });
    }
  }

  const scored = candidates
    .map((c) => ({ ...c, base: c.base * (c.mustHave ? 1.6 : 1) * (c.demoted ? 0.5 : 1) }))
    .sort((a, b) => b.base - a.base)
    .slice(0, 9);

  return rebalance(scored.map((c, i) => ({
    id: "c" + (i + 1),
    label: c.label,
    kind: c.kind,
    weight: c.base,
    terms: [...new Set([norm(c.label), ...c.terms.map(norm)])].filter(Boolean).slice(0, 8),
    mustHave: c.mustHave,
  })));
}

/** The slice of a JD that states requirements; the whole thing if unlabelled. */
function requirementSection(lines) {
  let start = -1;
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].replace(/^[-*•\s]+/, "");
    if (start < 0 && l.length < 70 && REQUIREMENT_HEADING.test(l)) start = i + 1;
    else if (start >= 0 && l.length < 70 && RESPONSIBILITY_HEADING.test(l)) { end = i; break; }
  }
  return start >= 0 && start < lines.length ? lines.slice(start, end) : lines;
}

/** Frequent 2-3 word phrases, stopword-trimmed. */
function topPhrases(text, limit) {
  const counts = new Map();
  for (const sentence of norm(text).split(/[.;:\n]/)) {
    const words = sentence.split(/[^a-z0-9+#./&-]+/).filter(Boolean);
    for (let n = 3; n >= 2; n--) {
      for (let i = 0; i + n <= words.length; i++) {
        const gram = words.slice(i, i + n);
        if (STOPWORDS.has(gram[0]) || STOPWORDS.has(gram[gram.length - 1])) continue;
        if (gram.some((w) => w.length < 3 || /^\d+$/.test(w))) continue;
        const phrase = gram.join(" ");
        counts.set(phrase, (counts.get(phrase) || 0) + 1);
      }
    }
  }
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);
  const repeated = entries.filter(([, n]) => n >= 2);
  return (repeated.length >= 3 ? repeated : entries).slice(0, limit);
}

function topWords(text, limit) {
  const counts = new Map();
  for (const raw of norm(text).split(/[^a-z0-9+#.]+/)) {
    const w = raw.replace(/^\.+|\.+$/g, "");
    if (w.length < 3 || STOPWORDS.has(w) || /^\d+$/.test(w)) continue;
    counts.set(w, (counts.get(w) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

/** Cheap synonym expansion so "node.js" also matches "nodejs" / "node". */
function synonyms(term) {
  const out = new Set();
  const t = norm(term);
  if (t.includes(".")) out.add(t.replace(/\./g, ""));
  if (t.includes("-")) { out.add(t.replace(/-/g, " ")); out.add(t.replace(/-/g, "")); }
  if (t.includes(" and ")) out.add(t.replace(" and ", " & "));
  if (t.endsWith(".js")) out.add(t.slice(0, -3));
  return [...out];
}

// Every lexicon term, flattened once - used to spare real domain vocabulary
// from the generic-head filter (e.g. "user experience" is a skill, not scaffolding).
const ALL_LEXICON_TERMS = new Set(Object.values(DOMAIN_LEXICONS).flat());

/**
 * Reject phrases that are not requirements: scaffolding whose head noun is
 * generic ("recognised university"), and n-grams that straddle a conjunction
 * ("research and legal", cut out of "legal research and legal drafting").
 * Known domain vocabulary is always kept - "mergers and acquisitions" and
 * "learning and development" are real criteria despite the interior "and".
 */
function isNoisePhrase(phrase) {
  const p = norm(phrase);
  if (ALL_LEXICON_TERMS.has(p)) return false;
  const words = p.split(" ");
  if (GENERIC_HEADS.has(words[words.length - 1])) return true;
  return words.slice(1, -1).some((w) => STOPWORDS.has(w));
}

/** The first line mentioning a term - used to read its must-have framing. */
function lineFor(lines, term) {
  return lines.find((l) => containsTerm(l, term)) || "";
}

/**
 * A criterion label is read by a human, so "LLB from a recognised university is
 * required" becomes "LLB" and "Minimum 2 years of experience in contract
 * drafting" becomes "2+ years: contract drafting".
 */
function qualificationLabel(phrase) {
  const p = norm(phrase);
  const degree = p.match(/\b(b\.?tech|m\.?tech|b\.?sc|m\.?sc|b\.?com|m\.?com|b\.?ed|m\.?ed|mba|bba|llb|llm|mbbs|phd|doctorate|bachelor|master)\b/);
  if (degree) {
    const d = degree[1].replace(/\./g, "");
    const pretty = { bachelor: "Bachelor's degree", master: "Master's degree", phd: "PhD", doctorate: "Doctorate" };
    return pretty[d] || d.toUpperCase();
  }
  const yrs = p.match(/(\d+)\+?\s*(?:-\s*\d+\s*)?years?\s*(?:of\s*)?(?:experience\s*)?(?:in|with)?\s*([a-z][a-z &]{2,40})?/);
  if (yrs) {
    const subject = (yrs[2] || "").replace(/\b(is|are|and|the|a|an)\b\s*$/g, "").trim();
    return subject ? yrs[1] + "+ years: " + subject.slice(0, 40) : yrs[1] + "+ years experience";
  }
  const cert = p.match(/\b(?:certified|certification|licensed|licence|license|chartered|accredited|registered)\b\s*(?:in|with|as|by)?\s*([a-z][a-z &]{2,35})?/);
  if (cert) return titleCase(cert[1] ? cert[1].trim() + " certification" : "Professional certification");
  return titleCase(phrase.slice(0, 50));
}

/** For "5+ years of litigation experience", a resume rarely says "5+ years". */
function qualificationTerms(phrase) {
  const p = norm(phrase);
  const terms = new Set([p]);
  const yrs = p.match(/(\d+)\+?\s*(?:-\s*\d+\s*)?years?\s*(?:of\s*)?(?:experience\s*)?(?:in|with)?\s*([a-z][a-z ]{2,40})?/);
  if (yrs && yrs[2]) terms.add(yrs[2].trim());
  const degree = p.match(/\b(bachelor|master|phd|b\.?tech|m\.?tech|mba|llb|llm|mbbs|b\.?com|m\.?com|b\.?sc|m\.?sc|b\.?ed)\b/);
  if (degree) terms.add(degree[1]);
  const cert = p.match(/\b(?:certified|certification|licensed|chartered)\b\s*(?:in\s*)?([a-z][a-z ]{2,30})?/);
  if (cert && cert[1]) terms.add(cert[1].trim());
  return [...terms].filter((t) => t && t.length >= 3).slice(0, 6);
}

function titleCase(s) {
  return String(s).trim().replace(/\s+/g, " ").replace(/^./, (c) => c.toUpperCase()).slice(0, 80);
}

// -------------------------------------------------------------------- scoring

/**
 * Score any resume against a rubric. Returns a number AND the reasoning behind
 * every point of it - the transparency the recruiter side is sold on.
 *
 * `resume` may be structured content, a master profile, or plain text.
 */
export function scoreAgainstRubric(rubric, resume) {
  const text = resumeToText(resume);
  const hay = norm(text);
  const criteria = rubric && Array.isArray(rubric.criteria) ? rubric.criteria : [];

  if (!criteria.length) {
    return {
      score: 0, criteria: [], matched: [], missing: [], mustHaveGaps: [],
      notes: ["No rubric criteria - add a job description to score against."],
    };
  }

  const results = criteria.map((c) => {
    const terms = (c.terms && c.terms.length ? c.terms : [c.label]);
    const matchedTerms = terms.filter((t) => containsTerm(hay, t));
    const hit = matchedTerms.length > 0;
    // Evidencing a criterion several different ways is worth slightly more than
    // a single passing mention, but never more than the criterion's full weight.
    const strength = hit ? Math.min(1, 0.75 + 0.25 * (matchedTerms.length - 1)) : 0;
    return {
      id: c.id,
      label: c.label,
      kind: c.kind,
      weight: c.weight,
      mustHave: Boolean(c.mustHave),
      matched: hit,
      matchedTerms,
      evidence: hit ? evidenceFor(text, matchedTerms[0]) : "",
      contribution: Math.round(c.weight * strength),
    };
  });

  const totalWeight = results.reduce((n, r) => n + r.weight, 0) || 1;
  const earned = results.reduce((n, r) => n + r.contribution, 0);
  const mustHaveGaps = results.filter((r) => r.mustHave && !r.matched);

  // A missing hard requirement is not a small deduction - it is usually
  // disqualifying, so it caps the score rather than nudging it.
  let score = Math.round((earned / totalWeight) * 100);
  if (mustHaveGaps.length) score = Math.min(score, 100 - Math.min(45, mustHaveGaps.length * 18));
  score = Math.max(0, Math.min(99, score));

  const matched = results.filter((r) => r.matched);
  const missing = results.filter((r) => !r.matched);

  return {
    score,
    criteria: results,
    // Back-compatible flat lists - the existing keyword chips read these.
    matched: [...new Set(matched.flatMap((r) => (r.matchedTerms.length ? r.matchedTerms : [r.label])))].slice(0, 18),
    missing: missing.map((r) => r.label).slice(0, 18),
    mustHaveGaps: mustHaveGaps.map((r) => r.label),
    notes: buildNotes(results, missing, mustHaveGaps, rubric),
  };
}

function buildNotes(results, missing, mustHaveGaps, rubric) {
  const notes = [];
  if (mustHaveGaps.length) {
    notes.push("Stated hard requirement" + (mustHaveGaps.length > 1 ? "s" : "") +
      " not evidenced: " + mustHaveGaps.map((r) => r.label).join(", ") + ".");
  }
  const heaviestGap = [...missing].sort((a, b) => b.weight - a.weight)[0];
  if (heaviestGap) {
    notes.push("Biggest single gain available: \"" + heaviestGap.label + "\" is worth " +
      heaviestGap.weight + " points and is not evidenced.");
  } else {
    notes.push("Every criterion in this rubric is evidenced somewhere in the resume.");
  }
  const thin = results.filter((r) => r.matched && r.matchedTerms.length === 1 && r.weight >= 12);
  if (thin.length) {
    notes.push("Mentioned only once, worth reinforcing: " + thin.slice(0, 3).map((r) => r.label).join(", ") + ".");
  }
  notes.push("Scored against " + results.length + " weighted criteria derived from the " +
    ((rubric && rubric.domain) || "general") + " posting" +
    (rubric && rubric.source === "local" ? " (offline rubric)" : "") + ".");
  return notes;
}

/**
 * Rank many resumes against one rubric - the recruiter's shortlist.
 * Ties break on hard requirements met, then on name, so repeated runs of the
 * same batch produce the same order.
 */
export function rankCandidates(rubric, candidates = []) {
  return candidates
    .map((cand) => {
      const result = scoreAgainstRubric(rubric, cand.resume_text || cand.resumeText || "");
      return { ...cand, score: result.score, breakdown: result };
    })
    .sort((a, b) =>
      b.score - a.score ||
      a.breakdown.mustHaveGaps.length - b.breakdown.mustHaveGaps.length ||
      String(a.name || "").localeCompare(String(b.name || "")))
    .map((c, i) => ({ ...c, rank: i + 1 }));
}
