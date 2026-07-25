// background.js — Service worker for FirSeCV
// Opens the side panel when the extension icon is clicked

chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch (err) {
    console.error('[FirSeCV background] Failed to open side panel:', err);
  }
});

// Keep service worker alive during side panel interactions
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PING') {
    sendResponse({ type: 'PONG' });
  }
  return true; // keep channel open for async responses
});
