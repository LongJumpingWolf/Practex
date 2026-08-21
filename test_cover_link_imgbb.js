const { JSDOM } = require('jsdom');
const fs = require('fs');

const dom = new JSDOM(`<div id="appRoot"></div><div id="toast"></div><div id="modalRoot"></div><div id="loadingScreen"></div><div id="authGate"></div><div id="syncStatusPill"></div>`,
  { runScripts: 'outside-only', url: 'https://example.com/' });
const { window } = dom;
global.window = window;
global.document = window.document;
global.crypto = { subtle: { digest: async () => new ArrayBuffer(32) } };

const names = ['practex-data-core.js','practex-import-content.js','practex-render-library.js','practex-learning-practice.js','practex-events-init.js'];
const combined = names.map(n => fs.readFileSync(require("path").join(__dirname, n), 'utf8')).join('\n');
try {
  window.eval(combined);
} catch (e) {
  console.error('LOAD ERROR:', e.message);
  process.exitCode = 1;
}

let failures = 0;
function assert(label, cond, extra) {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + label + (extra ? '  ' + extra : ''));
  if (!cond) failures++;
}

function freshState() {
  return { sources: { 'Practex Sample Content': { color: '#2F5C7A' } }, currentUser: { id: 'u1' }, mcqs: [] };
}

console.log('=== THE FIX: a pasted link now gets fetched and mirrored through the real ImgBB pipeline ===');
{
  window.state = freshState();
  let storeImageFromFileCalledWith = null;
  window.storeImageFromFile = async function(blob){ storeImageFromFileCalledWith = blob; return 'realhash123'; }; // the actual ImgBB pipeline — stubbed to confirm it's genuinely called, not bypassed
  window.fetch = async function(url){
    assert('fetch is actually called with the pasted URL', url === 'https://example.com/cover.jpg');
    return { ok: true, blob: async () => ({ type: 'image/jpeg', size: 1234 }) };
  };
  window.render = function(){}; window.saveSources = async function(){};

  return window.attachBookCoverUrl('Practex Sample Content', 'https://example.com/cover.jpg').then(() => {
    assert('storeImageFromFile (the real ImgBB pipeline) was genuinely called, not skipped', storeImageFromFileCalledWith !== null);
    assert('the source now stores coverImage (the hash-based, ImgBB-mirrored field) — same as a file upload would', window.state.sources['Practex Sample Content'].coverImage === 'realhash123');
    assert('coverImageUrl (the old raw-link field) is NOT set — nothing depends on the original link anymore', !window.state.sources['Practex Sample Content'].coverImageUrl);
    part2();
  });
}

function part2() {
console.log('\n=== Graceful failure: a CORS-blocked or unreachable source fails loudly, does not silently fall back to the raw link ===');
{
  window.state = freshState();
  let toastMsg = null;
  window.showToast = function(m){ toastMsg = m; };
  window.fetch = async function(){ throw new TypeError('Failed to fetch'); }; // exactly what a CORS block looks like from fetch()'s perspective
  window.render = function(){}; window.saveSources = async function(){};

  window.attachBookCoverUrl('Practex Sample Content', 'https://blocked-host.example/cover.jpg').then(() => {
    assert('a fetch failure does NOT silently store the raw link as a fallback', !window.state.sources['Practex Sample Content'].coverImageUrl && !window.state.sources['Practex Sample Content'].coverImage);
    /* This error is shown inline in the modal, not as a toast — see the comment on
       attachBookCoverUrl's catch block: "a toast is too easy to lose in a screen
       full of the browser's own CORS console noise". toastMsg only ever holds the
       earlier in-progress "Fetching and hosting…" message on this path, by design. */
    var modalHtml = document.getElementById('modalRoot').innerHTML;
    assert('a clear, honest error message is shown in the modal, suggesting the file-upload alternative', modalHtml.indexOf('blocking') !== -1 && modalHtml.indexOf('Upload a file') !== -1, modalHtml);
    part3();
  });
}
}

function part3() {
console.log('\n=== Rejects a non-image response (e.g. a webpage URL pasted by mistake) rather than mirroring garbage ===');
{
  window.state = freshState();
  let toastMsg = null;
  window.showToast = function(m){ toastMsg = m; };
  window.fetch = async function(){ return { ok: true, blob: async () => ({ type: 'text/html', size: 500 }) }; };
  window.render = function(){}; window.saveSources = async function(){};

  window.attachBookCoverUrl('Practex Sample Content', 'https://example.com/not-an-image.html').then(() => {
    assert('a non-image response is rejected, not stored as a cover', !window.state.sources['Practex Sample Content'].coverImage);
    part4();
  });
}
}

function part4() {
console.log('\n=== REGRESSION: URL validation still runs before any fetch attempt ===');
{
  window.state = freshState();
  let fetchCalled = false;
  window.fetch = async function(){ fetchCalled = true; return { ok: false }; };
  let toastMsg = null;
  window.showToast = function(m){ toastMsg = m; };

  window.attachBookCoverUrl('Practex Sample Content', 'not-a-real-url').then(() => {
    assert('garbage input is rejected before ever attempting a fetch', !fetchCalled);
    assert('clear validation message shown', toastMsg && toastMsg.indexOf('real link') !== -1);

    console.log('\n' + (failures === 0
      ? '=== COVER LINKS NOW GENUINELY GO THROUGH IMGBB — FIXED AS REQUESTED ==='
      : '=== ' + failures + ' FAILURE(S) — see above ==='));
    process.exit(failures === 0 && process.exitCode !== 1 ? 0 : 1);
  });
}
}
