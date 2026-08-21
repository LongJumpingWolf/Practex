const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

process.on('unhandledRejection', (reason) => { console.error('FATAL: unhandled rejection —', reason && reason.stack ? reason.stack : reason); process.exitCode = 1; process.exit(1); });

let loadFailed = false; // set if any app file fails to eval — see the load-error catch below
const APP_DIR = __dirname; // was hardcoded to a past session's path — tests live alongside the source, see HANDOFF.md
const FILES = [
  'practex-data-core.js',
  'practex-import-content.js',
  'practex-render-library.js',
  'practex-learning-practice.js',
  'practex-events-init.js',
];

// Two independent simulated disks — localStorage (survives tab close) and
// sessionStorage (survives navigation within a tab, cleared on tab close) — exactly
// matching the real distinction the fix depends on.
const fakeLocalDisk = {};
const persistentLocalStorage = {
  getItem: k => (k in fakeLocalDisk ? fakeLocalDisk[k] : null),
  setItem: (k, v) => { fakeLocalDisk[k] = String(v); },
  removeItem: k => { delete fakeLocalDisk[k]; },
};
const fakeSessionDisk = {}; // shared across "pages" in the same simulated tab, reset between simulated tabs
const persistentSessionStorage = {
  getItem: k => (k in fakeSessionDisk ? fakeSessionDisk[k] : null),
  setItem: (k, v) => { fakeSessionDisk[k] = String(v); },
  removeItem: k => { delete fakeSessionDisk[k]; },
};

function newWindow(url) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body><div id="appRoot"></div><div id="toast"></div><div id="loadingScreen"></div><div id="authGate"></div><div id="syncStatusPill"></div></body></html>`,
    { runScripts: 'outside-only', url });
  const win = dom.window;
  global.window = win; global.document = win.document;
  global.crypto = { subtle: { digest: async () => new ArrayBuffer(32) } };
  global.fetch = async () => ({ ok: false, json: async () => ({}) });
  Object.defineProperty(win, 'localStorage', { value: persistentLocalStorage, configurable: true, writable: true });
  Object.defineProperty(win, 'sessionStorage', { value: persistentSessionStorage, configurable: true, writable: true });
  global.localStorage = persistentLocalStorage;
  global.sessionStorage = persistentSessionStorage;
  FILES.forEach(name => {
    try { win.eval(fs.readFileSync(path.join(APP_DIR, name), 'utf8')); } catch (e) { console.error('LOAD ERROR in ' + name + ': ' + e.message); loadFailed = true; }
  });
  return win;
}

let failures = 0;
function assert(label, cond, extra) {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + label + (extra ? '  ' + extra : ''));
  if (!cond) failures++;
}

console.log('=== BUG FIX 1: "Leave without pausing" must not resurrect a stale paused session ===');
{
  for (const k in fakeLocalDisk) delete fakeLocalDisk[k];
  for (const k in fakeSessionDisk) delete fakeSessionDisk[k];

  // Start a session on library.html — this is the ORIGINAL bug trigger: startPractice()
  // writes a hand-off snapshot into PAUSED_SESSION_SYNC_KEY.
  const winLib = newWindow('https://example.com/library.html');
  winLib.state = { currentUser: { id: 'u1' }, mcqs: [
    { id: 'q1', type: undefined, answer: ['A'], learning: { history: [] } },
  ], learningMode: { enabled: false } };
  winLib.startPractice(['q1']);
  const afterStart = winLib.loadPausedSessionSync();
  assert('startPractice() writes the hand-off snapshot', afterStart && afterStart.ids.length === 1);

  // Arrive on practice.html, session gets adopted
  const winPrac = newWindow('https://example.com/practice.html');
  winPrac.state = { currentUser: { id: 'u1' }, pausedSession: JSON.parse(fakeLocalDisk['practex_paused_session_sync_v1']).pausedSession };
  winPrac.goToPracticeIfSessionPending();
  const afterAdopt = winPrac.loadPausedSessionSync();
  assert('sync key is CLEARED once adopted into a live session (the actual fix)', afterAdopt === null, 'got: ' + JSON.stringify(afterAdopt));

  // User explicitly clicks "Leave without pausing" — simulate the handler's core effect directly
  winPrac.clearLiveSessionSync();
  winPrac.clearPausedSessionSync();
  const afterLeave = winPrac.loadPausedSessionSync();
  assert('sync key still clear after explicit "leave without pausing"', afterLeave === null);

  // Next arrival at library.html — the bug would have shown a "Paused test" card here
  const winLib2 = newWindow('https://example.com/library.html');
  winLib2.state = { currentUser: { id: 'u1' }, pausedSession: null };
  const syncCheck = winLib2.loadPausedSessionSync();
  assert('no stale session resurfaces on the next library.html load', syncCheck === null, 'got: ' + JSON.stringify(syncCheck));
}

console.log('\n=== BUG FIX 2: toggling FSRS then immediately navigating must not silently revert ===');
{
  for (const k in fakeSessionDisk) delete fakeSessionDisk[k];

  const win = newWindow('https://example.com/library.html');
  win.state = { currentUser: { id: 'u1' }, mcqs: [], sources: {}, learningMode: { enabled: true },
    darkMode: false, streak: {count:0,lastDate:null}, fsrsCardExpanded: true, sleepingSubjects: {},
    autoSleepEnabled: true, autoSleepStreak: 4, emptyFolders: [] };

  // Simulate the toggle handler's exact sequence
  win.state.learningMode.enabled = !win.state.learningMode.enabled; // now false
  win.saveFsrsMode(); // fire-and-forget in the real app — we don't await it either, simulating the race

  // Immediately check what the NEXT page's fast-path would read, WITHOUT waiting for
  // any network round trip — this is the exact race window that caused the bug.
  const cache = win.loadSessionCache();
  assert('session cache reflects the toggle INSTANTLY, before any network save could land',
    cache && cache.learningModeEnabled === false, 'got: ' + JSON.stringify(cache && cache.learningModeEnabled));
}

console.log('\n=== BUG FIX 3: same-tab navigation should skip the full reload (settings half only — see test_quota_fix.js for the full settings+mirror fast path) ===');
{
  for (const k in fakeSessionDisk) delete fakeSessionDisk[k];

  // Page A: settings save happens, cache gets seeded (mcqs/sources deliberately no
  // longer part of this cache as of the quota fix — that half now comes from the
  // IndexedDB mirror instead, covered by test_quota_fix.js, not duplicated here)
  const winA = newWindow('https://example.com/library.html');
  winA.state = { currentUser: { id: 'u1' }, mcqs: [{id:'q1'}, {id:'q2'}], sources: {s1:{}},
    learningMode: { enabled: true }, darkMode: false, streak: {count:5,lastDate:'2026-08-20'},
    fsrsCardExpanded: true, sleepingSubjects: {}, autoSleepEnabled: true, autoSleepStreak: 4, emptyFolders: [] };
  winA.persistSessionCache();

  // Page B: a DIFFERENT window (simulating the new document after navigation), same tab's sessionStorage
  const winB = newWindow('https://example.com/practice.html');
  winB.state = { currentUser: { id: 'u1' }, mcqs: [], sources: {}, learningMode: { enabled: false } }; // currentUser must be set BEFORE loadSessionCache() checks it, same as the real app resolves auth before calling showApp()
  const cache = winB.loadSessionCache();
  assert('cache is found on the next page in the same simulated tab', cache !== null);
  if (cache) {
    winB.applySessionCache(cache);
    assert('streak carried over correctly', winB.state.streak.count === 5);
    assert('learningMode carried over correctly', winB.state.learningMode.enabled === true);
  }

  // Page C: a brand new TAB (fresh sessionStorage) must NOT see the cache — confirms
  // this doesn't leak across genuinely separate sessions.
  for (const k in fakeSessionDisk) delete fakeSessionDisk[k]; // simulates a new tab's empty sessionStorage
  const winC = newWindow('https://example.com/library.html');
  const cacheC = winC.loadSessionCache();
  assert('a genuinely new tab (empty sessionStorage) correctly falls through to a full load', cacheC === null);
}

console.log('\n=== REGRESSION: saveLibrary() and saveUserSettings() keep caches in sync ===');
{
  for (const k in fakeSessionDisk) delete fakeSessionDisk[k];
  const win = newWindow('https://example.com/practice.html');
  win.state = { currentUser: { id: 'u1' }, mcqs: [{id:'q1', learning:{history:[]}}], sources: {},
    learningMode: { enabled: true }, darkMode: false, streak: {count:0,lastDate:null},
    fsrsCardExpanded: true, sleepingSubjects: {}, autoSleepEnabled: true, autoSleepStreak: 4, emptyFolders: [] };

  // Mutate mcqs (simulating an answered question updating learning history) then save.
  // Post-quota-fix, saveLibrary() no longer puts mcqs into the sessionStorage settings
  // cache (that's the fix itself — see persistSessionCache() in practex-data-core.js) —
  // mcqs go through persistLocalMirror() instead, which saveLibrary() already calls
  // unconditionally. This checks each cache holds what it's actually supposed to now.
  win.state.mcqs[0].learning.history.push({correct:true, ts: Date.now()});
  win.saveLibrary();
  const settingsCache = win.loadSessionCache();
  assert('saveLibrary() does NOT put mcqs into the settings cache (the quota fix)', settingsCache && !('mcqs' in settingsCache));

  win.state.darkMode = true;
  win.saveUserSettings();
  const settingsCache2 = win.loadSessionCache();
  assert('saveUserSettings() DOES update the settings cache', settingsCache2 && settingsCache2.darkMode === true);
}

console.log('\n' + (failures === 0 ? '=== ALL BUGFIX TESTS PASSED ===' : '=== ' + failures + ' TEST(S) FAILED — see above ==='));
process.exitCode = (failures === 0 && !loadFailed) ? 0 : 1;
setTimeout(() => process.exit(process.exitCode), 150);
