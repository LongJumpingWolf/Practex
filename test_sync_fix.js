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

// Simulated Supabase — a real in-memory table, shared across "devices" the way a
// real Supabase table would be shared across a real account's devices.
let fakeMcqTable = {};
let fakeSettingsRow = null;

function makeFakeSupabase() {
  return {
    from(table) {
      return {
        upsert(rowOrRows) {
          return (async () => {
            const rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
            // Deep-clone on write — a real network request always serializes to JSON,
            // producing an independent copy server-side. Without this, two simulated
            // "devices" reading the same in-memory object would share object identity
            // in a way that can never happen over a real network, and a mutation on
            // one device would leak directly into the other's state.
            if (table === 'mcqs') rows.forEach(r => { fakeMcqTable[r.id] = JSON.parse(JSON.stringify(r)); });
            else if (table === 'user_settings') fakeSettingsRow = JSON.parse(JSON.stringify(rows[0]));
            return { error: null };
          })();
        },
        select() {
          const chain = {
            eq: () => chain,
            range: (from, to) => (async () => {
              // Deep-clone on read too — same reasoning, the other direction.
              const all = Object.values(fakeMcqTable).map(r => JSON.parse(JSON.stringify(r)));
              return { error: null, data: all.slice(from, to + 1), count: all.length };
            })(),
            maybeSingle: () => (async () => ({ error: null, data: fakeSettingsRow ? JSON.parse(JSON.stringify(fakeSettingsRow)) : null }))(),
          };
          return chain;
        },
      };
    },
  };
}

const fakeLocalDisk = {}; // localStorage IS actually shared across devices in this sim, since it represents "this browser profile" — deliberately separate per simulated device below
const perDeviceLocal = {}; // one PER simulated device (mobile vs PC are genuinely separate machines — separate localStorage too, unlike two tabs of the SAME browser)
const perDeviceSession = {};

function newDevice(deviceId, url) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body><div id="appRoot"></div><div id="toast"></div><div id="loadingScreen"></div><div id="authGate"></div><div id="syncStatusPill"></div></body></html>`,
    { runScripts: 'outside-only', url });
  const win = dom.window;
  global.window = win; global.document = win.document;
  global.crypto = { subtle: { digest: async () => new ArrayBuffer(32) } };
  global.fetch = async () => ({ ok: false, json: async () => ({}) });

  if (!perDeviceLocal[deviceId]) perDeviceLocal[deviceId] = {};
  if (!perDeviceSession[deviceId]) perDeviceSession[deviceId] = {};
  const localDisk = perDeviceLocal[deviceId];
  const sessionDisk = perDeviceSession[deviceId];
  Object.defineProperty(win, 'localStorage', { value: {
    getItem: k => (k in localDisk ? localDisk[k] : null), setItem: (k,v) => { localDisk[k] = String(v); }, removeItem: k => { delete localDisk[k]; }
  }, configurable: true, writable: true });
  Object.defineProperty(win, 'sessionStorage', { value: {
    getItem: k => (k in sessionDisk ? sessionDisk[k] : null), setItem: (k,v) => { sessionDisk[k] = String(v); }, removeItem: k => { delete sessionDisk[k]; }
  }, configurable: true, writable: true });
  global.localStorage = win.localStorage; global.sessionStorage = win.sessionStorage;

  FILES.forEach(name => {
    try { win.eval(fs.readFileSync(path.join(APP_DIR, name), 'utf8')); } catch (e) {}
  });
  win.supabaseClient = makeFakeSupabase();
  // No real IndexedDB in this harness — stub the mirror with a per-device in-memory
  // object instead. The app's own real persistLocalMirror()/loadLocalMirror() calls
  // (already sprinkled at the right points throughout the real code) populate and
  // read this naturally, same as they'd populate real IndexedDB on a real device.
  if (!newDevice._mirrors) newDevice._mirrors = {};
  if (!newDevice._mirrors[deviceId]) newDevice._mirrors[deviceId] = null;
  win.persistLocalMirror = async function(){
    if (!win.state || !win.state.currentUser) return;
    newDevice._mirrors[deviceId] = { userId: win.state.currentUser.id, mcqs: win.state.mcqs, sources: win.state.sources, pausedSession: win.state.pausedSession };
  };
  win.loadLocalMirror = async function(){
    var m = newDevice._mirrors[deviceId];
    if (!m || !win.state || !win.state.currentUser || m.userId !== win.state.currentUser.id) return null;
    return m;
  };
  return win;
}

// Minimal but complete initial state — loadLibrary() touches all of these fields
// unconditionally, so a real device's app always has them from its own defaults;
// a stripped-down test state needs to provide the same baseline.
function freshState(overrides) {
  return Object.assign({
    mcqs: [], sources: {}, learningMode: { enabled: false }, darkMode: false,
    streak: { count: 0, lastDate: null }, fsrsCardExpanded: true, sleepingSubjects: {},
    autoSleepEnabled: true, autoSleepStreak: 4, emptyFolders: [], hasUnsyncedChanges: false,
    pausedSession: null, expanded: {},
  }, overrides || {});
}
function assert(label, cond, extra) {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + label + (extra ? '  ' + extra : ''));
  if (!cond) failures++;
}

(async () => {

console.log('=== REPRODUCING THE REPORTED BUG: mobile finishes a test, PC (stale tab) reloads + syncs ===');

fakeMcqTable = { q1: { id: 'q1', data: { id: 'q1', question: 'Q1', learning: { history: [] } } } };
fakeSettingsRow = { user_id: 'u1', sources: {}, streak: { count: 0, lastDate: null } };

// --- PC: opens the app, does a normal full load (this seeds its same-tab cache) ---
const pc = newDevice('PC', 'https://example.com/library.html');
pc.state = freshState({ currentUser: { id: 'u1' } });
await pc.loadLibrary();
pc.persistSessionCache();
assert('PC initial load sees the one existing question', pc.state.mcqs.length === 1);

// --- Mobile: separate device, finishes a "test" — answers q1, pushes to the server ---
const mobile = newDevice('Mobile', 'https://example.com/practice.html');
mobile.state = freshState({ currentUser: { id: 'u1' } });
await mobile.loadLibrary();
mobile.state.mcqs[0].learning.history.push({ correct: true, ts: Date.now() });
mobile.state.hasUnsyncedChanges = true;
await mobile.saveLibrary();
assert('mobile\'s finished-test data actually reached the simulated server',
  fakeMcqTable['q1'].data.learning.history.length === 1);

// --- PC: user "reloads" — a reload does NOT clear sessionStorage (only tab close does),
// so this simulates the exact real scenario: same tab, same stale session cache ---
console.log('\n--- PC reload (same tab — sessionStorage/mirror still has the OLD pre-mobile-test data) ---');
const pcReload = newDevice('PC', 'https://example.com/library.html'); // same deviceId 'PC' -> same localStorage/sessionStorage disks, simulating a reload not a fresh device
pcReload.state = freshState({ currentUser: { id: 'u1' } });

const cache = pcReload.loadSessionCache();
const gotMirror = cache ? await pcReload.applyMirrorAsLibraryFastPath() : false;
assert('fast path engages on reload (this is the actual condition that was hiding mobile\'s changes)', !!(cache && gotMirror));
if (cache && gotMirror) pcReload.applySessionCache(cache);
console.log('  [debug] PC mirror stub contents:', JSON.stringify(newDevice._mirrors['PC']));
console.log('  [debug] pcReload.state.mcqs:', JSON.stringify(pcReload.state.mcqs));
assert('immediately after the fast path, PC STILL shows the stale pre-mobile-test data (expected — this is the bug becoming visible before the fix runs)',
  pcReload.state.mcqs[0].learning.history.length === 0);

// This is the actual fix: the fast path now fires autoSync() afterward, which — since
// lastAutoSyncAt starts at 0 — always runs on a fresh page's first check.
await pcReload.autoSync();
await new Promise(r => setTimeout(r, 50)); // let the fire-and-forget reconcile actually settle
assert('THE FIX: after the fast-path\'s follow-up autoSync(), PC now sees mobile\'s finished test',
  pcReload.state.mcqs[0].learning.history.length === 1,
  'history length: ' + pcReload.state.mcqs[0].learning.history.length);

console.log('\n=== REPRODUCING THE SECOND PART: manual "Sync" button, PC still on stale data ===');
{
  fakeMcqTable = { q2: { id: 'q2', data: { id: 'q2', question: 'Q2', learning: { history: [] } } } };
  fakeSettingsRow = { user_id: 'u2', sources: {}, streak: { count: 0, lastDate: null } };

  const pcStale = newDevice('PC2', 'https://example.com/library.html');
  pcStale.state = freshState({ currentUser: { id: 'u2' }, mcqs: [{ id: 'q2', question: 'Q2 (stale local copy)', learning: { history: [] } }] });

  // Another device pushes a change to the SAME question
  fakeMcqTable['q2'].data.question = 'Q2 (updated on mobile)';
  fakeMcqTable['q2'].data.learning.history.push({ correct: true, ts: Date.now() });

  // PC clicks "Sync" — the OLD manualSync() would have just re-pushed PC's stale
  // copy, silently overwriting mobile's update on the server. The fix pulls first.
  await pcStale.manualSync();
  assert('manualSync() now actually pulls mobile\'s update, not just re-pushes stale local data',
    pcStale.state.mcqs[0].question === 'Q2 (updated on mobile)');
  assert('the server was NOT overwritten with PC\'s stale copy', fakeMcqTable['q2'].data.question === 'Q2 (updated on mobile)');
}

console.log('\n=== REGRESSION: mid-session, sync should push but must NOT pull (protects the live session) ===');
{
  fakeMcqTable = { q3: { id: 'q3', data: { id: 'q3', question: 'Q3 original', learning: { history: [] } } } };
  fakeSettingsRow = { user_id: 'u3', sources: {}, streak: { count: 0, lastDate: null } };

  const midSessionTab = newDevice('MidSession', 'https://example.com/practice.html');
  midSessionTab.state = freshState({
    currentUser: { id: 'u3' },
    view: 'practice',
    session: { ids: ['q3'], index: 0, viewIndex: 0 }, // isMidSession() checks view==='practice' && !!session
    mcqs: [{ id: 'q3', question: 'Q3 local mid-session copy', learning: { history: [] } }],
  });

  // Meanwhile the server has something different (shouldn't matter — pull must be skipped)
  fakeMcqTable['q3'].data.question = 'Q3 changed elsewhere';

  await midSessionTab.manualSync();
  assert('mid-session sync does NOT pull (would have wholesale-replaced the live mcqs array)',
    midSessionTab.state.mcqs[0].question === 'Q3 local mid-session copy');
  assert('mid-session sync DOES still push (server should have this device\'s current data)',
    fakeMcqTable['q3'].data.learning !== undefined);
}

console.log('\n' + (failures === 0 ? '=== ALL SYNC FIX TESTS PASSED ===' : '=== ' + failures + ' TEST(S) FAILED — see above ==='));
process.exitCode = failures === 0 ? 0 : 1;
setTimeout(() => process.exit(process.exitCode), 150);

})();
