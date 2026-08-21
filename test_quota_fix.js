const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

process.on('unhandledRejection', () => {});

const APP_DIR = '/home/claude/practex_final';
const FILES = [
  'practex-data-core.js',
  'practex-import-content.js',
  'practex-render-library.js',
  'practex-learning-practice.js',
  'practex-events-init.js',
];

const fakeSessionDisk = {};
const persistentSessionStorage = {
  getItem: k => (k in fakeSessionDisk ? fakeSessionDisk[k] : null),
  setItem: (k, v) => {
    // Real sessionStorage quota simulation — throw exactly like a real browser would
    // if this entry alone would exceed a conservative ~5MB per-origin budget, so this
    // test actually proves the fix rather than just trusting my own arithmetic.
    if (v.length > 5 * 1024 * 1024) {
      const err = new Error("Failed to execute 'setItem' on 'Storage': Setting the value exceeded the quota.");
      err.name = 'QuotaExceededError';
      throw err;
    }
    fakeSessionDisk[k] = String(v);
  },
  removeItem: k => { delete fakeSessionDisk[k]; },
};

// Minimal fake IndexedDB mirror — bypasses the real openDataMirrorDb()/indexedDB API
// (not available in this harness) by directly stubbing loadLocalMirror/persistLocalMirror
// AFTER the app loads, which is fine here since this test is specifically about
// verifying the SPLIT between the two caches, not IndexedDB's own mechanics (already
// exercised implicitly by every earlier chapter's tests running against real app code).
let fakeMirror = null;

function newWindow(url) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body><div id="appRoot"></div><div id="toast"></div><div id="loadingScreen"></div><div id="authGate"></div></body></html>`,
    { runScripts: 'outside-only', url });
  const win = dom.window;
  global.window = win; global.document = win.document;
  global.crypto = { subtle: { digest: async () => new ArrayBuffer(32) } };
  global.fetch = async () => ({ ok: false, json: async () => ({}) });
  Object.defineProperty(win, 'sessionStorage', { value: persistentSessionStorage, configurable: true, writable: true });
  global.sessionStorage = persistentSessionStorage;
  FILES.forEach(name => {
    try { win.eval(fs.readFileSync(path.join(APP_DIR, name), 'utf8')); } catch (e) { /* expected boot noise */ }
  });
  // Stub the mirror functions directly — simplest reliable way to control what
  // "IndexedDB already has" without standing up a real IndexedDB implementation.
  win.loadLocalMirror = async function(){ return fakeMirror; };
  return win;
}

let failures = 0;
function assert(label, cond, extra) {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + label + (extra ? '  ' + extra : ''));
  if (!cond) failures++;
}

(async () => {

console.log('=== FIX VERIFICATION: settings cache stays tiny regardless of library size ===');
{
  for (const k in fakeSessionDisk) delete fakeSessionDisk[k];
  const win = newWindow('https://example.com/library.html');

  // Simulate a library the same rough size as the one that triggered the real
  // QuotaExceededError report — 6,000+ rich question objects.
  const bigMcqs = [];
  for (let i = 0; i < 6052; i++) {
    bigMcqs.push({
      id: 'q' + i, question: 'A '.repeat(50) + 'question stem with realistic length ' + i,
      options: [{letter:'A',text:'x'.repeat(80)},{letter:'B',text:'x'.repeat(80)},{letter:'C',text:'x'.repeat(80)},{letter:'D',text:'x'.repeat(80)}],
      answer: ['A'], explanation: 'y'.repeat(300), tags: ['tag1','tag2'], notes: [],
      learning: { history: [], due: Date.now() },
    });
  }
  win.state = { currentUser: { id: 'u1' }, mcqs: bigMcqs, sources: {s1:{},s2:{},s3:{}},
    learningMode: { enabled: true }, darkMode: false, streak: {count:12,lastDate:'2026-08-20'},
    fsrsCardExpanded: true, sleepingSubjects: {}, autoSleepEnabled: true, autoSleepStreak: 4, emptyFolders: [] };

  let threw = false;
  try { win.persistSessionCache(); } catch(e) { threw = true; console.log('  threw:', e.message); }
  assert('persistSessionCache() does not throw even with a 6000+ question library in state', !threw);

  const raw = fakeSessionDisk['practex_session_cache_v1'];
  assert('cache entry was actually written', !!raw);
  if (raw) {
    assert('cache entry is small (well under quota) regardless of library size', raw.length < 5000, 'actual bytes: ' + raw.length);
    const parsed = JSON.parse(raw);
    assert('cache entry does NOT contain mcqs (the actual fix)', !('mcqs' in parsed));
    assert('cache entry does NOT contain sources (the actual fix)', !('sources' in parsed));
    assert('cache entry DOES still contain settings', parsed.learningModeEnabled === true && parsed.streak.count === 12);
  }
}

console.log('\n=== FIX VERIFICATION: fast path correctly combines settings cache + mirror ===');
{
  for (const k in fakeSessionDisk) delete fakeSessionDisk[k];
  fakeMirror = { userId: 'u1', mcqs: [{id:'q1'},{id:'q2'},{id:'q3'}], sources: {s1:{}} };

  const winA = newWindow('https://example.com/library.html');
  winA.state = { currentUser: { id: 'u1' }, mcqs: [], sources: {}, learningMode: { enabled: false },
    darkMode: true, streak: {count:3,lastDate:'x'}, fsrsCardExpanded: true, sleepingSubjects: {},
    autoSleepEnabled: true, autoSleepStreak: 4, emptyFolders: [] };
  winA.persistSessionCache();

  const winB = newWindow('https://example.com/practice.html');
  winB.state = { currentUser: { id: 'u1' }, mcqs: [], sources: {}, learningMode: { enabled: false } };
  const cache = winB.loadSessionCache();
  assert('settings cache found on next page', cache !== null);
  const gotMirror = await winB.applyMirrorAsLibraryFastPath();
  assert('mirror successfully provides mcqs/sources', gotMirror === true);
  if (cache) winB.applySessionCache(cache);
  assert('mcqs hydrated from mirror, not sessionStorage', winB.state.mcqs.length === 3);
  assert('sources hydrated from mirror', Object.keys(winB.state.sources).length === 1);
  assert('settings hydrated from the small cache', winB.state.darkMode === true && winB.state.streak.count === 3);
}

console.log('\n=== FIX VERIFICATION: no mirror yet (fresh account) -> fast path correctly declines ===');
{
  fakeMirror = null;
  const win = newWindow('https://example.com/practice.html');
  win.state = { currentUser: { id: 'u1' }, mcqs: [], sources: {} };
  const gotMirror = await win.applyMirrorAsLibraryFastPath();
  assert('returns false when no mirror exists yet', gotMirror === false);
  assert('does not corrupt state.mcqs on a declined fast path', Array.isArray(win.state.mcqs) && win.state.mcqs.length === 0);
}

console.log('\n=== REGRESSION: FSRS toggle race fix still works with the smaller cache ===');
{
  for (const k in fakeSessionDisk) delete fakeSessionDisk[k];
  const win = newWindow('https://example.com/library.html');
  win.state = { currentUser: { id: 'u1' }, mcqs: [], sources: {}, learningMode: { enabled: true },
    darkMode: false, streak: {count:0,lastDate:null}, fsrsCardExpanded: true, sleepingSubjects: {},
    autoSleepEnabled: true, autoSleepStreak: 4, emptyFolders: [] };
  win.state.learningMode.enabled = !win.state.learningMode.enabled;
  win.persistSessionCache(); // simulating what saveFsrsMode()'s hook does synchronously
  const cache = win.loadSessionCache();
  assert('FSRS toggle still reflected instantly in the (now smaller) cache', cache && cache.learningModeEnabled === false);
}

console.log('\n' + (failures === 0 ? '=== ALL QUOTA-FIX TESTS PASSED ===' : '=== ' + failures + ' TEST(S) FAILED — see above ==='));
process.exitCode = failures === 0 ? 0 : 1;
setTimeout(() => process.exit(process.exitCode), 150);

})();
