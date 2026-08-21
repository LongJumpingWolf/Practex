/* practex-import-content.js — extracted from Practex's index.html, Chapter 2 file split.
   Loaded via <script src> in fixed order; the original enclosing IIFE has been
   removed so these files share one global scope, same as the original single
   inline <script> block did internally. Order matters: this file must load
   after every file before it in the list, and before every file after it. */
/* ---------------- Bulk image ZIP import ---------------- */
/* Re-schedules the whole library using the current FSRS ceiling rules, for
   questions whose due date was computed before a scheduling-logic fix
   shipped. Doesn't touch history, ratings, or FSRS stability/difficulty —
   purely recomputes the derived due date from what's already stored. */
function recomputeAllDueDates(){
  var changed = 0;
  state.mcqs.forEach(function(m){
    if (LearningEngine.recomputeDue(m)) changed++;
  });
  return changed;
}

/* Real bug found via a live import: the question list, CSV export, "Add a note"
   modal, and "Review history" modal all read m.question unconditionally — the
   field name standard MCQ types use. The 4 newer types (match/sequence/cutoff/
   mnemonic) use m.stem instead, so m.question is undefined for them, and calling
   .replace()/.length on undefined throws — which crashed the ENTIRE list/modal the
   moment it tried to render a row containing one of these types, not just that row.
   One shared helper, used everywhere a short preview of "what does this question
   say" is needed, so this can't drift out of sync across the 5 places it's used. */
function questionDisplayText(m){
  if (m.type === 'card') return m.front || '';
  return (m.type && m.stem !== undefined) ? m.stem : (m.question || '');
}

function csvEscape(s){
  s = String(s == null ? '' : s);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g,'""') + '"';
  return s;
}
function downloadIdSheet(){
  var sourceFilter = document.getElementById('idSheetSourceSelect');
  var src = sourceFilter ? sourceFilter.value : '';
  var rows = state.mcqs.filter(function(m){ return !src || m.source === src; });
  if (!rows.length) { showToast('No questions match that source.'); return; }
  var lines = ['id,question,subject,chapter,source'];
  rows.forEach(function(m){
    var snippet = questionDisplayText(m).replace(/\s+/g,' ').trim().slice(0, 120);
    lines.push([m.id, snippet, m.subject, (m.chapterPath||[]).join(' > '), m.source].map(csvEscape).join(','));
  });
  var blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'practex-question-ids' + (src ? '-' + src.replace(/[^a-z0-9]+/gi,'-') : '') + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
  showToast(rows.length + ' question ID' + (rows.length===1?'':'s') + ' exported.');
}
/* Matches zip entry filenames like <id>_q.jpg, <id>-a.png, <id>_q_2.webp — the id is
   whatever's before the last _q/_a marker, so ids containing underscores/hyphens
   themselves still work (uid() ids look like "m_ab12cd34xxxxx"). */
var IMAGE_ZIP_NAME_RE = /^(.+)[-_](q|a)(?:[-_]\d+)?\.(png|jpe?g|gif|webp)$/i;
var IMAGE_ZIP_UPLOAD_STAGGER_MS = 250; /* pace between entries so a big zip doesn't fire a burst of uploads at once against ImgBB's free-tier rate limit */

function requestNotificationPermissionIfNeeded(){
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') Notification.requestPermission().catch(function(){});
}
function notifyZipImportComplete(job){
  if (document.visibilityState === 'visible') return; /* tab's in front of you — the toast already covers it */
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    var n = new Notification('Practex — image import finished', {
      body: job.attached + ' of ' + job.total + ' image' + (job.total===1?'':'s') + ' attached.' + (job.notFound.length ? ' ' + job.notFound.length + ' filename(s) didn\'t match a question ID.' : ''),
      icon: 'icons/icon-128x128.png'
    });
    n.onclick = function(){ window.focus(); n.close(); };
  } catch(err) { console.warn('Notification failed:', err); }
}
/* Renders the in-page progress/summary if the person is still sitting on the Add
   Source screen — pure best-effort, the job itself doesn't depend on this element
   existing, so navigating away mid-import is completely safe. */
function renderZipImportStatus(){
  var reportEl = document.getElementById('zipUploadReport');
  if (!reportEl) return;
  var job = state.zipImportJob;
  if (!job) { reportEl.innerHTML = ''; return; }
  if (job.active) {
    reportEl.innerHTML = '<div class="view-sub">Processing ' + job.processed + ' of ' + job.total + '… (' + job.attached + ' attached so far — safe to navigate away, this keeps running in the background)</div>';
    return;
  }
  var summary = '<div class="parse-report"><span class="parse-ok">' + job.attached + ' image' + (job.attached===1?'':'s') + ' attached</span></div>';
  if (job.notFound.length) {
    summary += '<div class="parse-err-list">' + job.notFound.length + ' filename' + (job.notFound.length===1?'':'s') + ' didn\'t match any question ID (check the ID sheet):<br>' +
      job.notFound.slice(0,15).map(function(n){ return '· ' + escapeHtml(n); }).join('<br>') + '</div>';
  }
  if (job.skippedNames.length) {
    summary += '<div class="parse-err-list">' + job.skippedNames.length + ' file' + (job.skippedNames.length===1?'':'s') + ' skipped (didn\'t match the &lt;id&gt;_q/_a.ext naming pattern):<br>' +
      job.skippedNames.slice(0,15).map(function(n){ return '· ' + escapeHtml(n); }).join('<br>') + '</div>';
  }
  reportEl.innerHTML = summary;
}
/* Loads JSZip on demand — only ever needed for bulk image ZIP import, which most
   sessions never touch, so it doesn't belong in the initial page weight. Cached after
   the first successful load so a second ZIP import in the same session is instant. */
var jsZipLoadPromise = null;
function ensureJSZipLoaded(){
  if (typeof JSZip !== 'undefined') return Promise.resolve();
  if (jsZipLoadPromise) return jsZipLoadPromise;
  jsZipLoadPromise = new Promise(function(resolve, reject){
    var script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
    script.onload = function(){ resolve(); };
    script.onerror = function(){ jsZipLoadPromise = null; reject(new Error('Could not load ZIP support')); };
    document.head.appendChild(script);
  });
  return jsZipLoadPromise;
}
async function processImageZip(file){
  if (state.zipImportJob && state.zipImportJob.active) { showToast('An image import is already running — let it finish first.'); return; }
  try {
    await ensureJSZipLoaded();
  } catch(err) {
    showToast('ZIP support failed to load — check your connection and try again.');
    return;
  }

  var byId = {}; state.mcqs.forEach(function(m){ byId[m.id] = m; });
  var job = { active: true, processed: 0, total: 0, attached: 0, notFound: [], skippedNames: [] };
  state.zipImportJob = job;
  renderZipImportStatus();
  showToast('Import started — processing in the background, you can keep working.');

  var zip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch(err) {
    console.error('processImageZip:', err);
    job.active = false;
    showToast('Could not read that zip — is it a valid .zip file?');
    renderZipImportStatus();
    return;
  }

  var entries = Object.keys(zip.files).filter(function(name){ return !zip.files[name].dir; });
  job.total = entries.length;
  renderZipImportStatus();

  for (var i = 0; i < entries.length; i++) {
    var fullName = entries[i];
    var baseName = fullName.split('/').pop();
    var match = baseName.match(IMAGE_ZIP_NAME_RE);
    if (!match) { job.skippedNames.push(baseName); }
    else {
      var qid = match[1], side = match[2].toLowerCase(), ext = match[3].toLowerCase();
      var mcq = byId[qid];
      if (!mcq) { job.notFound.push(baseName); }
      else {
        try {
          var rawBlob = await zip.files[fullName].async('blob');
          var mimeType = 'image/' + (ext === 'jpg' ? 'jpeg' : ext);
          var typedBlob = rawBlob.type ? rawBlob : new Blob([rawBlob], { type: mimeType });
          var hash = await storeImageFromFile(typedBlob); /* local write is immediate; cloud upload to ImgBB kicks off in the background right here */
          var field = side === 'a' ? 'answerImages' : 'images';
          if (!mcq[field]) mcq[field] = [];
          if (mcq[field].indexOf(hash) === -1) mcq[field].push(hash);
          job.attached++;
        } catch(err) {
          console.error('processImageZip entry failed:', baseName, err);
          job.skippedNames.push(baseName + ' (failed to read)');
        }
      }
    }
    job.processed++;
    renderZipImportStatus();
    if (i < entries.length - 1) await new Promise(function(r){ setTimeout(r, IMAGE_ZIP_UPLOAD_STAGGER_MS); });
  }

  await saveLibrary();
  job.active = false;
  renderZipImportStatus();
  render(); /* picks up new thumbnails/counts wherever you've navigated to — doesn't touch an open modal */
  showToast(job.attached + ' image' + (job.attached===1?'':'s') + ' attached from the zip.');
  notifyZipImportComplete(job);
}
/* Reads and validates the file, then asks how to handle the FSRS progress baked into
   it before actually touching state.mcqs — the destructive/import-shaping choice
   happens in confirmImportWithChoice() below, once the user's picked one. */
async function handleImportFileSelected(file){
  try {
    var text = await file.text();
    var payload = JSON.parse(text);
    var incoming = Array.isArray(payload) ? payload : payload.mcqs;
    if (!Array.isArray(incoming) || !incoming.length) { showToast('That file doesn\'t look like a Practex export.'); return; }
    var validCount = incoming.filter(function(m){ return m && m.id; }).length;
    if (!validCount) { showToast('That file doesn\'t look like a Practex export.'); return; }
    state.pendingImportPayload = payload;
    openImportChoiceModal(validCount);
  } catch(e) {
    showToast('Could not read that file — is it a valid Practex export?');
  }
}
function openImportChoiceModal(newCount){
  state.activeModal = 'import-choice'; /* explicit, not left as whatever was open before (e.g. 'settings') — otherwise a stray render() elsewhere could re-render the PREVIOUS modal's content over this one, since render() re-renders whatever state.activeModal still points at */
  var html = '<h3>Import ' + newCount + ' question' + (newCount===1?'':'s') + '</h3>';
  html += '<p>This file also carries each question\'s answer history and FSRS scheduling from whenever it was exported. What should happen to that?</p>';
  html += '<p class="view-sub" style="margin-bottom:14px;">Each question gets a fresh copy with a new internal ID — safe to import into any account without conflicting with the original. Re-importing the same file again will create a second copy of everything rather than skipping it, so only import a given file once.</p>';
  html += '<div class="deck-menu" style="padding:0;">' +
    '<button class="deck-menu-item" data-action="confirm-import-file" data-reset="false" style="padding:12px;">' + icon('clock',17) +
      '<span><strong style="display:block;">Keep their existing progress</strong><span style="font-size:12px;color:var(--ink-soft);font-weight:400;">Import with their answer history and due dates intact — as if you\'d been reviewing them here all along.</span></span></button>' +
    '<div class="deck-menu-divider"></div>' +
    '<button class="deck-menu-item" data-action="confirm-import-file" data-reset="true" style="padding:12px;">' + icon('refresh-cw',17) +
      '<span><strong style="display:block;">Start fresh</strong><span style="font-size:12px;color:var(--ink-soft);font-weight:400;">Ignore the exported progress — treat every question as brand new, due immediately.</span></span></button>' +
    '</div>';
  html += '<div class="action-row" style="margin-top:14px;margin-bottom:0;"><button class="btn btn-ghost" data-action="cancel-import-file">Cancel</button></div>';
  showRichModal(html, 'narrow');
}
async function confirmImportWithChoice(resetProgress){
  var payload = state.pendingImportPayload;
  state.pendingImportPayload = null;
  closeModal();
  if (!payload) return;
  var incoming = Array.isArray(payload) ? payload : payload.mcqs;
  var added = 0;
  incoming.forEach(function(m){
    if (!m || !m.id) return;
    /* Always a fresh, brand-new id — never reuse the one baked into the export file.
       That id is the table's primary key, so reusing it is exactly what caused an
       otherwise-harmless re-import to get rejected by row-level security: the row
       already existed (possibly under a completely different account), and the
       database correctly refused to let this write claim it. Generating a new id
       means an imported question can never collide with anything, on any account,
       ever — the tradeoff is that importing the same file twice now creates two
       copies instead of silently skipping the second one, which the modal warns
       about up front. */
    m.id = uid();
    /* Defend against hand-edited/malformed import files — a normal export→import
       round trip already has all of this, but nothing stops someone from feeding in
       a hand-crafted or corrupted JSON file, and several render paths assume these
       fields exist without guarding (e.g. m.learning.history.length). */
    if (!m.learning || typeof m.learning !== 'object') {
      m.learning = { due: Date.now(), interval: 0, history: [], lastReviewed: null, fsrs: null };
    } else if (!Array.isArray(m.learning.history)) {
      m.learning.history = [];
    }
    if (resetProgress) {
      m.learning = { due: Date.now(), interval: 0, history: [], lastReviewed: null, fsrs: null };
      m.asleep = false; /* auto-sleep is derived from progress that no longer exists — nothing to preserve */
    }
    if (!Array.isArray(m.tags)) m.tags = [];
    if (!Array.isArray(m.images)) m.images = [];
    if (!Array.isArray(m.answerImages)) m.answerImages = [];
    if (!Array.isArray(m.notes)) m.notes = [];
    if (typeof m.asleep !== 'boolean') m.asleep = false;
    if (!Array.isArray(m.options)) m.options = [];
    if (!Array.isArray(m.answer) || !m.answer.length) m.answer = ['UNKNOWN'];
    if (!m.subject) m.subject = 'Unsorted';
    if (!Array.isArray(m.chapterPath) || !m.chapterPath.length) m.chapterPath = ['Unsorted'];
    if (typeof m.question !== 'string') m.question = '';
    if (typeof m.source !== 'string') m.source = 'Imported';
    state.mcqs.push(m);
    added++;
  });
  if (payload.sources) {
    Object.keys(payload.sources).forEach(function(k){
      if (!state.sources[k]) state.sources[k] = payload.sources[k];
    });
  }
  reconcileSources(); /* backfill any source an imported question references that wasn't in the file's own sources metadata — see the comment on reconcileSources for why this gap can happen at all */
  render();
  showToast('Saving ' + added + ' question' + (added===1?'':'s') + '…');
  await saveLibrary(); /* awaited — same reasoning as confirm-import: this is a bulk operation, not a frequent tap, worth the wait for correctness */
  await saveSources();
  if (state.lastSaveHadPermanentConflict) {
    /* saveLibrary() already showed a specific explanation — don't pile a misleading
       "success" message on top of it. */
  } else if (state.hasUnsyncedChanges) {
    showToast(added + ' question' + (added===1?'':'s') + ' saved locally — will sync once you\'re back online.');
  } else {
    showToast(added + ' question' + (added===1?'':'s') + (resetProgress ? ' imported fresh.' : ' imported with their existing progress.'));
  }
}
function showModal(title, message, buttons){
  var root=document.getElementById('modalRoot');
  root.innerHTML='<div class="modal-backdrop"><div class="modal-card"><h3>'+escapeHtml(title)+'</h3><p>'+escapeHtml(message)+'</p><div class="action-row" style="margin-bottom:0;">'+buttons.map(function(b){return '<button class="btn '+(b.primary?'btn-primary':'btn-ghost')+'" data-action="'+b.action+'">'+escapeHtml(b.label)+'</button>';}).join('')+'</div></div></div>';
}
function showRichModal(innerHtml, size){
  var root=document.getElementById('modalRoot');
  var sizeClass = size === 'narrow' ? 'narrow' : 'wide';
  root.innerHTML='<div class="modal-backdrop" data-action="modal-backdrop-close"><div class="modal-card '+sizeClass+'" data-stop-close>'+innerHtml+'</div></div>';
  hydrateImages();
}
function closeModal(){ document.getElementById('modalRoot').innerHTML=''; state.activeModal=null; state.editingMcqId=null; }

/* Any <img data-hash-src="HASH"> anywhere in the current DOM gets its real src filled
   in asynchronously — local IndexedDB cache first (instant), falling back to the
   cloud URL. Called after every render() and showRichModal(), so any view that wants
   to show an attached image just needs to render the placeholder tag; this fills it. */
function hydrateImages(){
  document.querySelectorAll('img[data-hash-src]').forEach(function(imgEl){
    var hash = imgEl.getAttribute('data-hash-src');
    if (imgEl.getAttribute('data-hydrated') === hash) return; // already loaded, skip
    resolveImageRef(hash).then(function(src){
      var container = imgEl.closest('.mcq-image-thumb,.qimage-thumb');
      if (src) {
        imgEl.src = src;
        imgEl.setAttribute('data-hydrated', hash);
        if (container) container.classList.remove('broken'); /* clear a stale broken-mark from an earlier attempt that failed only because the image-URL map hadn't finished loading yet — the reference itself was never actually lost, this is what resolved it just now */
      } else if (container) {
        container.classList.add('broken');
      }
    });
  });
}

/* ---------------- Image assignment (Edit modal) ---------------- */
function renderMcqImageGrid(m, field, gridElId){
  field = field || 'images';
  var grid = document.getElementById(gridElId || 'mcqImageGrid');
  if (!grid) return;
  var imgs = m[field] || [];
  var html = imgs.map(function(hash){
    return '<div class="mcq-image-thumb">' +
      '<img data-hash-src="' + escapeHtml(hash) + '" data-action="view-mcq-image" data-hash="' + escapeHtml(hash) + '" alt="">' +
      '<button class="mcq-image-remove-btn" data-action="remove-mcq-image" data-id="' + escapeHtml(m.id) + '" data-hash="' + escapeHtml(hash) + '" data-field="' + field + '" title="Remove image" aria-label="Remove image">' + icon('x',12) + '</button>' +
      '</div>';
  }).join('');
  html += '<button class="mcq-image-add-tile" data-action="add-mcq-image" data-id="' + escapeHtml(m.id) + '" data-field="' + field + '">' + icon('upload',18) + '<span>Add image</span></button>';
  grid.innerHTML = html;
  hydrateImages();
}
async function attachImageToMcq(mcqId, file, field){
  field = field || 'images';
  if (!file || file.type.indexOf('image/') !== 0) { showToast('That file isn\'t an image.'); return; }
  var m = state.mcqs.find(function(x){ return x.id === mcqId; });
  if (!m) return;
  showToast('Uploading image…');
  try {
    var hash = await storeImageFromFile(file);
    if (!m[field]) m[field] = [];
    if (m[field].indexOf(hash) === -1) m[field].push(hash);
    renderMcqImageGrid(m, field, field === 'answerImages' ? 'mcqAnswerImageGrid' : 'mcqImageGrid');
    showToast('Image added.');
    saveLibrary();
  } catch(err) {
    console.error('attachImageToMcq:', err);
    showToast('Could not add that image.');
  }
}
/* Book shelf cover images — a one-off file pick doesn't need a persistent hidden
   input in the page markup like the Edit modal's image sections do (those get
   reopened repeatedly for the same question); a temporary input created, clicked,
   and left to be garbage-collected is simpler here since this only ever fires once
   per click. */
function setBookCover(sourceName){
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.addEventListener('change', function(e){
    var file = e.target.files && e.target.files[0];
    if (file) attachBookCover(sourceName, file);
  });
  input.click();
}
async function attachBookCover(sourceName, file){
  if (!file || file.type.indexOf('image/') !== 0) { showToast('That file isn\'t an image.'); return; }
  showToast('Uploading cover…');
  try {
    var hash = await storeImageFromFile(file);
    if (!state.sources[sourceName]) state.sources[sourceName] = { color: colorForSource(sourceName) };
    state.sources[sourceName].coverImage = hash;
    render();
    showToast('Cover updated.');
    saveSources();
  } catch(err) {
    console.error('attachBookCover:', err);
    showToast('Could not set that cover.');
  }
}

async function openImageLightbox(hash){
  var src = await resolveImageRef(hash);
  if (!src) { showToast('Could not load that image.'); return; }
  var root = document.getElementById('modalRoot');
  root.innerHTML = '<div class="image-lightbox" data-action="close-lightbox">' +
    '<button class="modal-close-btn image-lightbox-close" data-action="close-lightbox" title="Close" aria-label="Close">' + icon('x',20) + '</button>' +
    '<img src="' + src + '" alt="">' +
    '</div>';
  state.activeModal = 'lightbox';
}

/* ---------------- Notes (the user's own annotations, distinct from the answer key) ----------------
   A running log, not a single editable note — each entry is its own timestamped
   text+images pair, so annotating the same question again after a later attempt adds
   to the record rather than overwriting what you thought last time. Entries are
   add/delete only, deliberately not editable after the fact, to keep that log-not-
   document framing honest. */
function renderNotesSection(mcq){
  var notes = mcq.notes || [];
  var html = '<div class="notes-section">';
  html += '<div class="notes-header"><span>' + icon('notes',13) + ' Your notes' + (notes.length ? ' (' + notes.length + ')' : '') + '</span>' +
    '<button class="link-btn" data-action="open-add-note" data-id="' + escapeHtml(mcq.id) + '">+ Add a note</button></div>';
  if (notes.length) {
    notes.slice().reverse().forEach(function(n){
      html += '<div class="note-entry">' +
        '<div class="note-entry-head"><span class="note-entry-date">' + escapeHtml(new Date(n.createdAt).toLocaleString()) + '</span>' +
        '<button class="mcq-icon-btn" data-action="delete-note" data-id="' + escapeHtml(mcq.id) + '" data-note-id="' + escapeHtml(n.id) + '" title="Delete note" aria-label="Delete note">' + icon('x',12) + '</button></div>' +
        (n.text ? '<div class="note-entry-text">' + renderContent(n.text) + '</div>' : '') +
        (n.images && n.images.length ? '<div class="qimage-grid">' + n.images.map(function(hash){
          return '<div class="qimage-thumb"><img data-hash-src="' + escapeHtml(hash) + '" data-action="view-mcq-image" data-hash="' + escapeHtml(hash) + '" alt=""></div>';
        }).join('') + '</div>' : '') +
        '</div>';
    });
  }
  html += '</div>';
  return html;
}
function openAddNoteModal(mcqId){
  var m = state.mcqs.find(function(x){ return x.id === mcqId; });
  if (!m) return;
  state.pendingNoteDraft = { mcqId: mcqId, images: [] };
  var html = '<h3>Add a note</h3>';
  var noteQText = questionDisplayText(m);
  html += '<p class="view-sub" style="margin-bottom:12px;">' + escapeHtml(noteQText.replace(/\n/g,' ').slice(0,100)) + (noteQText.length > 100 ? '…' : '') + '</p>';
  html += '<div class="form-field"><textarea id="noteTextInput" rows="4" placeholder="A mnemonic, a correction, a clearer explanation than the one given — anything you want next time."></textarea></div>';
  html += '<div class="form-field"><label>Images (optional)</label>' +
    '<div class="mcq-image-grid" id="noteImageGrid"></div>' +
    '<input type="file" id="noteImageFileInput" accept="image/*" multiple style="display:none">' +
    '</div>';
  html += '<div class="action-row" style="margin-top:6px;margin-bottom:0;">' +
    '<button class="btn btn-primary" data-action="save-note" data-id="' + escapeHtml(mcqId) + '">Save note</button>' +
    '<button class="btn btn-ghost" data-action="cancel-add-note">Cancel</button></div>';
  showRichModal(html, 'narrow');
  renderNoteDraftImageGrid();
  var fi = document.getElementById('noteImageFileInput');
  if (fi) {
    fi.addEventListener('change', function(e){
      Array.prototype.slice.call(e.target.files || []).forEach(function(f){ attachImageToNoteDraft(f); });
      e.target.value = '';
    });
  }
}
function renderNoteDraftImageGrid(){
  var grid = document.getElementById('noteImageGrid');
  if (!grid || !state.pendingNoteDraft) return;
  var imgs = state.pendingNoteDraft.images;
  var html = imgs.map(function(hash){
    return '<div class="mcq-image-thumb">' +
      '<img data-hash-src="' + escapeHtml(hash) + '" data-action="view-mcq-image" data-hash="' + escapeHtml(hash) + '" alt="">' +
      '<button class="mcq-image-remove-btn" data-action="remove-note-draft-image" data-hash="' + escapeHtml(hash) + '" title="Remove image" aria-label="Remove image">' + icon('x',12) + '</button>' +
      '</div>';
  }).join('');
  html += '<button class="mcq-image-add-tile" data-action="add-note-draft-image">' + icon('upload',18) + '<span>Add image</span></button>';
  grid.innerHTML = html;
  hydrateImages();
}
async function attachImageToNoteDraft(file){
  if (!file || file.type.indexOf('image/') !== 0 || !state.pendingNoteDraft) { showToast('That file isn\'t an image.'); return; }
  showToast('Uploading image…');
  try {
    var hash = await storeImageFromFile(file);
    if (state.pendingNoteDraft.images.indexOf(hash) === -1) state.pendingNoteDraft.images.push(hash);
    renderNoteDraftImageGrid();
    showToast('Image added.');
  } catch(err) {
    console.error('attachImageToNoteDraft:', err);
    showToast('Could not add that image.');
  }
}

/* ---------------- Settings modal ---------------- */
function openSettingsModal(){
  state.activeModal = 'settings';
  renderSettingsModalContent();
}
function renderSettingsModalContent(){
  var html = '<div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:16px;">' +
    '<h3 style="margin-bottom:0;">Settings</h3>' +
    '<button class="modal-close-btn" data-action="close-modal" title="Close" aria-label="Close">' + icon('x',18) + '</button>' +
    '</div>';

  var acct = userDisplayInfo(state.currentUser);
  html += '<div class="settings-account">' +
    (acct.avatarUrl
      ? '<img class="settings-avatar" src="' + escapeHtml(acct.avatarUrl) + '" alt="" style="object-fit:cover;">'
      : '<div class="settings-avatar">' + escapeHtml(acct.initials) + '</div>') +
    '<div class="settings-account-info">' +
      '<div class="settings-account-name">' + escapeHtml(acct.name) + '</div>' +
      '<div class="settings-account-email">' + escapeHtml(acct.email) + '</div>' +
      '<span class="settings-account-tag">Google Account</span>' +
    '</div>' +
    '<button class="btn btn-ghost btn-sm" data-action="sign-out">Sign out</button>' +
    '</div>';

  html += '<div class="settings-section"><h4>Your data</h4>' +
    '<div class="data-btn-row">' +
      '<button class="data-btn primary" data-action="export-library">' + icon('download',15) + ' Export library</button>' +
    '</div>' +
    '<div class="settings-row" style="margin-top:10px;"><span>' + icon('trash-2',14) + ' Trash</span>' +
      '<button class="btn btn-ghost btn-sm" data-action="set-view" data-view="trash">' + trashedMcqs().length + ' item' + (trashedMcqs().length===1?'':'s') + ' — view</button></div>' +
    '<div class="view-sub" style="margin-top:8px;margin-bottom:0;">Your library syncs to your account automatically — export is just for keeping an offline backup, or moving questions somewhere else on purpose. This exports everything; for just one subject or filtered set, use "Export this view" in the Library screen instead. Importing a backup file now lives on the Add Source screen.</div>' +
    '</div>';

  html += '<div class="settings-section"><h4>Progress</h4>' +
    '<div class="settings-row"><span class="icon-inline">' + icon('flame',14) + ' Current streak</span><strong>' + (state.streak.count||0) + ' day' + (state.streak.count===1?'':'s') + '</strong></div>' +
    '<div class="settings-row"><span>Questions tracked</span><strong>' + state.mcqs.length + '</strong></div>' +
    '</div>';

  html += '<div class="settings-section" style="margin-bottom:0;"><h4>Appearance &amp; scheduling</h4>' +
    '<div class="settings-row"><span>Dark mode</span>' +
      '<span class="settings-toggle' + (state.darkMode?' on':'') + '" data-action="toggle-dark-mode" role="switch" aria-checked="' + (state.darkMode?'true':'false') + '"><span class="settings-toggle-track"></span><span class="settings-toggle-thumb"></span></span></div>' +
    '<div class="settings-row"><span>FSRS mode</span>' +
      '<span class="settings-toggle' + (state.learningMode.enabled?' on':'') + '" data-action="toggle-fsrs-mode" role="switch" aria-checked="' + (state.learningMode.enabled?'true':'false') + '"><span class="settings-toggle-track"></span><span class="settings-toggle-thumb"></span></span></div>' +
    '<div class="settings-row"><span>Auto-sleep a question after it\'s right N times in a row</span>' +
      '<span class="settings-toggle' + (state.autoSleepEnabled?' on':'') + '" data-action="toggle-auto-sleep" role="switch" aria-checked="' + (state.autoSleepEnabled?'true':'false') + '"><span class="settings-toggle-track"></span><span class="settings-toggle-thumb"></span></span></div>' +
    (state.autoSleepEnabled ? '<div class="settings-row"><span>Streak needed (N)</span>' +
      '<input type="number" min="2" max="15" id="autoSleepStreakInput" value="' + state.autoSleepStreak + '" data-action="set-auto-sleep-streak" style="width:56px;padding:5px 8px;border:1px solid var(--rule-strong);border-radius:6px;background:var(--card);color:var(--ink);font-size:13px;text-align:center;"></div>' : '') +
    '<div class="settings-row" style="border-bottom:none;flex-direction:column;align-items:stretch;gap:8px;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;"><span>Re-schedule library with the current rules</span>' +
      '<button class="btn btn-ghost btn-sm" data-action="recompute-due-dates">' + icon('refresh-cw',13) + ' Run</button></div>' +
      '<div class="view-sub" style="margin-bottom:0;">Fixes due dates on questions scheduled before a recent scheduling fix. Doesn\'t touch your answer history, only recomputes when things are due — safe to run anytime.</div>' +
    '</div>' +
    '</div>';

  showRichModal(html);
  var streakInput = document.getElementById('autoSleepStreakInput');
  if (streakInput) {
    streakInput.addEventListener('change', function(e){
      var n = parseInt(e.target.value, 10);
      if (!n || n < 2) n = 2;
      if (n > 15) n = 15;
      state.autoSleepStreak = n;
      saveAutoSleepSettings();
      renderSettingsModalContent();
    });
  }
}

/* ---------------- Question history modal ---------------- */
function formatDurationMs(ms){
  if (typeof ms !== 'number' || ms < 0) return null;
  var s = Math.round(ms/1000);
  if (s < 60) return s + 's';
  var m = Math.floor(s/60); var rem = s % 60;
  return m + 'm' + (rem ? ' ' + rem + 's' : '');
}
function openHistoryModal(id){
  var m = state.mcqs.find(function(x){ return x.id === id; });
  if (!m) return;
  var fs = (m.learning && m.learning.fsrs) || null;
  var cls = getLearningState(m);
  var histQText = questionDisplayText(m);
  var snippet = histQText.replace(/\n/g,' ').slice(0, 140) + (histQText.length > 140 ? '…' : '');

  var html = '<h3>Review history</h3>';
  html += '<p style="margin-bottom:14px;">' + escapeHtml(snippet) + (m.asleep ? ' <span class="sleep-badge">Asleep</span>' : '') + '</p>';
  html += '<div class="fsrs-stat-grid">' +
    '<div><div class="stat-num">' + (fs ? (Math.round(fs.stability*10)/10) : '–') + '</div><div class="stat-label">Stability (d)</div></div>' +
    '<div><div class="stat-num">' + (fs ? (Math.round(fs.difficulty*10)/10) : '–') + '</div><div class="stat-label">Difficulty</div></div>' +
    '<div><div class="stat-num">' + (fs ? fs.reps : 0) + '</div><div class="stat-label">Reviews</div></div>' +
    '</div>';
  html += '<div class="view-sub" style="margin-bottom:10px;">Current state: <strong>' + escapeHtml(cls) + '</strong>' +
    (m.asleep ? ' · asleep — excluded from FSRS review and Start Practice' : (m.learning.due ? ' · next due ' + escapeHtml(new Date(m.learning.due).toLocaleString()) : '')) + '</div>';

  var hist = (m.learning.history || []).slice().reverse();
  if (!hist.length) {
    html += '<div class="view-sub">No attempts recorded yet.</div>';
  } else {
    var ratingLabels = {1:'Again',2:'Hard',3:'Good',4:'Easy'};
    html += '<div>';
    hist.forEach(function(h){
      var label = ratingLabels[h.rating];
      var answerDur = formatDurationMs(h.timeToAnswerMs);
      var explainDur = formatDurationMs(h.timeOnExplanationMs);
      html += '<div class="history-item"><div>' +
        '<span>' + escapeHtml(new Date(h.ts).toLocaleString()) + (label ? ' · ' + label : '') + '</span>' +
        (answerDur || explainDur ? '<div class="history-timing">' +
          (answerDur ? icon('clock',10) + ' ' + answerDur + ' to answer' : '') +
          (answerDur && explainDur ? ' · ' : '') +
          (explainDur ? explainDur + ' on explanation' : '') +
          '</div>' : '') +
        (h.remarks && h.remarks.length ? '<div class="history-remarks">' + h.remarks.map(function(r){ return '<span class="remark-pill">' + escapeHtml(r) + '</span>'; }).join('') + '</div>' : '') +
        '</div>' +
        '<span class="history-verdict ' + (h.correct ? 'correct' : 'wrong') + '">' + (h.correct ? 'Correct' : 'Wrong') + '</span></div>';
    });
    html += '</div>';
  }
  html += '<div class="action-row" style="margin-top:16px;margin-bottom:0;"><button class="btn btn-ghost" data-action="close-modal">Close</button></div>';
  showRichModal(html);
}

/* ---------------- Deck (subject/chapter) context menu & modals ---------------- */
function openDeckMenu(pathKey){
  var pathArr = pathKey.split('␟');
  var tree = buildTree();
  var deckNode = getNodeByPath(tree, pathArr);
  var name = deckNode ? deckNode.name : pathArr[pathArr.length-1];
  var html = '<div class="deck-menu">';
  html += '<button class="deck-menu-item" data-action="deck-rename" data-path="' + escapeHtml(pathKey) + '">' + icon('pencil',17) + ' Rename</button>';
  html += '<button class="deck-menu-item" data-action="deck-move" data-path="' + escapeHtml(pathKey) + '">' + icon('corner-up-right',17) + ' Move to…</button>';
  html += '<button class="deck-menu-item" data-action="deck-copy" data-path="' + escapeHtml(pathKey) + '">' + icon('copy',17) + ' Copy</button>';
  html += '<button class="deck-menu-item" data-action="deck-cut" data-path="' + escapeHtml(pathKey) + '">' + icon('scissors',17) + ' Cut</button>';
  html += '<div class="deck-menu-divider"></div>';
  html += '<button class="deck-menu-item" data-action="open-new-folder" data-path="' + escapeHtml(pathKey) + '">' + icon('folder-plus',17) + ' New sub-folder here</button>';
  html += '<div class="deck-menu-divider"></div>';
  html += '<button class="deck-menu-item danger" data-action="deck-delete" data-path="' + escapeHtml(pathKey) + '">' + icon('trash-2',17) + ' Delete</button>';
  html += '</div>';
  showRichModal(html, 'narrow');
}

function openRenameDeckModal(pathKey){
  var pathArr = pathKey.split('␟');
  var currentName = pathArr[pathArr.length-1];
  var html = '<h3>Rename</h3>';
  html += '<div class="form-field"><label>New name</label><input type="text" id="renameDeckInput" value="' + escapeHtml(currentName) + '"></div>';
  html += '<div class="action-row" style="margin-top:6px;margin-bottom:0;">' +
    '<button class="btn btn-primary" data-action="confirm-rename-deck" data-path="' + escapeHtml(pathKey) + '">Save</button>' +
    '<button class="btn btn-ghost" data-action="close-modal">Cancel</button></div>';
  showRichModal(html);
  var input = document.getElementById('renameDeckInput');
  if (input) { input.focus(); input.select(); }
}

/* Folders are otherwise entirely implied by which subject/chapterPath actual
   questions carry — there's no way to make one exist with nothing in it yet without
   this. Root call (no parentPathKey) creates a new top-level subject; called from a
   deck's own menu, it creates a sub-folder nested under that deck instead. */
function openNewFolderModal(parentPathKey){
  var isNested = !!parentPathKey;
  var html = '<h3>' + (isNested ? 'New sub-folder' : 'New subject') + '</h3>';
  if (isNested) {
    var parentName = parentPathKey.split('␟').pop();
    html += '<p class="view-sub" style="margin-bottom:12px;">Inside "' + escapeHtml(parentName) + '"</p>';
  }
  html += '<div class="form-field"><label>Name</label><input type="text" id="newFolderInput" placeholder="e.g. ' + (isNested ? 'Sterilization and Disinfection' : 'Pharmacology') + '"></div>';
  html += '<div class="action-row" style="margin-top:6px;margin-bottom:0;">' +
    '<button class="btn btn-primary" data-action="confirm-new-folder" data-parent="' + escapeHtml(parentPathKey || '') + '">Create</button>' +
    '<button class="btn btn-ghost" data-action="close-modal">Cancel</button></div>';
  showRichModal(html, 'narrow');
  var input = document.getElementById('newFolderInput');
  if (input) input.focus();
}

/* Every node in the tree, at every depth, as a flat list of {path, depth} — used to
   populate the "Move to..." destination picker with real nested folders, not just
   top-level subjects. Excludes the deck being moved and anything nested inside it
   (can't move a folder into its own child), matching the same isPathWithinOrEqual
   check confirm-move-deck itself already uses at the point of actually moving it. */
function flattenTreePaths(tree, excludePathArr){
  var out = [];
  function walk(node, path, depth){
    if (excludePathArr && isPathWithinOrEqual(path, excludePathArr)) return; // this node (or anything under it) isn't a valid destination
    out.push({ path: path.slice(), depth: depth });
    Object.keys(node.children).sort().forEach(function(k){
      walk(node.children[k], path.concat([k]), depth + 1);
    });
  }
  Object.keys(tree).sort().forEach(function(s){ walk(tree[s], [s], 0); });
  return out;
}
function openMoveDeckModal(pathKey){
  var pathArr = pathKey.split('␟');
  var currentName = pathArr[pathArr.length-1];
  var tree = buildTree();
  var destinations = flattenTreePaths(tree, pathArr);
  var isNested = pathArr.length > 1;
  var html = '<h3>Move "' + escapeHtml(currentName) + '" to…</h3>';
  html += '<p>It\'ll become a chapter under whichever folder you pick, keeping anything nested inside it.</p>';
  html += '<div class="form-field"><label>Destination</label><select id="moveDeckSelect" style="width:100%;padding:8px 10px;border:1px solid var(--rule-strong);border-radius:6px;background:var(--card);color:var(--ink);font-size:13.5px;">' +
    '<option value="">— choose —</option>' +
    (isNested ? '<option value="__LIBRARY_ROOT__">Library (make it a top-level subject)</option>' : '') +
    destinations.map(function(d){
      var key = d.path.join('␟');
      var indent = '\u00A0\u00A0\u00A0\u00A0'.repeat(d.depth); // non-breaking spaces — <option> text collapses regular spaces
      var label = indent + (d.depth ? '↳ ' : '') + d.path[d.path.length-1];
      return '<option value="' + escapeHtml(key) + '">' + escapeHtml(label) + '</option>';
    }).join('') +
    '</select></div>';
  html += '<div class="form-field"><label>Or type a new subject</label><input type="text" id="moveDeckNewInput" placeholder="New subject name"></div>';
  html += '<div class="action-row" style="margin-top:6px;margin-bottom:0;">' +
    '<button class="btn btn-primary" data-action="confirm-move-deck" data-path="' + escapeHtml(pathKey) + '">Move</button>' +
    '<button class="btn btn-ghost" data-action="close-modal">Cancel</button></div>';
  showRichModal(html);
}

function openDeleteDeckModal(pathKey){
  var pathArr = pathKey.split('␟');
  var currentName = pathArr[pathArr.length-1];
  var count = mcqsUnderPath(pathArr).length;
  showModal(
    'Delete "' + currentName + '"?',
    'This permanently removes ' + count + ' question' + (count===1?'':'s') + ' — including everything nested inside it. This can\'t be undone.',
    [{label:'Delete', action:'confirm-delete-deck', primary:true},{label:'Cancel', action:'close-modal'}]
  );
  /* stash which deck a confirm click applies to, since showModal's buttons don't carry data attributes */
  state.pendingDeckDelete = pathKey;
}

/* ---------------- Edit MCQ modal ---------------- */
function openEditModal(id){
  var m = state.mcqs.find(function(x){ return x.id === id; });
  if (!m) return;
  /* This modal was built for the standard question shape (question/options/answer) and
     has no fields for pairs/steps/range/letters — editing one of the 4 newer types here
     would show an empty "Question" box (m.question is genuinely undefined for these —
     they use m.stem) and, worse, SAVING would silently write a stray m.question field
     onto the object while never touching the real content (m.pairs, m.steps_correct_order,
     etc), corrupting nothing visibly but fixing nothing either. Honest "not supported
     yet" beats a form that looks like it works and doesn't. */
  if (m.type === 'match' || m.type === 'sequence' || m.type === 'cutoff' || m.type === 'mnemonic') {
    var html2 = '<h3>Edit question</h3>';
    html2 += '<p class="view-sub" style="margin-bottom:14px;">Editing ' + escapeHtml(m.type) + ' questions isn\'t supported in this view yet — this editor only knows the standard question/options/answer shape. For now, delete this question and re-paste a corrected version through Add Source.</p>';
    html2 += '<div class="action-row" style="margin-bottom:0;"><button class="btn btn-ghost" data-action="close-modal">Close</button></div>';
    showRichModal(html2, 'narrow');
    return;
  }
  var html = '<h3>Edit question</h3>';
  html += '<div class="form-field"><label>Question</label><textarea id="editQuestion" rows="4">' + escapeHtml(m.question) + '</textarea></div>';
  if (m.passage) {
    html += '<div class="form-field"><label>Passage</label><textarea id="editPassage" rows="3">' + escapeHtml(m.passage) + '</textarea></div>';
  }
  if (m.isShortAnswer) {
    html += '<div class="form-field"><label>Answer</label><input type="text" id="editShortAnswer" value="' + escapeHtml(m.answer[0]||'') + '"></div>';
  } else {
    html += '<div class="form-field"><label>Options — check the correct one(s)</label>';
    m.options.forEach(function(opt){
      var checked = m.answer.indexOf(opt.letter) !== -1;
      html += '<div class="option-edit-row"><span class="opt-letter">' + escapeHtml(opt.letter) + '</span>' +
        '<input type="text" class="edit-option-text" data-letter="' + escapeHtml(opt.letter) + '" value="' + escapeHtml(opt.text) + '" style="flex:1;padding:6px 8px;border:1px solid var(--rule-strong);border-radius:6px;background:var(--card);color:var(--ink);font-size:13px;">' +
        '<label><input type="checkbox" class="edit-option-correct" data-letter="' + escapeHtml(opt.letter) + '" ' + (checked?'checked':'') + '> correct</label></div>';
    });
    html += '</div>';
  }
  html += '<div class="form-field"><label>Explanation</label><textarea id="editExplanation" rows="3">' + escapeHtml(m.explanation||'') + '</textarea></div>';
  html += '<div class="form-field"><label>Question images</label>' +
    '<div class="mcq-image-grid" id="mcqImageGrid"></div>' +
    '<input type="file" id="mcqImageFileInput" accept="image/*" multiple style="display:none">' +
    '<div class="view-sub" style="margin-top:6px;">Shown alongside the question. Click "Add image" to upload, or paste (Ctrl/Cmd+V) a screenshot while this window is open.</div>' +
    '</div>';
  html += '<div class="form-field"><label>Answer / explanation images</label>' +
    '<div class="mcq-image-grid" id="mcqAnswerImageGrid"></div>' +
    '<input type="file" id="mcqAnswerImageFileInput" accept="image/*" multiple style="display:none">' +
    '<div class="view-sub" style="margin-top:6px;">Shown after reveal, alongside the explanation.</div>' +
    '</div>';
  html += '<div class="form-field">' + renderNotesSection(m) + '</div>';
  html += '<div class="form-field"><label>Subject</label><input type="text" id="editSubject" value="' + escapeHtml(m.subject||'') + '"></div>';
  html += '<div class="form-field"><label>Chapter path (use &gt; to separate levels)</label><input type="text" id="editChapter" value="' + escapeHtml((m.chapterPath||[]).join(' > ')) + '"></div>';
  html += '<div class="form-field"><label>Tags (comma-separated)</label><input type="text" id="editTags" value="' + escapeHtml((m.tags||[]).join(', ')) + '"></div>';
  html += '<div class="action-row" style="margin-top:6px;margin-bottom:0;">' +
    '<button class="btn btn-primary" data-action="save-edit-mcq" data-id="' + m.id + '">Save changes</button>' +
    '<button class="btn btn-ghost" data-action="close-modal">Cancel</button></div>';
  showRichModal(html);
  state.editingMcqId = id;
  renderMcqImageGrid(m, 'images', 'mcqImageGrid');
  renderMcqImageGrid(m, 'answerImages', 'mcqAnswerImageGrid');
  var fileInput = document.getElementById('mcqImageFileInput');
  if (fileInput) {
    fileInput.addEventListener('change', function(e){
      Array.prototype.slice.call(e.target.files || []).forEach(function(f){ attachImageToMcq(id, f, 'images'); });
      e.target.value = '';
    });
  }
  var answerFileInput = document.getElementById('mcqAnswerImageFileInput');
  if (answerFileInput) {
    answerFileInput.addEventListener('change', function(e){
      Array.prototype.slice.call(e.target.files || []).forEach(function(f){ attachImageToMcq(id, f, 'answerImages'); });
      e.target.value = '';
    });
  }
}
async function saveEditMcq(id){
  var m = state.mcqs.find(function(x){ return x.id === id; });
  if (!m) return;
  var qEl = document.getElementById('editQuestion');
  if (qEl) m.question = qEl.value.trim();
  var pEl = document.getElementById('editPassage');
  if (pEl) m.passage = pEl.value.trim() || null;
  if (m.isShortAnswer) {
    var saEl = document.getElementById('editShortAnswer');
    if (saEl) m.answer = [saEl.value.trim()];
  } else {
    var texts = document.querySelectorAll('.edit-option-text');
    var corrects = document.querySelectorAll('.edit-option-correct');
    var newOptions = [];
    texts.forEach(function(inp){ newOptions.push({ letter: inp.getAttribute('data-letter'), text: inp.value.trim() }); });
    var newAnswer = [];
    corrects.forEach(function(cb){ if (cb.checked) newAnswer.push(cb.getAttribute('data-letter')); });
    m.options = newOptions;
    if (newAnswer.length) m.answer = newAnswer;
  }
  var expEl = document.getElementById('editExplanation');
  if (expEl) m.explanation = expEl.value.trim();
  var subjEl = document.getElementById('editSubject');
  if (subjEl) m.subject = subjEl.value.trim() || 'Unsorted';
  var chEl = document.getElementById('editChapter');
  if (chEl) m.chapterPath = chEl.value.split('>').map(function(s){return s.trim();}).filter(Boolean);
  if (!m.chapterPath.length) m.chapterPath = ['Unsorted'];
  var tagsEl = document.getElementById('editTags');
  if (tagsEl) m.tags = tagsEl.value.split(',').map(function(s){return s.trim();}).filter(Boolean);
  closeModal();
  render();
  await saveLibrary(); /* awaited — same reasoning as the deck operations above */
  showToast('Question updated.');
}

function currentSessionSnapshot(){ return state.session ? JSON.parse(JSON.stringify(state.session)) : null; }
function requestStartPractice(ids, learningEnabled){
  if (state.pausedSession) {
    state.pendingStart={ids:ids.slice(), learningEnabled:learningEnabled};
    showModal('Paused test in progress','You still have an unfinished paused test. Return to it, or continue with the new test. Your previous answers and learning data are already saved.',[{label:'Back to paused test',action:'resume-paused',primary:true},{label:'Continue with new test',action:'confirm-new-test'}]);
    return;
  }
  state.learningMode.enabled=learningEnabled;
  startPractice(ids);
}
function requestLeavePractice(){
  showModal('Leave this test?','Choose whether to pause this test at its current question or leave without saving the test session. Answers you already revealed remain recorded.',[{label:'Pause & leave',action:'pause-and-leave',primary:true},{label:'Leave without pausing',action:'leave-without-pausing'},{label:'Cancel',action:'close-modal'}]);
}
/* True whenever an in-progress practice session is on screen — used to gate any sidebar
   navigation (which stays visible/clickable during practice) so it can't silently
   abandon an active test without offering to pause it first. */
function isMidSession(){ return state.view === 'practice' && !!state.session; }
/* Call at the top of a navigation action's handler. If a session is active, it stashes
   what the user was trying to do, pops the leave-practice modal, and returns true so
   the caller can bail out instead of navigating immediately. */
function guardNavigation(action, el){
  if (!isMidSession()) return false;
  state.pendingNav = { action: action, view: el.getAttribute('data-view'), path: el.getAttribute('data-path') };
  requestLeavePractice();
  return true;
}
/* Chapter 4 (MPA): building the return URL for wherever the person was trying to go
   before requestLeavePractice()'s modal interrupted them. Previously this just set
   state.view in memory; now practice.html and library.html are different documents,
   so "where they were headed" has to survive an actual navigation — encoded as a
   query string that library.html's own boot reads once on load (see the boot script
   in library.html) to restore the same view/path this used to set directly. */
function pendingNavTargetUrl(){
  var nav = state.pendingNav;
  state.pendingNav = null;
  if (!nav) return 'library.html';
  if (nav.action === 'set-view') return 'library.html?view=' + encodeURIComponent(nav.view || 'browse');
  if (nav.action === 'open-dashboard') return 'library.html?view=dashboard';
  if (nav.action === 'select-node' && nav.path) return 'library.html?view=browse&path=' + encodeURIComponent(nav.path);
  return 'library.html';
}
function bookmarkButton(m){
  return '<button class="btn btn-ghost btn-sm bookmark-btn'+(m.flagged?' bookmarked':'')+'" data-action="bookmark-current" title="Bookmark question (F)" aria-label="'+(m.flagged?'Remove bookmark':'Bookmark question')+'"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4V3z"></path></svg><span>'+(m.flagged?'Bookmarked':'Bookmark')+'</span></button>';
}
