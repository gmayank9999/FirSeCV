// Runs in the page context via chrome.scripting.executeScript.
// Must be fully self-contained (no imports) - it is serialized and injected.

export function scrapePage() {
  const selectors = [
    ".job__description",
    "#content .body",
    ".posting",
    ".description__text",
    "[class*='jobDescription']",
    "[class*='job-description']",
    "article",
    "main",
  ];
  let best = "";
  for (const sel of selectors) {
    for (const el of document.querySelectorAll(sel)) {
      const t = (el.innerText || "").trim();
      if (t.length > best.length) best = t;
    }
  }
  if (best.length < 200) best = (document.body.innerText || "").trim();
  return { rawPageText: best, pageUrl: location.href };
}
