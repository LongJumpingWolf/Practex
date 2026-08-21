const { JSDOM } = require('jsdom');
const fs = require('fs');

const dom = new JSDOM(`<!DOCTYPE html><html><body><div id="appRoot"></div><div id="toast"></div><div id="loadingScreen"></div><div id="authGate"></div><div id="syncStatusPill"></div></body></html>`,
  { runScripts: 'outside-only', url: 'https://example.com/' });
const { window } = dom;
global.window = window;
global.document = window.document;
global.crypto = { subtle: { digest: async () => new ArrayBuffer(32) } };
global.localStorage = { getItem(){return null;}, setItem(){}, removeItem(){} };
window.localStorage = global.localStorage;
global.fetch = async () => ({ ok: false, json: async () => ({}) });

// Was hardcoded to '/home/claude/extracted_script_testable.js' — a pre-file-split
// relic that predates the current 5-file MPA architecture and doesn't exist in this
// delivery at all. Concatenated the same way every other test in this suite does.
const path = require('path');
const FILES = ['practex-data-core.js','practex-import-content.js','practex-render-library.js','practex-learning-practice.js','practex-events-init.js'];
let src = FILES.map(n => fs.readFileSync(path.join(__dirname, n), 'utf8')).join('\n');
let loadFailed = false;
try {
  window.eval(src);
} catch (e) {
  console.error('LOAD ERROR:', e.message);
  loadFailed = true;
}

function balancedDivs(html) {
  const opens = (html.match(/<div\b/g) || []).length;
  const closes = (html.match(/<\/div>/g) || []).length;
  return { opens, closes, balanced: opens === closes };
}

let allPass = true;
function report(label, html) {
  const b = balancedDivs(html);
  const ok = b.balanced && html.length > 0;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + '  divs open=' + b.opens + ' close=' + b.closes + '  length=' + html.length);
  if (!ok) allPass = false;
  return html;
}

// Minimal session object each render function needs
function baseSession(overrides) {
  return Object.assign({ viewIndex: 0, index: 0, ids: ['q1'], selected: null, revealed: false }, overrides || {});
}

// Mirrors EXACTLY what confirmImportWithChoice() (the app's real import normalizer,
// index.html ~line 1797) sets on every imported question regardless of type — verified
// by reading that function directly, not guessed. A question that skips this (like my
// first test pass did) isn't representative of a real imported question, which is why
// that pass crashed on mcq.learning.history — not a bug in the new render code, a gap
// in the test's own setup.
function withRealImportDefaults(m) {
  m.learning = { due: Date.now(), interval: 0, history: [], lastReviewed: null, fsrs: null };
  if (!Array.isArray(m.tags)) m.tags = [];
  if (!Array.isArray(m.images)) m.images = [];
  if (!Array.isArray(m.answerImages)) m.answerImages = [];
  if (!Array.isArray(m.notes)) m.notes = [];
  if (typeof m.asleep !== 'boolean') m.asleep = false;
  // These next three are forced onto EVERY imported mcq today, including the new types
  // — dead weight for match/sequence/cutoff/mnemonic (which never read them) but not
  // harmful, since evaluateCorrect() branches on m.type before ever touching them.
  if (!Array.isArray(m.options)) m.options = [];
  if (!Array.isArray(m.answer) || !m.answer.length) m.answer = ['UNKNOWN'];
  if (typeof m.question !== 'string') m.question = '';
  return m;
}

console.log('--- MATCH ---');
const matchQ = withRealImportDefaults({ id:'q1', type:'match', stem:'Match the following', source:'Test', tags:['a','b'],
  pairs:[{left:'t(11:22)',right:'EWS-FLI1'},{left:'t(9:22)',right:'EWS-CHN'},{left:'t(X:18)',right:'SS18-SSX'}] });
report('unanswered', window.renderMatchBody(matchQ, baseSession(), false, null, false));
report('mid-pairing (one pending)', window.renderMatchBody(matchQ, baseSession({selected:{links:{0:0},rightOrder:[2,0,1],pendingLeft:1}}), false, null, false));
report('revealed, all correct', window.renderMatchBody(matchQ, baseSession({selected:{links:{0:0,1:1,2:2},rightOrder:[0,1,2]},revealed:true}), false, null, true));
report('revealed, some wrong', window.renderMatchBody(matchQ, baseSession({selected:{links:{0:1,1:0,2:2},rightOrder:[0,1,2]},revealed:true}), false, null, true));

console.log('\n--- SEQUENCE ---');
const seqQ = withRealImportDefaults({ id:'q2', type:'sequence', stem:'Order the stages', source:'Test', tags:[],
  steps_correct_order:['Stage A','Stage B','Stage C','Stage D'] });
report('unanswered (shuffled start)', window.renderSequenceBody(seqQ, baseSession({index:0}), false, null, false));
report('revealed correct', window.renderSequenceBody(seqQ, baseSession({selected:[0,1,2,3],revealed:true}), false, null, true));
report('revealed wrong', window.renderSequenceBody(seqQ, baseSession({selected:[1,0,2,3],revealed:true}), false, null, true));

console.log('\n--- CUTOFF ---');
const cutoffQ = withRealImportDefaults({ id:'q3', type:'cutoff', stem:'Mentzer Index', source:'Test', tags:[],
  range:[8,18,0.1], threshold:13, testValue:11.2, below:'Thal minor', above:'IDA' });
report('unanswered', window.renderCutoffBody(cutoffQ, baseSession(), false, null, false));
report('revealed', window.renderCutoffBody(cutoffQ, baseSession({selected:10,revealed:true}), false, null, true));

console.log('\n--- MNEMONIC ---');
const mnemQ = withRealImportDefaults({ id:'q4', type:'mnemonic', stem:'CAFFFI', source:'Test', tags:[],
  letters:[{letter:'C',meaning:'Chondroblastoma'},{letter:'A',meaning:'ABC/Osteosarcoma'}], testIndex:0 });
report('unanswered', window.renderMnemonicBody(mnemQ, baseSession(), false, null, false));
report('revealed, not yet self-graded', window.renderMnemonicBody(mnemQ, baseSession({selected:'my guess',revealed:true}), false, null, true));

console.log('\n' + (allPass ? '=== ALL RENDER TESTS PASSED (no throws, balanced markup) ===' : '=== SOME RENDER TESTS FAILED ==='));
process.exit((allPass && !loadFailed) ? 0 : 1);
