const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

process.on('unhandledRejection', (reason) => { console.error('FATAL: unhandled rejection —', reason && reason.stack ? reason.stack : reason); process.exitCode = 1; process.exit(1); });

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

async function run() {

console.log('=== SCENARIO 1: a real local mirror exists on this device ===');
{
  const FDBFactory = require('fake-indexeddb/lib/FDBFactory');
  const dom = new JSDOM(`
    <div id="loadingScreen" style="display:flex;"></div>
    <div id="authGate" style="display:none;"></div>
    <div id="appRoot" style="display:none;"></div>
    <div id="toast"></div><div id="modalRoot"></div><div id="syncStatusPill"></div>
  `, { runScripts: 'outside-only', url: 'https://example.com/library.html' });
  const win = dom.window;
  global.window = win;
  global.document = win.document;
  global.navigator = win.navigator;
  global.crypto = { subtle: { digest: async () => new ArrayBuffer(32) } };
  global.fetch = async () => ({ ok: false, json: async () => ({}) });
  global.localStorage = { getItem(){return null;}, setItem(){}, removeItem(){} };
  win.localStorage = global.localStorage;
  win.indexedDB = new FDBFactory();
  global.indexedDB = win.indexedDB;

  // Seed the local mirror exactly like persistLocalMirror() would have, from
  // earlier ordinary use of the real app on this device.
  const seedReq = win.indexedDB.open('practex_data_mirror_v1', 1);
  await new Promise((resolve, reject) => {
    seedReq.onupgradeneeded = function(){ seedReq.result.createObjectStore('mirror', { keyPath: 'key' }); };
    seedReq.onsuccess = function(){
      const db = seedReq.result;
      const tx = db.transaction('mirror', 'readwrite');
      tx.objectStore('mirror').put({
        key: 'current', version: 1, updatedAt: Date.now(), userId: 'user-abc-123',
        mcqs: [makeMcq('a'), makeMcq('b'), makeMcq('c')],
        sources: { 'Book': { color: '#123456' } },
        streak: { count: 3, lastDate: '2026-08-01' }, sleepingSubjects: {},
        fsrsModeEnabled: false, darkMode: false, fsrsCardExpanded: true,
        autoSleepEnabled: true, autoSleepStreak: 4, emptyFolders: [], studyPlans: {},
        pausedSession: null
      });
      tx.oncomplete = resolve;
      tx.onerror = reject;
    };
    seedReq.onerror = reject;
  });

  const names = ['practex-data-core.js','practex-import-content.js','practex-render-library.js','practex-learning-practice.js','practex-events-init.js'];
  let loadFailed = false;
  names.forEach(n => {
    try { win.eval(fs.readFileSync(path.join(__dirname, n), 'utf8')); }
    catch (e) { console.error('LOAD ERROR in ' + n + ':', e.message); loadFailed = true; }
  });
  assert('real app files load cleanly', !loadFailed);

  // At this point init() has already run synchronously and (since there's no
  // real Supabase reachable in this test either) shown the auth gate — exactly
  // the state a real restricted account would be in. Now run the shim.
  const shimSrc = fs.readFileSync(path.join(__dirname, 'practex-offline-shim.js'), 'utf8');
  win.eval(shimSrc);
  await new Promise(r => setTimeout(r, 50)); // let the shim's async IIFE finish

  assert('supabaseClient is nulled out', win.supabaseClient === null);
  assert('state.currentUser synthesized with the mirror\'s real userId', win.state.currentUser && win.state.currentUser.id === 'user-abc-123');
  assert('mcqs hydrated from the mirror (3 questions)', win.state.mcqs.length === 3);
  assert('sources hydrated too', win.state.sources && win.state.sources['Book'] && win.state.sources['Book'].color === '#123456');
  assert('streak hydrated too', win.state.streak.count === 3);
  assert('auth gate hidden', win.document.getElementById('authGate').style.display === 'none');
  assert('app root shown', win.document.getElementById('appRoot').style.display === 'grid');
  assert('loading screen hidden', win.document.getElementById('loadingScreen').style.display === 'none');
  assert('appRoot actually has rendered content (a real render() happened)', win.document.getElementById('appRoot').innerHTML.length > 100);
  assert('sync status pill force-hidden via injected style', win.document.head.innerHTML.indexOf('#syncStatusPill{display:none') !== -1);
}

console.log('\n=== SCENARIO 2: no local mirror on this device (wrong device / never used before) — should just be an EMPTY normal app, not a dead end ===');
{
  const FDBFactory = require('fake-indexeddb/lib/FDBFactory');
  const dom = new JSDOM(`
    <div id="loadingScreen" style="display:flex;"></div>
    <div id="authGate" style="display:none;"></div>
    <div id="appRoot" style="display:none;"></div>
    <div id="toast"></div><div id="modalRoot"></div><div id="syncStatusPill"></div>
  `, { runScripts: 'outside-only', url: 'https://example.com/library.html' });
  const win = dom.window;
  global.window = win;
  global.document = win.document;
  global.navigator = win.navigator;
  global.crypto = { subtle: { digest: async () => new ArrayBuffer(32) } };
  global.fetch = async () => ({ ok: false, json: async () => ({}) });
  global.localStorage = win.localStorage; // jsdom's own real implementation — see test_offline_pause_reconciliation.js for why assigning a mock object here doesn't actually work
  win.indexedDB = new FDBFactory(); // fresh, empty — nothing seeded, exactly a never-used device
  global.indexedDB = win.indexedDB;

  const names = ['practex-data-core.js','practex-import-content.js','practex-render-library.js','practex-learning-practice.js','practex-events-init.js'];
  let loadFailed = false;
  names.forEach(n => { try { win.eval(fs.readFileSync(path.join(__dirname, n), 'utf8')); } catch (e) { console.error('LOAD ERROR in ' + n + ':', e.message); loadFailed = true; } });
  assert('app files load cleanly', !loadFailed);

  const shimSrc = fs.readFileSync(path.join(__dirname, 'practex-offline-shim.js'), 'utf8');
  win.eval(shimSrc);
  await new Promise(r => setTimeout(r, 50));

  assert('no crash with a completely empty device', true); // if we got here without throwing, this already passed
  assert('auth gate hidden — no blocking screen at all', win.document.getElementById('authGate').style.display === 'none' || win.document.getElementById('authGate').style.display === '');
  assert('app root shown normally, same as any real boot', win.document.getElementById('appRoot').style.display === 'grid');
  assert('a local identity was generated so this device has somewhere consistent to save to', win.state.currentUser && win.state.currentUser.id && win.state.currentUser.id.indexOf('offline-local-') === 0, win.state.currentUser);
  assert('library starts genuinely empty, not fake/placeholder data', Array.isArray(win.state.mcqs) && win.state.mcqs.length === 0);
  const appHtml = win.document.getElementById('appRoot').innerHTML;
  assert('the real "nothing logged yet, go to Add source" empty state renders — same as a normal fresh account would show', appHtml.indexOf('Nothing logged yet') !== -1, appHtml.length);
  assert('offline mode ALSO surfaces the backup-import option right there in that same message, not hidden behind a separate dead-end screen', appHtml.indexOf('import-offline-backup.html') !== -1);

  // The generated identity should be durable — a second boot on the same
  // (still-empty) device should reuse it, not silently regenerate a new one
  // and orphan whatever gets added under the first one.
  var db2 = await win.openDataMirrorDb();
  var tx2 = db2.transaction(win.DATA_MIRROR_STORE_NAME, 'readonly');
  var persisted = await win.requestToPromise(tx2.objectStore(win.DATA_MIRROR_STORE_NAME).get('current'));
  assert('the generated empty identity was actually persisted locally, not just held in memory', persisted && persisted.userId === win.state.currentUser.id, persisted);
}

console.log('\n=== SCENARIO 3: the SAME empty-device generated identity is reused on a second boot, not regenerated ===');
{
  const FDBFactory = require('fake-indexeddb/lib/FDBFactory');
  const dom = new JSDOM(`
    <div id="loadingScreen" style="display:flex;"></div>
    <div id="authGate" style="display:none;"></div>
    <div id="appRoot" style="display:none;"></div>
    <div id="toast"></div><div id="modalRoot"></div><div id="syncStatusPill"></div>
  `, { runScripts: 'outside-only', url: 'https://example.com/library.html' });
  const win = dom.window;
  global.window = win; global.document = win.document; global.navigator = win.navigator;
  global.crypto = { subtle: { digest: async () => new ArrayBuffer(32) } };
  global.fetch = async () => ({ ok: false, json: async () => ({}) });
  global.localStorage = win.localStorage;
  win.indexedDB = new FDBFactory();
  global.indexedDB = win.indexedDB;
  const names = ['practex-data-core.js','practex-import-content.js','practex-render-library.js','practex-learning-practice.js','practex-events-init.js'];
  names.forEach(n => win.eval(fs.readFileSync(path.join(__dirname, n), 'utf8')));

  const shimSrc = fs.readFileSync(path.join(__dirname, 'practex-offline-shim.js'), 'utf8');
  win.eval(shimSrc);
  await new Promise(r => setTimeout(r, 50));
  const firstId = win.state.currentUser.id;

  // Simulate "Add source" having actually added a question in between boots.
  win.state.mcqs.push({ id: 'x1', question: 'test', subject: 'S', chapterPath: ['C'], source: 'Book', tags: [], options: [], answer: [], explanation: '', images: [], answerImages: [], notes: [], flagged: false, learning: { history: [], due: Date.now() } });
  await win.saveLibrary();

  win.eval(shimSrc); // second boot, same device
  await new Promise(r => setTimeout(r, 50));

  assert('the same identity is reused on a second boot', win.state.currentUser.id === firstId, { first: firstId, second: win.state.currentUser.id });
  assert('the question added between boots is still there — the second boot did not wipe it', win.state.mcqs.length === 1 && win.state.mcqs[0].id === 'x1', win.state.mcqs);
}

console.log('\n' + (failures === 0 ? '=== OFFLINE SHIM VERIFIED ===' : '=== ' + failures + ' FAILURE(S) — see above ==='));
process.exitCode = failures === 0 ? 0 : 1;
process.exit(process.exitCode);

}

run();
