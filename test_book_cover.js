const { JSDOM } = require('jsdom');
const fs = require('fs');

const dom = new JSDOM(`<div id="appRoot"></div><div id="toast"></div><div id="modalRoot"></div><div id="loadingScreen"></div><div id="authGate"></div><div id="syncStatusPill"></div>`,
  { runScripts: 'outside-only', url: 'https://example.com/' });
const { window } = dom;
global.window = window;
global.document = window.document;
global.crypto = { subtle: { digest: async () => new ArrayBuffer(32) } };
global.fetch = async () => ({ ok: false, json: async () => ({}) });

const names = ['practex-data-core.js','practex-import-content.js','practex-render-library.js','practex-learning-practice.js','practex-events-init.js'];
const combined = names.map(n => fs.readFileSync(require("path").join(__dirname, n), 'utf8')).join('\n');
const expose = `
window.setBookCover = setBookCover;
window.attachBookCoverUrl = attachBookCoverUrl;
window.removeBookCover = removeBookCover;
window.attachBookCover = attachBookCover;
window.renderBookshelf = renderBookshelf;
`;
try {
  window.eval(combined + '\n' + expose);
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
  return {
    mcqs: [{ id:'q1', question:'Q', subject:'Pathology', chapterPath:['Ch'], source:'Practex Sample Content', tags:[], options:[], answer:['A'], explanation:'', images:[], answerImages:[], notes:[], learning:{history:[],due:Date.now(),interval:0,lastReviewed:null,fsrs:null} }],
    sources: { 'Practex Sample Content': { color: '#2F5C7A' } },
    view: 'bookshelf', bookshelfActiveSource: null, currentUser: { id: 'u1' },
    studyPlans: {}, sleepingSubjects: {}, // real app state always has these — this file's helper predates Study Plans and Book Shelf's plan widget, which renderBookshelf() now calls unconditionally
  };
}

console.log('=== setBookCover() shows a real modal offering both paths ===');
{
  window.state = freshState();
  window.setBookCover('Practex Sample Content');
  const modalHtml = document.getElementById('modalRoot').innerHTML;
  assert('modal shows a URL input for pasting a link', modalHtml.indexOf('bookCoverUrlInput') !== -1);
  assert('modal offers "Upload a file instead" as the alternative', modalHtml.indexOf('set-book-cover-upload') !== -1);
  assert('no "Remove cover" option shown when nothing is set yet', modalHtml.indexOf('remove-book-cover') === -1);
}

console.log('\n=== attachBookCoverUrl(): validation ===');
{
  window.state = freshState();
  window.saveSources = async function(){};
  window.render = function(){};
  window.attachBookCoverUrl('Practex Sample Content', 'not-a-real-url');
  assert('a non-URL string is rejected, not silently stored', !window.state.sources['Practex Sample Content'].coverImageUrl);
  /* attachBookCoverUrl() is now async and fetches-then-mirrors through ImgBB rather
     than storing the raw URL directly — that whole flow (success, CORS failure,
     non-image rejection) is covered properly in test_cover_link_imgbb.js. This file
     keeps just the synchronous validation check above, which is unchanged. */
}

console.log('\n=== Mutual exclusivity: a source has exactly ONE cover, whichever was set most recently ===');
{
  window.state = freshState();
  window.state.sources['Practex Sample Content'].coverImage = 'somehash123'; // pretend an uploaded-file cover already exists
  window.saveSources = async function(){};
  window.render = function(){};
  window.storeImageFromFile = async function(){ return 'newhash456'; }; // stub the ImgBB pipeline itself — this block is testing the one-cover-per-source invariant, not the pipeline (that's covered in test_cover_link_imgbb.js)
  return window.attachBookCover('Practex Sample Content', { type: 'image/jpeg' }).then(() => {
    assert('setting a new upload retires whatever cover was there before, one cover per source', window.state.sources['Practex Sample Content'].coverImage === 'newhash456');
    finish();
  });
}

function finish() {

console.log('\n=== removeBookCover(): clears both fields cleanly ===');
{
  window.state = freshState();
  window.state.sources['Practex Sample Content'].coverImageUrl = 'https://example.com/x.jpg';
  window.saveSources = async function(){};
  window.render = function(){};
  window.removeBookCover('Practex Sample Content');
  assert('coverImageUrl cleared', !window.state.sources['Practex Sample Content'].coverImageUrl);
  assert('coverImage also cleared (harmless no-op if it was never set)', !window.state.sources['Practex Sample Content'].coverImage);
}

console.log('\n=== setBookCover() modal DOES show "Remove current cover" once a cover exists ===');
{
  window.state = freshState();
  window.state.sources['Practex Sample Content'].coverImageUrl = 'https://example.com/x.jpg';
  window.setBookCover('Practex Sample Content');
  const modalHtml = document.getElementById('modalRoot').innerHTML;
  assert('remove option now present', modalHtml.indexOf('remove-book-cover') !== -1);
}

console.log('\n=== renderBookshelf(): render priority — link cover, hash cover, then plain color fallback ===');
{
  window.state = freshState();
  window.state.sources['Practex Sample Content'].coverImageUrl = 'https://example.com/link-cover.jpg';
  let html = window.renderBookshelf();
  assert('with a link cover set, renders a plain <img src> (no ImgBB hash lookup needed)', html.indexOf('src="https://example.com/link-cover.jpg"') !== -1);
  assert('does not ALSO try to render a data-hash-src for the same book', html.indexOf('data-hash-src') === -1);

  window.state = freshState();
  window.state.sources['Practex Sample Content'].coverImage = 'realhash456';
  html = window.renderBookshelf();
  assert('with only an uploaded-file cover, renders via data-hash-src (the ImgBB-cached path)', html.indexOf('data-hash-src="realhash456"') !== -1);

  window.state = freshState(); // no cover of either kind
  html = window.renderBookshelf();
  assert('with no cover at all, falls back to the plain color block with the book\'s name', html.indexOf('book-cover-title') !== -1 && html.indexOf('Practex Sample Content') !== -1);

  const opens = (html.match(/<div\b/g)||[]).length, closes = (html.match(/<\/div>/g)||[]).length;
  assert('balanced markup throughout', opens === closes, `divs ${opens}/${closes}`);
}

console.log('\n' + (failures === 0
  ? '=== COVER IMAGE (LINK + IMGBB) FEATURE VERIFIED ==='
  : '=== ' + failures + ' FAILURE(S) — see above ==='));
process.exit(failures === 0 && process.exitCode !== 1 ? 0 : 1);
}
