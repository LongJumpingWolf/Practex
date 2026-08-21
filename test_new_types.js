const { JSDOM } = require('jsdom');
const fs = require('fs');

const dom = new JSDOM(`<!DOCTYPE html><html><body>
  <div id="appRoot"></div>
</body></html>`, { runScripts: 'outside-only', url: 'https://example.com/' });

const { window } = dom;
global.window = window;
global.document = window.document;
global.crypto = { subtle: { digest: async () => new ArrayBuffer(32) } };
global.localStorage = { getItem(){return null;}, setItem(){}, removeItem(){} };
window.localStorage = global.localStorage;
global.fetch = async () => ({ ok: false, json: async () => ({}) });
global.indexedDB = undefined; // image DB paths aren't exercised by this test

let src = fs.readFileSync('/home/claude/extracted_script_testable.js', 'utf8');
// The real app boots itself on real DOM elements (loadingScreen etc.) that don't exist
// in this minimal harness — strip the auto-boot IIFE calls at the bottom is overkill;
// instead just eval it and swallow boot-time errors, since we only need the function
// DEFINITIONS (evaluateCorrect, pickedStrFor, render bodies), not a working live app.
try {
  window.eval(src);
} catch (e) {
  console.log('(boot-time error suppressed, expected — harness has no real UI chrome):', e.message);
}

const fns = ['evaluateCorrect', 'pickedStrFor', 'renderMatchBody', 'renderSequenceBody',
             'renderCutoffBody', 'renderMnemonicBody', 'shuffledIndices', 'qMetaAndStemHtml'];
let allDefined = true;
fns.forEach(name => {
  const ok = typeof window[name] === 'function';
  console.log((ok ? 'OK  ' : 'FAIL') + ' ' + name + ' is a function: ' + ok);
  if (!ok) allDefined = false;
});
if (!allDefined) { console.log('\nSome functions never attached to window — cannot continue.'); process.exit(1); }

console.log('\n--- evaluateCorrect() logic tests ---');

function check(label, actual, expected) {
  const pass = actual === expected;
  console.log((pass ? 'PASS' : 'FAIL') + '  ' + label + '  got=' + JSON.stringify(actual) + ' expected=' + JSON.stringify(expected));
  return pass;
}

let allPass = true;

// MATCH
const matchQ = { type: 'match', pairs: [{left:'A',right:'1'},{left:'B',right:'2'},{left:'C',right:'3'}] };
allPass &= check('match: all correct pairs', window.evaluateCorrect(matchQ, { links: {0:0,1:1,2:2} }), true);
allPass &= check('match: one wrong pair', window.evaluateCorrect(matchQ, { links: {0:0,1:2,2:1} }), false);
allPass &= check('match: incomplete pairing', window.evaluateCorrect(matchQ, { links: {0:0,1:1} }), false);

// SEQUENCE
const seqQ = { type: 'sequence', steps_correct_order: ['first','second','third','fourth'] };
allPass &= check('sequence: correct order', window.evaluateCorrect(seqQ, [0,1,2,3]), true);
allPass &= check('sequence: shuffled order', window.evaluateCorrect(seqQ, [1,0,2,3]), false);
allPass &= check('sequence: wrong length', window.evaluateCorrect(seqQ, [0,1,2]), false);

// CUTOFF
const cutoffQ = { type: 'cutoff', range:[8,18,0.1], threshold: 13, testValue: 11.2, below:'thal minor', above:'IDA' };
allPass &= check('cutoff: user correctly picks below-side (testValue=11.2 is below 13)', window.evaluateCorrect(cutoffQ, 10), true);
allPass &= check('cutoff: user incorrectly picks above-side', window.evaluateCorrect(cutoffQ, 15), false);
const cutoffQ2 = { type: 'cutoff', range:[8,18,0.1], threshold: 13, testValue: 15.5, below:'thal minor', above:'IDA' };
allPass &= check('cutoff: user correctly picks above-side (testValue=15.5 is above 13)', window.evaluateCorrect(cutoffQ2, 16), true);
const cutoffMalformed = { type: 'cutoff', range:[8,18,0.1], threshold: 13, below:'x', above:'y' }; // no testValue
allPass &= check('cutoff: malformed question (no testValue) returns null, not false', window.evaluateCorrect(cutoffMalformed, 10), null);

// MNEMONIC (self-graded, mirrors isShortAnswer)
// window.__state is a REFERENCE to the actual closure-internal `state` object the app
// uses — mutating it here mutates what evaluateCorrect() reads inside the IIFE too.
window.__state.session = { shortAnswerCorrect: true };
const mnemQ = { type: 'mnemonic', letters:[{letter:'C',meaning:'x'}], testIndex: 0 };
allPass &= check('mnemonic: self-graded true', window.evaluateCorrect(mnemQ, 'my guess'), true);
window.__state.session.shortAnswerCorrect = false;
allPass &= check('mnemonic: self-graded false', window.evaluateCorrect(mnemQ, 'my guess'), false);
window.__state.session.shortAnswerCorrect = null;
allPass &= check('mnemonic: not yet self-graded returns null', window.evaluateCorrect(mnemQ, 'my guess'), null);

// Existing standard MCQ path — regression check, must be unaffected
const stdQ = { type: undefined, answer: ['B'] };
allPass &= check('regression: standard MCQ correct still works', window.evaluateCorrect(stdQ, ['B']), true);
allPass &= check('regression: standard MCQ wrong still works', window.evaluateCorrect(stdQ, ['A']), false);
const shortQ = { isShortAnswer: true };
window.__state.session.shortAnswerCorrect = true;
allPass &= check('regression: isShortAnswer path still works', window.evaluateCorrect(shortQ, 'anything'), true);

console.log('\n--- pickedStrFor() sanity ---');
console.log('match:', window.pickedStrFor(matchQ, {links:{0:0,1:2}}));
console.log('sequence:', window.pickedStrFor(seqQ, [1,0,2,3]));
console.log('cutoff:', window.pickedStrFor(cutoffQ, 11.3));
console.log('mnemonic:', window.pickedStrFor(mnemQ, 'hello'));
console.log('standard MCQ (regression):', window.pickedStrFor(stdQ, ['B']));

console.log('\n--- shuffledIndices() determinism ---');
const s1 = window.shuffledIndices(6, 'question-id-42');
const s2 = window.shuffledIndices(6, 'question-id-42');
const s3 = window.shuffledIndices(6, 'different-id');
console.log('same seed twice:', JSON.stringify(s1), JSON.stringify(s2), 'equal:', JSON.stringify(s1) === JSON.stringify(s2));
console.log('different seed:', JSON.stringify(s3), 'differs from s1:', JSON.stringify(s1) !== JSON.stringify(s3));
allPass &= (JSON.stringify(s1) === JSON.stringify(s2));

console.log('\n' + (allPass ? '=== ALL TESTS PASSED ===' : '=== SOME TESTS FAILED — see above ==='));
process.exit(allPass ? 0 : 1);
