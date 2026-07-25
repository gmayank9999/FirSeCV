/* ═══════════════════════════════════════════════════════════════
   FirSeCV — Side Panel JavaScript
   Manages all screens, API calls to backend, and extension flow
   ═══════════════════════════════════════════════════════════════ */

'use strict';

// ──────────────────────────────────────────────────────
// CONFIG
// ──────────────────────────────────────────────────────
const API_BASE = 'http://localhost:3000';

// ──────────────────────────────────────────────────────
// STATE
// ──────────────────────────────────────────────────────
let state = {
  userId: null,
  masterProfile: null,
  // JD extraction results
  extractedCompany: '',
  extractedPosition: '',
  extractedJdText: '',
  // Generation results (persisted for revision loop)
  currentStructuredContent: null,
  currentLatexSource: null,
  currentPdfBase64: null,
  currentAtsScore: null,
  currentAtsBreakdown: null,
  // Chat history for display
  chatHistory: []
};

// ──────────────────────────────────────────────────────
// INIT
// ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await initUserId();
  bindEventListeners();
  await checkOnboarding();
});

async function initUserId() {
  // Retrieve or generate a persistent user ID stored in chrome.storage.local
  const stored = await chromeStorageGet('firsecv_user_id');
  if (stored) {
    state.userId = stored;
  } else {
    // Generate a simple UUID-like ID
    state.userId = 'user_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
    await chromeStorageSet('firsecv_user_id', state.userId);
  }
}

async function checkOnboarding() {
  showLoading('Checking your profile...');
  try {
    const resp = await apiGet(`/api/master-profile?user_id=${encodeURIComponent(state.userId)}`);
    if (resp.ok) {
      state.masterProfile = await resp.json();
      showMainApp();
    } else {
      // 404 → needs onboarding
      showScreen('screen-onboarding');
    }
  } catch (err) {
    // If backend isn't running, skip to main
    console.warn('[FirSeCV] Backend unreachable, skipping profile check:', err.message);
    showScreen('screen-onboarding');
  } finally {
    hideLoading();
  }
}

// ──────────────────────────────────────────────────────
// EVENT LISTENERS
// ──────────────────────────────────────────────────────
function bindEventListeners() {
  // ── Onboarding
  $('#parseResumeBtn').addEventListener('click', handleParseResume);
  $('#manualSetupBtn').addEventListener('click', () => {
    showScreen('screen-manual-profile');
  });
  $('#backFromManual').addEventListener('click', () => {
    showScreen('screen-onboarding');
  });
  $('#saveManualProfileBtn').addEventListener('click', handleSaveManualProfile);

  // ── Tab nav
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      if (tab === 'main') showScreen('screen-main');
      else if (tab === 'history') { showScreen('screen-history'); loadHistory(); }
      else if (tab === 'profile') { showScreen('screen-profile'); loadProfileScreen(); }
    });
  });

  // ── Extract / Generate
  $('#extractBtn').addEventListener('click', handleExtract);
  $('#clearJdBtn').addEventListener('click', () => {
    $('#jdEditor').classList.add('hidden');
    $('#extractBtn').disabled = false;
  });
  $('#generateBtn').addEventListener('click', handleGenerate);

  // ── Review screen
  $('#backToMain').addEventListener('click', () => {
    switchTab('main');
    showScreen('screen-main');
  });
  $('#downloadBtn').addEventListener('click', handleDownload);
  $('#chatSendBtn').addEventListener('click', handleChatSend);
  $('#chatInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleChatSend(); }
  });
  $('#approveBtn').addEventListener('click', handleApprove);

  // ── ATS breakdown collapse
  $('#toggleBreakdown').addEventListener('click', () => {
    const body = $('#breakdownBody');
    const icon = document.querySelector('.toggle-icon');
    body.classList.toggle('open');
    icon.textContent = body.classList.contains('open') ? '▲' : '▼';
  });

  // ── History search
  $('#historySearchBtn').addEventListener('click', loadHistory);
  $('#historySearch').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadHistory();
  });

  // ── Profile update
  $('#updateProfileBtn').addEventListener('click', handleUpdateProfile);
}

// ──────────────────────────────────────────────────────
// ONBOARDING HANDLERS
// ──────────────────────────────────────────────────────
async function handleParseResume() {
  const text = $('#resumeTextInput').value.trim();
  if (!text || text.length < 100) {
    toast('Please paste your full resume text (at least a few hundred characters).', 'error');
    return;
  }

  showLoading('Parsing your resume with AI...');
  try {
    const resp = await apiPost('/api/master-profile', {
      resumeText: text,
      user_id: state.userId
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Parsing failed');

    state.masterProfile = data.profile;
    toast('Profile saved! 🎉', 'success');
    showMainApp();
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

async function handleSaveManualProfile() {
  const name = $('#mf-name').value.trim();
  const email = $('#mf-email').value.trim();
  if (!name || !email) {
    toast('Full name and email are required.', 'error');
    return;
  }

  showLoading('Saving profile...');
  try {
    const structuredData = {
      full_name: name,
      email: email,
      phone: $('#mf-phone').value.trim() || null,
      location: $('#mf-location').value.trim() || null,
      linkedin_url: $('#mf-linkedin').value.trim() || null,
      github_url: $('#mf-github').value.trim() || null,
      portfolio_url: null,
      education: [],
      experience: [],
      projects: [],
      skills: [],
      certifications: [],
      achievements: []
    };

    const resp = await apiPost('/api/master-profile', {
      structuredData,
      user_id: state.userId
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Save failed');

    state.masterProfile = data.profile;
    toast('Profile saved!', 'success');
    showMainApp();
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

// ──────────────────────────────────────────────────────
// EXTRACT JD
// ──────────────────────────────────────────────────────
async function handleExtract() {
  showLoading('Extracting job description from page...');
  try {
    // Get the current active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('No active tab found');

    // Ask content script to extract text
    let pageData;
    try {
      pageData = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_JD' });
    } catch {
      // Content script might not be loaded — inject it
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
      await new Promise(r => setTimeout(r, 300));
      pageData = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_JD' });
    }

    if (!pageData || !pageData.success) {
      throw new Error(pageData?.error || 'Could not extract page content');
    }

    updateLoadingText('Cleaning job description with AI...');

    // Send to backend for LLM cleaning
    const resp = await apiPost('/api/extract-jd', {
      rawPageText: pageData.text,
      pageUrl: pageData.url
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Extraction failed');

    // Populate the editor
    state.extractedCompany = data.company;
    state.extractedPosition = data.position;
    state.extractedJdText = data.jd_text;

    $('#jd-company').value = data.company;
    $('#jd-position').value = data.position;
    $('#jd-text').value = data.jd_text;

    $('#jdEditor').classList.remove('hidden');
    $('#extractBtn').disabled = true;
    toast('Job description extracted! ✅ Review and edit if needed.', 'success');
  } catch (err) {
    toast('Extraction error: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

// ──────────────────────────────────────────────────────
// GENERATE RESUME
// ──────────────────────────────────────────────────────
async function handleGenerate() {
  const company  = $('#jd-company').value.trim();
  const position = $('#jd-position').value.trim();
  const jdText   = $('#jd-text').value.trim();

  if (!company || !position) {
    toast('Please fill in company and position.', 'error');
    return;
  }
  if (!jdText || jdText.length < 50) {
    toast('Job description text seems too short. Please paste the full JD.', 'error');
    return;
  }

  state.extractedCompany = company;
  state.extractedPosition = position;
  state.extractedJdText = jdText;
  state.chatHistory = [];

  showLoading('Generating tailored resume... (this may take ~20s)');

  try {
    const resp = await apiPost('/api/generate-resume', {
      user_id: state.userId,
      company,
      position,
      jdText
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Generation failed');

    handleGenerationSuccess(data);
    switchTab('');
    showScreen('screen-review');
    toast('Resume generated! 🚀', 'success');
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

function handleGenerationSuccess(data) {
  state.currentStructuredContent = data.structuredContent;
  state.currentLatexSource = data.latexSource;
  state.currentPdfBase64 = data.pdfBase64;
  state.currentAtsScore = data.atsScore;
  state.currentAtsBreakdown = data.atsBreakdown;

  renderPdfPreview(data.pdfBase64);
  renderAtsScore(data.atsScore, data.atsBreakdown);
}

function renderPdfPreview(pdfBase64) {
  const byteChars = atob(pdfBase64);
  const byteArr = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteArr[i] = byteChars.charCodeAt(i);
  }
  const blob = new Blob([byteArr], { type: 'application/pdf' });
  const blobUrl = URL.createObjectURL(blob);
  const iframe = $('#pdfPreview');
  iframe.src = blobUrl;
}

function renderAtsScore(score, breakdown) {
  // Ring animation
  const ring = $('#ringProgress');
  const circumference = 251.2;
  const offset = circumference - (score / 100) * circumference;
  ring.style.strokeDashoffset = offset;

  // Color based on score
  if (score >= 75) {
    ring.style.stroke = '#22c55e';
    ring.style.filter = 'drop-shadow(0 0 4px #22c55e)';
    $('#atsSubLabel').textContent = 'Excellent match!';
  } else if (score >= 55) {
    ring.style.stroke = '#f59e0b';
    ring.style.filter = 'drop-shadow(0 0 4px #f59e0b)';
    $('#atsSubLabel').textContent = 'Good match';
  } else {
    ring.style.stroke = '#ef4444';
    ring.style.filter = 'drop-shadow(0 0 4px #ef4444)';
    $('#atsSubLabel').textContent = 'Needs improvement';
  }
  $('#ringScore').textContent = score;

  // Breakdown chips
  if (breakdown) {
    $('#atsBreakdown').style.display = 'block';

    const matchedEl = $('#matchedKeywords');
    matchedEl.innerHTML = '';
    (breakdown.matched_keywords || []).slice(0, 15).forEach(kw => {
      const chip = document.createElement('span');
      chip.className = 'chip chip-matched';
      chip.textContent = kw;
      matchedEl.appendChild(chip);
    });

    const missingEl = $('#missingKeywords');
    missingEl.innerHTML = '';
    (breakdown.missing_keywords || []).slice(0, 10).forEach(kw => {
      const chip = document.createElement('span');
      chip.className = 'chip chip-missing';
      chip.textContent = kw;
      missingEl.appendChild(chip);
    });

    const notesEl = $('#atsNotes');
    notesEl.innerHTML = '';
    (breakdown.notes || []).forEach(note => {
      const div = document.createElement('div');
      div.className = 'note-item';
      div.textContent = '• ' + note;
      notesEl.appendChild(div);
    });
  }
}

// ──────────────────────────────────────────────────────
// DOWNLOAD
// ──────────────────────────────────────────────────────
function handleDownload() {
  if (!state.currentPdfBase64) return;
  const byteChars = atob(state.currentPdfBase64);
  const byteArr = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) byteArr[i] = byteChars.charCodeAt(i);
  const blob = new Blob([byteArr], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${state.extractedCompany || 'resume'}_${state.extractedPosition || ''}.pdf`
    .replace(/[^a-z0-9_.-]/gi, '_');
  a.click();
  URL.revokeObjectURL(url);
}

// ──────────────────────────────────────────────────────
// CHAT / REVISION
// ──────────────────────────────────────────────────────
async function handleChatSend() {
  const instruction = $('#chatInput').value.trim();
  if (!instruction) return;

  $('#chatInput').value = '';
  addChatMessage(instruction, 'user');
  addChatMessage('Applying your changes...', 'assistant');

  showLoading('Applying revision...');

  try {
    const resp = await apiPost('/api/generate-resume', {
      user_id: state.userId,
      company: state.extractedCompany,
      position: state.extractedPosition,
      jdText: state.extractedJdText,
      revisionInstruction: instruction,
      previousContent: state.currentStructuredContent
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Revision failed');

    // Remove the "Applying..." placeholder and show result
    const msgs = $('#chatMessages');
    const placeholder = msgs.lastElementChild;
    if (placeholder && placeholder.textContent === 'Applying your changes...') {
      msgs.removeChild(placeholder);
    }
    addChatMessage(`Done! ATS score: ${data.atsScore}/100`, 'assistant');

    handleGenerationSuccess(data);
    toast('Resume updated!', 'success');
  } catch (err) {
    addChatMessage('Error: ' + err.message, 'assistant');
    toast('Revision error: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

function addChatMessage(text, role) {
  const msgs = $('#chatMessages');
  const div = document.createElement('div');
  div.className = `chat-msg ${role}`;
  div.textContent = text;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  state.chatHistory.push({ role, text });
}

// ──────────────────────────────────────────────────────
// APPROVE
// ──────────────────────────────────────────────────────
async function handleApprove() {
  if (!state.currentPdfBase64) {
    toast('No resume to approve.', 'error');
    return;
  }

  showLoading('Saving to tracker...');
  try {
    const resp = await apiPost('/api/approve-resume', {
      user_id: state.userId,
      company: state.extractedCompany,
      position: state.extractedPosition,
      jdText: state.extractedJdText,
      atsScore: state.currentAtsScore,
      pdfBase64: state.currentPdfBase64,
      latexSource: state.currentLatexSource
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Approval failed');

    toast('Saved to Supabase + Notion tracker! 🎉', 'success');

    // Reset state and go to history
    state.currentPdfBase64 = null;
    state.currentStructuredContent = null;
    switchTab('history');
    showScreen('screen-history');
    await loadHistory();
  } catch (err) {
    toast('Error saving: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

// ──────────────────────────────────────────────────────
// HISTORY
// ──────────────────────────────────────────────────────
async function loadHistory() {
  const company = $('#historySearch').value.trim();
  const url = `/api/search-resumes?user_id=${encodeURIComponent(state.userId)}` +
    (company ? `&company=${encodeURIComponent(company)}` : '');

  const listEl = $('#historyList');
  listEl.innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><p>Loading...</p></div>';

  try {
    const resp = await apiGet(url);
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error);

    if (!data.results || data.results.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📭</div>
          <p>No applications found.<br/>Approve a resume to see it here.</p>
        </div>`;
      return;
    }

    listEl.innerHTML = '';
    data.results.forEach(item => {
      const date = new Date(item.applied_at).toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric'
      });
      const score = item.ats_score;
      const scoreClass = score >= 75 ? 'high' : score >= 55 ? 'mid' : 'low';
      const div = document.createElement('div');
      div.className = 'history-item';
      div.innerHTML = `
        <div class="history-item-header">
          <div class="history-company">${escapeHtml(item.company)}</div>
          ${score ? `<span class="ats-badge ${scoreClass}">${score}/100</span>` : ''}
        </div>
        <div class="history-position">${escapeHtml(item.position)}</div>
        <div class="history-meta">
          <span class="history-date">📅 ${date}</span>
          ${item.pdfUrl ? `<a class="history-link" href="${item.pdfUrl}" target="_blank">View PDF ↗</a>` : ''}
        </div>`;
      listEl.appendChild(div);
    });
  } catch (err) {
    listEl.innerHTML = `<div class="empty-state"><p>Error loading history: ${escapeHtml(err.message)}</p></div>`;
  }
}

// ──────────────────────────────────────────────────────
// PROFILE SCREEN
// ──────────────────────────────────────────────────────
async function loadProfileScreen() {
  const el = $('#profileDisplay');
  if (!state.masterProfile) {
    el.innerHTML = '<div class="profile-loading">No profile set up yet.</div>';
    return;
  }
  const p = state.masterProfile;
  el.innerHTML = `
    <div class="profile-info-grid">
      ${profileField('Name', p.full_name)}
      ${profileField('Email', p.email)}
      ${profileField('Phone', p.phone)}
      ${profileField('Location', p.location)}
      ${profileField('LinkedIn', p.linkedin_url ? `<a href="${p.linkedin_url}" target="_blank" class="history-link">Profile ↗</a>` : '—', true)}
      ${profileField('GitHub', p.github_url ? `<a href="${p.github_url}" target="_blank" class="history-link">Profile ↗</a>` : '—', true)}
    </div>
    ${p.experience?.length ? `
      <div class="profile-section-title">Experience (${p.experience.length} entries)</div>
      ${p.experience.map(e => `
        <div class="profile-field" style="margin-bottom:6px">
          <div class="profile-field-label">${escapeHtml(e.company)}</div>
          <div class="profile-field-value">${escapeHtml(e.role)} · ${escapeHtml(e.start_date)}–${escapeHtml(e.end_date)}</div>
        </div>`).join('')}
    ` : ''}
    ${p.skills?.length ? `
      <div class="profile-section-title">Skills</div>
      <div class="keyword-chips" style="margin-top:4px">
        ${p.skills.flatMap(s => s.items || []).slice(0, 20).map(sk =>
          `<span class="chip chip-matched">${escapeHtml(sk)}</span>`).join('')}
      </div>
    ` : ''}
  `;
}

function profileField(label, value, rawHtml = false) {
  return `
    <div class="profile-field">
      <div class="profile-field-label">${label}</div>
      <div class="profile-field-value">${rawHtml ? (value || '—') : escapeHtml(value || '—')}</div>
    </div>`;
}

async function handleUpdateProfile() {
  const text = $('#updateResumeText').value.trim();
  if (!text || text.length < 100) {
    toast('Please paste a full resume to update your profile.', 'error');
    return;
  }
  showLoading('Updating profile...');
  try {
    const resp = await apiPost('/api/master-profile', {
      resumeText: text,
      user_id: state.userId
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Update failed');
    state.masterProfile = data.profile;
    await loadProfileScreen();
    $('#updateResumeText').value = '';
    toast('Profile updated! ✅', 'success');
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

// ──────────────────────────────────────────────────────
// UI HELPERS
// ──────────────────────────────────────────────────────
function showMainApp() {
  document.getElementById('tabNav').style.display = 'flex';
  showScreen('screen-main');
  // Reset extract state
  $('#jdEditor').classList.add('hidden');
  $('#extractBtn').disabled = false;
}

function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
}

function switchTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tabName);
  });
}

function showLoading(text = 'Processing...') {
  $('#loadingText').textContent = text;
  $('#loadingOverlay').classList.remove('hidden');
}

function updateLoadingText(text) {
  $('#loadingText').textContent = text;
}

function hideLoading() {
  $('#loadingOverlay').classList.add('hidden');
}

function toast(message, type = 'info') {
  const container = $('#toastContainer');
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = message;
  container.appendChild(t);
  setTimeout(() => {
    t.style.animation = 'none';
    t.style.opacity = '0';
    t.style.transition = 'opacity 0.3s';
    setTimeout(() => container.removeChild(t), 300);
  }, 3500);
}

function $(selector) {
  return document.getElementById(selector) || document.querySelector(selector);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ──────────────────────────────────────────────────────
// API HELPERS
// ──────────────────────────────────────────────────────
async function apiGet(path) {
  return fetch(API_BASE + path, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' }
  });
}

async function apiPost(path, body) {
  return fetch(API_BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

// ──────────────────────────────────────────────────────
// CHROME STORAGE HELPERS
// ──────────────────────────────────────────────────────
function chromeStorageGet(key) {
  return new Promise((resolve) => {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.get([key], (result) => resolve(result[key] || null));
    } else {
      resolve(localStorage.getItem(key));
    }
  });
}

function chromeStorageSet(key, value) {
  return new Promise((resolve) => {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({ [key]: value }, resolve);
    } else {
      localStorage.setItem(key, value);
      resolve();
    }
  });
}
