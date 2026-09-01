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

console.log('\n=== SCENARIO 2: no local mirror on this device (wrong device / never used before) ===');
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
  win.indexedDB = new FDBFactory(); // fresh, empty — nothing seeded
  global.indexedDB = win.indexedDB;

  const names = ['practex-data-core.js','practex-import-content.js','practex-render-library.js','practex-learning-practice.js','practex-events-init.js'];
  names.forEach(n => { try { win.eval(fs.readFileSync(path.join(__dirname, n), 'utf8')); } catch (e) {} });

  const shimSrc = fs.readFileSync(path.join(__dirname, 'practex-offline-shim.js'), 'utf8');
  win.eval(shimSrc);
  await new Promise(r => setTimeout(r, 50));

  assert('no crash with an empty/missing mirror', true); // if we got here without throwing, this already passed
  const gateHtml = win.document.getElementById('authGate').innerHTML;
  assert('auth gate shown with a clear explanation, not silently blank', win.document.getElementById('authGate').style.display === 'flex' && gateHtml.indexOf('No offline copy found') !== -1);
  assert('app root stays hidden', win.document.getElementById('appRoot').style.display !== 'grid');
  assert('does NOT use the old near-invisible light-on-light text color (the actual bug reported)', gateHtml.indexOf('#EAF0F5') === -1, gateHtml.slice(0,150));
  assert('uses the real .auth-card styling instead of ad-hoc colors', gateHtml.indexOf('auth-card') !== -1);
  assert('gives an actual way forward — links to the backup-import tool, not a dead end', gateHtml.indexOf('import-offline-backup.html') !== -1);
}

console.log('\n' + (failures === 0 ? '=== OFFLINE SHIM VERIFIED ===' : '=== ' + failures + ' FAILURE(S) — see above ==='));
process.exitCode = failures === 0 ? 0 : 1;
process.exit(process.exitCode);

}

run();
