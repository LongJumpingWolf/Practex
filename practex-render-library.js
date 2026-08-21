/* practex-render-library.js — extracted from Practex's index.html, Chapter 2 file split.
   Loaded via <script src> in fixed order; the original enclosing IIFE has been
   removed so these files share one global scope, same as the original single
   inline <script> block did internally. Order matters: this file must load
   after every file before it in the list, and before every file after it. */
/* ---------------- Standard format parser ---------------- */
function parseLibraryText(raw, sourceOverride){
  var lines = raw.replace(/\r\n/g,'\n').split('\n');
  var mcqs = [];
  var errors = [];
  var passages = {};
  var optionBanks = {}; /* shared answer-choice lists for extended matching questions — see #OPTIONBANK below */
  var source = sourceOverride || '';
  var subject = '';
  var chapterPath = [];
  var i = 0;

  while (i < lines.length) {
    var line = lines[i];
    var t = line.trim();
    if (!t) { i++; continue; }

    if (t.indexOf('#SOURCE:') === 0) {
      if (!sourceOverride) source = t.slice(8).trim();
      i++; continue;
    }
    if (t.indexOf('#SUBJECT:') === 0) {
      subject = t.slice(9).trim(); i++; continue;
    }
    if (t.indexOf('#CHAPTER:') === 0) {
      chapterPath = t.slice(9).split('>').map(function(s){return s.trim();}).filter(Boolean);
      i++; continue;
    }
    if (t.indexOf('#PASSAGE:') === 0) {
      var pid = t.slice(9).trim();
      i++;
      var pbuf = [];
      while (i < lines.length && lines[i].trim() !== '#ENDPASSAGE') { pbuf.push(lines[i]); i++; }
      passages[pid] = pbuf.join('\n').trim();
      i++;
      continue;
    }
    if (t.indexOf('#OPTIONBANK:') === 0) {
      /* Extended matching questions — one shared lettered option list (commonly A-J)
         answered by several consecutive questions, e.g. "match each vignette below to
         the most likely diagnosis". Defined once, referenced by id from any #Q line
         via [BANK:id], same mechanic as #PASSAGE above. A question using a bank omits
         its own #OPTIONS block entirely — the bank's options get copied in during
         parsing, so from here on each question is a fully normal, independent MCQ;
         nothing downstream (storage, editing, practice, FSRS) needs to know a bank
         was ever involved. */
      var bid = t.slice(12).trim();
      i++;
      var bopts = [];
      while (i < lines.length && lines[i].trim() !== '#ENDOPTIONBANK') {
        var bt = lines[i].trim();
        var bm = bt.match(/^([A-Z])\)\s*(.*)$/);
        if (bm) bopts.push({ letter: bm[1], text: bm[2].trim() });
        i++;
      }
      optionBanks[bid] = bopts;
      i++;
      continue;
    }
    /* ---------------- New question types (match/sequence/cutoff/mnemonic) ----------------
       A block starting with #TYPE: is one of the 4 newer, non-MCQ question types added
       alongside the existing bubble-MCQ/short-answer format above. Everything else in
       this file (source/subject/chapter headers, #Q-first blocks with no #TYPE:, images,
       tags) is completely untouched — this is purely additive. Uses this file's own
       existing conventions (colon-terminated tags, comma-separated #TAGS:) rather than
       inventing a second syntax, so both formats can appear in the same pasted file. */
    if (t.indexOf('#TYPE:') === 0) {
      var newType = t.slice(6).trim().toLowerCase();
      var typeStartLine = i + 1;
      i++;

      function readColonLine(tag){
        if (i < lines.length && lines[i].trim().indexOf(tag) === 0) {
          var raw2 = lines[i].trim();
          var val = raw2.slice(raw2.indexOf(':') + 1).trim();
          i++;
          return val;
        }
        return null;
      }
      function readMultilineUntil(stopTags){
        var buf = [];
        while (i < lines.length) {
          var lt = lines[i].trim();
          if (stopTags.some(function(st){ return lt.indexOf(st) === 0; })) break;
          buf.push(lines[i]);
          i++;
        }
        return buf;
      }

      if (t.indexOf('#Q') !== 0 && lines[i] && lines[i].trim().indexOf('#Q') !== 0) {
        errors.push({ line: typeStartLine, message: '#TYPE: ' + newType + ' near line ' + typeStartLine + ' is missing #Q' });
        continue;
      }
      var qLine = lines[i].trim();
      var qStem = qLine.indexOf('#Q') === 0 ? qLine.slice(2).trim() : '';
      i++;
      var qImages = [];
      // Optional #IMAGE_Q: line, same convention as the standard MCQ format above
      if (i < lines.length && lines[i].trim().indexOf('#IMAGE_Q:') === 0) {
        var imgLine = lines[i].trim();
        var imgUrl = imgLine.slice(9).trim();
        if (/^https?:\/\//i.test(imgUrl)) qImages.push(imgUrl);
        else errors.push({ line: i + 1, message: '#IMAGE_Q: near line ' + (i+1) + ' doesn\'t look like a real http(s) link — skipped.' });
        i++;
      }

      var newQ = null;

      if (newType === 'match') {
        if (i < lines.length && lines[i].trim().indexOf('#PAIRS') === 0) i++;
        var pairs = [];
        while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
          var pm = lines[i].trim().match(/^\d+\.\s*(.+?)\s*=\s*(.+)$/);
          if (pm) pairs.push({ left: pm[1].trim(), right: pm[2].trim() });
          else errors.push({ line: i + 1, message: 'Malformed #PAIRS line near ' + (i+1) + ' — expected "N. left = right"' });
          i++;
        }
        if (pairs.length < 3) errors.push({ line: typeStartLine, message: 'match block near line ' + typeStartLine + ' needs at least 3 #PAIRS, found ' + pairs.length });
        newQ = { type: 'match', stem: qStem, pairs: pairs, images: qImages };
      } else if (newType === 'sequence') {
        if (i < lines.length && lines[i].trim().indexOf('#STEPS') === 0) i++;
        var steps = [];
        while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
          var sm = lines[i].trim().match(/^\d+\.\s*(.+)$/);
          if (sm) steps.push(sm[1].trim());
          i++;
        }
        if (steps.length < 2) errors.push({ line: typeStartLine, message: 'sequence block near line ' + typeStartLine + ' needs at least 2 #STEPS, found ' + steps.length });
        newQ = { type: 'sequence', stem: qStem, steps_correct_order: steps, images: qImages };
      } else if (newType === 'cutoff') {
        var rangeRaw = readColonLine('#RANGE:');
        var thresholdRaw = readColonLine('#THRESHOLD:');
        var testValueRaw = readColonLine('#TESTVALUE:');
        var belowRaw = readColonLine('#BELOW:');
        var aboveRaw = readColonLine('#ABOVE:');
        var rangeParts = rangeRaw ? rangeRaw.split(/\s+/).map(Number) : null;
        var threshold = thresholdRaw !== null ? Number(thresholdRaw) : null;
        var testValue = testValueRaw !== null ? Number(testValueRaw) : null;
        if (!rangeRaw || !rangeParts || rangeParts.length !== 3 || rangeParts.some(isNaN)) {
          errors.push({ line: typeStartLine, message: 'cutoff block near line ' + typeStartLine + ': #RANGE: needs "min max step"' });
        }
        if (threshold === null || isNaN(threshold)) errors.push({ line: typeStartLine, message: 'cutoff block near line ' + typeStartLine + ' missing/invalid #THRESHOLD:' });
        if (testValue === null || isNaN(testValue)) errors.push({ line: typeStartLine, message: 'cutoff block near line ' + typeStartLine + ' missing/invalid #TESTVALUE: — required, evaluateCorrect() can\'t grade a cutoff question without it' });
        if (!belowRaw) errors.push({ line: typeStartLine, message: 'cutoff block near line ' + typeStartLine + ' missing #BELOW:' });
        if (!aboveRaw) errors.push({ line: typeStartLine, message: 'cutoff block near line ' + typeStartLine + ' missing #ABOVE:' });
        newQ = { type: 'cutoff', stem: qStem, range: rangeParts, threshold: threshold, testValue: testValue, below: belowRaw, above: aboveRaw, images: qImages };
      } else if (newType === 'mnemonic') {
        if (i < lines.length && lines[i].trim().indexOf('#LETTERS') === 0) i++;
        var letters = [];
        while (i < lines.length && /=/.test(lines[i].trim()) && lines[i].trim().indexOf('#') !== 0) {
          var lm = lines[i].trim().match(/^(.+?)\s*=\s*(.+)$/);
          if (lm) letters.push({ letter: lm[1].trim(), meaning: lm[2].trim() });
          i++;
        }
        if (letters.length < 2) errors.push({ line: typeStartLine, message: 'mnemonic block near line ' + typeStartLine + ' needs at least 2 #LETTERS, found ' + letters.length });
        var testLetterRaw = null;
        if (i < lines.length && lines[i].trim().indexOf('#TESTLETTER:') === 0) {
          testLetterRaw = readColonLine('#TESTLETTER:');
        }
        var testIndex = 0;
        if (testLetterRaw) {
          var foundIdx = -1;
          for (var li = 0; li < letters.length; li++) { if (letters[li].letter.toLowerCase() === testLetterRaw.toLowerCase()) { foundIdx = li; break; } }
          if (foundIdx === -1) errors.push({ line: typeStartLine, message: 'mnemonic block near line ' + typeStartLine + ': #TESTLETTER: "' + testLetterRaw + '" does not match any #LETTERS entry' });
          testIndex = foundIdx === -1 ? 0 : foundIdx;
        } else {
          testIndex = letters.length ? Math.floor(Math.random() * letters.length) : 0;
        }
        newQ = { type: 'mnemonic', stem: qStem, letters: letters, testIndex: testIndex, images: qImages };
      } else if (newType === 'card') {
        /* Pure-reading flashcard — front is qStem (from #Q), back is a multiline
           block under #BACK. No #OPTIONS/#ANSWER/#EXPLANATION at all — there's
           nothing to grade, see evaluateCorrect()/advanceAfterReveal() in
           practex-learning-practice.js for how "no answering" is enforced beyond
           just this screen. */
        var back = '';
        if (i < lines.length && lines[i].trim().indexOf('#BACK') === 0) {
          i++;
          var backBuf = readMultilineUntil(['#TAGS:', '#END']);
          back = backBuf.join('\n').trim();
        }
        newQ = { type: 'card', front: qStem, back: back, images: qImages };
      } else {
        errors.push({ line: typeStartLine, message: 'Unknown #TYPE: "' + newType + '" near line ' + typeStartLine + ' (expected match, sequence, cutoff, mnemonic, or card)' });
      }

      var newTags = [];
      if (i < lines.length && lines[i].trim().indexOf('#TAGS:') === 0) {
        var ntl = lines[i].trim();
        newTags = ntl.slice(ntl.indexOf(':') + 1).split(',').map(function(s){return s.trim();}).filter(Boolean);
        i++;
      }
      if (i < lines.length && lines[i].trim().indexOf('#END') === 0) { i++; }

      if (newQ) {
        mcqs.push(Object.assign(newQ, {
          id: uid(),
          source: source || 'Unlabeled source',
          subject: subject || 'Unsorted',
          chapterPath: chapterPath.length ? chapterPath.slice() : ['Unsorted'],
          tags: newTags,
          flagged: false,
          answerImages: [],
          notes: [],
          asleep: false,
          addedAt: Date.now(),
          learning: { due: Date.now(), interval: 0, history: [], lastReviewed: null, fsrs: null },
          /* Defensive safety net, not the primary fix — expectedAnswerStrFor() and
             evaluateCorrect() already handle these 4 types correctly without needing
             m.answer/m.options at all. This exists in case some OTHER, still-undiscovered
             code path makes the same unconditional-field assumption LearningEngine.record()
             did (see the real bug that shipped from exactly this gap) — better a harmless
             placeholder than another silent crash. */
          answer: ['UNKNOWN'],
          options: [],
        }));
      }
      continue;
    }
    if (t.indexOf('#Q') === 0) {
      var startLine = i + 1;
      var pmatch = t.match(/\[PASSAGE:(\S+)\]/);
      var passageId = pmatch ? pmatch[1] : null;
      var bmatch = t.match(/\[BANK:(\S+)\]/);
      var bankId = bmatch ? bmatch[1] : null;
      i++;
      var qlines = [];
      var qImageUrls = [];
      while (i < lines.length && lines[i].trim().indexOf('#OPTIONS') !== 0 && lines[i].trim().indexOf('#ANSWER') !== 0) {
        var qbt = lines[i].trim();
        if (qbt.indexOf('#IMAGE_Q:') === 0) {
          var qImgUrl = qbt.slice(9).trim();
          if (/^https?:\/\//i.test(qImgUrl)) qImageUrls.push(qImgUrl);
          else errors.push({ line: i + 1, message: '#IMAGE_Q: near line ' + (i+1) + ' doesn\'t look like a real http(s) link — skipped. Use #IMAGE: [description] instead if there\'s no real link for it.' });
        } else {
          qlines.push(lines[i]);
        }
        i++;
      }
      var questionText = qlines.join('\n').trim();

      var options = [];
      if (i < lines.length && lines[i].trim().indexOf('#OPTIONS') === 0) {
        i++;
        while (i < lines.length) {
          var ot = lines[i].trim();
          if (ot.indexOf('#ANSWER') === 0) break;
          var om = ot.match(/^([A-H])\)\s*(.*)$/);
          if (om) options.push({ letter: om[1], text: om[2].trim() });
          i++;
        }
      } else if (bankId) {
        if (optionBanks[bankId] && optionBanks[bankId].length) {
          options = optionBanks[bankId].map(function(o){ return { letter: o.letter, text: o.text }; }); // copy, never share the array — each question is independent from here on
        } else {
          errors.push({ line: startLine, message: '#Q references bank "' + bankId + '" near line ' + startLine + ', but that bank was never defined (or is empty) — check the #OPTIONBANK appears earlier with a matching id.' });
        }
      }

      var isShortAnswer = options.length === 0;
      var answer = [];
      if (i < lines.length && lines[i].trim().indexOf('#ANSWER') === 0) {
        var aline = lines[i].trim();
        var aval = aline.slice(aline.indexOf(':') + 1).trim();
        if (isShortAnswer) {
          answer = [aval];
        } else if (/^unknown$/i.test(aval)) {
          answer = ['UNKNOWN'];
        } else {
          answer = aval.split(',').map(function(s){return s.trim().toUpperCase();}).filter(Boolean);
        }
        i++;
      } else {
        errors.push({ line: startLine, message: 'Missing #ANSWER for question near line ' + startLine });
      }

      var explanation = '';
      var aImageUrls = [];
      if (i < lines.length && lines[i].trim().indexOf('#EXPLANATION') === 0) {
        i++;
        var ebuf = [];
        while (i < lines.length && lines[i].trim().indexOf('#TAGS') !== 0 && lines[i].trim().indexOf('#END') !== 0) {
          var ebt = lines[i].trim();
          if (ebt.indexOf('#IMAGE_A:') === 0) {
            var aImgUrl = ebt.slice(9).trim();
            if (/^https?:\/\//i.test(aImgUrl)) aImageUrls.push(aImgUrl);
            else errors.push({ line: i + 1, message: '#IMAGE_A: near line ' + (i+1) + ' doesn\'t look like a real http(s) link — skipped. Use #IMAGE: [description] instead if there\'s no real link for it.' });
          } else {
            ebuf.push(lines[i]);
          }
          i++;
        }
        explanation = ebuf.join('\n').trim();
      }

      var tags = [];
      if (i < lines.length && lines[i].trim().indexOf('#TAGS') === 0) {
        var tl = lines[i].trim();
        tags = tl.slice(tl.indexOf(':') + 1).split(',').map(function(s){return s.trim();}).filter(Boolean);
        i++;
      }

      if (i < lines.length && lines[i].trim().indexOf('#END') === 0) { i++; }

      if (!questionText) {
        errors.push({ line: startLine, message: 'Empty question body near line ' + startLine });
      } else {
        mcqs.push({
          id: uid(),
          source: source || 'Unlabeled source',
          subject: subject || 'Unsorted',
          chapterPath: chapterPath.length ? chapterPath.slice() : ['Unsorted'],
          passage: passageId ? (passages[passageId] || null) : null,
          question: questionText,
          options: options,
          isShortAnswer: isShortAnswer,
          answer: answer,
          explanation: explanation,
          tags: tags,
          flagged: false,
          images: qImageUrls,
          answerImages: aImageUrls,
          notes: [],
          asleep: false,
          addedAt: Date.now(),
          learning: {
            due: Date.now(),
            interval: 0,
            history: [],
            lastReviewed: null
          }
        });
      }
      continue;
    }
    i++;
  }
  return { mcqs: mcqs, errors: errors };
}

/* ---------------- Content renderer (tables, images, prose) ---------------- */
function tryParseTable(lines, idx){
  if (!/^\s*\|.*\|\s*$/.test(lines[idx] || '')) return null;
  var sep = lines[idx+1] || '';
  if (!/^\s*\|?[\s:\-|]+\|[\s:\-|]*\s*$/.test(sep) || sep.indexOf('-') === -1) return null;
  function splitRow(l){
    var cells = l.split('|').map(function(c){return c.trim();});
    if (cells.length && cells[0] === '') cells.shift();
    if (cells.length && cells[cells.length-1] === '') cells.pop();
    return cells;
  }
  var header = splitRow(lines[idx]);
  var r = idx + 2;
  var rows = [];
  while (r < lines.length && /^\s*\|.*\|\s*$/.test(lines[r])) { rows.push(splitRow(lines[r])); r++; }
  return { header: header, rows: rows, nextIdx: r };
}

function renderContent(text){
  if (!text) return '';
  var lines = text.split('\n');
  var out = '';
  var i = 0;
  var buf = [];
  function flush(){
    if (buf.length) { out += '<p>' + buf.map(escapeHtml).join('<br>') + '</p>'; buf = []; }
  }
  while (i < lines.length) {
    var line = lines[i];
    if (/^\s*#IMAGE:/.test(line)) {
      flush();
      var desc = line.replace(/^\s*#IMAGE:\s*/, '');
      out += '<div class="img-placeholder">Image referenced in source — ' + escapeHtml(desc) + '</div>';
      i++; continue;
    }
    var table = tryParseTable(lines, i);
    if (table) {
      flush();
      out += '<table class="mcq-table"><thead><tr>' + table.header.map(function(h){return '<th>'+escapeHtml(h)+'</th>';}).join('') + '</tr></thead><tbody>' +
        table.rows.map(function(row){ return '<tr>' + row.map(function(c){return '<td>'+escapeHtml(c)+'</td>';}).join('') + '</tr>'; }).join('') +
        '</tbody></table>';
      i = table.nextIdx;
      continue;
    }
    /* Markdown-style bullet lists ("- " or "* " at the start of a line) — Practex's
       own authoring convention already asks for "bullet any answer with 2+ distinct
       facts, no dense prose paragraphs", but renderContent() had no way to actually
       render one — every list-like line just fell into the same <p><br> paragraph
       treatment as ordinary prose, indistinguishable from it. */
    if (/^\s*[-*]\s+/.test(line)) {
      flush();
      var listItems = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        listItems.push(lines[i].replace(/^\s*[-*]\s+/, ''));
        i++;
      }
      out += '<ul class="content-bullets">' + listItems.map(function(li){ return '<li>' + escapeHtml(li) + '</li>'; }).join('') + '</ul>';
      continue;
    }
    if (line.trim() === '') { flush(); i++; continue; }
    buf.push(line);
    i++;
  }
  flush();
  return out;
}

/* ---------------- Tree building ---------------- */
function buildTree(){
  /* While drilled into a specific book on the shelf, every question not from that
     source is excluded — this is what turns "click a book" into "see that book's own
     folder structure" rather than a flat filtered list, since it's the SAME tree the
     normal Library view builds, just scoped down first. Checked against state.view
     too, not just bookshelfActiveSource alone, so leaving bookshelf mode always and
     immediately stops filtering regardless of whether that field happened to still be
     set from an earlier visit. */
  var sourceFilter = (state.view === 'bookshelf' && state.bookshelfActiveSource) ? state.bookshelfActiveSource : null;
  var root = {};
  state.mcqs.forEach(function(m){
    if (m.trashedAt) return; /* soft-deleted — invisible everywhere browsing/counting/practicing happens, without needing to touch every read site individually; see TRASH_RETENTION_DAYS and the Trash view for where these actually live now */
    if (sourceFilter && m.source !== sourceFilter) return;
    if (!root[m.subject]) root[m.subject] = { name: m.subject, count: 0, children: {}, ids: [] };
    var node = root[m.subject];
    node.count++;
    var path = m.chapterPath && m.chapterPath.length ? m.chapterPath : ['Unsorted'];
    path.forEach(function(part){
      if (!node.children[part]) node.children[part] = { name: part, count: 0, children: {}, ids: [] };
      node = node.children[part];
      node.count++;
    });
    node.ids.push(m.id);
  });
  /* Merge in folders that were created on purpose but have no questions yet — these
     never show up from the mcq scan above since nothing there references them.
     Harmless no-op if a path here now DOES have real content (a normal node already
     exists for it, this just finds it rather than creating a duplicate). Skipped
     entirely while source-filtered — an empty folder isn't associated with any
     particular book, so it doesn't belong in a book-scoped view. */
  if (!sourceFilter) {
    (state.emptyFolders || []).forEach(function(pathArr){
      if (!pathArr || !pathArr.length) return;
      if (!root[pathArr[0]]) root[pathArr[0]] = { name: pathArr[0], count: 0, children: {}, ids: [] };
      var node = root[pathArr[0]];
      for (var i = 1; i < pathArr.length; i++) {
        var part = pathArr[i];
        if (!node.children[part]) node.children[part] = { name: part, count: 0, children: {}, ids: [] };
        node = node.children[part];
      }
    });
  }
  return root;
}

function collectIds(node){
  var ids = node.ids.slice();
  Object.keys(node.children).forEach(function(k){ ids = ids.concat(collectIds(node.children[k])); });
  return ids;
}

function getNodeByPath(tree, pathArr){
  if (!pathArr.length) return null;
  var node = tree[pathArr[0]];
  for (var i = 1; i < pathArr.length && node; i++) node = node.children[pathArr[i]];
  return node;
}

/* ---------------- Deck (subject/chapter) management: rename / move / copy / delete ---------------- */
function fullPathOf(m){
  return [m.subject].concat(m.chapterPath && m.chapterPath.length ? m.chapterPath : ['Unsorted']);
}
/* Every mcq whose full path starts with pathArr (i.e. lives under this deck, at any depth). */
function mcqsUnderPath(pathArr){
  return state.mcqs.filter(function(m){
    var fp = fullPathOf(m);
    if (fp.length < pathArr.length) return false;
    for (var i = 0; i < pathArr.length; i++) if (fp[i] !== pathArr[i]) return false;
    return true;
  });
}
function applyFullPath(m, fullPath){
  m.subject = fullPath[0];
  m.chapterPath = fullPath.length > 1 ? fullPath.slice(1) : ['Unsorted'];
}
function renameDeck(pathArr, newName){
  newName = (newName || '').trim();
  if (!newName) return false;
  var depth = pathArr.length;
  mcqsUnderPath(pathArr).forEach(function(m){
    var fp = fullPathOf(m);
    fp[depth - 1] = newName;
    applyFullPath(m, fp);
  });
  if (state.sleepingSubjects[pathArr[0]] && depth === 1) {
    state.sleepingSubjects[newName] = state.sleepingSubjects[pathArr[0]];
    delete state.sleepingSubjects[pathArr[0]];
  }
  return true;
}
/* Moves the deck at pathArr to become a child of destPathArr (a full path — can be a
   bare subject, or a nested chapter), keeping its own name as the new top segment
   underneath the destination and preserving anything nested below it. */
function moveDeckUnder(pathArr, destPathArr){
  /* destPathArr may be [] (or omitted) to promote the deck to a top-level subject in its own right. */
  destPathArr = destPathArr || [];
  var ownName = pathArr[pathArr.length - 1];
  var depth = pathArr.length;
  mcqsUnderPath(pathArr).forEach(function(m){
    var fp = fullPathOf(m);
    var below = fp.slice(depth); // whatever was nested underneath this deck, unaffected
    applyFullPath(m, destPathArr.concat([ownName]).concat(below));
  });
  return true;
}
/* True if destPathArr is the deck itself or lives somewhere underneath it — pasting/moving
   there would nest a deck inside its own descendant, which makes no sense. */
function isPathWithinOrEqual(destPathArr, pathArr){
  if (destPathArr.length < pathArr.length) return false;
  for (var i = 0; i < pathArr.length; i++) if (destPathArr[i] !== pathArr[i]) return false;
  return true;
}
function duplicateDeck(pathArr){
  var ownName = pathArr[pathArr.length - 1];
  var depth = pathArr.length;
  var copies = mcqsUnderPath(pathArr).map(function(m){
    var fp = fullPathOf(m);
    var below = fp.slice(depth);
    var newFullPath = fp.slice(0, depth - 1).concat([ownName + ' (copy)']).concat(below);
    var copy = JSON.parse(JSON.stringify(m));
    copy.id = uid();
    copy.addedAt = Date.now();
    copy.learning = { due: Date.now(), interval: 0, history: [], lastReviewed: null, fsrs: null };
    copy.flagged = false;
    applyFullPath(copy, newFullPath);
    return copy;
  });
  state.mcqs = state.mcqs.concat(copies);
  return copies.length;
}
function deleteDeck(pathArr){
  var removed = mcqsUnderPath(pathArr);
  /* Soft delete — mark and keep, don't remove from state.mcqs at all. buildTree()
     already excludes anything with trashedAt set, so this is invisible everywhere
     browsing happens immediately, exactly like a real delete looks from the outside,
     but nothing actually leaves state.mcqs (or the server) until it's restored or
     the 30-day retention window elapses — see TRASH_RETENTION_DAYS. */
  var now = Date.now();
  removed.forEach(function(m){ m.trashedAt = now; });

  /* Real bug found via a live report: an EMPTY folder/subject (created via "New
     subject"/"New folder" with zero questions ever added to it) is tracked entirely
     in state.emptyFolders, completely separate from state.mcqs — deleteDeck() only
     ever operated on state.mcqs, so deleting an empty folder found zero matching
     questions, did nothing, and the folder stayed visible forever with no way to
     actually remove it. Empty folders have no content to trash/restore, so this is
     a real, permanent removal for them specifically, not a soft delete — there's
     nothing meaningful to keep for 30 days when there was never anything in it. */
  state.emptyFolders = (state.emptyFolders || []).filter(function(ef){
    if (ef.length < pathArr.length) return true; // shorter path can't be this deck or a descendant of it — keep
    for (var i = 0; i < pathArr.length; i++) { if (ef[i] !== pathArr[i]) return true; } // diverges somewhere — not this deck or a descendant — keep
    return false; // exact match or a descendant of the deleted path — remove
  });

  return removed; /* full mcq objects — the trash view needs the real content to show/restore them */
}

/* ---------------- Filtering ---------------- */
function activeSourceFilterList(){
  var chosen = Object.keys(state.filters.sources).filter(function(k){ return state.filters.sources[k]; });
  return chosen.length ? chosen : null;
}
function activeTagFilterList(){
  var chosen = Object.keys(state.filters.tags).filter(function(k){ return state.filters.tags[k]; });
  return chosen.length ? chosen : null;
}
/* Filters are scoped to "however you're browsing right now" rather than persisting
   forever — leaving a folder and coming back (even to the same one) starts clean,
   rather than silently carrying over a status/tag/source filter from a previous visit
   that's easy to forget is still active. Search stays put — it's a deliberately
   cross-folder tool, not a per-visit one. */
function resetFolderFilters(){
  state.filters.status = 'all';
  state.filters.sources = {};
  state.filters.tags = {};
  state.filters.tagPanelOpen = false;
}
function passesFilters(m){
  var srcF = activeSourceFilterList();
  if (srcF && srcF.indexOf(m.source) === -1) return false;
  var tagF = activeTagFilterList();
  if (tagF && !m.tags.some(function(t){ return tagF.indexOf(t) !== -1; })) return false;
  var st = state.filters.status;
  var hist = m.learning.history || [];
  var lastAttempt = hist.length ? hist[hist.length - 1] : null;
  if (st === 'unanswered' && hist.length > 0) return false;
  if (st === 'correct' && (!lastAttempt || lastAttempt.correct !== true)) return false; /* most recent attempt was right — not the FSRS "mastered" classification, which needs 3+ attempts before it means anything */
  if (st === 'wrong' && (!lastAttempt || lastAttempt.correct !== false)) return false; /* most recent attempt was wrong */
  if (st === 'flagged' && !m.flagged) return false;
  var q = (state.filters.search || '').trim().toLowerCase();
  if (q) {
    var hay = [
      questionDisplayText(m), /* m.question for standard types, m.stem for match/sequence/cutoff/mnemonic — without this, search silently couldn't find the new types by their content at all (no crash, just never matched) */
      m.explanation,
      m.subject,
      m.source,
      (m.chapterPath || []).join(' '),
      m.tags.join(' '),
      (m.options || []).map(function(o){ return o.text; }).join(' ')
    ].join(' ').toLowerCase();
    if (hay.indexOf(q) === -1) return false;
  }
  return true;
}

function allTags(){
  var set = {};
  liveMcqs().forEach(function(m){ m.tags.forEach(function(t){ set[t] = true; }); });
  return Object.keys(set).sort();
}

/* ---------------- Rendering: shell ---------------- */
function render(){
  document.body.classList.toggle('fsrs-mode', !!(state.learningMode && state.learningMode.enabled));
  document.body.classList.toggle('dark-mode', !!state.darkMode);
  var root = document.getElementById('appRoot');
  root.innerHTML =
    renderSidebar() +
    (state.sidebarOpen ? '<div class="sidebar-backdrop" data-action="toggle-sidebar"></div>' : '') +
    '<main class="main">' +
      '<div class="mobile-topbar"><button class="btn btn-sm" data-action="toggle-sidebar">' +
        (state.sidebarOpen ? icon('x',15) + ' Close' : icon('menu',15) + ' Menu') +
      '</button></div>' +
      renderMain() +
    '</main>';
  bindEvents();
  hydrateImages();
  renderZipImportStatus(); /* no-op unless the zipUploadReport element exists on this screen — safe to call unconditionally */
  bindPracticeWidgets(); /* no-op unless the current question is a 'cutoff' type — safe to call unconditionally */
  persistLiveSessionSync(); /* no-op unless mid-session — Chapter 3 continuous persistence, see practex-data-core.js */
  if (state.activeModal === 'settings') renderSettingsModalContent();
}

/* Post-render hook for widgets that need real DOM/pointer wiring beyond what the
   plain HTML string render() produces — the cutoff slider's live-updating label, and
   sequence's drag-to-reorder. Both share one constraint: never call the normal
   render() mid-interaction, since it rebuilds #appRoot's entire innerHTML and would
   kill the browser's active pointer capture. Each binds only to its own question
   type and no-ops otherwise, so this is safe to call unconditionally after every
   render(). */
function bindPracticeWidgets(){
  if (state.view !== 'practice' || !state.session) return;
  var s = state.session;
  if (s.viewIndex < s.index) return; /* reviewing an already-answered question — slider is disabled, nothing to bind */
  var m = state.mcqs.find(function(x){ return x.id === s.ids[s.viewIndex]; });
  if (!m) return;
  if (m.type === 'cutoff') bindCutoffSlider(m);
  if (m.type === 'sequence') bindSequenceDrag(m);
}

function bindCutoffSlider(m){
  var slider = document.getElementById('cutoffSlider');
  var label = document.getElementById('cutoffVal');
  if (!slider || slider.dataset.bound) return; /* already bound this render pass */
  slider.dataset.bound = '1';
  slider.addEventListener('input', function(){
    var val = parseFloat(slider.value);
    if (label) label.textContent = val.toFixed(m.range[2] < 1 ? 1 : 0);
    if (!state.session.revealed) state.session.selected = val;
  });
}

/* Sequence drag-to-reorder. Deliberately built on pointer events (pointerdown/move/up),
   not the native HTML5 Drag and Drop API — that API is mouse-first and has a long,
   well-documented history of being unreliable on mobile touch (no real drag image,
   inconsistent touch-to-drag gesture recognition across browsers), which is exactly
   why this project already avoided it for the arrow-button version. Pointer events
   work uniformly across mouse and touch.

   Critical constraint carried over from the cutoff slider above: render() rebuilds
   the ENTIRE #appRoot innerHTML from scratch, which would destroy the dragged
   element's pointer capture mid-gesture. So nothing here calls render() until the
   drag actually ends — the live reflow while dragging works by shifting the OTHER
   items with a CSS transform (opening a gap where the dragged item would land), while
   the dragged item itself just follows the pointer. Only on drop does the real order
   get written to state.session.selected and a normal render() run to settle
   everything cleanly. */
function bindSequenceDrag(m){
  var container = document.getElementById('seqList');
  if (!container || container.dataset.bound) return;
  container.dataset.bound = '1';
  if (container.getAttribute('data-interactive') !== '1') return; /* revealed or reviewing — arrows/handles aren't even rendered, nothing to bind */

  container.addEventListener('pointerdown', function(e){
    var handle = e.target && e.target.closest ? e.target.closest('.seq-drag-handle') : null;
    if (!handle) return;
    var itemEl = handle.closest('.seq-item');
    if (!itemEl) return;
    e.preventDefault();

    var items = Array.prototype.slice.call(container.querySelectorAll('.seq-item'));
    var startIndex = items.indexOf(itemEl);
    if (startIndex === -1) return;
    var itemHeight = itemEl.getBoundingClientRect().height || 44; /* fallback for an environment with no real layout (shouldn't happen live, guards a divide against 0 elsewhere) */

    var drag = { itemEl: itemEl, startIndex: startIndex, currentIndex: startIndex, startY: e.clientY, itemHeight: itemHeight, pointerId: e.pointerId };
    itemEl.setPointerCapture(e.pointerId);
    itemEl.classList.add('seq-dragging');

    function applyGapShift(){
      /* Every item EXCEPT the one being dragged either sits at its natural resting
         transform (0) or shifts by exactly one slot height to open a visual gap at
         wherever the pointer currently implies the dragged item would land. */
      var others = Array.prototype.slice.call(container.querySelectorAll('.seq-item:not(.seq-dragging)'));
      others.forEach(function(el, i){
        var naturalPos = i < drag.startIndex ? i : i + 1; /* this item's index in the FULL list, skipping over the dragged item's own original slot */
        var shift = 0;
        if (drag.startIndex < drag.currentIndex && naturalPos > drag.startIndex && naturalPos <= drag.currentIndex) shift = -1;
        else if (drag.startIndex > drag.currentIndex && naturalPos >= drag.currentIndex && naturalPos < drag.startIndex) shift = 1;
        el.style.transform = shift ? 'translateY(' + (shift * drag.itemHeight) + 'px)' : '';
      });
    }

    function onMove(ev){
      var deltaY = ev.clientY - drag.startY;
      drag.itemEl.style.transform = 'translateY(' + deltaY + 'px)';
      var rawOffset = Math.round(deltaY / drag.itemHeight);
      var newIndex = Math.max(0, Math.min(items.length - 1, drag.startIndex + rawOffset));
      if (newIndex !== drag.currentIndex) {
        drag.currentIndex = newIndex;
        applyGapShift();
      }
    }

    function onUp(){
      itemEl.releasePointerCapture(drag.pointerId);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      /* Commit the real reorder now, then let a full clean render() take over —
         everything above was visual-only (transforms on the live DOM), nothing
         touched state.session.selected until this point. */
      if (drag.currentIndex !== drag.startIndex) {
        state.session.selected = moveArrayItem(state.session.selected, drag.startIndex, drag.currentIndex);
      }
      render();
    }

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  });
}


/* ================= Phase 3.4 ================= */
function getLearningStats(){
  var now = Date.now();
  var stats = { due: 0, new: 0, noconcept: 0, misconception: 0, learning: 0, mastered: 0, tomorrow: 0, recovering: 0 };
  liveMcqs().forEach(function(q){
    if(!q.learning) return;
    if(state.sleepingSubjects[q.subject] || q.asleep) return; /* asleep subjects/questions don't contribute to due/state counts */
    var s = getLearningState(q);
    if(stats[s] !== undefined) stats[s]++;
    if((q.learning.due || 0) <= now) stats.due++;
    if((q.learning.due || 0) > now && (q.learning.due || 0) <= now + 86400000) stats.tomorrow++;
    
    // Check recovery: transitioning from misconception/noconcept to learning/mastered recently
    var hist = q.learning.history;
    if (hist.length >= 2) {
      var last = hist[hist.length - 1];
      var prev = hist[hist.length - 2];
      if (!prev.correct && last.correct) {
        stats.recovering++;
      }
    }
  });
  return stats;
}

function getDashboardData(){
  var ls = getLearningStats();
  var totalTracked = liveMcqs().length;
  var masteryPct = totalTracked ? Math.round((ls.mastered / totalTracked) * 100) : 0;

  // Weakest subjects (asleep subjects/questions excluded — not recommended)
  var subjMap = {};
  liveMcqs().forEach(function(m){
    if (state.sleepingSubjects[m.subject] || m.asleep) return;
    if(!subjMap[m.subject]) subjMap[m.subject] = { total: 0, mastered: 0 };
    subjMap[m.subject].total++;
    if(getLearningState(m) === 'mastered') subjMap[m.subject].mastered++;
  });
  var weakestSubjects = Object.keys(subjMap).map(function(sub){
    var obj = subjMap[sub];
    var pct = obj.total ? Math.round((obj.mastered / obj.total) * 100) : 0;
    return { subject: sub, percentage: pct };
  }).sort(function(a,b){ return a.percentage - b.percentage; });

  // Persistent misconceptions (asleep subjects/questions excluded — not recommended)
  var miscMap = {};
  liveMcqs().forEach(function(m){
    if (state.sleepingSubjects[m.subject] || m.asleep) return;
    if(getLearningState(m) === 'misconception') {
      var trap = getMostRepeatedWrong(m);
      var key = m.subject + ' (' + trap + ')';
      miscMap[key] = (miscMap[key] || 0) + 1;
    }
  });
  var persistentMisconceptions = Object.keys(miscMap).map(function(k){
    return { name: k, count: miscMap[k] };
  }).sort(function(a,b){ return b.count - a.count; }).slice(0, 5);

  var todayStr = dateStr(Date.now());
  var reviewsToday = 0;
  liveMcqs().forEach(function(m){
    (m.learning.history || []).forEach(function(h){ if (dateStr(h.ts) === todayStr) reviewsToday++; });
  });

  return {
    due: ls.due,
    tracked: totalTracked,
    mastered: ls.mastered,
    learning: ls.learning,
    misconception: ls.misconception,
    noconcept: ls.noconcept,
    new: ls.new,
    mastery: masteryPct,
    recovering: ls.recovering,
    tomorrow: ls.tomorrow,
    weakestSubjects: weakestSubjects,
    persistentMisconceptions: persistentMisconceptions,
    reviewsToday: reviewsToday,
    streak: state.streak.count || 0
  };
}
/* ============================================ */

function renderSidebar(){
  var tree = buildTree();
  var subjectKeys = Object.keys(tree).sort();
  var html = '<aside class="sidebar' + (state.sidebarOpen ? ' open' : '') + '" id="sidebar">';
  html += '<div class="brand"><div class="brand-mark"><img src="icons/icon-128x128.png" alt="Practex logo"></div>' +
    '<div style="flex:1;"><div class="brand-name serif">Practex</div><div class="brand-tag">MCQ practice</div></div>' +
    '<button class="sidebar-gear-btn' + (state.view === 'addsource' ? ' active' : '') + '" data-action="set-view" data-view="addsource" title="Add source" aria-label="Add source">' + icon('folder-plus',16) + '</button>' +
    '<button class="sidebar-gear-btn" data-action="open-settings" title="Settings" aria-label="Settings">' + icon('settings',16) + '</button></div>';

  html += renderSyncStatusPill();

  html += '<div class="nav-tabs">' +
    '<button class="nav-tab' + (state.view==='browse'?' active':'') + '" data-action="set-view" data-view="browse">Library</button>' +
    '<button class="nav-tab' + (state.view==='bookshelf'?' active':'') + '" data-action="toggle-bookshelf">Book Shelf</button>' +
    '</div>';

  var ls = getLearningStats();
  html += '<div class="fsrs-bar">';
  html += '<div class="fsrs-bar-header" data-action="toggle-fsrs-card" role="button" aria-expanded="' + (state.fsrsCardExpanded ? 'true' : 'false') + '">' +
    '<span class="icon-inline">' + icon(state.fsrsCardExpanded ? 'chevron-down' : 'chevron-right', 13) + '<span style="font-size:12px;font-weight:600;">FSRS MODE</span></span>' +
    '<span class="fsrs-switch' + (state.learningMode.enabled ? ' on' : '') + '" data-action="toggle-fsrs-mode" role="switch" aria-checked="' + (state.learningMode.enabled ? 'true' : 'false') + '" aria-label="Toggle FSRS mode" title="' + (state.learningMode.enabled ? 'FSRS mode is on — click to disable' : 'FSRS mode is off — click to enable') + '"><span class="fsrs-switch-track"></span><span class="fsrs-switch-thumb"></span></span>' +
    '</div>';
  if (state.fsrsCardExpanded) {
    html += '<div class="fsrs-bar-body" data-action="open-dashboard">';
    html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;text-align:center;margin-bottom:8px;">';
    html += '<div><div style="font-size:18px;font-weight:700">' + ls.due + '</div><div style="font-size:10px;opacity:0.8;">Due</div></div>';
    html += '<div><div style="font-size:18px;font-weight:700">' + ls.misconception + '</div><div style="font-size:10px;opacity:0.8;">Misconcept.</div></div>';
    html += '<div><div style="font-size:18px;font-weight:700">' + ls.tomorrow + '</div><div style="font-size:10px;opacity:0.8;">Tomorrow</div></div>';
    html += '</div>';
    html += '<div style="border-top:1px solid rgba(255,255,255,0.15);padding-top:6px;font-size:11px;display:flex;justify-content:space-between;opacity:0.9;">' +
      '<span>Tracked</span><strong>' + state.mcqs.length + ' Questions</strong></div>';
    html += '</div>';
  }
  html += '</div>';

  html += '<div class="side-section-label">Subjects &amp; chapters</div>';
  html += '<button class="toc-root-link' + (state.view==='browse' && !state.selectedPath ? ' active' : '') + '" data-action="clear-selection">' + icon('home',14) + ' Library (all subjects)</button>';
  html += '<div class="toc">';
  if (!subjectKeys.length) {
    html += '<div class="toc-empty">Nothing logged yet. Go to <strong>Add source</strong> to import your first set of OCR\'d MCQs.</div>';
  } else {
    subjectKeys.forEach(function(sk){
      html += renderTocNode(tree[sk], [sk], true);
    });
  }
  html += '</div>';

  html += '<div class="side-footer">' + state.mcqs.length + ' MCQs logged from ' + Object.keys(state.sources).length + ' source' + (Object.keys(state.sources).length===1?'':'s') + '.</div>';
  html += '</aside>';
  return html;
}

function renderTocNode(node, path, isSubject){
  var key = path.join('␟');
  var expanded = !!state.expanded[key];
  var hasChildren = Object.keys(node.children).length > 0;
  var selected = state.selectedPath && state.selectedPath.join('␟') === key;
  var html = '<div class="toc-node' + (isSubject ? ' subject' : '') + '">';
  html += '<div class="toc-row' + (selected ? ' selected' : '') + '">';
  if (hasChildren) {
    html += '<button class="toc-toggle" data-action="toggle-node" data-path="' + escapeHtml(key) + '">' + (expanded ? icon('chevron-down',12) : icon('chevron-right',12)) + '</button>';
  } else {
    html += '<span class="toc-toggle"></span>';
  }
  html += '<span class="toc-label" data-action="select-node" data-path="' + escapeHtml(key) + '">' + escapeHtml(node.name) + '</span>';
  html += '<span class="toc-count">' + node.count + '</span>';
  html += '</div>';
  if (hasChildren && expanded) {
    html += '<div class="toc-children">';
    Object.keys(node.children).sort().forEach(function(ck){
      html += renderTocNode(node.children[ck], path.concat([ck]), false);
    });
    html += '</div>';
  }
  html += '</div>';
  return html;
}

function renderMain(){
  if (state.view === 'addsource') return renderAddSource();
  if (state.view === 'dashboard') return renderDashboard();
  if (state.view === 'queuepreview') return renderQueuePreview();
  if (state.view === 'practice' && state.session) return renderPractice();
  if (state.view === 'summary' && state.session) return renderSummary();
  if (state.view === 'bookshelf') return renderBookshelf();
  if (state.view === 'trash') return renderTrashView();
  return renderBrowse();
}

/* ---------------- Trash (soft-deleted questions, 30-day retention) ---------------- */
function renderTrashView(){
  var items = trashedMcqs().slice().sort(function(a, b){ return b.trashedAt - a.trashedAt; }); /* most recently deleted first */
  var html = '<div class="view-head"><div class="breadcrumb"><button class="breadcrumb-link" data-action="set-view" data-view="browse">' + icon('chevron-left',12) + ' Library</button></div>' +
    '<div class="view-title serif">Trash</div>' +
    '<div class="view-sub">' + items.length + ' question' + (items.length===1?'':'s') + ' — anything here longer than ' + TRASH_RETENTION_DAYS + ' days is removed automatically.</div></div>';

  if (!items.length) {
    html += '<div class="card empty-state"><span class="serif">Trash is empty</span>Deleted decks and sources land here for ' + TRASH_RETENTION_DAYS + ' days before being cleaned up automatically.</div>';
    return html;
  }

  html += '<div class="action-row"><button class="btn btn-ghost" data-action="empty-trash">' + icon('trash-2',14) + ' Empty trash</button></div>';

  html += '<div class="mcq-list">';
  items.forEach(function(m){
    var daysLeft = Math.max(0, TRASH_RETENTION_DAYS - Math.floor((Date.now() - m.trashedAt) / 86400000));
    var qText = questionDisplayText(m);
    var snippet = qText.replace(/\n/g,' ').slice(0, 140) + (qText.length > 140 ? '…' : '');
    html += '<div class="card mcq-row">' +
      '<div class="mcq-status-dot"></div>' +
      '<div class="mcq-row-text">' + escapeHtml(snippet) +
      '<div class="mcq-row-meta">' +
      '<span class="source-pill" style="background:' + colorForSource(m.source) + '">' + escapeHtml(m.source) + '</span>' +
      '<span class="tag-pill">' + daysLeft + ' day' + (daysLeft===1?'':'s') + ' left</span>' +
      '</div></div>' +
      '<div class="mcq-row-actions">' +
      '<button class="mcq-icon-btn" data-action="restore-trash-item" data-id="' + m.id + '" title="Restore">' + icon('corner-up-right',14) + '</button>' +
      '<button class="mcq-icon-btn" data-action="permanently-delete-trash-item" data-id="' + m.id + '" title="Delete forever">' + icon('trash-2',14) + '</button>' +
      '</div></div>';
  });
  html += '</div>';
  return html;
}

/* ---------------- Book shelf view (by source) ---------------- */
function renderBookshelf(){
  if (state.bookshelfActiveSource) return renderBookInterior();

  /* state.sources is the single reference for "what sources exist" — Manage Sources
     reads it, and this should always show exactly the same list, not independently
     re-derive its own answer from scanning mcq.source values. That scan used to also
     happen here as a defensive fallback, which is what let the two views quietly
     disagree in the first place when the registry fell behind; now that
     reconcileSources() keeps state.sources itself correct on every load, this view
     doesn't need its own separate patch for the same problem — trusting the registry
     is what actually keeps both views in permanent agreement, rather than each one
     tolerating a different subset of drift. */
  var sourceNames = Object.keys(state.sources).sort();
  var byId = {}; state.mcqs.forEach(function(m){ byId[m.id] = m; });
  var countBySource = {};
  liveMcqs().forEach(function(m){ countBySource[m.source] = (countBySource[m.source]||0) + 1; });

  var html = '<div class="view-head"><div class="view-title serif">Book Shelf</div>' +
    '<div class="view-sub">' + sourceNames.length + ' source' + (sourceNames.length===1?'':'s') + ' — click one to see its chapters, or set a cover.</div></div>';

  if (!sourceNames.length) {
    html += '<div class="card empty-state"><span class="serif">Nothing here yet</span>Add some questions first — each source you import from becomes a book here.</div>';
    return html;
  }

  html += '<div class="book-shelf-grid">';
  sourceNames.forEach(function(name){
    var count = countBySource[name] || 0;
    var src = state.sources[name] || {};
    var coverUrl = src.coverImageUrl; /* pasted link — rendered directly, never goes through ImgBB */
    var coverHash = src.coverImage;   /* uploaded file — goes through the same ImgBB relay as question images */
    var color = colorForSource(name);
    html += '<div class="book-card" data-action="open-book" data-source="' + escapeHtml(name) + '">';
    if (coverUrl) {
      html += '<div class="book-cover has-image"><img src="' + escapeHtml(coverUrl) + '" alt="" loading="lazy"></div>';
    } else if (coverHash) {
      html += '<div class="book-cover has-image"><img data-hash-src="' + escapeHtml(coverHash) + '" alt=""></div>';
    } else {
      html += '<div class="book-cover" style="background:' + color + ';"><span class="book-cover-title">' + escapeHtml(name) + '</span></div>';
    }
    html += '<button class="book-cover-edit" data-action="set-book-cover" data-source="' + escapeHtml(name) + '" title="Set cover image" aria-label="Set cover image">' + icon('image',13) + '</button>';
    html += '<div class="book-label" title="' + escapeHtml(name) + '">' + escapeHtml(name) + '</div>';
    html += '<div class="book-count">' + count + ' question' + (count===1?'':'s') + '</div>';
    html += '</div>';
  });
  html += '</div>';
  return html;
}

/* The view once you've clicked into a specific book — reuses the exact same
   chapter-grid/question-list machinery the normal Library uses, just fed a tree
   that's already been scoped down to this one source by buildTree() itself (see the
   sourceFilter check there). This is what makes "click a book" show its actual
   folder structure instead of a flat filtered list. */
function renderBookInterior(){
  var searchBarHtml = renderSearchBar();
  if ((state.filters.search || '').trim()) {
    return searchBarHtml + renderQuestionList(buildTree(), null, true);
  }
  var tree = buildTree();
  var node = state.selectedPath ? getNodeByPath(tree, state.selectedPath) : null;
  var hasChildren = node && Object.keys(node.children).length > 0;
  var showGrid = !node || (hasChildren && !state.forceList);
  return searchBarHtml + (showGrid ? renderChapterGrid(tree, node) : renderQuestionList(tree, node));
}

/* ---------------- Learning Dashboard view ---------------- */
function renderDashboard(){
  var d = getDashboardData();
  var html = '<div class="view-head"><div class="view-title serif">Learning Dashboard</div>' +
    '<div class="view-sub">Overview of your spaced repetition, memory states, and weak spots.</div></div>';
  html += '<div style="margin-bottom:18px;"><button class="btn btn-ghost" data-action="set-view" data-view="browse">' + icon('chevron-left',14) + ' Back to Library</button></div>';
  if (state.pausedSession) {
    var psd = state.pausedSession;
    html += '<div class="card paused-card"><div style="font-weight:600;margin-bottom:4px;">Paused test</div>' +
      '<div class="view-sub" style="margin-bottom:10px;">Question ' + Math.min(psd.index+1, psd.ids.length) + ' of ' + psd.ids.length + ' · ' + psd.results.length + ' answered</div>' +
      '<button class="btn btn-primary btn-sm" data-action="resume-paused">Resume test</button></div>';
  }

  html += '<div class="card section-block" style="background:var(--cover);color:#fff;">';
  html += '<div style="font-size:12px;text-transform:uppercase;letter-spacing:1px;opacity:0.8;margin-bottom:4px;">Today\'s Due</div>';
  html += '<div style="font-size:clamp(32px,9vw,42px);font-weight:700;margin-bottom:12px;">' + d.due + '</div>';
  html += '<button class="btn btn-primary" style="background:#fff;color:var(--cover);border-color:#fff;" data-action="start-queue-preview">Start Today\'s Session</button>';
  html += '<div style="display:flex;gap:18px;margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.25);font-size:12.5px;opacity:0.95;">' +
    '<span class="icon-inline">' + icon('flame',14) + ' <strong>' + d.streak + '</strong> day' + (d.streak===1?'':'s') + '</span>' +
    '<span><strong>' + d.reviewsToday + '</strong> reviewed today</span>' +
    '</div>';
  html += '</div>';

  html += '<div class="card section-block">';
  html += '<h3>Question States</h3>';
  html += '<div style="display:flex;flex-direction:column;gap:8px;margin-top:10px;">';
  html += '<div style="display:flex;justify-content:space-between;font-size:13.5px;padding:6px 0;border-bottom:1px solid var(--rule);"><span><span style="display:inline-flex;align-items:center;"><span style="width:12px;height:12px;border-radius:50%;background:#22c55e;border:1.5px solid #111;display:inline-block;margin-right:8px;"></span>Mastered</span></span><strong>' + d.mastered + '</strong></div>';
  html += '<div style="display:flex;justify-content:space-between;font-size:13.5px;padding:6px 0;border-bottom:1px solid var(--rule);"><span><span style="display:inline-flex;align-items:center;"><span style="width:12px;height:12px;border-radius:50%;background:#228be6;border:1.5px solid #111;display:inline-block;margin-right:8px;"></span>Learning</span></span><strong>' + d.learning + '</strong></div>';
  html += '<div style="display:flex;justify-content:space-between;font-size:13.5px;padding:6px 0;border-bottom:1px solid var(--rule);"><span><span style="display:inline-flex;align-items:center;"><span style="width:12px;height:12px;border-radius:50%;background:#facc15;border:1.5px solid #111;display:inline-block;margin-right:8px;"></span>No Concept</span></span><strong>' + d.noconcept + '</strong></div>';
  html += '<div style="display:flex;justify-content:space-between;font-size:13.5px;padding:6px 0;border-bottom:1px solid var(--rule);"><span><span style="display:inline-flex;align-items:center;"><span style="width:12px;height:12px;border-radius:50%;background:#ef4444;border:1.5px solid #111;display:inline-block;margin-right:8px;"></span>Misconception</span></span><strong>' + d.misconception + '</strong></div>';
  html += '<div style="display:flex;justify-content:space-between;font-size:13.5px;padding:6px 0;"><span><span style="display:inline-flex;align-items:center;"><span style="width:12px;height:12px;border-radius:50%;background:#fff;border:1.5px solid #111;display:inline-block;margin-right:8px;"></span>New</span></span><strong>' + d.new + '</strong></div>';
  html += '</div></div>';

  html += '<div class="card section-block">';
  html += '<h3>Mastery &amp; Recovery</h3>';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:10px;">';
  html += '<div style="background:var(--paper);padding:14px;border-radius:8px;"><div style="font-size:clamp(19px,5.5vw,24px);font-weight:700;color:var(--pen-green);">' + d.mastery + '%</div><div style="font-size:12px;color:var(--ink-soft);margin-top:2px;">Overall Mastery</div></div>';
  html += '<div style="background:var(--paper);padding:14px;border-radius:8px;"><div style="font-size:clamp(19px,5.5vw,24px);font-weight:700;color:var(--cover);">' + d.recovering + '</div><div style="font-size:12px;color:var(--ink-soft);margin-top:2px;">Questions recovering</div></div>';
  html += '</div></div>';

  if (d.persistentMisconceptions.length) {
    html += '<div class="card section-block">';
    html += '<h3>Most Persistent Misconceptions</h3>';
    html += '<div style="display:flex;flex-direction:column;gap:6px;margin-top:10px;">';
    d.persistentMisconceptions.forEach(function(m){
      html += '<div style="font-size:13.5px;padding:6px 0;border-bottom:1px solid var(--rule);display:flex;justify-content:space-between;"><span>• ' + escapeHtml(m.name) + '</span><span style="color:var(--pen-red);font-weight:600;">' + m.count + ' misses</span></div>';
    });
    html += '</div></div>';
  }

  if (d.weakestSubjects.length) {
    html += '<div class="card section-block">';
    html += '<h3>Weakest Subjects</h3>';
    html += '<div style="display:flex;flex-direction:column;gap:8px;margin-top:10px;">';
    d.weakestSubjects.forEach(function(s){
      html += '<div style="display:flex;justify-content:space-between;align-items:center;font-size:13.5px;padding:6px 0;border-bottom:1px solid var(--rule);">' +
        '<button class="link-btn" data-action="jump-subject" data-subject="' + escapeHtml(s.subject) + '">' + escapeHtml(s.subject) + '</button><strong>' + s.percentage + '%</strong></div>';
    });
    html += '</div></div>';
  }


  return html;
}

/* ---------------- Queue Preview view ---------------- */
function renderQueuePreview(){
  var dueIds = getLearningQueue(state.mcqs.map(function(m){return m.id;}));
  var byId = {}; state.mcqs.forEach(function(m){ byId[m.id] = m; });
  var dueQs = dueIds.map(function(id){ return byId[id]; }).filter(Boolean);

  var counts = { misconception: 0, noconcept: 0, learning: 0, mastered: 0, new: 0 };
  dueQs.forEach(function(q){
    var st = getLearningState(q);
    if (counts[st] !== undefined) counts[st]++;
  });

  var estTime = Math.max(2, Math.round(dueQs.length * 0.75));

  var html = '<div class="view-head"><div class="view-title serif">Today\'s Session</div>' +
    '<div class="view-sub">Review queue prepared by your spaced repetition algorithm.</div></div>';

  if (!dueQs.length) {
    html += '<div class="card section-block" style="text-align:center;padding:40px 20px;">' +
      '<div class="serif icon-inline" style="font-size:20px;margin-bottom:8px;justify-content:center;">' + icon('check-circle',20) + ' You\'re caught up</div>' +
      '<div class="view-sub" style="margin-bottom:20px;">Nothing is scheduled.</div>' +
      '<div style="border-top:1px solid var(--rule);padding-top:20px;margin-top:20px;">' +
      '<div class="serif" style="font-size:16px;margin-bottom:6px;">Study Ahead</div>' +
      '<div class="view-sub" style="margin-bottom:14px;">Review tomorrow\'s questions today.</div>' +
      '<button class="btn btn-primary" data-action="start-study-ahead">Study Ahead</button>' +
      '</div><div style="margin-top:20px;">' +
      '<div class="serif" style="font-size:16px;margin-bottom:6px;">Practice All</div>' +
      '<div class="view-sub" style="margin-bottom:14px;">Ignore FSRS Mode.</div>' +
      '<button class="btn" data-action="start-practice-all">Practice Everything</button>' +
      '</div></div>';
  } else {
    html += '<div class="card section-block">';
    html += '<div style="font-size:clamp(22px,7vw,28px);font-weight:700;margin-bottom:14px;">' + dueQs.length + ' Questions</div>';
    html += '<div style="display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--rule);border-bottom:1px solid var(--rule);padding:12px 0;margin-bottom:14px;">';
    if (counts.misconception) html += '<div style="display:flex;justify-content:space-between;font-size:13.5px;"><span><span style="display:inline-flex;align-items:center;"><span style="width:12px;height:12px;border-radius:50%;background:#ef4444;border:1.5px solid #111;display:inline-block;margin-right:8px;"></span>Misconception</span></span><strong>' + counts.misconception + '</strong></div>';
    if (counts.noconcept) html += '<div style="display:flex;justify-content:space-between;font-size:13.5px;"><span><span style="display:inline-flex;align-items:center;"><span style="width:12px;height:12px;border-radius:50%;background:#facc15;border:1.5px solid #111;display:inline-block;margin-right:8px;"></span>No Concept</span></span><strong>' + counts.noconcept + '</strong></div>';
    if (counts.learning) html += '<div style="display:flex;justify-content:space-between;font-size:13.5px;"><span><span style="display:inline-flex;align-items:center;"><span style="width:12px;height:12px;border-radius:50%;background:#228be6;border:1.5px solid #111;display:inline-block;margin-right:8px;"></span>Learning</span></span><strong>' + counts.learning + '</strong></div>';
    if (counts.mastered) html += '<div style="display:flex;justify-content:space-between;font-size:13.5px;"><span><span style="display:inline-flex;align-items:center;"><span style="width:12px;height:12px;border-radius:50%;background:#22c55e;border:1.5px solid #111;display:inline-block;margin-right:8px;"></span>Mastered</span></span><strong>' + counts.mastered + '</strong></div>';
    if (counts.new) html += '<div style="display:flex;justify-content:space-between;font-size:13.5px;"><span><span style="display:inline-flex;align-items:center;"><span style="width:12px;height:12px;border-radius:50%;background:#fff;border:1.5px solid #111;display:inline-block;margin-right:8px;"></span>New</span></span><strong>' + counts.new + '</strong></div>';
    html += '</div>';
    html += '<div class="view-sub" style="margin-bottom:20px;">Estimated Time: <strong>~' + estTime + ' min</strong></div>';
    html += '<div class="action-row"><button class="btn btn-primary" data-action="start-due-session">Start Session</button>' +
      '<button class="btn btn-ghost" data-action="set-view" data-view="browse">Back to Library</button></div>';
    html += '</div>';
  }
  return html;
}

/* ---------------- Browse view ---------------- */
function renderSearchBar(){
  var term = state.filters.search || '';
  return '<div class="main-search"><span class="main-search-icon">' + icon('search',15) + '</span>' +
    '<input type="text" id="globalSearchInput" placeholder="Search questions…" value="' + escapeHtml(term) + '">' +
    (term ? '<button class="main-search-clear" data-action="clear-search" title="Clear search" aria-label="Clear search">' + icon('x',14) + '</button>' : '') +
    '</div>';
}

/* Was a single generic "Question list" tag on every leaf chapter card regardless of
   what's actually in it — replaced with a real breakdown of the question TYPES
   present, since a chapter mixing standard MCQs with a match-the-following or a
   flashcard looked identical to one that was pure MCQ. Shows one small pill per
   distinct type actually present (not per question — a chapter with 20 MCQs and
   1 match still shows just "MCQ" + "Match", not 21 pills), in a fixed, predictable
   order so the same chapter always lists its types the same way between renders. */
var QUESTION_TYPE_LABELS = { undefined: 'MCQ', match: 'Match', sequence: 'Sequence', cutoff: 'Cutoff', mnemonic: 'Mnemonic', card: 'Flashcard' };
var QUESTION_TYPE_ORDER = ['undefined', 'match', 'sequence', 'cutoff', 'mnemonic', 'card'];
function renderQuestionTypeTags(qs){
  if (!qs.length) return '<span class="deck-type-tag leaf" title="No questions logged here yet">' + icon('list',11) + ' Empty</span>';
  var present = {};
  qs.forEach(function(m){ present[m.type || 'undefined'] = true; });
  var types = QUESTION_TYPE_ORDER.filter(function(t){ return present[t]; });
  /* Wrapped in its own flex container with a real gap — the tags themselves are
     inline-flex (for their own icon+text layout), which doesn't produce any spacing
     between ADJACENT tags on its own; joining the HTML strings with '' would render
     them touching with zero gap otherwise. */
  return '<span class="deck-type-tag-row">' + types.map(function(t){
    return '<span class="deck-type-tag leaf" title="Opens straight to its question list">' + escapeHtml(QUESTION_TYPE_LABELS[t]) + '</span>';
  }).join('') + '</span>';
}

function renderBrowse(){
  var pausedHtml='';
  if(state.pausedSession){
    var ps=state.pausedSession;
    /* recoveredFromCrash (Chapter 3) means this wasn't an explicit "Pause & leave" —
       it's a continuous-persistence snapshot adopted because the last exit wasn't
       graceful (tab crashed, closed without warning, etc). Worth saying so plainly
       rather than implying the person did something they didn't. */
    var cardTitle = ps.recoveredFromCrash ? 'Recovered session' : 'Paused test';
    var cardNote = ps.recoveredFromCrash ? ' — looks like the app closed unexpectedly' : '';
    pausedHtml='<div class="card paused-card"><div style="font-weight:600;margin-bottom:4px;">'+cardTitle+cardNote+'</div><div class="view-sub" style="margin-bottom:10px;">Question '+Math.min(ps.index+1,ps.ids.length)+' of '+ps.ids.length+' · '+ps.results.length+' answered</div><button class="btn btn-primary btn-sm" data-action="resume-paused">Resume test</button></div>';
  }
  var searchBarHtml = renderSearchBar();
  if ((state.filters.search || '').trim() || (!state.selectedPath && state.forceList)) {
    /* The second condition is what makes clicking a book on the shelf show a flat,
       filtered list rather than the subject grid — forceList alone only works when
       you're already inside a specific folder; at the root, "!node" was winning and
       showing the grid regardless of forceList, so a source-filtered view from the
       book shelf needs this explicit path to the same global-list rendering the
       search box already uses. */
    return searchBarHtml + pausedHtml + renderQuestionList(buildTree(), null, true);
  }
  var tree = buildTree();
  var node = state.selectedPath ? getNodeByPath(tree, state.selectedPath) : null;
  var hasChildren = node && Object.keys(node.children).length > 0;
  var showGrid = state.mcqs.length && (!node || (hasChildren && !state.forceList));
  return searchBarHtml + pausedHtml + (showGrid ? renderChapterGrid(tree, node) : renderQuestionList(tree, node));
}

function renderBreadcrumb(){
  if (state.view === 'bookshelf' && state.bookshelfActiveSource) {
    var html = '<div class="breadcrumb">';
    html += '<button class="breadcrumb-link" data-action="back-to-shelf">' + icon('book',12) + ' Book Shelf</button>';
    html += '<span class="breadcrumb-sep">/</span>';
    if (!state.selectedPath) {
      html += '<span class="breadcrumb-current">' + escapeHtml(state.bookshelfActiveSource) + '</span>';
    } else {
      html += '<button class="breadcrumb-link" data-action="clear-book-path">' + escapeHtml(state.bookshelfActiveSource) + '</button>';
      var bookAcc = [];
      state.selectedPath.forEach(function(seg, i){
        bookAcc.push(seg);
        var isLastB = i === state.selectedPath.length - 1;
        html += '<span class="breadcrumb-sep">/</span>';
        if (isLastB) {
          html += '<span class="breadcrumb-current">' + escapeHtml(seg) + '</span>';
        } else {
          html += '<button class="breadcrumb-link" data-action="select-node" data-path="' + escapeHtml(bookAcc.join('␟')) + '">' + escapeHtml(seg) + '</button>';
        }
      });
    }
    html += '</div>';
    return html;
  }
  if (!state.selectedPath) return '';
  var html = '<div class="breadcrumb">';
  html += '<button class="breadcrumb-link" data-action="clear-selection">Library</button>';
  var acc = [];
  state.selectedPath.forEach(function(seg, i){
    acc.push(seg);
    var isLast = i === state.selectedPath.length - 1;
    html += '<span class="breadcrumb-sep">/</span>';
    if (isLast) {
      html += '<span class="breadcrumb-current">' + escapeHtml(seg) + '</span>';
    } else {
      html += '<button class="breadcrumb-link" data-action="select-node" data-path="' + escapeHtml(acc.join('␟')) + '">' + escapeHtml(seg) + '</button>';
    }
  });
  html += '</div>';
  return html;
}

/* Card grid — shown for the library root (subjects) and for any node that still has children (chapters) */
function renderChapterGrid(tree, node){
  var childrenMap = node ? node.children : tree;
  var keys = Object.keys(childrenMap).sort();
  var title = node ? node.name : 'Library';
  var kind = node ? 'chapter' : 'subject';

  var html = '<div class="view-head">';
  html += renderBreadcrumb();
  html += '<div class="view-title serif">' + escapeHtml(title) + '</div>' +
    '<div class="view-sub">' + keys.length + ' ' + kind + (keys.length===1?'':'s') +
    (node ? ' in this subject' : ' — pick one to see its chapters and questions') + '</div></div>';

  var inBookInterior = state.view === 'bookshelf' && state.bookshelfActiveSource;
  if (!inBookInterior) {
    html += '<div class="action-row" style="margin-top:0;">' +
      '<button class="btn btn-ghost" data-action="open-new-folder" data-path="' + (node ? escapeHtml(state.selectedPath.join('␟')) : '') + '">' + icon('folder-plus',14) + ' New ' + (node ? 'sub-folder' : 'subject') + '</button>' +
      '</div>';
  }

  if (state.clipboardNode) {
    var herePathKey = (node ? state.selectedPath : []).join('␟');
    html += '<div class="paste-banner"><span>' + icon('clipboard',15) + ' <strong>' + escapeHtml(state.clipboardNode.name) + '</strong> is cut — pick a destination, then paste it here.</span>' +
      '<span style="display:flex;gap:8px;flex-shrink:0;">' +
      '<button class="btn btn-primary btn-sm" data-action="paste-node-here" data-path="' + escapeHtml(herePathKey) + '">Paste here</button>' +
      '<button class="btn btn-ghost btn-sm" data-action="cancel-cut">Cancel</button>' +
      '</span></div>';
  }

  if (!keys.length) {
    html += '<div class="card empty-state"><span class="serif">Nothing here yet</span>No MCQs are logged under this ' + kind + '.</div>';
    return html;
  }

  var byId = {}; state.mcqs.forEach(function(m){ byId[m.id] = m; });
  html += '<div class="chapter-grid">';
  keys.forEach(function(k){
    var child = childrenMap[k];
    var path = (node ? state.selectedPath : []).concat([k]);
    var pathKey = path.join('␟');
    var qs = collectIds(child).map(function(id){ return byId[id]; }).filter(Boolean);
    var answered = qs.filter(function(m){ return m.learning.history.length > 0; }).length;
    var mastered = qs.filter(function(m){ return getLearningState(m) === 'mastered'; }).length;
    var flagged = qs.filter(function(m){ return m.flagged; }).length;
    var mastery = answered ? Math.round(mastered / qs.length * 100) : 0;
    var childHasKids = Object.keys(child.children).length > 0;
    var isSubjectLevel = !node;
    var asleep = isSubjectLevel && !!state.sleepingSubjects[k];

    var childCount = Object.keys(child.children).length;
    var typeTag = childHasKids
      ? '<span class="deck-type-tag folder" title="Opens another set of chapters">' + icon('folder',11) + ' ' + childCount + ' chapter' + (childCount===1?'':'s') + '</span>'
      : renderQuestionTypeTags(qs);

    html += '<div class="chapter-card' + (asleep ? ' asleep' : '') + (childHasKids ? ' is-folder' : ' is-leaf') + '" data-action="select-node" data-path="' + escapeHtml(pathKey) + '">';
    html += '<div class="chapter-card-toolbar">';
    if (isSubjectLevel) {
      html += '<button class="chapter-card-sleep-btn' + (asleep ? ' on' : '') + '" data-action="toggle-subject-sleep" data-subject="' + escapeHtml(k) + '" title="' + (asleep ? 'Asleep — click to wake, resuming FSRS review' : 'Put this subject to sleep — pauses FSRS review and excludes it from Start Practice on the library root') + '" aria-label="Toggle sleep for ' + escapeHtml(k) + '">' + icon('moon',14) + '</button>';
    }
    html += '<button class="chapter-card-menu-btn" data-action="open-deck-menu" data-path="' + escapeHtml(pathKey) + '" title="More options" aria-label="More options for ' + escapeHtml(child.name) + '">' + icon('more-vertical',15) + '</button>';
    html += '</div>';
    html += '<div class="chapter-card-body">';
    html += '<div class="chapter-card-title">' + escapeHtml(child.name) + (asleep ? ' <span class="sleep-badge">Asleep</span>' : '') + '</div>';
    html += typeTag;
    html += '<div class="chapter-card-stats"><strong>' + child.count + '</strong> question' + (child.count===1?'':'s');
    if (answered) {
      var accClass = mastery >= 70 ? 'stat-good' : (mastery >= 40 ? 'stat-mid' : 'stat-low');
      html += ' · <span class="' + accClass + '">' + mastery + '% mastered</span>';
    } else {
      html += ' · not started';
    }
    if (flagged) html += ' · ' + flagged + ' flagged';
    if (asleep) html += ' · not recommended while asleep';
    html += '</div></div>';
    html += '<button class="chapter-card-view" data-action="view-node-questions" data-path="' + escapeHtml(pathKey) + '">' +
      'View questions ' + icon('chevron-right',13) + '</button>';
    html += '</div>';
  });
  html += '</div>';
  return html;
}

/* Flat filtered question list — shown once you're inside a leaf chapter, or after "View questions" */
function renderQuestionList(tree, node, searchAll){
  var title = searchAll ? 'Search results' : (state.selectedPath ? state.selectedPath[state.selectedPath.length-1] : 'All subjects');
  var ids = (searchAll || !node) ? liveMcqs().map(function(m){return m.id;}) : collectIds(node);
  var byId = {}; state.mcqs.forEach(function(m){ byId[m.id] = m; });
  var list = ids.map(function(id){ return byId[id]; }).filter(Boolean).filter(passesFilters);
  /* Sleeping subjects stay visible for browsing, but drop out of the root-level "Start practice" pool/count. */
  var practiceCount = (searchAll || !node) ? list.filter(function(m){ return !state.sleepingSubjects[m.subject] && !m.asleep; }).length : list.filter(function(m){ return !m.asleep; }).length;

  var html = '<div class="view-head">';
  html += searchAll ? '<div class="breadcrumb"><button class="breadcrumb-link" data-action="clear-search">' + icon('chevron-left',12) + ' Library</button></div>' : renderBreadcrumb();
  html += '<div class="view-title serif">' + escapeHtml(title) + '</div>' +
    '<div class="view-sub">' + list.length + ' question' + (list.length===1?'':'s') + ' match the filters below' + (searchAll || state.selectedPath ? '' : ' · pick a subject or chapter on the left to narrow down') + '</div></div>';

  html += renderFilters();

  html += '<div class="action-row">' +
    '<button class="btn btn-primary" data-action="start-practice"' + (practiceCount ? '' : ' disabled') + '>Start practice (' + practiceCount + ')</button>' +
    '<button class="btn btn-ghost" data-action="export-current-view"' + (list.length ? '' : ' disabled') + '>' + icon('download',14) + ' Export this view (' + list.length + ')</button>';
  html += '</div>';

  if (!state.mcqs.length) {
    html += '<div class="card empty-state"><span class="serif">Your library is empty</span>Head to <strong>Add source</strong> to paste in your first standardized MCQ set.</div>';
  } else if (!list.length) {
    html += '<div class="card empty-state"><span class="serif">No questions match</span>Try loosening the filters above.</div>';
  } else {
    html += '<div class="mcq-list">';
    list.slice(0, 200).forEach(function(m){
      var statusClass = m.flagged ? 'flagged' : (m.learning.history.length === 0 ? '' : (getLearningState(m) === 'mastered' ? 'correct' : 'wrong'));
      var qText = questionDisplayText(m);
      var snippet = qText.replace(/\n/g,' ').slice(0, 140);
      html += '<div class="card mcq-row' + (m.asleep ? ' mcq-asleep' : '') + '" data-action="preview-mcq" data-id="' + m.id + '">' +
        '<div class="mcq-status-dot ' + statusClass + '"></div>' +
        '<div class="mcq-row-text">' + escapeHtml(snippet) + (qText.length > 140 ? '…' : '') + (m.asleep ? ' <span class="sleep-badge">Asleep</span>' : '') +
        '<div class="mcq-row-meta">' +
        '<span class="source-pill" style="background:' + colorForSource(m.source) + '">' + escapeHtml(m.source) + '</span>' +
        (m.images && m.images.length ? '<span class="tag-pill icon-inline" title="' + m.images.length + ' image' + (m.images.length===1?'':'s') + ' attached">' + icon('image',11) + ' ' + m.images.length + '</span>' : '') +
        (m.notes && m.notes.length ? '<span class="tag-pill icon-inline" title="' + m.notes.length + ' note' + (m.notes.length===1?'':'s') + '">' + icon('notes',11) + ' ' + m.notes.length + '</span>' : '') +
        m.tags.slice(0,2).map(function(t){ return '<span class="tag-pill">' + escapeHtml(t) + '</span>'; }).join('') +
        (m.tags.length > 2 ? '<span class="tag-pill-more">+' + (m.tags.length-2) + '</span>' : '') +
        '</div></div>' +
        '<div class="mcq-row-actions">' +
        '<button class="mcq-icon-btn' + (m.asleep ? ' on' : '') + '" data-action="toggle-mcq-sleep" data-id="' + m.id + '" title="' + (m.asleep ? 'Asleep — click to wake, resuming FSRS review' : 'Put just this question to sleep — pauses its FSRS review and excludes it from Start Practice') + '">' + icon('moon',14) + '</button>' +
        '<button class="mcq-icon-btn" data-action="view-history" data-id="' + m.id + '" title="Review history">' + icon('clock',14) + '</button>' +
        '<button class="mcq-icon-btn" data-action="edit-mcq" data-id="' + m.id + '" title="Edit question">' + icon('pencil',14) + '</button>' +
        '</div></div>';
    });
    if (list.length > 200) html += '<div class="view-sub" style="margin-top:8px;">Showing first 200 of ' + list.length + ' — narrow the filters to see more precisely.</div>';
    html += '</div>';
  }
  return html;
}

function renderFilters(){
  var sources = Object.keys(state.sources);
  var tags = allTags();
  if (!sources.length) return '';
  var activeTagCount = Object.keys(state.filters.tags).filter(function(t){ return state.filters.tags[t]; }).length;
  var anyFilterActive = activeTagCount > 0 ||
    Object.keys(state.filters.sources).some(function(s){ return state.filters.sources[s]; }) ||
    state.filters.status !== 'all';

  var html = '<div class="filters-bar">';
  html += '<div class="filter-toolbar">';

  // Sources — small set, always shown inline
  html += '<div class="filter-toolbar-group">';
  sources.forEach(function(s){
    var active = !!state.filters.sources[s];
    html += '<button class="chip' + (active?' active':'') + '" data-action="toggle-source-filter" data-source="' + escapeHtml(s) + '">' +
      '<span class="chip-dot" style="background:' + colorForSource(s) + '"></span>' + escapeHtml(s) + '</button>';
  });
  html += '</div>';

  if (tags.length) {
    html += '<div class="filter-divider"></div>';
    html += '<button class="tags-trigger' + (activeTagCount ? ' has-active' : '') + '" data-action="toggle-tag-panel">' +
      'Tags' + (activeTagCount ? '<span class="count-badge">' + activeTagCount + '</span>' : '') +
      '<span class="caret">' + (state.filters.tagPanelOpen ? icon('chevron-up',11) : icon('chevron-down',11)) + '</span></button>';
  }

  html += '<div class="filter-divider"></div>';
  html += '<div class="filter-toolbar-group">' +
    '<select class="status-select status-select-' + state.filters.status + '" data-action="set-status-filter">' +
    ['all','unanswered','correct','wrong','flagged'].map(function(v){
      var label = v === 'flagged' ? 'Bookmarked' : (v.charAt(0).toUpperCase()+v.slice(1));
      return '<option value="'+v+'"' + (state.filters.status===v?' selected':'') + '>' + label + '</option>';
    }).join('') + '</select></div>';

  if (anyFilterActive) {
    html += '<button class="filter-clear-link" data-action="clear-all-filters">Clear filters</button>';
  }
  html += '</div>'; // .filter-toolbar

  if (state.filters.tagPanelOpen && tags.length) {
    html += '<div class="tag-panel">';
    tags.forEach(function(t){
      var active = !!state.filters.tags[t];
      html += '<button class="chip' + (active?' active':'') + '" data-action="toggle-tag-filter" data-tag="' + escapeHtml(t) + '">' + escapeHtml(t) + '</button>';
    });
    html += '</div>';
  }

  html += '</div>'; // .filters-bar
  return html;
}

/* ---------------- Add source view ---------------- */
var MASTER_PROMPT = "PRACTEX MCQ STANDARDIZATION PROMPT\n\n" +
"You will be given raw, messy OCR text extracted from a medical review or self-assessment book containing multiple-choice questions (and, where the source material suits it, match-the-following, ordered-sequence, numeric-cutoff, or lettered-mnemonic content — see types 12-15 below). Convert it into the exact Practex Standard Format below. Output ONLY the converted text in this format - no commentary, no markdown code fences, nothing before or after.\n\n" +
"=== FILE HEADER (once, at the very top) ===\n" +
"#SOURCE: <Full book title, author, edition - as accurately as you can tell from the text or context given>\n\n" +
"=== SECTION HEADERS (repeat only when subject or chapter changes) ===\n" +
"#SUBJECT: <subject name, e.g. Microbiology>\n" +
"#CHAPTER: <chapter path, use \" > \" to separate levels if the book nests Section > Chapter > Topic, e.g. \"General Microbiology > Sterilization and Disinfection\">\n" +
"Place these immediately before the first question they apply to. Do not repeat them for every question - only when they change.\n\n" +
"=== EACH QUESTION BLOCK ===\n" +
"#Q\n" +
"<full question stem, verbatim, except for OCR cleanup below>\n" +
"#OPTIONS\n" +
"A) <option text>\n" +
"B) <option text>\n" +
"C) <option text>\n" +
"D) <option text>\n" +
"E) <option text>   (only if a 5th option exists - omit the line entirely if not)\n" +
"#ANSWER: <letter, e.g. B - or comma-separated letters for multi-correct e.g. B,D - or UNKNOWN if the source has no answer key for this question>\n" +
"#EXPLANATION\n" +
"<explanation text if the book provides one, else omit this whole block>\n" +
"#TAGS: <comma-separated - exam name/year if shown e.g. AIIMS 2015, plus any topic tags you can infer>\n" +
"#END\n\n" +
"Always re-letter options A, B, C, D, E in that order regardless of how the original numbered them (i, ii, iii or 1, 2, 3 all become A, B, C...).\n\n" +
"=== SPECIAL QUESTION TYPES ===\n\n" +
"1. Standard single-best-answer - use the block above as-is.\n\n" +
"2. Multiple correct answers (select all that apply) - watch for these signals in the source, since OCR often loses the actual instruction line: the stem says \"select all that apply\", \"which of the following are true/correct\" (plural \"are\", not singular \"is\"), \"mark all correct statements\", a checkbox-style layout instead of round radio-style bullets, or an answer key that lists more than one letter for a single question. When any of these appear, #ANSWER lists every correct letter comma-separated with no spaces, e.g. #ANSWER: A,C,D - never collapse a genuinely multi-correct question down to just one letter because only one seemed most textbook-important. This is different from type 5 below (combination-style options like \"A) 1 and 2 only\") - a combination question still has exactly ONE correct lettered option and gets a single #ANSWER letter, even though the option text itself describes multiple statements.\n\n" +
"3. Assertion-Reason questions - put both statements in the #Q body labeled exactly \"Assertion (A):\" and \"Reason (R):\" on their own lines, then the standard Assertion-Reason options go in #OPTIONS as normal lettered options.\n\n" +
"4. Match-the-following / column matching - put the two columns in the #Q body as a markdown pipe table (table rules below), then the lettered combinations go in #OPTIONS as normal, e.g. \"A) 1-a, 2-b, 3-c, 4-d\".\n\n" +
"5. Multiple-statement true/false (Roman numeral statements I, II, III, IV) - list the numbered statements as plain lines inside #Q body, then the combinations go in #OPTIONS as normal, e.g. \"A) I and II only\". Single #ANSWER letter, same reasoning as the note in type 2 above.\n\n" +
"6. Fill-in-the-blank / one-word-answer questions with no options - omit the #OPTIONS block entirely. Put the answer directly after #ANSWER:\n\n" +
"7. Passage or case-vignette shared by 2+ consecutive questions - write the shared passage once, immediately before the first question using it:\n" +
"#PASSAGE: P1\n" +
"<passage text>\n" +
"#ENDPASSAGE\n" +
"Then for every question that uses it, add the passage id right after #Q on the same line: \"#Q [PASSAGE:P1]\". Give each distinct passage in the document a new sequential id (P1, P2, P3...).\n\n" +
"8. Extended matching questions (a shared bank of options, e.g. A-J, used to answer several consecutive scenario/clinical-vignette questions in a row) - write the shared bank once, immediately before the first question using it:\n" +
"#OPTIONBANK: B1\n" +
"A) <option text>\n" +
"B) <option text>\n" +
"... (as many lettered options as the source actually has - not limited to A-D)\n" +
"#ENDOPTIONBANK\n" +
"Then for every question that uses it, add the bank id right after #Q on the same line: \"#Q [BANK:B1]\", and omit that question's own #OPTIONS block entirely - its options come from the bank. #ANSWER is still just the single letter for that question, from the bank's lettering. Give each distinct bank in the document a new sequential id (B1, B2, B3...), same pattern as #PASSAGE ids.\n\n" +
"9. Negative/EXCEPT questions (\"which of the following is NOT true\", \"all of the following are correct EXCEPT\", \"which is a contraindication\" when everything else in the list is an indication, etc.) - keep the negative framing exactly as worded in the #Q stem, never rephrase it into a positive question. #ANSWER is still whichever single letter correctly answers the question AS ASKED - i.e. the one false/exceptional statement, not the ones that happen to be individually true. Getting this backwards is the single most common conversion error on this question type, so double check the answer key's letter actually matches the exception, not the rule.\n\n" +
"10. Questions referencing an image/photo/diagram that OCR cannot capture - insert a line inside the #Q body: #IMAGE: [brief description inferred from the surrounding text/caption]. Never invent findings that aren't stated nearby - if you cannot tell what the image shows, write #IMAGE: [image - description unavailable].\n\n" +
"10b. If the source material actually gives you a REAL, working image URL (e.g. converting from a webpage or a digital document where images are already hosted somewhere, not a scanned/photographed page) - use #IMAGE_Q: <url> instead, on its own line inside the #Q body, for an image that belongs with the question itself. For an image that belongs with the answer/explanation, use #IMAGE_A: <url> on its own line inside the #EXPLANATION body specifically (it will not be recognized anywhere else). Only ever use these two for a URL you can actually see verbatim in the source - NEVER invent, guess, or construct a plausible-looking URL. If you are not looking at a real link, use #IMAGE: [description] from rule 10 instead. A question can have #IMAGE_Q:/#IMAGE_A: and the plain #IMAGE: placeholder together if some images have real links and others don't.\n\n" +
"11. Questions with no visible answer key anywhere in the source - still create the full block, options included, and set #ANSWER: UNKNOWN.\n\n" +
"12. Match-the-following as its OWN question type (not the #OPTIONS-based combination style in rule 4 - use this instead when the source is asking the reader to pair items directly, not pick a lettered combination): \n" +
"#TYPE: match\n" +
"#Q <what the pairing task is asking>\n" +
"#PAIRS\n" +
"1. <left item> = <right item>\n" +
"2. <left item> = <right item>\n" +
"3. <left item> = <right item>\n" +
"(at least 3 pairs - use rule 4's #OPTIONS-based style instead if the source only gives 1-2 genuine pairs)\n" +
"#TAGS: <comma-separated>\n" +
"#END\n\n" +
"13. A staged test or ordered protocol where the ORDER ITSELF is the fact being tested (e.g. \"list these steps in the order they occur\"), not a simple numbered list of facts:\n" +
"#TYPE: sequence\n" +
"#Q <what's being ordered>\n" +
"#STEPS\n" +
"1. <step, written in the CORRECT order - Practex shuffles it for display, never write it pre-shuffled>\n" +
"2. <step>\n" +
"(at least 2 steps)\n" +
"#TAGS: <comma-separated>\n" +
"#END\n\n" +
"14. A lab value or numeric threshold with real diagnostic weight, where the source gives (or implies) both a cutoff number AND what a value on each side of it means:\n" +
"#TYPE: cutoff\n" +
"#Q <what's being classified>\n" +
"#RANGE: <min> <max> <step>\n" +
"#THRESHOLD: <the boundary value>\n" +
"#TESTVALUE: <a specific value clearly on one side of the threshold, not sitting exactly on it - required, this is what actually gets graded>\n" +
"#BELOW: <what a value below the threshold means>\n" +
"#ABOVE: <what a value above the threshold means>\n" +
"#TAGS: <comma-separated>\n" +
"#END\n" +
"Pick #RANGE and #TESTVALUE so the value is unambiguously on one side - never place #TESTVALUE exactly at #THRESHOLD.\n\n" +
"15. An existing lettered mnemonic in the source (e.g. \"CAFFFI\", \"HAFSA\") - only use this for a mnemonic that's ALREADY spelled out with a meaning per letter in the source text, never invent one that isn't there:\n" +
"#TYPE: mnemonic\n" +
"#Q <what the mnemonic stands for>\n" +
"#LETTERS\n" +
"<Letter> = <meaning>\n" +
"<Letter> = <meaning>\n" +
"(at least 2 letters, one line per letter of the mnemonic, in order)\n" +
"#TESTLETTER: <one specific letter to quiz - optional, Practex picks one at random if omitted, but prefer being explicit>\n" +
"#TAGS: <comma-separated>\n" +
"#END\n" +
"If converting a whole chapter with several mnemonics, and time/space allows, create multiple #TYPE: mnemonic blocks for the SAME mnemonic with different #TESTLETTER: values (one block per letter worth testing) rather than just one block per mnemonic - this is what lets the letter being quizzed rotate across review sessions instead of always testing the same one.\n\n" +
"Types 12-15 do NOT use #OPTIONS, #ANSWER, or #EXPLANATION at all - grading is built into the shape of the data itself (pairs must all link correctly, steps must be in the stated order, the slider must land on the correct side of the threshold, the self-graded mnemonic answer is checked against #LETTERS). They still support #IMAGE_Q: exactly like rule 10b, on its own line right after #Q, but never #IMAGE_A: (there's no #EXPLANATION block for these types to put an answer-side image in).\n\n" +
"16. Content with NO natural distractor at all - a pure definition, a single fact, a step in a flowchart with nothing to confuse it with - is usually better as a Kardex flashcard than a Practex question. But when the source material itself frames something as a standalone fact worth reading rather than quizzing (a named syndrome's full definition, a classic clinical picture worth just seeing once), use a read-only card instead of forcing a fake distractor into existence:\n" +
"#TYPE: card\n" +
"#Q <the front - what's being shown first>\n" +
"#BACK\n" +
"<the back - shown together with the front, since there's no quiz step to gate it behind>\n" +
"#TAGS: <comma-separated>\n" +
"#END\n" +
"A card has no #OPTIONS, #ANSWER, or #EXPLANATION, and is never graded right or wrong - it's excluded from FSRS scheduling and correct/wrong stats entirely, the same way a Kardex flashcard is. Use this sparingly and only when 12-15 and the standard MCQ format genuinely don't fit - most content that could be a card is better served staying in Kardex, where it's already meant to live. Like 12-15, a card also supports #IMAGE_Q: on its own line right after #Q, but never #IMAGE_A:.\n\n" +
"=== TABLE RULES ===\n" +
"Use standard markdown pipe tables only, inside a #Q or #EXPLANATION body:\n" +
"| Header 1 | Header 2 |\n" +
"|---|---|\n" +
"| cell | cell |\n" +
"Every header cell must contain text - never leave one empty. Keep one fact per cell. Preserve row order exactly as in the source.\n\n" +
"=== OCR CLEANUP RULES ===\n" +
"Fix obvious character-level OCR errors you're confident about (rn misread as m, 0 for O, words split across a line break) and rejoin them. Remove stray running headers, page numbers, and watermarks that leaked into the text (e.g. repeated site names). Never guess or alter actual medical content, numbers, or drug names you're not sure about - keep your best-guess reading rather than inventing something, and don't flag uncertainty inline. Normalize arrows to the → character. Keep superscripts as ^ (10^3) and subscripts as _ (CO_2) since true super/subscript formatting is usually lost in OCR. Remove duplicated/garbled repeated fragments from double-scanned lines.\n\n" +
"=== GENERAL RULES ===\n" +
"One #Q ... #END block per question, no empty blocks. Do not add your own question numbers - if the original had a locator worth preserving, put it in #TAGS instead (e.g. TAGS: Q45). If converting a large document, process it completely - do not summarize, skip, or truncate partway through, even across hundreds of questions. Output nothing except the formatted blocks - no preamble, no closing notes.\n\n" +
"Below is the raw OCR text to convert:\n" +
"<PASTE YOUR OCR TEXT HERE>";

function renderAddSource(){
  var html = '<div class="view-head"><div class="view-title serif">Add source</div>' +
    '<div class="view-sub">Convert a book\'s OCR dump into the Practex format, then paste the result below to log it.</div></div>';

  html += '<div class="card section-block">' +
    '<h3>1. Copy the conversion prompt</h3>' +
    '<div class="view-sub" style="margin-bottom:10px;">Paste this into an LLM (like Claude) along with your raw OCR text. It defines the exact standard format Practex parses, including every question type, table rules, and OCR cleanup rules — so imports come out clean instead of haywire.</div>' +
    '<div class="prompt-box mono" id="promptBox">' + escapeHtml(MASTER_PROMPT) + '</div>' +
    '<div class="action-row"><button class="btn btn-primary" data-action="copy-prompt">Copy prompt</button></div>' +
    '</div>';

  html += '<div class="card section-block">' +
    '<h3>2. Paste the standardized output here</h3>' +
    '<div class="field-row"><div class="field"><label>Source name override (optional — leave blank to use the #SOURCE: line from the text)</label><input type="text" id="sourceOverrideInput" placeholder="e.g. Sastry Microbiology, 6th ed."></div></div>' +
    '<textarea class="ingest-area mono" id="ingestArea" placeholder="#SOURCE: ...&#10;#SUBJECT: ...&#10;#CHAPTER: ...&#10;#Q ..."></textarea>' +
    '<div class="action-row">' +
    '<button class="btn btn-primary" data-action="parse-preview">Parse &amp; preview</button>' +
    '<button class="btn btn-ghost" data-action="clear-ingest">Clear</button>' +
    '</div>' +
    '<div id="parseReport"></div>' +
    '</div>';

  html += '<div class="card section-block">' +
    '<h3>3. Restore from a backup file (optional)</h3>' +
    '<div class="view-sub" style="margin-bottom:12px;">Import a <code class="mono">.json</code> file you previously exported (Settings → Export library). You\'ll be asked whether to keep each question\'s existing progress or start it fresh, before anything\'s added.</div>' +
    '<div class="action-row"><button class="btn btn-ghost" data-action="import-library">' + icon('upload',14) + ' Choose a library file…</button></div>' +
    '</div>';

  if (state.mcqs.length) {
    var sourceOptions = Object.keys(state.sources).map(function(s){ return '<option value="' + escapeHtml(s) + '">' + escapeHtml(s) + '</option>'; }).join('');
    html += '<div class="card section-block">' +
      '<h3>4. Bulk-attach images (optional)</h3>' +
      '<div class="view-sub" style="margin-bottom:12px;">Every question has a unique ID. Download the ID sheet below, name your image ' +
      'files to match — <code class="mono">&lt;id&gt;_q.jpg</code> for an image shown alongside the question, ' +
      '<code class="mono">&lt;id&gt;_a.jpg</code> for one shown alongside the answer/explanation — zip them up, and upload the zip here. ' +
      'jpg, png, gif, and webp are all fine; multiple images per question/side work too (add <code class="mono">_1</code>, <code class="mono">_2</code> etc. before the extension).</div>' +
      '<div class="field-row"><div class="field"><label>Download ID sheet for</label>' +
      '<select id="idSheetSourceSelect" style="width:100%;padding:8px 10px;border:1px solid var(--rule-strong);border-radius:6px;background:var(--card);color:var(--ink);font-size:13.5px;">' +
      '<option value="">All questions (' + state.mcqs.length + ')</option>' + sourceOptions + '</select></div></div>' +
      '<div class="action-row"><button class="btn btn-ghost" data-action="download-id-sheet">' + icon('download',14) + ' Download ID sheet (CSV)</button></div>' +
      '<div class="field-row" style="margin-top:14px;"><div class="field"><label>Images ZIP</label>' +
      '<input type="file" id="imageZipInput" accept=".zip,application/zip"></div></div>' +
      '<div class="action-row"><button class="btn btn-primary" data-action="upload-image-zip">Process ZIP</button></div>' +
      '<div id="zipUploadReport"></div>' +
      '</div>';
  }

  var sourceNames = Object.keys(state.sources);
  if (sourceNames.length) {
    html += '<div class="card section-block"><h3>Manage sources</h3>';
    sourceNames.forEach(function(s){
      var count = liveMcqs().filter(function(m){ return m.source === s; }).length;
      html += '<div class="source-manage-row">' +
        '<span class="chip-dot" style="background:' + colorForSource(s) + '"></span>' +
        '<span style="flex:1;">' + escapeHtml(s) + '</span>' +
        '<span class="view-sub" style="margin:0;">' + count + ' MCQs</span>' +
        '<button class="btn btn-sm btn-danger" data-action="delete-source" data-source="' + escapeHtml(s) + '">Delete</button>' +
        '</div>';
    });
    html += '</div>';
  }

  if (state.mcqs.length) {
    html += '<div class="card section-block"><h3>Reset</h3>' +
      '<div class="view-sub" style="margin-bottom:10px;">Removes every logged MCQ and source. Cannot be undone.</div>' +
      '<button class="btn btn-danger btn-sm" data-action="clear-all">Clear entire library</button></div>';
  }

  return html;
}
