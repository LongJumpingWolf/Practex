const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

process.on('unhandledRejection', (reason) => { console.error('FATAL:', reason && reason.stack ? reason.stack : reason); process.exit(1); });

let failures = 0;
function assert(label, cond, extra) {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + label + (extra ? '  ' + extra : ''));
  if (!cond) failures++;
}

function makeMcq(id) {
  return {
    id: id, question: 'Q ' + id, subject: 'Pathology', chapterPath: ['Ch1'],
    source: 'Book', tags: [], options: [{letter:'A',text:'x'},{letter:'B',text:'y'}], answer: ['A'], explanation: '',
    images: [], answerImages: [], notes: [], flagged: false, asleep: false,
    learning: { history: [], due: Date.now(), interval: 0, lastReviewed: null, fsrs: null },
  };
}

async function seedMirror(win, record) {
  const seedReq = win.indexedDB.open('practex_data_mirror_v1', 1);
  await new Promise((resolve, reject) => {
    seedReq.onupgradeneeded = function(){ seedReq.result.createObjectStore('mirror', { keyPath: 'key' }); };
    seedReq.onsuccess = function(){
      const tx = seedReq.result.transaction('mirror', 'readwrite');
      tx.objectStore('mirror').put(record);
      tx.oncomplete = resolve; tx.onerror = reject;
    };
    seedReq.onerror = reject;
  });
}

function setupWindow() {
  const dom = new JSDOM(`
    <div id="loadingScreen" style="display:flex;"></div>
    <div id="authGate" style="display:none;"></div>
    <div id="appRoot" style="display:none;"></div>
    <div id="toast"></div><div id="modalRoot"></div><div id="syncStatusPill"></div>
  `, { runScripts: 'outside-only', url: 'https://example.com/library-offline.html' });
  const win = dom.window;
  global.window = win; global.document = win.document; global.navigator = win.navigator;
  global.crypto = { subtle: { digest: async () => new ArrayBuffer(32) } };
  global.fetch = async () => ({ ok: false, json: async () => ({}) });
  // jsdom's window.localStorage is a getter-only property — assigning a mock to it
  // (win.localStorage = ...) is silently ignored, not an error. Use jsdom's own
  // real, working native implementation instead, consistently, for both the app's
  // own reads/writes AND this test's setup — that's the only way this actually
  // exercises real localStorage persistence rather than a no-op stub.
  global.localStorage = win.localStorage;
  const FDBFactory = require('fake-indexeddb/lib/FDBFactory');
  win.indexedDB = new FDBFactory();
  global.indexedDB = win.indexedDB;
  const names = ['practex-data-core.js','practex-import-content.js','practex-render-library.js','practex-learning-practice.js','practex-events-init.js'];
  let loadFailed = false;
  names.forEach(n => {
    try { win.eval(fs.readFileSync(path.join(__dirname, n), 'utf8')); }
    catch (e) { console.error('LOAD ERROR in ' + n + ':', e.message); loadFailed = true; }
  });
  return { win, loadFailed, ls: win.localStorage };
}

async function runShim(win) {
  const shimSrc = fs.readFileSync(path.join(__dirname, 'practex-offline-shim.js'), 'utf8');
  win.eval(shimSrc);
  await new Promise(r => setTimeout(r, 50));
}

async function run() {

console.log('=== SCENARIO 1: mirror already has the freshest pausedSession (normal case — no reconciliation needed) ===');
{
  const { win, loadFailed } = setupWindow();
  assert('app loads cleanly', !loadFailed);
  await seedMirror(win, {
    key: 'current', version: 1, updatedAt: Date.now(), userId: 'user-1',
    mcqs: [makeMcq('a'), makeMcq('b')], sources: {}, streak: {count:0}, sleepingSubjects: {},
    fsrsModeEnabled: false, darkMode: false, fsrsCardExpanded: true, autoSleepEnabled: true,
    autoSleepStreak: 4, emptyFolders: [], studyPlans: {},
    pausedSession: { ids: ['a','b'], index: 1, results: [{}], pausedAt: 5000 }
  });
  await runShim(win);
  assert('pausedSession picked up from mirror', win.state.pausedSession && win.state.pausedSession.pausedAt === 5000);
  assert('"Resume test" card renders on the library view', win.renderBrowse().indexOf('Resume test') !== -1);
}

console.log('\n=== SCENARIO 2 (the reported bug): pause-and-leave synced to localStorage but the async mirror write raced a reload and lost ===');
{
  const { win, ls } = setupWindow();
  // Mirror is STALE — still shows the pre-pause state (no pausedSession at all),
  // simulating persistLocalMirror()'s async IndexedDB write not having landed yet.
  await seedMirror(win, {
    key: 'current', version: 1, updatedAt: Date.now(), userId: 'user-1',
    mcqs: [makeMcq('a'), makeMcq('b')], sources: {}, streak: {count:0}, sleepingSubjects: {},
    fsrsModeEnabled: false, darkMode: false, fsrsCardExpanded: true, autoSleepEnabled: true,
    autoSleepStreak: 4, emptyFolders: [], studyPlans: {},
    pausedSession: null
  });
  // But persistPausedSessionSync() DID complete (it's synchronous, localStorage) —
  // this is the actual durable copy "Pause & leave" guarantees.
  ls.setItem('practex_paused_session_sync_v1', JSON.stringify({
    userId: 'user-1',
    pausedSession: { ids: ['a','b'], index: 1, results: [{}], pausedAt: 9999 }
  }));
  await runShim(win);
  assert('the FRESHER localStorage copy wins over the stale mirror (this was the actual bug — it was silently lost before)', win.state.pausedSession && win.state.pausedSession.pausedAt === 9999, win.state.pausedSession);
  assert('"Resume test" card renders correctly now', win.renderBrowse().indexOf('Resume test') !== -1);
}

console.log('\n=== SCENARIO 3 (the reported bug): tab closed/reloaded mid-test with NO explicit pause — crash recovery ===');
{
  const { win, ls } = setupWindow();
  // Neither the mirror NOR the paused-session sync key has anything — the person
  // never clicked "Pause & leave" at all, they just closed the tab mid-question.
  await seedMirror(win, {
    key: 'current', version: 1, updatedAt: Date.now(), userId: 'user-1',
    mcqs: [makeMcq('a'), makeMcq('b'), makeMcq('c')], sources: {}, streak: {count:0}, sleepingSubjects: {},
    fsrsModeEnabled: false, darkMode: false, fsrsCardExpanded: true, autoSleepEnabled: true,
    autoSleepStreak: 4, emptyFolders: [], studyPlans: {},
    pausedSession: null
  });
  // The ONLY thing that captured anything is the continuous live-session writer,
  // which fires on every render + on visibilitychange/pagehide regardless of pause.
  ls.setItem('practex_live_session_sync_v1', JSON.stringify({
    userId: 'user-1',
    session: { ids: ['a','b','c'], index: 2, results: [{},{}], viewIndex: 2 },
    savedAt: 12345
  }));
  await runShim(win);
  assert('crash-recovery session adopted as the pausedSession', win.state.pausedSession && win.state.pausedSession.index === 2, JSON.stringify(win.state.pausedSession));
  assert('correctly flagged as recovered, not a deliberate pause', win.state.pausedSession && win.state.pausedSession.recoveredFromCrash === true);
  assert('pausedAt derived from the crash-recovery savedAt', win.state.pausedSession && win.state.pausedSession.pausedAt === 12345);
  var browseHtml = win.renderBrowse();
  assert('"Recovered session" wording shown, not "Paused test" (this distinction already existed, just never reachable in offline mode before)', browseHtml.indexOf('Recovered session') !== -1, browseHtml.slice(0,400));
  assert('live-session key cleared after being adopted (no re-offering it again next boot)', ls.getItem('practex_live_session_sync_v1') === null);
}

console.log('\n' + (failures === 0 ? '=== OFFLINE PAUSE/RESUME/CRASH-RECOVERY RECONCILIATION VERIFIED ===' : '=== ' + failures + ' FAILURE(S) — see above ==='));
process.exitCode = failures === 0 ? 0 : 1;
process.exit(process.exitCode);

}
run();
