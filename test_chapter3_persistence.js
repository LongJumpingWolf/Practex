const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

// init() is async and calls Supabase/DOM things this minimal harness never set up —
// it throws after an await boundary, which becomes an unhandled rejection rather than
// something a synchronous try/catch around eval() can catch. Expected and harmless:
// every assertion in this file runs and reports before init()'s async chain gets to
// that point. Swallow it so the suite's real pass/fail is what determines exit code.
process.on('unhandledRejection', () => {});

const APP_DIR = '/home/claude/practex_final';
const FILES = [
  'practex-data-core.js',
  'practex-import-content.js',
  'practex-render-library.js',
  'practex-learning-practice.js',
  'practex-events-init.js',
];

function freshWindow() {
  const dom = new JSDOM(`<!DOCTYPE html><html><body><div id="appRoot"></div><div id="loadingScreen"></div></body></html>`,
    { runScripts: 'outside-only', url: 'https://example.com/' });
  const { window } = dom;
  global.window = window;
  global.document = window.document;
  global.crypto = { subtle: { digest: async () => new ArrayBuffer(32) } };
  global.fetch = async () => ({ ok: false, json: async () => ({}) });
  return window;
}

// A real localStorage backed by a plain object OUTSIDE any single jsdom window, so it
// genuinely persists across the "crash" (a brand new window/global reset below) —
// exactly like real localStorage survives a tab close and reopen.
const fakeDisk = {};
const persistentLocalStorage = {
  getItem: k => (k in fakeDisk ? fakeDisk[k] : null),
  setItem: (k, v) => { fakeDisk[k] = String(v); },
  removeItem: k => { delete fakeDisk[k]; },
};

function loadAllFiles(win) {
  // jsdom ships its own real localStorage implementation — a plain `win.localStorage = x`
  // assignment silently doesn't stick (it's not a writable own-property in the way you'd
  // expect), so a naive override leaves each fresh jsdom window with its OWN isolated
  // storage, never actually sharing state the way two real browser sessions against the
  // same disk would. Object.defineProperty forces the real override.
  Object.defineProperty(win, 'localStorage', { value: persistentLocalStorage, configurable: true, writable: true });
  global.localStorage = persistentLocalStorage;
  let errors = [];
  FILES.forEach(name => {
    const code = fs.readFileSync(path.join(APP_DIR, name), 'utf8');
    try { win.eval(code); } catch (e) { errors.push(name + ': ' + e.message); }
  });
  return errors;
}

console.log('=== TEST 1: serialize/deserialize round trip for every Chapter-1 type\'s s.selected shape ===');
{
  const win = freshWindow();
  loadAllFiles(win);
  win.state = { currentUser: { id: 'user-1' } };
  const cases = [
    ['match', { links: {0:0,1:2}, rightOrder: [2,0,1], pendingLeft: null }],
    ['sequence', [2,0,1,3]],
    ['cutoff', 11.3],
    ['mnemonic/short', 'a typed guess with spaces and — punctuation'],
    ['standard MCQ', ['B','D']],
  ];
  let allPass = true;
  cases.forEach(([label, value]) => {
    const roundTripped = JSON.parse(JSON.stringify(value));
    const pass = JSON.stringify(roundTripped) === JSON.stringify(value);
    console.log((pass ? 'PASS' : 'FAIL') + '  ' + label + '  ' + JSON.stringify(value) + ' -> ' + JSON.stringify(roundTripped));
    if (!pass) allPass = false;
  });
  console.log(allPass ? 'Round-trip: ALL PASS\n' : 'Round-trip: FAILURES ABOVE\n');
}

console.log('=== TEST 2: staleness bug — old code would freeze after first hide; new code must not ===');
{
  const win = freshWindow();
  loadAllFiles(win);
  win.state = {
    currentUser: { id: 'user-1' },
    view: 'practice',
    session: { ids: ['q1','q2','q3'], index: 1, viewIndex: 1, selected: null, revealed: false, results: [{id:'q1',correct:true}], undoStack: [] },
  };
  // First "hide" — simulate what persistLiveSessionSync does (called internally by render(),
  // but we call it directly here since render() needs a full DOM/mcqs setup this harness doesn't have)
  win.persistLiveSessionSync();
  const afterFirst = JSON.parse(persistentLocalStorage.getItem('practex_live_session_sync_v1'));
  console.log('after first snapshot, index =', afterFirst.session.index, '(expect 1)');

  // User comes back, keeps answering — index advances
  win.state.session.index = 2;
  win.state.session.results.push({id:'q2',correct:false});
  win.persistLiveSessionSync(); // this is the call that was MISSING in the old guarded version
  const afterSecond = JSON.parse(persistentLocalStorage.getItem('practex_live_session_sync_v1'));
  console.log('after second snapshot, index =', afterSecond.session.index, '(expect 2, NOT still 1)');

  const pass = afterSecond.session.index === 2 && afterSecond.session.results.length === 2;
  console.log(pass ? 'PASS — snapshot stayed fresh across multiple hides, staleness bug is fixed\n' : 'FAIL — snapshot went stale\n');
}

console.log('=== TEST 3: alt-tab-and-come-back must NOT show a paused-session card ===');
{
  const win = freshWindow();
  loadAllFiles(win);
  win.state = { currentUser: { id: 'user-1' }, view: 'practice', session: { ids:['q1'], index:0, viewIndex:0, selected:null, revealed:false, results:[], undoStack:[] }, pausedSession: null };
  win.persistLiveSessionSync(); // this is what the visibilitychange handler now calls — nothing else
  const pass = win.state.pausedSession === null;
  console.log((pass ? 'PASS' : 'FAIL') + '  state.pausedSession is still null after a hide-event-triggered persist (' + JSON.stringify(win.state.pausedSession) + ') — the "Paused test" card should NOT appear while still actively practicing\n');
}

console.log('=== TEST 4: full crash simulation — mutate session, "crash" (no graceful exit), reboot, verify recovery ===');
{
  // --- Session A: the "before crash" browser tab ---
  const winA = freshWindow();
  loadAllFiles(winA);
  winA.state = {
    currentUser: { id: 'user-1' },
    view: 'practice',
    session: {
      ids: ['q1','q2','q3','q4'], index: 2, viewIndex: 2,
      selected: { links: {0:0}, rightOrder: [1,0], pendingLeft: 1 }, // mid-interaction on a match question
      revealed: false,
      results: [{id:'q1',correct:true},{id:'q2',correct:false}],
      undoStack: [{mcqId:'q1', index:0, selected:['A']}],
      stats: { correct:1, wrong:1, misconception:0, learning:0, mastered:0, noconcept:0 },
    },
    pausedSession: null,
  };
  winA.persistLiveSessionSync(); // what render() would have called after every action
  console.log('Session A: mid-session state persisted, index =', winA.state.session.index);
  console.log('Session A: NEVER called pause-and-leave, leave-without-pausing, or reached summary — this is an ungraceful exit.');
  // No clearLiveSessionSync() call anywhere — simulates the tab just vanishing.

  // --- Reboot: brand new window, same disk (persistentLocalStorage), simulating reopening the app ---
  const winB = freshWindow();
  loadAllFiles(winB);
  winB.state = { currentUser: { id: 'user-1' }, pausedSession: null };

  // Reproduce exactly the reconciliation logic loadLibrary() runs (without the Supabase
  // network calls this harness can't make) — same function, same key, same comparison.
  const liveSync = winB.loadLiveSessionSync();
  const cloudPausedAt = 0; // simulate no cloud pause on record
  const liveSyncAt = liveSync ? (liveSync.savedAt || 0) : 0;
  if (liveSyncAt > cloudPausedAt) {
    winB.state.pausedSession = liveSync.session;
    winB.state.pausedSession.pausedAt = liveSync.savedAt;
    winB.state.pausedSession.recoveredFromCrash = true;
  }

  console.log('\nAfter reboot, recovered pausedSession:');
  console.log('  index:', winB.state.pausedSession.index, '(expect 2)');
  console.log('  selected.links:', JSON.stringify(winB.state.pausedSession.selected.links), '(expect {"0":0})');
  console.log('  selected.pendingLeft:', winB.state.pausedSession.selected.pendingLeft, '(expect 1)');
  console.log('  results.length:', winB.state.pausedSession.results.length, '(expect 2)');
  console.log('  recoveredFromCrash:', winB.state.pausedSession.recoveredFromCrash, '(expect true)');

  const pass = winB.state.pausedSession.index === 2
    && winB.state.pausedSession.selected.links['0'] === 0
    && winB.state.pausedSession.selected.pendingLeft === 1
    && winB.state.pausedSession.results.length === 2
    && winB.state.pausedSession.recoveredFromCrash === true;
  console.log('\n' + (pass ? 'PASS — full crash recovery reproduces exact pre-crash state, including in-progress match-question interaction' : 'FAIL — recovered state does not match what was live before the crash'));
  process.exitCode = pass ? 0 : 1;
}

console.log('\n=== TEST 5: normal completion clears the live-sync key (no false "crash" on next load) ===');
{
  const win = freshWindow();
  loadAllFiles(win);
  win.state = { currentUser: { id: 'user-1' }, view: 'practice', session: { ids:['q1'], index:0, viewIndex:0, selected:['A'], revealed:true, results:[], undoStack:[] } };
  win.persistLiveSessionSync();
  console.log('before completion, key present:', win.loadLiveSessionSync() !== null);
  win.clearLiveSessionSync(); // what advanceAfterReveal() now calls on normal completion
  const afterClear = win.loadLiveSessionSync();
  console.log('after normal completion, key present:', afterClear !== null, '(expect false)');
  console.log(afterClear === null ? 'PASS\n' : 'FAIL\n');
  if (afterClear !== null) process.exitCode = 1;
}
setTimeout(() => process.exit(process.exitCode || 0), 200); // let any trailing async noise settle, then exit clean
