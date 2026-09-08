// Open the JOZY side panel when the toolbar icon is clicked.
// setPanelBehavior is the modern path; the onClicked handler is a fallback
// for cases where the behavior flag hasn't taken effect yet.

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.warn("[JOZY] setPanelBehavior failed:", err));
});

chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch (err) {
    // If openPanelOnActionClick already handled it, this is a harmless no-op.
  }
});
