// content.js — Content script injected into every page
// Listens for an EXTRACT_JD message from the side panel and returns page text

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'EXTRACT_JD') return;

  try {
    let jobText = '';

    // Try known ATS platform selectors first for cleaner extraction
    const selectors = [
      // Greenhouse
      '.job__description',
      '#content',
      // Lever
      '.posting-page',
      '.posting-description',
      // LinkedIn
      '.jobs-description__content',
      '.job-view-layout',
      // Workday
      '[data-automation-id="jobPostingDescription"]',
      // Ashby
      '.ashby-job-posting-brief-description',
      // Generic fallback
      'main',
      'article',
      '[role="main"]'
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText && el.innerText.trim().length > 200) {
        jobText = el.innerText.trim();
        console.log(`[FirSeCV] Extracted via selector: ${sel}`);
        break;
      }
    }

    // Final fallback: full visible body text
    if (!jobText || jobText.length < 200) {
      jobText = document.body.innerText;
      console.log('[FirSeCV] Falling back to body.innerText');
    }

    sendResponse({
      success: true,
      text: jobText,
      url: window.location.href,
      title: document.title
    });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }

  return true; // keep message channel open
});
