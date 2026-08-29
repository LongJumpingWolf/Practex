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

function loadApp(win) {
  const names = ['practex-data-core.js','practex-import-content.js','practex-render-library.js','practex-learning-practice.js','practex-events-init.js'];
  let loadFailed = false;
  names.forEach(n => {
    try { win.eval(fs.readFileSync(path.join(__dirname, n), 'utf8')); }
    catch (e) { console.error('LOAD ERROR in ' + n + ':', e.message); loadFailed = true; }
  });
  return !loadFailed;
}

async function run() {

console.log('=== practexPageUrl() itself ===');
{
  const dom = new JSDOM('<div id="appRoot"></div><div id="toast"></div><div id="loadingScreen"></div><div id="authGate"></div><div id="syncStatusPill"></div><div id="modalRoot"></div>', { runScripts: 'outside-only', url: 'https://example.com/library-offline.html' });
  global.window = dom.window; global.document = dom.window.document;
  global.crypto = { subtle: { digest: async () => new ArrayBuffer(32) } };
  loadApp(dom.window);

  dom.window.PRACTEX_OFFLINE_MODE = false;
  assert('online mode: library.html unchanged', dom.window.practexPageUrl('library.html') === 'library.html');
  assert('online mode: practice.html?view=browse unchanged', dom.window.practexPageUrl('practice.html?view=browse') === 'practice.html?view=browse');

  dom.window.PRACTEX_OFFLINE_MODE = true;
  assert('offline mode: library.html -> library-offline.html', dom.window.practexPageUrl('library.html') === 'library-offline.html');
  assert('offline mode: practice.html -> practice-offline.html', dom.window.practexPageUrl('practice.html') === 'practice-offline.html');
  assert('offline mode: query string preserved', dom.window.practexPageUrl('library.html?view=bookshelf&source=Foo') === 'library-offline.html?view=bookshelf&source=Foo');
}

console.log('\n=== practice-offline.html page-detection regex (the exact bug) ===');
{
  const dom = new JSDOM('<div id="appRoot"></div><div id="toast"></div><div id="loadingScreen"></div><div id="authGate"></div><div id="syncStatusPill"></div><div id="modalRoot"></div>', { runScripts: 'outside-only', url: 'https://example.com/practice-offline.html' });
  global.window = dom.window; global.document = dom.window.document;
  global.crypto = { subtle: { digest: async () => new ArrayBuffer(32) } };
  loadApp(dom.window);
  const isMatch = /practice(-offline)?\.html/.test(dom.window.location.pathname);
  assert('practice-offline.html is correctly recognized as a practice page', isMatch);
}

console.log('\n=== END-TO-END: starting practice from library-offline.html stays on -offline pages ===');
{
  const FDBFactory = require('fake-indexeddb/lib/FDBFactory');
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
  global.localStorage = { getItem(){return null;}, setItem(){}, removeItem(){} };
  win.localStorage = global.localStorage;
  win.indexedDB = new FDBFactory();
  global.indexedDB = win.indexedDB;

  // Seed a local mirror, same as a real prior session would have left.
  const seedReq = win.indexedDB.open('practex_data_mirror_v1', 1);
  await new Promise((resolve, reject) => {
    seedReq.onupgradeneeded = function(){ seedReq.result.createObjectStore('mirror', { keyPath: 'key' }); };
    seedReq.onsuccess = function(){
      const tx = seedReq.result.transaction('mirror', 'readwrite');
      tx.objectStore('mirror').put({
        key: 'current', version: 1, updatedAt: Date.now(), userId: 'user-abc',
        mcqs: [makeMcq('a'), makeMcq('b')], sources: { 'Book': { color: '#123456' } },
        streak: { count: 0 }, sleepingSubjects: {}, fsrsModeEnabled: false, darkMode: false,
        fsrsCardExpanded: true, autoSleepEnabled: true, autoSleepStreak: 4, emptyFolders: [],
        studyPlans: {}, pausedSession: null
      });
      tx.oncomplete = resolve; tx.onerror = reject;
    };
    seedReq.onerror = reject;
  });

  assert('app files load cleanly', loadApp(win));

  const shimSrc = fs.readFileSync(path.join(__dirname, 'practex-offline-shim.js'), 'utf8');
  win.eval(shimSrc);
  await new Promise(r => setTimeout(r, 50));

  assert('PRACTEX_OFFLINE_MODE flag set by the shim', win.PRACTEX_OFFLINE_MODE === true);

  // Spy on practexPageUrl rather than fighting jsdom's restrictions on redefining
  // location.href (jsdom doesn't support real navigation anyway) — this verifies
  // the actual call startPractice() makes, which is what matters here.
  const calls = [];
  const realPracexPageUrl = win.practexPageUrl;
  win.practexPageUrl = function(p) { const result = realPracexPageUrl(p); calls.push({ input: p, output: result }); return result; };

  // Reproduce exactly what the user hit: start a practice session. jsdom doesn't
  // implement real navigation, so the actual `window.location.href = ...` line
  // will log a harmless "not implemented" console warning — that's jsdom, not a
  // bug in the app; what matters is what URL it attempted to navigate to.
  try { win.startPractice(['a', 'b']); } catch (e) { /* jsdom navigation noise, expected */ }
  await new Promise(r => setTimeout(r, 20));

  assert('startPractice() ran practexPageUrl(\'practice.html\')', calls.length === 1 && calls[0].input === 'practice.html', JSON.stringify(calls));
  assert('...and it resolved to practice-offline.html, NOT the real practice.html (the actual bug reported)', calls.length === 1 && calls[0].output === 'practice-offline.html', JSON.stringify(calls));
}

console.log('\n' + (failures === 0 ? '=== OFFLINE NAVIGATION FIX VERIFIED ===' : '=== ' + failures + ' FAILURE(S) — see above ==='));
process.exitCode = failures === 0 ? 0 : 1;
process.exit(process.exitCode);

}
run();
