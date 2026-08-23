const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

process.on('unhandledRejection', (reason) => { console.error('FATAL: unhandled rejection —', reason && reason.stack ? reason.stack : reason); process.exitCode = 1; process.exit(1); });

const dom = new JSDOM(`<div id="appRoot"></div><div id="toast"></div><div id="modalRoot"></div><div id="loadingScreen"></div><div id="authGate"></div><div id="syncStatusPill"></div>`,
  { runScripts: 'outside-only', url: 'https://example.com/library.html' });
const { window } = dom;
global.window = window;
global.document = window.document;
global.crypto = { subtle: { digest: async () => new ArrayBuffer(32) } };
global.fetch = async () => ({ ok: false, json: async () => ({}) });

let loadFailed = false;
const names = ['practex-data-core.js','practex-import-content.js','practex-render-library.js','practex-learning-practice.js','practex-events-init.js'];
names.forEach(n => {
  try {
    window.eval(fs.readFileSync(path.join(__dirname, n), 'utf8'));
  } catch (e) {
    console.error('LOAD ERROR in ' + n + ':', e.message);
    loadFailed = true;
  }
});

let failures = 0;
function assert(label, cond, extra) {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + label + (extra ? '  ' + extra : ''));
  if (!cond) failures++;
}

function makeMcq(id, overrides) {
  return Object.assign({
    id: id, question: 'Q ' + id, subject: 'Pathology', chapterPath: ['Ch1'],
    source: 'Book', tags: [], options: [], answer: ['A'], explanation: '',
    images: [], answerImages: [], notes: [], flagged: false, asleep: false,
    learning: { history: [], due: Date.now(), interval: 0, lastReviewed: null, fsrs: null },
  }, overrides || {});
}

// 5 live questions, 2 trashed — every fixed display should say 5, never 7.
window.state = {
  mcqs: [
    makeMcq('a'), makeMcq('b'), makeMcq('c'), makeMcq('d'), makeMcq('e'),
    makeMcq('trashed1', { trashedAt: Date.now() }),
    makeMcq('trashed2', { trashedAt: Date.now() }),
  ],
  sources: { 'Book': { color: '#123456' } },
  currentUser: { id: 'u1' }, sleepingSubjects: {}, learningMode: { enabled: false },
  fsrsCardExpanded: true, streak: { count: 0 }, darkMode: false,
  view: 'browse', selectedPath: null, forceList: false, expanded: {},
  filters: { search: '' }, studyPlans: {}, autoSleepEnabled: true, autoSleepStreak: 4,
};

console.log('=== Sidebar side-footer count excludes trashed items (the "Tracked" stat itself moved to Settings, see below) ===');
{
  const sidebarHtml = window.renderSidebar();
  assert('side-footer "MCQs logged" shows 5, not 7', sidebarHtml.indexOf('5 MCQs logged from 1 source') !== -1, sidebarHtml.match(/\d+ MCQs logged/));
}

console.log('\n=== Settings "Questions tracked" now excludes trashed items ===');
{
  window.renderSettingsModalContent();
  const settingsHtml = document.getElementById('modalRoot').innerHTML;
  assert('a settings-render function exists to check', typeof window.renderSettingsModalContent === 'function');
  if (settingsHtml) {
    assert('"Questions tracked" shows 5, not 7', settingsHtml.indexOf('<span>Questions tracked</span><strong>5</strong>') !== -1, settingsHtml.match(/Questions tracked<\/span><strong>\d+/));
    assert('FSRS stats (Due/Misconcept./Tomorrow) now live in Settings, not the sidebar', settingsHtml.indexOf('Due') !== -1 && settingsHtml.indexOf('Misconcept.') !== -1 && settingsHtml.indexOf('Tomorrow') !== -1);
  }
}

console.log('\n=== The old sidebar FSRS bar is gone entirely — no dead markup left behind ===');
{
  const sidebarHtml = window.renderSidebar();
  assert('no more fsrs-bar in the sidebar', sidebarHtml.indexOf('fsrs-bar') === -1);
  assert('no more standalone FSRS toggle switch in the sidebar', sidebarHtml.indexOf('fsrs-switch') === -1);
}

console.log('\n=== Add Source: "All questions (N)" dropdown label now matches what downloadIdSheet() actually exports ===');
{
  const addSourceHtml = window.renderAddSource ? window.renderAddSource() : null;
  assert('an add-source-render function exists to check', addSourceHtml !== null);
  if (addSourceHtml !== null) {
    assert('dropdown label shows "All questions (5)", not (7) — matches liveMcqs() used by the real export', addSourceHtml.indexOf('All questions (5)') !== -1, addSourceHtml.match(/All questions \(\d+\)/));
  }
}

console.log('\n' + ((failures === 0 && !loadFailed) ? '=== ALL DISPLAY-COUNT FIXES VERIFIED ===' : '=== ' + failures + ' FAILURE(S) — see above ==='));
process.exitCode = (failures === 0 && !loadFailed) ? 0 : 1;
process.exit(process.exitCode);
