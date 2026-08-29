const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

process.on('unhandledRejection', (reason) => { console.error('FATAL:', reason && reason.stack ? reason.stack : reason); process.exit(1); });

let failures = 0;
function assert(label, cond, extra) {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + label + (extra ? '  ' + extra : ''));
  if (!cond) failures++;
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

function click(win, el) {
  const evt = new win.MouseEvent('click', { bubbles: true, cancelable: true });
  el.dispatchEvent(evt);
}

async function run() {

const dom = new JSDOM('<div id="appRoot"></div><div id="toast"></div><div id="loadingScreen"></div><div id="authGate"></div><div id="syncStatusPill"></div><div id="modalRoot"></div>', { runScripts: 'outside-only', url: 'https://example.com/practice.html' });
const win = dom.window;
global.window = win; global.document = win.document;
global.crypto = { subtle: { digest: async () => new ArrayBuffer(32) } };
assert('app files load cleanly', loadApp(win));

// A live, mid-session state — exactly the situation the bug report describes.
function freshMidSession() {
  win.state = {
    view: 'practice', sidebarOpen: false, mcqs: [], sources: {},
    session: { ids: ['a','b'], index: 0, viewIndex: 0, originContext: null },
    pendingNav: null, activeModal: null,
  };
}

const cases = [
  { label: 'Book Shelf tab (the exact bug reported)', action: 'toggle-bookshelf', attrs: {} },
  { label: '"Library (all subjects)" link', action: 'clear-selection', attrs: {} },
  { label: 'Due-today queue preview', action: 'start-queue-preview', attrs: {} },
  { label: 'Sidebar subject shortcut', action: 'jump-subject', attrs: { 'data-subject': 'Pathology' } },
  { label: 'Chapter tree "view questions"', action: 'view-node-questions', attrs: { 'data-path': 'Pathology␟Ch1' } },
];

cases.forEach(function(c) {
  freshMidSession();
  const btn = win.document.createElement('button');
  btn.setAttribute('data-action', c.action);
  Object.keys(c.attrs).forEach(function(k){ btn.setAttribute(k, c.attrs[k]); });
  win.document.body.appendChild(btn);
  click(win, btn);

  assert(c.label + ': view did NOT silently change (session still intact)', win.state.view === 'practice' && !!win.state.session);
  assert(c.label + ': the leave/pause modal actually opened', win.document.getElementById('modalRoot').innerHTML.indexOf('Leave this test') !== -1 || win.document.getElementById('modalRoot').innerHTML.indexOf('Pause') !== -1, win.document.getElementById('modalRoot').innerHTML.slice(0,80));
  win.document.body.removeChild(btn);
});

console.log('\n=== Not mid-session: these same actions should NOT be blocked ===');
{
  win.state = { view: 'browse', sidebarOpen: false, mcqs: [], sources: {}, session: null, pendingNav: null, activeModal: null };
  const btn = win.document.createElement('button');
  btn.setAttribute('data-action', 'toggle-bookshelf');
  win.document.body.appendChild(btn);
  click(win, btn);
  assert('toggle-bookshelf works normally with no active session', win.state.view === 'bookshelf');
}

console.log('\n' + (failures === 0 ? '=== NAVIGATION GUARD FIX VERIFIED ===' : '=== ' + failures + ' FAILURE(S) — see above ==='));
process.exitCode = failures === 0 ? 0 : 1;
process.exit(process.exitCode);

}
run();
