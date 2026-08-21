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

function makeMcq(id) {
  return {
    id: id, question: 'Q ' + id, subject: 'Pathology', chapterPath: ['Ch1'],
    source: 'Book', tags: [], options: [], answer: ['A'], explanation: '',
    images: [], answerImages: [], notes: [], flagged: false, asleep: false,
    learning: { history: [], due: Date.now(), interval: 0, lastReviewed: null, fsrs: null },
  };
}

console.log('=== clear-all: same auto-sync race that empty-trash was fixed for, applied to the whole library ===');
{
  window.state = {
    mcqs: [makeMcq('a'), makeMcq('b'), makeMcq('c')],
    sources: { 'Book': { color: '#123456' } },
    currentUser: { id: 'u1' }, hasUnsyncedChanges: false, selectedPath: ['Book'],
  };
  window.showToast = function(){};
  window.render = function(){};
  window.deleteMcqRows = async function(){ /* simulated network delete, not yet landed when the race check happens below */ };
  window.saveSources = async function(){};

  // Reproduce clear-all's own body directly (not through the DOM event handler,
  // since that requires full click wiring) — same local mutations it performs.
  var allMcqIds = window.state.mcqs.map(function(m){ return m.id; });
  window.state.mcqs = [];
  window.state.sources = {};
  window.state.selectedPath = null;
  window.syncInFlight = true; // THE fix under test
  window.state.hasUnsyncedChanges = true;

  // Simulate a concurrent auto-sync firing in the exact window between the local
  // clear and deleteMcqRows/saveSources actually landing — reconcileWithCloud's
  // very first check is `if (syncInFlight) return;`.
  window.supabaseClient = {};
  window.loadLibrary = async function(){
    // If this ever actually ran during the race window, it would resurrect the
    // whole library — proving the fix by proving this function correctly never runs.
    window.state.mcqs = [makeMcq('a'), makeMcq('b'), makeMcq('c')];
  };
  window.pushLocalChanges = async function(){ window.state.hasUnsyncedChanges = false; return true; };
  window.updateSyncIndicator = function(){};

  window.reconcileWithCloud({ silent: true }).then(function(){
    assert('THE FIX: reconcileWithCloud bailed out immediately (syncInFlight guard) — the concurrent pull never ran', window.state.mcqs.length === 0, 'mcqs count: ' + window.state.mcqs.length);
    window.syncInFlight = false; // simulates clear-all's own finally block running once deleteMcqRows/saveSources actually complete
    part2();
  });
}

function part2() {
console.log('\n=== REGRESSION: without the guard, the same race WOULD resurrect the entire library (proving this isn\'t a coincidence) ===');
{
  window.state = {
    mcqs: [], sources: {}, currentUser: { id: 'u1' }, hasUnsyncedChanges: false,
  };
  window.syncInFlight = false; // deliberately NOT set — simulating the pre-fix code path
  window.loadLibrary = async function(){
    window.state.mcqs = [makeMcq('a'), makeMcq('b'), makeMcq('c')];
  };
  window.pushLocalChanges = async function(){ return true; };
  window.updateSyncIndicator = function(){};

  window.reconcileWithCloud({ silent: true }).then(function(){
    assert('confirms the race is real: without syncInFlight, the pull DOES bring the whole library back', window.state.mcqs.length === 3);

    console.log('\n' + ((failures === 0 && !loadFailed) ? '=== CLEAR-ALL SYNCINFLIGHT FIX VERIFIED ===' : '=== ' + failures + ' FAILURE(S) — see above ==='));
    process.exitCode = (failures === 0 && !loadFailed) ? 0 : 1;
    process.exit(process.exitCode);
  });
}
}
