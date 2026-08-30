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

function extractGate(html) {
  var b = html.match(/gate-breadcrumb">([^<]*)</);
  var n = html.match(/gate-location">([^<]*)</);
  return { breadcrumb: b ? b[1] : null, name: n ? n[1] : null };
}

const dom = new JSDOM('<div id="appRoot"></div><div id="toast"></div><div id="loadingScreen"></div><div id="authGate"></div><div id="syncStatusPill"></div>', { runScripts: 'outside-only', url: 'https://example.com/' });
global.window = dom.window; global.document = dom.window.document;
global.crypto = { subtle: { digest: async () => new ArrayBuffer(32) } };
const names = ['practex-data-core.js','practex-import-content.js','practex-render-library.js','practex-learning-practice.js','practex-events-init.js'];
let loadFailed = false;
names.forEach(n => { try { dom.window.eval(fs.readFileSync(path.join(__dirname, n), 'utf8')); } catch(e){ console.error('LOAD ERROR:', e.message); loadFailed = true; } });
assert('app files load cleanly', !loadFailed);

console.log('\n=== Single question, deep chapter path (the exact reported screenshot: Prep Main > Microbiology > Bacteriology > Streptococcaceae) ===');
{
  dom.window.state = {
    mcqs: [makeMcq('a', 'Prep Main', ['Microbiology', '02. Bacteriology', '02. Streptococcaceae'])],
    session: { ids: ['a'], index:0, viewIndex:0, results:[], stats:{correct:0,wrong:0}, autoSkullCount:0, timePerQ:30, autoSkullEnabled:true, awaitingStart:true }
  };
  var g = extractGate(dom.window.renderPracticeGateScreen());
  assert('big name is the DEEPEST segment only', g.name === '02. Streptococcaceae', g);
  assert('breadcrumb is everything leading up to it', g.breadcrumb === 'Prep Main &gt; Microbiology &gt; 02. Bacteriology', g);
}

console.log('\n=== Many questions, all the same chapter ===');
{
  dom.window.state.mcqs = [
    makeMcq('a', 'Pathology', ['Neoplasia']),
    makeMcq('b', 'Pathology', ['Neoplasia']),
    makeMcq('c', 'Pathology', ['Neoplasia']),
  ];
  dom.window.state.session = { ids: ['a','b','c'], index:0, viewIndex:0, results:[], stats:{correct:0,wrong:0}, autoSkullCount:0, timePerQ:30, autoSkullEnabled:true, awaitingStart:true };
  var g = extractGate(dom.window.renderPracticeGateScreen());
  assert('name is the chapter itself', g.name === 'Neoplasia', g);
  assert('breadcrumb is just the subject', g.breadcrumb === 'Pathology', g);
}

console.log('\n=== Same subject, different chapters (e.g. a study plan spanning a unit) ===');
{
  dom.window.state.mcqs = [
    makeMcq('a', 'Pathology', ['Neoplasia']),
    makeMcq('b', 'Pathology', ['Inflammation']),
  ];
  dom.window.state.session = { ids: ['a','b'], index:0, viewIndex:0, results:[], stats:{correct:0,wrong:0}, autoSkullCount:0, timePerQ:30, autoSkullEnabled:true, awaitingStart:true };
  var g = extractGate(dom.window.renderPracticeGateScreen());
  assert('name is the subject', g.name === 'Pathology', g);
  assert('breadcrumb notes the chapter spread', g.breadcrumb === '2 chapters', g);
}

console.log('\n=== A few different subjects ===');
{
  dom.window.state.mcqs = [
    makeMcq('a', 'Pathology', ['Neoplasia']),
    makeMcq('b', 'Microbiology', ['Bacteriology']),
  ];
  dom.window.state.session = { ids: ['a','b'], index:0, viewIndex:0, results:[], stats:{correct:0,wrong:0}, autoSkullCount:0, timePerQ:30, autoSkullEnabled:true, awaitingStart:true };
  var g = extractGate(dom.window.renderPracticeGateScreen());
  assert('name lists both subjects', g.name === 'Pathology, Microbiology', g);
  assert('no breadcrumb needed here', g.breadcrumb === null, g);
}

console.log('\n=== Many subjects — "Practice Everything" style ===');
{
  dom.window.state.mcqs = [
    makeMcq('a','Pathology',['X']), makeMcq('b','Microbiology',['X']),
    makeMcq('c','Pharmacology',['X']), makeMcq('d','Anatomy',['X']),
  ];
  dom.window.state.session = { ids: ['a','b','c','d'], index:0, viewIndex:0, results:[], stats:{correct:0,wrong:0}, autoSkullCount:0, timePerQ:30, autoSkullEnabled:true, awaitingStart:true };
  var g = extractGate(dom.window.renderPracticeGateScreen());
  assert('name is a clear catch-all', g.name === 'Practice Everything', g);
  assert('breadcrumb notes the subject count', g.breadcrumb === '4 subjects', g);
}

console.log('\n=== CSS: name is genuinely bigger/bolder than the breadcrumb, not just re-labeled ===');
{
  var ok = (function(){
    for (var f of ['library.html','practice.html']) {
      var c = fs.readFileSync(path.join(__dirname, f), 'utf8');
      var nameRule = c.match(/\.gate-location\{([^}]*)\}/);
      var crumbRule = c.match(/\.gate-breadcrumb\{([^}]*)\}/);
      if (!nameRule || !crumbRule) return false;
      var nameSize = parseInt((nameRule[1].match(/font-size:(\d+)px/)||[])[1] || '0', 10);
      var crumbSize = parseInt((crumbRule[1].match(/font-size:(\d+)px/)||[])[1] || '0', 10);
      if (!(nameSize > crumbSize)) return false;
      if (nameRule[1].indexOf('font-weight:700') === -1) return false;
    }
    return true;
  })();
  assert('name font-size > breadcrumb font-size, and name is bold, in both real pages', ok);
}

console.log('\n' + (failures === 0 ? '=== GATE NAME/BREADCRUMB SPLIT VERIFIED ===' : '=== ' + failures + ' FAILURE(S) — see above ==='));
process.exitCode = failures === 0 ? 0 : 1;
process.exit(process.exitCode);
