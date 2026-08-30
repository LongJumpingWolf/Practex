const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

process.on('unhandledRejection', (reason) => { console.error('FATAL:', reason && reason.stack ? reason.stack : reason); process.exit(1); });

let failures = 0;
function assert(label, cond, extra) {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + label + (extra ? '  ' + extra : ''));
  if (!cond) failures++;
}

function makeMcq(id, subject, chapterPath) {
  return {
    id: id, question: 'Q ' + id, subject: subject, chapterPath: chapterPath,
    source: 'Book', tags: [], options: [{letter:'A',text:'x'},{letter:'B',text:'y'}], answer: ['A'], explanation: '',
    images: [], answerImages: [], notes: [], flagged: false, learning: { history: [], due: Date.now() },
  };
}

const dom = new JSDOM('<div id="appRoot"></div><div id="toast"></div><div id="loadingScreen"></div><div id="authGate"></div><div id="syncStatusPill"></div>', { runScripts: 'outside-only', url: 'https://example.com/' });
global.window = dom.window; global.document = dom.window.document;
global.crypto = { subtle: { digest: async () => new ArrayBuffer(32) } };
const names = ['practex-data-core.js','practex-import-content.js','practex-render-library.js','practex-learning-practice.js','practex-events-init.js'];
let loadFailed = false;
names.forEach(n => { try { dom.window.eval(fs.readFileSync(path.join(__dirname, n), 'utf8')); } catch(e){ console.error('LOAD ERROR:', e.message); loadFailed = true; } });
assert('app files load cleanly', !loadFailed);

console.log('\n=== Single question, single chapter (the exact reported screenshot) ===');
{
  dom.window.state = {
    mcqs: [makeMcq('a', 'Microbiology', ['Bacteriology', 'Staphylococcus'])],
    session: { ids: ['a'], index:0, viewIndex:0, results:[], stats:{correct:0,wrong:0}, autoSkullCount:0, timePerQ:30, autoSkullEnabled:true, awaitingStart:true }
  };
  var html = dom.window.renderPracticeGateScreen();
  assert('shows the exact subject > chapter path', html.indexOf('Microbiology &gt; Bacteriology &gt; Staphylococcus') !== -1 || html.indexOf('Microbiology > Bacteriology > Staphylococcus') !== -1, html.match(/gate-location">([^<]*)</));
}

console.log('\n=== Many questions, all the same chapter ===');
{
  dom.window.state.mcqs = [
    makeMcq('a', 'Pathology', ['Neoplasia']),
    makeMcq('b', 'Pathology', ['Neoplasia']),
    makeMcq('c', 'Pathology', ['Neoplasia']),
  ];
  dom.window.state.session = { ids: ['a','b','c'], index:0, viewIndex:0, results:[], stats:{correct:0,wrong:0}, autoSkullCount:0, timePerQ:30, autoSkullEnabled:true, awaitingStart:true };
  var html = dom.window.renderPracticeGateScreen();
  var m = html.match(/gate-location">([^<]*)</);
  assert('single shared chapter shown, no chapter-count suffix', m && m[1] === 'Pathology &gt; Neoplasia', m);
}

console.log('\n=== Same subject, different chapters (e.g. a study plan spanning a unit) ===');
{
  dom.window.state.mcqs = [
    makeMcq('a', 'Pathology', ['Neoplasia']),
    makeMcq('b', 'Pathology', ['Inflammation']),
  ];
  dom.window.state.session = { ids: ['a','b'], index:0, viewIndex:0, results:[], stats:{correct:0,wrong:0}, autoSkullCount:0, timePerQ:30, autoSkullEnabled:true, awaitingStart:true };
  var html = dom.window.renderPracticeGateScreen();
  var m = html.match(/gate-location">([^<]*)</);
  assert('single subject shown with a chapter count', m && m[1] === 'Pathology — 2 chapters', m);
}

console.log('\n=== A few different subjects ===');
{
  dom.window.state.mcqs = [
    makeMcq('a', 'Pathology', ['Neoplasia']),
    makeMcq('b', 'Microbiology', ['Bacteriology']),
  ];
  dom.window.state.session = { ids: ['a','b'], index:0, viewIndex:0, results:[], stats:{correct:0,wrong:0}, autoSkullCount:0, timePerQ:30, autoSkullEnabled:true, awaitingStart:true };
  var html = dom.window.renderPracticeGateScreen();
  var m = html.match(/gate-location">([^<]*)</);
  assert('both subjects named directly', m && m[1] === 'Pathology, Microbiology', m);
}

console.log('\n=== Many subjects — "Practice Everything" style, naming them all would be noise ===');
{
  dom.window.state.mcqs = [
    makeMcq('a','Pathology',['X']), makeMcq('b','Microbiology',['X']),
    makeMcq('c','Pharmacology',['X']), makeMcq('d','Anatomy',['X']),
  ];
  dom.window.state.session = { ids: ['a','b','c','d'], index:0, viewIndex:0, results:[], stats:{correct:0,wrong:0}, autoSkullCount:0, timePerQ:30, autoSkullEnabled:true, awaitingStart:true };
  var html = dom.window.renderPracticeGateScreen();
  var m = html.match(/gate-location">([^<]*)</);
  assert('collapses to a subject count instead of a long list', m && m[1] === '4 subjects', m);
}

console.log('\n=== Location label is visually distinct (bold pill), not lost in the subtitle text ===');
{
  var hasStyle = (function(){
    for (var f of ['library.html','practice.html']) {
      var c = fs.readFileSync(path.join(__dirname, f), 'utf8');
      if (c.indexOf('.gate-location{') === -1) return false;
      if (c.indexOf('font-weight:700') === -1) return false;
    }
    return true;
  })();
  assert('bold pill CSS present in both real pages', hasStyle);
}

console.log('\n' + (failures === 0 ? '=== GATE LOCATION LABEL VERIFIED ===' : '=== ' + failures + ' FAILURE(S) — see above ==='));
process.exitCode = failures === 0 ? 0 : 1;
process.exit(process.exitCode);
