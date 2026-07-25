// Minimal state-machine router for the side panel.
// Each screen is a <section data-screen="NAME"> toggled via `hidden`.
// Screen content is mounted by render functions added in later tasks.

const SCREENS = ["onboarding", "extract", "review", "history"];

export function showScreen(name) {
  for (const s of SCREENS) {
    const el = document.querySelector(`[data-screen="${s}"].screen`);
    if (el) el.hidden = s !== name;
  }
  document.body.dataset.screen = name;
}

async function initRouter() {
  // Boot logic (onboarding vs extract) is wired in Task 5.
  showScreen("extract");
}

document.addEventListener("DOMContentLoaded", initRouter);
