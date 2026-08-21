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

// window.confirm doesn't exist in jsdom by default (prints "Not implemented"
// noise and returns undefined) — stub it so that if any of the 6 sites still
// calls it, that shows up as a hard, visible failure rather than silently
// falling through as falsy.
let confirmCalled = false;
window.confirm = function(){ confirmCalled = true; return false; };

let failures = 0;
function assert(label, cond, extra) {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + label + (extra ? '  ' + extra : ''));
  if (!cond) failures++;
}

function makeMcq(id, overrides) {
  return Object.assign({
    id: id, question: 'Q ' + id, subject: 'Pathology', chapterPath: ['Ch1'],
    source: 'Book', tags: [], options: [], answer: ['A'], explanation: '',
    images: [], answerImages: [], notes: [], flagged: false, asleep: false,
    learning: { history: [], due: Date.now(), interval: 0, lastReviewed: null, fsrs: null },
  }, overrides || {});
}

function click(el) {
  const evt = new window.MouseEvent('click', { bubbles: true, cancelable: true });
  el.dispatchEvent(evt);
}

async function run() {

console.log('=== Source code: no native confirm() calls remain anywhere in the app ===');
{
  const combined = names.map(n => fs.readFileSync(path.join(__dirname, n), 'utf8')).join('\n');
  assert('zero "if (!confirm(" / "if (confirm(" occurrences left in the shipped app', !/if \(!?confirm\(/.test(combined));
}

console.log('\n=== empty-trash: click-through now uses the app\'s own modal, not window.confirm ===');
{
  window.state = {
    mcqs: [makeMcq('a', { trashedAt: Date.now() }), makeMcq('b', { trashedAt: Date.now() })],
    sources: {}, currentUser: { id: 'u1' }, hasUnsyncedChanges: false,
  };
  window.deleteMcqRows = async function(){};
  window.purgeOrphanedImageHashes = async function(){};
  window.render = function(){};
  window.showToast = function(){};
  confirmCalled = false;

  const trigger = document.createElement('button');
  trigger.setAttribute('data-action', 'empty-trash');
  document.body.appendChild(trigger);
  click(trigger);
  await new Promise(r => setTimeout(r, 0));

  assert('window.confirm was never called', !confirmCalled);
  const modalHtml = document.getElementById('modalRoot').innerHTML;
  assert('the app\'s own modal rendered instead, with a danger-styled confirm button', modalHtml.indexOf('confirm-empty-trash') !== -1 && modalHtml.indexOf('btn-danger') !== -1, modalHtml.slice(0, 120));
  assert('trash is untouched until the modal is actually confirmed', window.trashedMcqs().length === 2);

  const confirmBtn = document.querySelector('[data-action="confirm-empty-trash"]');
  assert('confirm button is present and clickable', !!confirmBtn);
  click(confirmBtn);
  await new Promise(r => setTimeout(r, 0));
  assert('clicking the modal\'s own confirm button actually empties the trash', window.trashedMcqs().length === 0);
  assert('modal closes after confirming', document.getElementById('modalRoot').innerHTML === '');
}

console.log('\n=== clear-all: same click-through, plus the syncInFlight guard still fires on the confirmed path ===');
{
  window.state = {
    mcqs: [makeMcq('a'), makeMcq('b')], sources: { 'Book': { color: '#123' } },
    currentUser: { id: 'u1' }, hasUnsyncedChanges: false, selectedPath: ['Book'],
  };
  window.deleteMcqRows = async function(){};
  window.saveSources = async function(){};
  window.render = function(){};
  window.showToast = function(){};
  confirmCalled = false;

  const trigger = document.createElement('button');
  trigger.setAttribute('data-action', 'clear-all');
  document.body.appendChild(trigger);
  click(trigger);
  await new Promise(r => setTimeout(r, 0));

  assert('window.confirm was never called', !confirmCalled);
  assert('library untouched until confirmed', window.state.mcqs.length === 2);

  const confirmBtn = document.querySelector('[data-action="confirm-clear-all"]');
  assert('confirm button present', !!confirmBtn);
  click(confirmBtn);
  await new Promise(r => setTimeout(r, 0));
  assert('confirming actually clears the library', window.state.mcqs.length === 0 && Object.keys(window.state.sources).length === 0);
}

console.log('\n' + ((failures === 0 && !loadFailed) ? '=== ALL CONFIRM-MODAL FIXES VERIFIED ===' : '=== ' + failures + ' FAILURE(S) — see above ==='));
process.exitCode = (failures === 0 && !loadFailed) ? 0 : 1;
process.exit(process.exitCode);

}

run();
