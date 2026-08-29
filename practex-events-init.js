/* practex-events-init.js — extracted from Practex's index.html, Chapter 2 file split.
   Loaded via <script src> in fixed order; the original enclosing IIFE has been
   removed so these files share one global scope, same as the original single
   inline <script> block did internally. Order matters: this file must load
   after every file before it in the list, and before every file after it. */
/* ---------------- Events ---------------- */
function bindEvents(){
  var statusSel = document.querySelector('[data-action="set-status-filter"]');
  if (statusSel) statusSel.addEventListener('change', function(e){ state.filters.status = e.target.value; render(); });
  var searchInput = document.getElementById('globalSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', function(e){
      state.filters.search = e.target.value;
      var cursorPos = e.target.selectionStart;
      render();
      var newInput = document.getElementById('globalSearchInput');
      if (newInput) { newInput.focus(); newInput.setSelectionRange(cursorPos, cursorPos); }
    });
  }

  /* Gate screen's custom time input — two 2-digit segments, typing the 2nd digit of
     minutes auto-advances into seconds (a plain HTML input can't do that on its own,
     hence the manual focus juggling here rather than just letting the browser handle
     it, same reasoning as globalSearchInput above). */
  var gateMm = document.getElementById('gateMmInput');
  var gateSs = document.getElementById('gateSsInput');
  function commitGateTime(focusTarget, cursorPos){
    var s = state.session;
    if (!s) return;
    var mmVal = parseInt((document.getElementById('gateMmInput')||{}).value || '0', 10) || 0;
    var ssVal = parseInt((document.getElementById('gateSsInput')||{}).value || '0', 10) || 0;
    var total = mmVal * 60 + ssVal;
    if (total > 0) {
      s.timePerQ = total;
      try { localStorage.setItem('practex_time_per_q', String(total)); } catch(e) {}
    }
    render();
    var el = document.getElementById(focusTarget);
    if (el) { el.focus(); if (typeof cursorPos === 'number') el.setSelectionRange(cursorPos, cursorPos); }
  }
  if (gateMm) {
    gateMm.addEventListener('input', function(e){
      var digits = e.target.value.replace(/[^0-9]/g, '').slice(0, 2);
      e.target.value = digits;
      var advance = digits.length === 2; /* 2 digits typed — hand off to seconds, matching a normal OTP-style time input */
      commitGateTime(advance ? 'gateSsInput' : 'gateMmInput', advance ? 0 : digits.length);
    });
  }
  if (gateSs) {
    gateSs.addEventListener('input', function(e){
      var digits = e.target.value.replace(/[^0-9]/g, '').slice(0, 2);
      if (parseInt(digits || '0', 10) > 59) digits = '59';
      e.target.value = digits;
      commitGateTime('gateSsInput', digits.length);
    });
    gateSs.addEventListener('keydown', function(e){
      if (e.key === 'Backspace' && !e.target.value) {
        var mmEl = document.getElementById('gateMmInput');
        if (mmEl) { mmEl.focus(); mmEl.setSelectionRange(mmEl.value.length, mmEl.value.length); }
      }
    });
  }
}

async function onClick(e){
  var el = e.target.closest('[data-action]');
  if (!el) return;
  var action = el.getAttribute('data-action');

  if (action === 'toggle-sidebar') { state.sidebarOpen = !state.sidebarOpen; render(); return; }
  if (action === 'manual-sync') { manualSync(); return; }
  if (action === 'set-view') { if (guardNavigation(action, el)) return; closeModal(); state.view = el.getAttribute('data-view'); state.sidebarOpen = false; render(); return; }
  if (action === 'open-dashboard') { if (guardNavigation(action, el)) return; closeModal(); state.view = 'dashboard'; state.sidebarOpen = false; render(); return; }
  if (action === 'set-landing-view') {
    var landingVal = el.getAttribute('data-value');
    try { localStorage.setItem('practex_landing_view', landingVal); } catch(e) {}
    render(); /* refreshes the Settings modal's own button highlight, same hook every other setting toggle already relies on */
    showToast('Practex will now open to ' + (landingVal === 'bookshelf' ? 'Book Shelf' : 'Library') + '.');
    return;
  }
  if (action === 'toggle-fsrs-mode') {
    state.learningMode.enabled = !state.learningMode.enabled;
    saveFsrsMode();
    showToast('FSRS Mode ' + (state.learningMode.enabled ? 'enabled' : 'disabled'));
    render();
    return;
  }
  if (action === 'toggle-skull-mode') {
    state.skullModeActive = !state.skullModeActive;
    try { localStorage.setItem('practex_skull_mode', state.skullModeActive ? '1' : '0'); } catch(e) {}
    showToast(state.skullModeActive ? '💀 Skull Mode — showing only the questions you\'ve marked for extra practice.' : 'Skull Mode off — back to the full library.');
    render();
    return;
  }
  if (action === 'toggle-auto-sleep') {
    state.autoSleepEnabled = !state.autoSleepEnabled;
    saveAutoSleepSettings();
    render();
    return;
  }
  if (action === 'recompute-due-dates') {
    var changedCount = recomputeAllDueDates();
    showToast(changedCount ? changedCount + ' question' + (changedCount===1?'':'s') + ' re-scheduled with the current rules.' : 'Nothing to change — everything\'s already scheduled with the current rules.');
    render();
    saveLibrary();
    return;
  }
  if (action === 'cleanup-duplicates') { await cleanupDuplicates(); return; }
  if (action === 'open-plan-setup') { openPlanSetupModal(el.getAttribute('data-scope-type'), el.getAttribute('data-scope-value')); return; }
  if (action === 'confirm-create-plan') {
    var planDaysEl = document.getElementById('planDaysInput');
    var planDays = planDaysEl ? parseInt(planDaysEl.value, 10) : NaN;
    if (!planDays || planDays < 1) { showToast('Enter a real number of days first.'); return; }
    createStudyPlan(el.getAttribute('data-scope-type'), el.getAttribute('data-scope-value'), planDays);
    closeModal();
    render();
    showToast('Plan set.');
    saveUserSettings();
    return;
  }
  if (action === 'start-plan-session') { startPlanSession(el.getAttribute('data-plan-key')); return; }
  if (action === 'cancel-plan') {
    showModal('Cancel this plan?', 'Your progress on it won\'t be undone, but the plan itself (and its pacing) will be gone.', [
      { action: 'close-modal', label: 'Keep plan' },
      { action: 'confirm-cancel-plan', label: 'Cancel plan', danger: true, data: { 'plan-key': el.getAttribute('data-plan-key') } }
    ]);
    return;
  }
  if (action === 'confirm-cancel-plan') {
    closeModal();
    cancelStudyPlan(el.getAttribute('data-plan-key'));
    render();
    showToast('Plan cancelled.');
    saveUserSettings();
    return;
  }
  if (action === 'toggle-fsrs-card') {
    state.fsrsCardExpanded = !state.fsrsCardExpanded;
    saveFsrsCardExpanded();
    render();
    return;
  }
  if (action === 'toggle-subject-sleep') {
    var subj = el.getAttribute('data-subject');
    if (state.sleepingSubjects[subj]) {
      delete state.sleepingSubjects[subj];
      showToast('"' + subj + '" is awake again — back in FSRS review.');
    } else {
      state.sleepingSubjects[subj] = true;
      showToast('"' + subj + '" is now asleep — paused from FSRS review and Start Practice on the root page.');
    }
    saveSleepingSubjects();
    render();
    return;
  }
  if (action === 'toggle-mcq-sleep') {
    var mqId = el.getAttribute('data-id');
    var mq = state.mcqs.find(function(x){ return x.id === mqId; });
    if (!mq) return;
    mq.asleep = !mq.asleep;
    if (!mq.asleep) mq.autoSlept = false; // waking it manually also clears the auto-slept flag
    showToast(mq.asleep ? 'Question asleep — paused from FSRS review everywhere.' : 'Question awake again — back in FSRS review.');
    render();
    saveLibrary();
    return;
  }
  if (action === 'toggle-dark-mode') {
    state.darkMode = !state.darkMode;
    saveDarkMode();
    render();
    return;
  }
  if (action === 'export-library') { exportLibrary(); return; }
  if (action === 'import-library') {
    var fi = document.getElementById('importFileInput');
    if (fi) fi.click();
    return;
  }
  if (action === 'open-settings') { openSettingsModal(); return; }
  if (action === 'toggle-bookshelf') {
    /* Was a genuine toggle (go to shelf / leave shelf, same button either direction) —
       correct for the old small icon-button spot, but Book Shelf now sits as a plain
       peer tab next to "Library", so it should behave like one: always navigate TO
       bookshelf, the same way clicking "Library" always navigates to browse rather
       than toggling away if you're already there. */
    state.view = 'bookshelf';
    state.bookshelfActiveSource = null; /* always start fresh at the shelf grid */
    state.selectedPath = null;
    state.sidebarOpen = false;
    render();
    return;
  }
  if (action === 'open-book') {
    var bookSource = el.getAttribute('data-source');
    state.bookshelfActiveSource = bookSource;
    state.selectedPath = null;
    state.forceList = false;
    resetFolderFilters();
    state.sidebarOpen = false;
    render();
    return;
  }
  if (action === 'back-to-shelf') {
    state.bookshelfActiveSource = null;
    state.selectedPath = null;
    resetFolderFilters();
    render();
    return;
  }
  if (action === 'clear-book-path') {
    state.selectedPath = null;
    state.forceList = false;
    resetFolderFilters();
    render();
    return;
  }
  if (action === 'set-book-cover') { setBookCover(el.getAttribute('data-source')); return; }
  if (action === 'set-book-cover-upload') { openBookCoverFilePicker(el.getAttribute('data-source')); return; }
  if (action === 'confirm-book-cover-link') {
    var urlInput = document.getElementById('bookCoverUrlInput');
    await attachBookCoverUrl(el.getAttribute('data-source'), urlInput ? urlInput.value : ''); /* now genuinely async — fetches and mirrors the image before returning, not a synchronous set-and-forget */
    return;
  }
  if (action === 'remove-book-cover') { removeBookCover(el.getAttribute('data-source')); return; }
  if (action === 'sign-out') { signOutUser(); return; }
  if (action === 'google-sign-in') { signInWithGoogle(); return; }
  if (action === 'start-queue-preview') { state.view = 'queuepreview'; state.sidebarOpen = false; render(); return; }
  if (action === 'start-due-session') {
    var dueIds = getLearningQueue(state.mcqs.map(function(m){return m.id;})); /* getLearningQueue() itself now filters trashedAt internally, protecting this regardless of what's passed in */
    requestStartPractice(dueIds, true);
    return;
  }
  if (action === 'start-study-ahead') {
    var tomorrow = Date.now() + 86400000;
    var byId = {}; state.mcqs.forEach(function(m){ byId[m.id]=m; });
    /* Real bug found via a live report: this bypassed getLearningQueue() entirely and
       did its own filtering with no trashedAt check — a soft-deleted question due
       soon could genuinely end up in a live practice session here. */
    var ids = liveMcqs().filter(function(q){ return (q.learning.due||0) <= tomorrow; }).map(function(q){ return q.id; });
    requestStartPractice(ids, true);
    return;
  }
  if (action === 'start-practice-all') {
    /* Same bug, more severe here — "Start practice (all)" had NO filtering at all,
       meaning a deleted question could actually be answered during a live session,
       feeding back into its learning history despite supposedly being gone. */
    var allIds = skullScoped(liveMcqs()).map(function(m){ return m.id; });
    requestStartPractice(allIds, false);
    return;
  }

  if (action === 'toggle-node') {
    var key = el.getAttribute('data-path');
    state.expanded[key] = !state.expanded[key];
    render(); return;
  }
  if (action === 'select-node') {
    if (guardNavigation(action, el)) return;
    var key2 = el.getAttribute('data-path');
    state.selectedPath = key2.split('␟');
    if (!(state.view === 'bookshelf' && state.bookshelfActiveSource)) state.view = 'browse'; /* preserve book-drill-in context — don't kick back to the normal Library just for navigating a chapter inside a book */
    state.expanded[key2] = true;
    state.forceList = false;
    state.sidebarOpen = false;
    resetFolderFilters();
    render(); return;
  }
  if (action === 'view-node-questions') {
    var key4 = el.getAttribute('data-path');
    state.selectedPath = key4.split('␟');
    if (!(state.view === 'bookshelf' && state.bookshelfActiveSource)) state.view = 'browse';
    state.expanded[key4] = true;
    state.forceList = true;
    state.sidebarOpen = false;
    resetFolderFilters();
    render(); return;
  }
  if (action === 'clear-selection') { state.view = 'browse'; state.selectedPath = null; state.forceList = false; resetFolderFilters(); state.sidebarOpen = false; render(); return; }

  if (action === 'toggle-source-filter') {
    var s = el.getAttribute('data-source');
    state.filters.sources[s] = !state.filters.sources[s];
    render(); return;
  }
  if (action === 'toggle-tag-filter') {
    var tg = el.getAttribute('data-tag');
    state.filters.tags[tg] = !state.filters.tags[tg];
    render(); return;
  }
  if (action === 'toggle-tag-panel') {
    state.filters.tagPanelOpen = !state.filters.tagPanelOpen;
    render(); return;
  }
  if (action === 'clear-all-filters') {
    state.filters.sources = {};
    state.filters.tags = {};
    state.filters.status = 'all';
    render(); return;
  }
  if (action === 'clear-search') {
    state.filters.search = '';
    render();
    var si = document.getElementById('globalSearchInput');
    if (si) si.focus();
    return;
  }

  if (action === 'start-practice') {
    var tree = buildTree();
    var node = state.selectedPath ? getNodeByPath(tree, state.selectedPath) : null;
    /* Real bug found via a live report: this is the actual generic "Start Practice"
       button used everywhere in the app, not just the settings-menu "all" variant —
       its root-level fallback (no specific deck selected) had the same missing
       trashedAt filter as everything else audited here. */
    var ids = node ? collectIds(node) : skullScoped(liveMcqs()).map(function(m){ return m.id; });
    var byId = {}; state.mcqs.forEach(function(m){ byId[m.id]=m; });
    if (!node) ids = ids.filter(function(id){ return byId[id] && !state.sleepingSubjects[byId[id].subject]; }); /* root-level "Start Practice" skips sleeping subjects entirely */
    ids = ids.filter(function(id){ return byId[id] && !byId[id].asleep; }); /* individually-slept questions are excluded everywhere, not just from the root */
    var filtered = ids.filter(function(id){ return byId[id] && passesFilters(byId[id]); });
    requestStartPractice(filtered, state.learningMode.enabled);
    return;
  }
  if (action === 'export-current-view') {
    /* Deliberately mirrors renderQuestionList()'s own list computation exactly (not
       start-practice's, which is close but doesn't account for an active search) —
       the whole point is "export exactly what's on screen right now". */
    var expSearchAll = !!(state.filters.search || '').trim();
    var expTree = buildTree();
    var expNode = state.selectedPath ? getNodeByPath(expTree, state.selectedPath) : null;
    var expIds = (expSearchAll || !expNode) ? skullScoped(liveMcqs()).map(function(m){ return m.id; }) : collectIds(expNode);
    var expById = {}; state.mcqs.forEach(function(m){ expById[m.id] = m; });
    var expList = expIds.map(function(id){ return expById[id]; }).filter(Boolean).filter(passesFilters);
    var expLabel = expSearchAll ? 'search-results' : (state.selectedPath ? state.selectedPath[state.selectedPath.length-1].toLowerCase().replace(/[^a-z0-9]+/g,'-') : 'all-subjects');
    exportMcqSubset(expList, expLabel);
    return;
  }

  if (action === 'preview-mcq') {
    var id = el.getAttribute('data-id');
    requestStartPractice([id], false);
    return;
  }

  if (action === 'copy-prompt') {
    var copied = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(MASTER_PROMPT);
        copied = true;
      }
    } catch(err) { copied = false; }
    if (!copied) {
      /* Fallback for contexts where the async Clipboard API is blocked (e.g. sandboxed
         preview iframes without clipboard-write permission delegated) — the older
         execCommand path works in more of those environments. */
      try {
        var ta = document.createElement('textarea');
        ta.value = MASTER_PROMPT;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-9999px';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
        copied = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch(err2) { copied = false; }
    }
    if (copied) {
      showToast('Prompt copied — paste it into your LLM of choice.');
    } else {
      var pb = document.getElementById('promptBox');
      if (pb && window.getSelection) {
        var range = document.createRange();
        range.selectNodeContents(pb);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
      showToast('Could not copy automatically — the prompt text below is now selected, press Ctrl/Cmd+C to copy.');
    }
    return;
  }

  if (action === 'clear-ingest') {
    document.getElementById('ingestArea').value = '';
    document.getElementById('parseReport').innerHTML = '';
    return;
  }

  if (action === 'download-id-sheet') { downloadIdSheet(); return; }
  if (action === 'confirm-import-file') { confirmImportWithChoice(el.getAttribute('data-reset') === 'true'); return; }
  if (action === 'cancel-import-file') { state.pendingImportPayload = null; closeModal(); return; }

  if (action === 'open-add-note') { openAddNoteModal(el.getAttribute('data-id')); return; }
  if (action === 'cancel-add-note') {
    state.pendingNoteDraft = null;
    if (state.editingMcqId) openEditModal(state.editingMcqId); else closeModal();
    return;
  }
  if (action === 'add-note-draft-image') {
    var noteFi = document.getElementById('noteImageFileInput');
    if (noteFi) noteFi.click();
    return;
  }
  if (action === 'toggle-note-existing-picker') {
    if (state.pendingNoteDraft) {
      state.pendingNoteDraft.showingPicker = !state.pendingNoteDraft.showingPicker;
      renderNoteDraftImageGrid();
    }
    return;
  }
  if (action === 'pick-existing-note-image') {
    if (state.pendingNoteDraft) {
      var pickHash = el.getAttribute('data-hash');
      if (pickHash && state.pendingNoteDraft.images.indexOf(pickHash) === -1) state.pendingNoteDraft.images.push(pickHash); /* linking, not re-uploading — the exact same stored/mirrored image, just referenced from one more place */
      state.pendingNoteDraft.showingPicker = false;
      renderNoteDraftImageGrid();
      showToast('Image linked — reusing what\'s already stored, nothing re-uploaded.');
    }
    return;
  }
  if (action === 'remove-note-draft-image') {
    if (state.pendingNoteDraft) {
      var rmHash2 = el.getAttribute('data-hash');
      state.pendingNoteDraft.images = state.pendingNoteDraft.images.filter(function(h){ return h !== rmHash2; });
      renderNoteDraftImageGrid();
    }
    return;
  }
  if (action === 'save-note') {
    var noteMcqId = el.getAttribute('data-id');
    var noteM = state.mcqs.find(function(x){ return x.id === noteMcqId; });
    var noteTextEl = document.getElementById('noteTextInput');
    var noteText = noteTextEl ? noteTextEl.value.trim() : '';
    var noteImages = state.pendingNoteDraft ? state.pendingNoteDraft.images.slice() : [];
    if (!noteText && !noteImages.length) { showToast('Write something or add an image first.'); return; }
    if (noteM) {
      if (!Array.isArray(noteM.notes)) noteM.notes = [];
      noteM.notes.push({ id: uid(), text: noteText, images: noteImages, createdAt: Date.now() });
    }
    state.pendingNoteDraft = null;
    if (state.editingMcqId) openEditModal(state.editingMcqId); else closeModal();
    render();
    showToast('Note added.');
    saveLibrary();
    return;
  }
  if (action === 'delete-note') {
    var delNoteMcqId = el.getAttribute('data-id'), delNoteId = el.getAttribute('data-note-id');
    var delNoteM = state.mcqs.find(function(x){ return x.id === delNoteMcqId; });
    if (delNoteM && Array.isArray(delNoteM.notes)) {
      delNoteM.notes = delNoteM.notes.filter(function(n){ return n.id !== delNoteId; });
      if (state.editingMcqId) openEditModal(state.editingMcqId); else render();
      showToast('Note deleted.');
      saveLibrary();
    }
    return;
  }
  if (action === 'upload-image-zip') {
    var zipInput = document.getElementById('imageZipInput');
    var zipFile = zipInput && zipInput.files && zipInput.files[0];
    if (!zipFile) { showToast('Choose a .zip file first.'); return; }
    requestNotificationPermissionIfNeeded(); /* must happen synchronously off this click — a real user gesture, not an unsolicited prompt */
    processImageZip(zipFile);
    return;
  }

  if (action === 'parse-preview') {
    var raw = document.getElementById('ingestArea').value;
    var override = document.getElementById('sourceOverrideInput').value.trim();
    if (!raw.trim()) { showToast('Paste some standardized MCQ text first.'); return; }
    var result = parseLibraryText(raw, override || null);
    var reportEl = document.getElementById('parseReport');
    if (!result.mcqs.length) {
      reportEl.innerHTML = '<div class="parse-report" style="color:var(--pen-red);">No valid #Q blocks found. Check the format against the prompt above.</div>';
      return;
    }
    var bySubj = {};
    result.mcqs.forEach(function(m){ bySubj[m.subject] = (bySubj[m.subject]||0) + 1; });
    var subjSummary = Object.keys(bySubj).map(function(k){ return k + ' (' + bySubj[k] + ')'; }).join(', ');
    var reportHtml = '<div class="parse-report"><span class="parse-ok">' + result.mcqs.length + ' questions parsed</span> — ' + escapeHtml(subjSummary) + '</div>';
    if (result.errors.length) {
      reportHtml += '<div class="parse-err-list">' + result.errors.length + ' block(s) skipped:<br>' +
        result.errors.slice(0,15).map(function(er){ return '· ' + escapeHtml(er.message); }).join('<br>') + '</div>';
    }
    /* Surfaced before import, not just after — someone deciding whether to import
       right now benefits from knowing upfront that some of what they're about to
       add needs a second look, not just discovering it later in the review queue. */
    var flaggedCount = result.mcqs.filter(function(m){ return m.needsReview; }).length;
    if (flaggedCount) {
      reportHtml += '<div class="parse-err-list" style="border-color:var(--pen-amber,#D3B15C);">' + icon('flag',13) + ' ' + flaggedCount + ' question' + (flaggedCount===1?'':'s') +
        ' flagged for review (illegible/uncertain source content) — still imported, just marked so you can find and fix ' + (flaggedCount===1?'it':'them') + ' afterward via Settings → Needs Review.</div>';
    }
    /* Preview the duplicate check BEFORE committing, against the full picture (existing
       library + this batch) — same logic confirm-import actually applies, just shown
       ahead of time so the person knows what "Import N questions" will really do. */
    var previewDup = partitionDuplicates(liveMcqs().concat(result.mcqs));
    var previewPendingIds = {}; result.mcqs.forEach(function(m){ previewPendingIds[m.id] = true; });
    var previewExcessCount = previewDup.excess.filter(function(m){ return previewPendingIds[m.id]; }).length;
    if (previewExcessCount) {
      reportHtml += '<div class="parse-err-list">' + previewDup.duplicateGroupCount + ' duplicate group' + (previewDup.duplicateGroupCount===1?'':'s') +
        ' detected — ' + previewExcessCount + ' question' + (previewExcessCount===1?'':'s') + ' will be skipped on import (already at the 3-copy limit).</div>';
    }
    reportHtml += '<div class="action-row"><button class="btn btn-primary" data-action="confirm-import">Import ' + (result.mcqs.length - previewExcessCount) + ' question' + ((result.mcqs.length - previewExcessCount)===1?'':'s') + '</button></div>';
    reportEl.innerHTML = reportHtml;
    reportEl._pending = result.mcqs;
    return;
  }

  if (action === 'confirm-import') {
    var reportEl2 = document.getElementById('parseReport');
    var pending = reportEl2 && reportEl2._pending;
    if (!pending || !pending.length) return;
    /* Duplicate check happens against the FULL picture — existing library plus this
       batch together — not just within the batch itself, so re-importing something
       that's already well-represented in the library correctly gets trimmed too, not
       just duplicates that happen to appear more than 3 times within the pasted text
       alone. Only the NEWLY IMPORTED excess gets dropped here — existing questions
       that were already over the limit before this import are untouched; that's what
       the separate "Clean up duplicates" pass in Settings is for. */
    var pendingIds = {}; pending.forEach(function(m){ pendingIds[m.id] = true; });
    var dupResult = partitionDuplicates(liveMcqs().concat(pending));
    var excessPendingIds = {}; dupResult.excess.forEach(function(m){ if (pendingIds[m.id]) excessPendingIds[m.id] = true; });
    var toImport = pending.filter(function(m){ return !excessPendingIds[m.id]; });
    var skippedCount = pending.length - toImport.length;

    toImport.forEach(function(m){
      if (!state.sources[m.source]) state.sources[m.source] = { color: colorForSource(m.source) };
    });
    state.mcqs = state.mcqs.concat(toImport);
    document.getElementById('ingestArea').value = '';
    syncInFlight = true; /* bulk import is the same class of mutation as the trash/rename operations elsewhere — blocks a concurrent auto-sync from pulling stale data back mid-import */
    state.hasUnsyncedChanges = true;

    /* Real bug found via a live report: the old flow set state.view='browse' and
       showed a toast immediately, BEFORE the actual save had even started — the
       only feedback was that one toast, which fades in a few seconds with nothing
       persistent behind it. No way to tell if an import was still running or had
       silently failed to start; one report described re-uploading the same
       source a second time because of exactly that ambiguity. A blocking modal
       with real, live progress (not a fake spinner — this is wired to the actual
       batch-by-batch save progress) replaces that, and it's structurally
       impossible to trigger a second import while it's up, since Add Source
       itself isn't reachable until this closes. */
    var libraryTotal = state.mcqs.length;
    showBlockingModal(renderImportProgressModal(0, libraryTotal, toImport.length), 'narrow');
    importInFlight = true;
    try {
      /* Sources saved BEFORE the questions, deliberately reversed from the
         order this used to run in. If something still manages to interrupt
         between the two saves despite the blocking modal and the beforeunload
         guard above (a crash, a force-quit, anything truly outside the page's
         control), this ordering makes the failure mode the safe one: a
         registered source with no questions under it yet, which the "hide
         empty sources" fix elsewhere already makes invisible on Book Shelf
         rather than confusing — instead of the old failure mode this was
         actually reported with, questions that saved fine but whose source
         never appeared as a visible book at all. */
      await saveSources();
      await saveLibrary(function(progress){ updateImportProgressModal(progress.completed, progress.total, toImport.length); });
    } finally {
      syncInFlight = false;
      importInFlight = false;
    }

    if (state.lastSaveHadPermanentConflict) {
      /* saveLibrary() already showed a specific explanation via its own toast —
         close the progress modal and let that stand, rather than piling a
         misleading "done" confirmation on top of a save that actually failed. */
      closeModal();
      state.view = 'browse';
      render();
    } else {
      var doneRoot = document.getElementById('modalRoot');
      var doneCard = doneRoot && doneRoot.querySelector('.modal-card');
      if (doneCard) doneCard.innerHTML = renderImportDoneModal(toImport.length, skippedCount);
      if (state.hasUnsyncedChanges) {
        showToast(pending.length + ' question' + (pending.length===1?'':'s') + ' saved locally — will sync once you\'re back online.');
      }
    }
    return;
  }
  if (action === 'close-import-done') {
    closeModal();
    state.view = 'browse';
    render();
    return;
  }

  if (action === 'rename-source') { openRenameSourceModal(el.getAttribute('data-source')); return; }
  if (action === 'confirm-rename-source') {
    var rsOld = el.getAttribute('data-source');
    var rsInput = document.getElementById('renameSourceInput');
    var rsNewName = rsInput ? rsInput.value : '';
    if (renameSource(rsOld, rsNewName)) {
      closeModal(); render();
      syncInFlight = true; /* same race and same fix as the trash mutations and deck rename above */
      state.hasUnsyncedChanges = true;
      try {
        await saveLibrary();
      } finally {
        syncInFlight = false;
      }
      showToast('Renamed to "' + rsNewName.trim() + '".');
    } else {
      showToast(rsNewName.trim() === rsOld ? 'That\'s already the name.' : 'Enter a name first.');
    }
    return;
  }
  if (action === 'delete-source') {
    var srcName = el.getAttribute('data-source');
    showModal('Move to Trash?', 'Move "' + srcName + '" and all its MCQs to Trash? Restorable for ' + TRASH_RETENTION_DAYS + ' days.', [
      { action: 'close-modal', label: 'Cancel' },
      { action: 'confirm-delete-source', label: 'Move to Trash', danger: true, data: { source: srcName } }
    ]);
    return;
  }
  if (action === 'confirm-delete-source') {
    closeModal();
    var srcName = el.getAttribute('data-source');
    var trashedNow = Date.now();
    var trashedCount = 0;
    state.mcqs.forEach(function(m){ if (m.source === srcName && !m.trashedAt) { m.trashedAt = trashedNow; m.trashedFrom = { type: 'source', label: srcName }; trashedCount++; } });
    syncInFlight = true; /* same race and same fix as the other trash mutations above */
    state.hasUnsyncedChanges = true;
    /* Source metadata (name/color) deliberately stays — a trashed question restored
       later should still show its original source pill correctly, not fall back to
       a regenerated color as if it were never labeled at all. */
    showToast('Moving to Trash…');
    render();
    try {
      await saveLibrary(); /* normal upsert — nothing left the table, just marked */
    } finally {
      syncInFlight = false;
    }
    showToast(trashedCount + ' question' + (trashedCount===1?'':'s') + ' moved to Trash.');
    return;
  }

  if (action === 'approve-review-item') {
    var apId = el.getAttribute('data-id');
    var apM = state.mcqs.find(function(x){ return x.id === apId; });
    if (apM) {
      apM.needsReview = false;
      apM.reviewReason = '';
      state.hasUnsyncedChanges = true;
      render();
      saveLibrary();
      showToast('Approved.');
    }
    return;
  }
  if (action === 'restore-trash-item') {
    var restoreId = el.getAttribute('data-id');
    var restoreM = state.mcqs.find(function(x){ return x.id === restoreId; });
    if (!restoreM) return;
    delete restoreM.trashedAt;
    syncInFlight = true; /* same protection as the other trash mutations, cleaned up via .finally() since this save stays fire-and-forget like every other in-place edit */
    state.hasUnsyncedChanges = true;
    render();
    saveLibrary().finally(function(){ syncInFlight = false; });
    showToast('Restored.');
    return;
  }

  if (action === 'permanently-delete-trash-item') {
    var permId = el.getAttribute('data-id');
    showModal('Delete forever?', 'Delete this question forever? This cannot be undone.', [
      { action: 'close-modal', label: 'Cancel' },
      { action: 'confirm-permanently-delete-trash-item', label: 'Delete forever', danger: true, data: { id: permId } }
    ]);
    return;
  }
  if (action === 'confirm-permanently-delete-trash-item') {
    closeModal();
    var permId = el.getAttribute('data-id');
    var permM = state.mcqs.find(function(x){ return x.id === permId; });
    if (!permM) return;
    var permHashes = (permM.images || []).concat(permM.answerImages || []);
    state.mcqs = state.mcqs.filter(function(x){ return x.id !== permId; });
    syncInFlight = true; /* same fix as empty-trash — blocks any concurrent sync for the actual duration of the delete, see the comment there for why hasUnsyncedChanges alone isn't enough */
    state.hasUnsyncedChanges = true;
    render();
    try {
      await deleteMcqRows([permId]);
      await purgeOrphanedImageHashes(permHashes);
    } finally {
      syncInFlight = false;
    }
    showToast('Deleted forever.');
    return;
  }

  /* Group versions — act on everything trashed together in one deletion (a whole
     source or folder), matching how a real recycle bin restores/deletes a
     deleted folder as one thing rather than requiring every file inside it to be
     picked one at a time. Same grouping key renderTrashView() itself used to
     build these rows in the first place. */
  if (action === 'restore-trash-group') {
    var restoreGroupKey = el.getAttribute('data-group');
    var toRestore = trashedMcqs().filter(function(m){ return trashGroupKeyOf(m) === restoreGroupKey; });
    if (!toRestore.length) return;
    toRestore.forEach(function(m){ delete m.trashedAt; delete m.trashedFrom; });
    syncInFlight = true;
    state.hasUnsyncedChanges = true;
    render();
    saveLibrary().finally(function(){ syncInFlight = false; });
    showToast('Restored ' + toRestore.length + ' question' + (toRestore.length===1?'':'s') + '.');
    return;
  }

  if (action === 'permanently-delete-trash-group') {
    var deleteGroupKey = el.getAttribute('data-group');
    var toDelete = trashedMcqs().filter(function(m){ return trashGroupKeyOf(m) === deleteGroupKey; });
    if (!toDelete.length) return;
    showModal('Delete forever?', 'Delete these ' + toDelete.length + ' question' + (toDelete.length===1?'':'s') + ' forever? This cannot be undone.', [
      { action: 'close-modal', label: 'Cancel' },
      { action: 'confirm-permanently-delete-trash-group', label: 'Delete forever', danger: true, data: { group: deleteGroupKey } }
    ]);
    return;
  }
  if (action === 'confirm-permanently-delete-trash-group') {
    closeModal();
    var deleteGroupKey = el.getAttribute('data-group');
    var toDelete = trashedMcqs().filter(function(m){ return trashGroupKeyOf(m) === deleteGroupKey; });
    if (!toDelete.length) return;
    var groupDeleteIds = toDelete.map(function(m){ return m.id; });
    var groupDeleteHashes = [];
    toDelete.forEach(function(m){
      (m.images || []).forEach(function(h){ groupDeleteHashes.push(h); });
      (m.answerImages || []).forEach(function(h){ groupDeleteHashes.push(h); });
    });
    state.mcqs = state.mcqs.filter(function(m){ return groupDeleteIds.indexOf(m.id) === -1; });
    syncInFlight = true;
    state.hasUnsyncedChanges = true;
    render();
    try {
      await deleteMcqRows(groupDeleteIds);
      await purgeOrphanedImageHashes(groupDeleteHashes);
    } finally {
      syncInFlight = false;
    }
    showToast('Deleted ' + toDelete.length + ' question' + (toDelete.length===1?'':'s') + ' forever.');
    return;
  }

  if (action === 'empty-trash') {
    var toEmpty = trashedMcqs();
    if (!toEmpty.length) return;
    showModal('Empty Trash?', 'Permanently delete all ' + toEmpty.length + ' question' + (toEmpty.length===1?'':'s') + ' in Trash? This cannot be undone.', [
      { action: 'close-modal', label: 'Cancel' },
      { action: 'confirm-empty-trash', label: 'Empty Trash', danger: true }
    ]);
    return;
  }
  if (action === 'confirm-empty-trash') {
    closeModal();
    var toEmpty = trashedMcqs();
    if (!toEmpty.length) return;
    var emptyIds = toEmpty.map(function(m){ return m.id; });
    var emptyHashes = [];
    toEmpty.forEach(function(m){
      (m.images || []).forEach(function(h){ emptyHashes.push(h); });
      (m.answerImages || []).forEach(function(h){ emptyHashes.push(h); });
    });
    state.mcqs = state.mcqs.filter(function(m){ return !m.trashedAt; });
    /* Real, reproducible bug: between this local update and deleteMcqRows actually
       landing on the server, a concurrent auto-sync could run. Setting
       hasUnsyncedChanges alone turned out NOT to be enough — reconcileWithCloud's
       "push first" branch still calls loadLibrary() (a pull) afterward to
       reconfirm lockstep, and that pull can still race ahead of the real row
       deletion finishing, resurrecting exactly what was just emptied either way.
       syncInFlight is the guard reconcileWithCloud() already respects and bails
       out on entirely (`if (syncInFlight) return;`) — reusing it here blocks any
       concurrent sync attempt completely for the actual duration of the delete,
       not just reordering it. */
    syncInFlight = true;
    state.hasUnsyncedChanges = true;
    render();
    try {
      await deleteMcqRows(emptyIds);
      await purgeOrphanedImageHashes(emptyHashes);
    } finally {
      syncInFlight = false;
    }
    showToast('Trash emptied.');
    return;
  }

  if (action === 'clear-all') {
    showModal('Clear entire library?', 'Delete your entire Practex library? This cannot be undone.', [
      { action: 'close-modal', label: 'Cancel' },
      { action: 'confirm-clear-all', label: 'Clear entire library', danger: true }
    ]);
    return;
  }
  if (action === 'confirm-clear-all') {
    closeModal();
    var allMcqIds = state.mcqs.map(function(m){ return m.id; });
    state.mcqs = [];
    state.sources = {};
    state.selectedPath = null;
    /* Same race as empty-trash/permanently-delete — this is actually the single most
       destructive action in the app (the ENTIRE library, not just Trash), so it's the
       last place this guard should be missing. Without it, a concurrent auto-sync tick
       (retryUnsyncedChangesIfAny runs every 30s) can pull the pre-clear library straight
       back from Supabase before deleteMcqRows/saveSources actually land, resurrecting
       everything the person just confirmed deleting. syncInFlight is the guard
       reconcileWithCloud() already respects and bails out on entirely. */
    syncInFlight = true;
    state.hasUnsyncedChanges = true;
    showToast('Clearing your library…');
    render();
    try {
      await deleteMcqRows(allMcqIds); /* same reasoning as delete-source above — upsert can't remove rows */
      await saveSources();
    } finally {
      syncInFlight = false;
    }
    showToast('Library cleared.');
    return;
  }

  if (action === 'close-modal') { state.pendingNav = null; closeModal(); return; }
  if (action === 'modal-backdrop-close') { if (e.target === el && lastMouseDownOnBackdrop) { state.pendingNav = null; closeModal(); } return; }
  if (action === 'view-history') { openHistoryModal(el.getAttribute('data-id')); return; }
  if (action === 'edit-mcq') { openEditModal(el.getAttribute('data-id')); return; }
  if (action === 'save-edit-mcq') { saveEditMcq(el.getAttribute('data-id')); return; }

  if (action === 'add-mcq-image') {
    var addField = el.getAttribute('data-field') || 'images';
    var fi = document.getElementById(addField === 'answerImages' ? 'mcqAnswerImageFileInput' : 'mcqImageFileInput');
    if (fi) fi.click();
    return;
  }
  if (action === 'remove-mcq-image') {
    var rmId = el.getAttribute('data-id'), rmHash = el.getAttribute('data-hash');
    var rmField = el.getAttribute('data-field') || 'images';
    var rmM = state.mcqs.find(function(x){ return x.id === rmId; });
    if (rmM && rmM[rmField]) {
      rmM[rmField] = rmM[rmField].filter(function(h){ return h !== rmHash; });
      renderMcqImageGrid(rmM, rmField, rmField === 'answerImages' ? 'mcqAnswerImageGrid' : 'mcqImageGrid');
      showToast('Image removed.');
      await saveLibrary();
      await purgeOrphanedImageHashes([rmHash]); /* only actually deletes it if no other question still uses this hash */
    }
    return;
  }
  if (action === 'view-mcq-image') { openImageLightbox(el.getAttribute('data-hash')); return; }
  if (action === 'close-lightbox') {
    if (state.editingMcqId) openEditModal(state.editingMcqId);
    else closeModal();
    return;
  }

  if (action === 'open-deck-menu') { openDeckMenu(el.getAttribute('data-path')); return; }

  if (action === 'deck-rename') { openRenameDeckModal(el.getAttribute('data-path')); return; }
  if (action === 'open-new-folder') { openNewFolderModal(el.getAttribute('data-path')); return; }
  if (action === 'confirm-new-folder') {
    var nfParent = el.getAttribute('data-parent');
    var nfInput = document.getElementById('newFolderInput');
    var nfName = nfInput ? nfInput.value.trim() : '';
    if (!nfName) { showToast('Enter a name first.'); return; }
    var nfPath = nfParent ? nfParent.split('␟').concat([nfName]) : [nfName];
    var nfTree = buildTree();
    if (getNodeByPath(nfTree, nfPath)) {
      showToast('"' + nfName + '" already exists there.');
      return;
    }
    state.emptyFolders.push(nfPath);
    closeModal();
    render();
    showToast('"' + nfName + '" created.');
    saveUserSettings();
    return;
  }
  if (action === 'confirm-rename-deck') {
    var rPath = el.getAttribute('data-path');
    var rInput = document.getElementById('renameDeckInput');
    var rNewName = rInput ? rInput.value : '';
    if (renameDeck(rPath.split('␟'), rNewName)) {
      closeModal(); render();
      syncInFlight = true; /* same race and same fix as the trash mutations elsewhere — a bulk rename touching many rows is exactly as vulnerable to a concurrent auto-sync pulling the pre-rename state back before this save lands */
      state.hasUnsyncedChanges = true;
      /* Awaited — a rename/move/copy/delete is rare and high-stakes enough that
         showing "done" and letting a reload interrupt the actual save (aborting it
         mid-flight, same failure mode that lost imports) is worse than the extra
         half-second wait. Frequent taps during practice stay optimistic on purpose. */
      try {
        await saveLibrary(); await saveSleepingSubjects();
      } finally {
        syncInFlight = false;
      }
      showToast('Renamed to "' + rNewName.trim() + '".');
    } else {
      showToast('Enter a name first.');
    }
    return;
  }

  if (action === 'deck-move') { openMoveDeckModal(el.getAttribute('data-path')); return; }
  if (action === 'confirm-move-deck') {
    var mvPath = el.getAttribute('data-path');
    var mvArr = mvPath.split('␟');
    var mvSelect = document.getElementById('moveDeckSelect');
    var mvNewInput = document.getElementById('moveDeckNewInput');
    var mvNewName = mvNewInput ? mvNewInput.value.trim() : '';
    var mvDestArr, mvDestLabel;
    if (mvNewName) {
      mvDestArr = [mvNewName];
      mvDestLabel = mvNewName;
    } else if (mvSelect && mvSelect.value === '__LIBRARY_ROOT__') {
      mvDestArr = [];
      mvDestLabel = 'Library';
    } else if (mvSelect && mvSelect.value) {
      mvDestArr = mvSelect.value.split('␟'); // a select option's value now carries a full nested path, not just a single subject name
      mvDestLabel = mvDestArr.join(' / ');
    } else {
      showToast('Pick or type a destination first.');
      return;
    }
    var movedName = mvArr[mvArr.length-1];
    if (!mvDestArr.length) {
      moveDeckUnder(mvArr, []);
      closeModal(); render();
      await saveLibrary();
      showToast('"' + movedName + '" is now a top-level subject in the Library.');
      return;
    }
    if (isPathWithinOrEqual(mvDestArr, mvArr)) { showToast('Can\'t move a deck into itself.'); return; }
    moveDeckUnder(mvArr, mvDestArr);
    closeModal(); render();
    await saveLibrary();
    showToast('Moved "' + movedName + '" under "' + mvDestLabel + '".');
    return;
  }

  if (action === 'deck-copy') {
    var cpPath = el.getAttribute('data-path');
    var cpCount = duplicateDeck(cpPath.split('␟'));
    closeModal(); render();
    await saveLibrary();
    showToast('Copied — ' + cpCount + ' question' + (cpCount===1?'':'s') + ' duplicated as "' + cpPath.split('␟').pop() + ' (copy)".');
    return;
  }

  if (action === 'deck-cut') {
    var cutPath = el.getAttribute('data-path');
    var cutArr = cutPath.split('␟');
    state.clipboardNode = { path: cutArr, name: cutArr[cutArr.length-1] };
    closeModal(); render();
    showToast('"' + state.clipboardNode.name + '" cut — navigate to a destination and choose "Paste here".');
    return;
  }
  if (action === 'cancel-cut') { state.clipboardNode = null; render(); return; }
  if (action === 'paste-node-here') {
    if (!state.clipboardNode) { render(); return; }
    var destPath = el.getAttribute('data-path');
    var destPathArr = destPath ? destPath.split('␟') : [];
    if (!destPathArr.length) {
      if (state.clipboardNode.path.length === 1) {
        showToast('That\'s already at the Library root.');
        state.clipboardNode = null; render();
        return;
      }
      var promotedName = state.clipboardNode.name;
      moveDeckUnder(state.clipboardNode.path, []);
      state.clipboardNode = null;
      render();
      await saveLibrary();
      showToast('"' + promotedName + '" moved to the Library root as a top-level subject.');
      return;
    }
    if (isPathWithinOrEqual(destPathArr, state.clipboardNode.path)) {
      showToast(destPathArr.join(' / ') === state.clipboardNode.path.join(' / ') ? 'That\'s already where it is.' : 'Can\'t paste a deck into itself.');
      if (destPathArr.join(' / ') === state.clipboardNode.path.join(' / ')) state.clipboardNode = null;
      render();
      return;
    }
    moveDeckUnder(state.clipboardNode.path, destPathArr);
    var pastedName = state.clipboardNode.name;
    state.clipboardNode = null;
    render();
    await saveLibrary();
    showToast('"' + pastedName + '" moved here.');
    return;
  }

  if (action === 'deck-delete') { openDeleteDeckModal(el.getAttribute('data-path')); return; }
  if (action === 'confirm-delete-deck') {
    var delPath = state.pendingDeckDelete;
    state.pendingDeckDelete = null;
    if (delPath) {
      var delArr = delPath.split('␟');
      var removedMcqs = deleteDeck(delArr); /* soft delete — see deleteDeck(), nothing actually leaves state.mcqs or the server here */
      syncInFlight = true; /* blocks any concurrent auto-sync until saveLibrary() below actually lands — same race and same fix as empty-trash/permanently-delete */
      state.hasUnsyncedChanges = true;
      if (state.selectedPath && state.selectedPath.join('␟').indexOf(delPath) === 0) {
        state.selectedPath = null; state.forceList = false;
      }
      closeModal(); render();
      showToast(removedMcqs.length ? ('Moved ' + removedMcqs.length + ' question' + (removedMcqs.length===1?'':'s') + ' to Trash — restorable for ' + TRASH_RETENTION_DAYS + ' days.') : 'Folder deleted.');
      try {
        await saveLibrary(); /* normal upsert — trashedAt is just another field on the same rows, no explicit delete call needed since nothing is actually gone yet */
        await saveUserSettings(); /* emptyFolders lives in a separate settings column, not state.mcqs — deleting an empty folder only touches THIS, and without saving it too the folder would silently reappear on next sync from another device even though it looked deleted locally */
      } finally {
        syncInFlight = false;
      }
    } else {
      closeModal();
    }
    return;
  }
  if (action === 'leave-practice') { requestLeavePractice(); return; }

  if (action === 'set-gate-time-chip') {
    var s4 = state.session;
    if (!s4) return;
    s4.timePerQ = parseInt(el.getAttribute('data-secs'), 10) || 0;
    try { localStorage.setItem('practex_time_per_q', String(s4.timePerQ)); } catch(e) {}
    render();
    return;
  }
  if (action === 'toggle-gate-autoskull') {
    var s5 = state.session;
    if (!s5) return;
    s5.autoSkullEnabled = !s5.autoSkullEnabled;
    try { localStorage.setItem('practex_auto_skull', s5.autoSkullEnabled ? '1' : '0'); } catch(e) {}
    render();
    return;
  }
  if (action === 'dismiss-gate-screen') {
    var s6 = state.session;
    if (!s6) return;
    s6.awaitingStart = false;
    s6.timerStartedAt = null; /* forces startQuestionTimerIfNeeded() to treat this as a fresh countdown for whichever question is current, whether that's genuinely Q1 or a resumed mid-test question */
    s6.timerFrozenPct = null;
    persistLiveSessionSync(); /* state.pausedSession is already null by now (reconciled into state.session on arrival) — persistPausedSessionSync() would be a no-op here; this is the live-session key that actually covers "mid-question, tab still open" durability */
    render();
    return;
  }
  if (action === 'pause-and-leave') {
    var targetUrl = pendingNavTargetUrl(); /* compute before clearing state.session below, since it reads state.pendingNav, not state.session */
    state.pausedSession=currentSessionSnapshot();
    if (state.pausedSession) state.pausedSession.pausedAt = Date.now();
    persistPausedSessionSync(); /* synchronous, instant — guaranteed to survive the navigation below even if the async cloud save gets cancelled by it, same reasoning as Chapter 3's crash-recovery key */
    state.session=null; closeModal(); render();
    clearLiveSessionSync(); /* deliberate pause takes precedence over any earlier ungraceful-exit leftover from earlier in this same session */
    showToast('Pausing…');
    /* Awaited BEFORE navigating (Chapter 4) — navigating to library.html cancels any
       in-flight fetch the same way closing the tab would, which is exactly the race
       this await was already guarding against; the difference is this now happens on
       every pause, not just when someone closes the tab unusually fast. The sync
       localStorage write above already guarantees local durability regardless, so
       navigating a little late here is about giving OTHER devices a fresher cloud
       copy, not about losing anything locally. */
    await saveUserSettings();
    if (state.lastSaveHadPermanentConflict) {
      /* saveUserSettings doesn't currently set this, but stay consistent with the
         pattern used elsewhere in case that ever changes. */
    } else if (state.hasUnsyncedChanges) {
      showToast('Paused locally — will sync to your other devices once you\'re back online.');
    } else {
      showToast('Paused — resume it from any device.');
    }
    window.location.href = targetUrl;
    return;
  }
  if (action === 'leave-without-pausing') {
    var targetUrl2 = pendingNavTargetUrl();
    state.session=null; closeModal(); render();
    clearLiveSessionSync(); /* explicit "don't save this" — an ungraceful-exit leftover from earlier in this session shouldn't override that choice next load */
    clearPausedSessionSync(); /* bugfix — startPractice()'s hand-off write to this same key, from however this session originally got started, would otherwise still be sitting on disk and get mistaken for a real pause on the next load */
    window.location.href = targetUrl2;
    return;
  }
  if (action === 'resume-paused') {
    /* Chapter 4 (MPA): resuming now means navigating to practice.html, which runs this
       exact same normalization itself on arrival (see normalizePausedSessionForResume()
       and goToPracticeIfSessionPending() in practex-learning-practice.js) — a manual
       click here doesn't need to duplicate that logic, just get the browser there. The
       corrupted-session case still needs to be caught HERE though, before navigating,
       so the person gets the toast on the page they're already looking at instead of
       silently landing on an empty practice.html. */
    if(!state.pausedSession){ closeModal(); return; }
    var check = normalizePausedSessionForResume(state.pausedSession);
    if (!check.ids.length) {
      showToast('That paused test looks corrupted and can\'t be resumed — sorry about that. Starting fresh is the safest option.');
      state.pausedSession = null; closeModal(); render(); savePausedSession(); clearLiveSessionSync(); clearPausedSessionSync(); return;
    }
    closeModal();
    window.location.href = 'practice.html';
    return;
  }
  if (action === 'confirm-new-test') {
    var pending=state.pendingStart; state.pendingStart=null; closeModal();
    if(pending){ if (!pending.planKey) state.learningMode.enabled=pending.learningEnabled; startPractice(pending.ids, pending.planKey); }
    return;
  }
  if (action === 'jump-subject') {
    state.selectedPath=[el.getAttribute('data-subject')]; state.view='browse'; state.forceList=false; state.expanded[state.selectedPath.join('␟')]=true; resetFolderFilters(); render(); return;
  }

  if (action === 'select-option') {
    if (state.session.revealed) return;
    var letter = el.getAttribute('data-letter');
    var curM = state.mcqs.find(function(x){ return x.id === state.session.ids[state.session.index]; });
    if (curM) toggleOptionSelection(curM, state.session, letter);
    render();
    return;
  }

  if (action === 'reveal-mcq') { revealCurrent(); return; }

  if (action === 'match-pick-left') {
    if (state.session.revealed) return;
    var sel = state.session.selected;
    if (!sel) return;
    var leftI = parseInt(el.getAttribute('data-i'), 10);
    if (sel.pendingLeft === leftI) sel.pendingLeft = null; // tapping the same pending left again cancels the pending pick
    else sel.pendingLeft = leftI; // works the same whether this left is already linked or not — picking a new right below will replace its existing pairing
    render();
    return;
  }
  if (action === 'match-pick-right') {
    if (state.session.revealed) return;
    var sel2 = state.session.selected;
    if (!sel2) return;
    var rightIdx = parseInt(el.getAttribute('data-i'), 10);
    if (sel2.pendingLeft === null || sel2.pendingLeft === undefined) {
      /* Real gap found via a live report: once a pair was made, there was no way to
         undo it short of overwriting it by picking a different right for that left —
         no way to leave it fully unpaired again. Tapping an already-linked right item
         with nothing currently pending now unlinks it directly — a real "undo this
         pairing" affordance, not just "replace this pairing." */
      var existingLeft = Object.keys(sel2.links).find(function(li){ return sel2.links[li] === rightIdx; });
      if (existingLeft !== undefined) { delete sel2.links[existingLeft]; render(); }
      return;
    }
    /* Right items must stay uniquely assigned — without this, two different lefts
       could silently both point at the same right (nothing here previously checked),
       making the reveal ambiguous about which pairing was actually "yours". If this
       right was already claimed by a DIFFERENT left, clear that link first. */
    var otherLeft = Object.keys(sel2.links).find(function(li){ return sel2.links[li] === rightIdx && Number(li) !== sel2.pendingLeft; });
    if (otherLeft !== undefined) delete sel2.links[otherLeft];
    sel2.links[sel2.pendingLeft] = rightIdx;
    /* Was `sel2.pendingLeft = null;` here — cleared the active left the instant ANY
       right was picked, which meant trying a different right for the same left
       required re-tapping the left every single time. A real, specific request:
       the active left should stay "sticky" — freely re-pickable, including stealing
       an already-used right from another left — until the person deliberately moves
       on, either by tapping this same left again (finalize/deselect) or tapping a
       DIFFERENT left (match-pick-left already handles both of those correctly on its
       own; nothing here needs to change for that half). */
    render();
    return;
  }
  if (action === 'match-reset') {
    if (state.session.revealed) return;
    var sel3 = state.session.selected;
    if (!sel3) return;
    sel3.links = {};
    sel3.pendingLeft = null;
    render();
    return;
  }

  if (action === 'seq-move-up') {
    if (state.session.revealed) return;
    var pos = parseInt(el.getAttribute('data-pos'), 10);
    var arr = state.session.selected;
    if (!arr || pos <= 0) return;
    var tmp = arr[pos - 1]; arr[pos - 1] = arr[pos]; arr[pos] = tmp;
    render();
    return;
  }
  if (action === 'seq-move-down') {
    if (state.session.revealed) return;
    var pos2 = parseInt(el.getAttribute('data-pos'), 10);
    var arr2 = state.session.selected;
    if (!arr2 || pos2 >= arr2.length - 1) return;
    var tmp2 = arr2[pos2 + 1]; arr2[pos2 + 1] = arr2[pos2]; arr2[pos2] = tmp2;
    render();
    return;
  }
  if (action === 'seq-show-correct') {
    var seqM = state.mcqs.find(function(x){ return x.id === state.session.ids[state.session.viewIndex]; });
    if (!seqM || seqM.type !== 'sequence') return;
    animateSequenceToCorrect(seqM); /* commits the correct order to state.session.selected AND animates the reflow — see the big comment on this function for why it's not just render() */
    return;
  }
  if (action === 'match-show-correct') {
    var matchM = state.mcqs.find(function(x){ return x.id === state.session.ids[state.session.viewIndex]; });
    if (!matchM || matchM.type !== 'match') return;
    animateMatchToCorrect(matchM); /* realigns the right column to match rows AND animates the reflow — see the big comment on this function */
    return;
  }

  if (action === 'reveal-short') {
    var val = document.getElementById('shortAnswerInput').value.trim();
    state.session.selected = val;
    revealCurrent();
    return;
  }

  if (action === 'next-question') { advanceAfterReveal(); return; }

  if (action === 'self-grade') {
    if (state.session) state.session.shortAnswerCorrect = el.getAttribute('data-correct') === 'true';
    advanceAfterReveal();
    return;
  }

  if (action === 'undo-answer') { undoLastAnswer(); return; }

  if (action === 'practice-prev') {
    if (state.session && state.session.viewIndex > 0) { state.session.viewIndex--; render(); }
    return;
  }
  if (action === 'practice-next') {
    if (state.session && state.session.viewIndex < state.session.index) { state.session.viewIndex++; render(); }
    return;
  }
  if (action === 'jump-to-current') {
    if (state.session) { state.session.viewIndex = state.session.index; render(); }
    return;
  }
  if (action === 'jump-to-question') {
    var jumpIdx = parseInt(el.getAttribute('data-index'), 10);
    if (state.session && jumpIdx >= 0 && jumpIdx <= state.session.index) {
      state.session.viewIndex = jumpIdx;
      closeModal();
      render();
    }
    return;
  }
  if (action === 'open-question-overview') { openQuestionOverview(); return; }

  if (action === 'bookmark-current') {
    var s2 = state.session;
    var m2 = state.mcqs.find(function(x){ return x.id === s2.ids[s2.viewIndex]; });
    m2.flagged = !m2.flagged;
    render();
    saveLibrary();
    return;
  }

  if (action === 'skull-question') {
    /* "Skull it" — agree to see this exact question again before the test ends,
       at a random point you haven't reached yet, not predictably tacked onto the
       end (that would just teach people to anticipate "oh, skulled ones come last").
       Nothing about the re-encounter itself needs separate storage — it's just
       another id sitting in this session's own s.ids queue, so every existing
       mechanism (pause/resume, FSRS recording, results/stats, "Finish session" vs
       "Next question" labeling) already handles it with zero special-casing.
       skullCount is the one thing that DOES persist — a plain field on the mcq,
       synced the exact same way flagged/asleep/needsReview already are (see
       saveLibrary — the whole mcq object rides along as one JSONB blob, no schema
       change needed), and it's what powers Skull Mode's descending-frequency
       ordering later (see startPractice). */
    var s3 = state.session;
    if (!s3) return;
    var skullId = el.getAttribute('data-id');
    var m3 = state.mcqs.find(function(x){ return x.id === skullId; });
    if (!m3) return;
    if (!performAutoSkull(m3, s3)) return; /* already actioned for this exact occurrence — this same id can still be skulled again on a LATER occurrence (that's the whole point), just not twice for the one you're looking at right now. performAutoSkull() also does the actual re-queue-at-a-random-point work, and counts toward s.autoSkullCount either way it's triggered (manual button or auto-on-mistake/timeout) — see its own comment in practex-learning-practice.js. */

    render();
    saveLibrary(); /* fire-and-forget, same convention as bookmark-current just above */
    showToast('🔥 Skulled — you\'ll see this one again before the test ends.');
    return;
  }

  if (action === 'retry-wrong') {
    var ids2 = el.getAttribute('data-ids').split(',').filter(Boolean);
    startPractice(ids2);
    return;
  }

  if (action === 'back-to-library') {
    /* Same origin-context fallback as pendingNavTargetUrl() — read BEFORE clearing
       state.session, same reasoning as the other two exit paths above. */
    var backUrl = state.session && state.session.originContext ? originContextToUrl(state.session.originContext) : null;
    state.session = null;
    window.location.href = backUrl || 'library.html';
    return;
  }
}

/* ---------------- Auth ---------------- */
function userDisplayInfo(user){
  if (!user) return { name: '', email: '', initials: '?', avatarUrl: null };
  var meta = user.user_metadata || {};
  var name = meta.full_name || meta.name || (user.email ? user.email.split('@')[0] : 'Account');
  var initials = name.split(/\s+/).filter(Boolean).slice(0,2).map(function(w){ return w[0].toUpperCase(); }).join('') || '?';
  return { name: name, email: user.email || '', initials: initials, avatarUrl: meta.avatar_url || meta.picture || null };
}
async function signInWithGoogle(){
  if (!supabaseClient) return;
  var errEl = document.getElementById('authError');
  if (errEl) errEl.textContent = '';
  try {
    var res = await supabaseClient.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + window.location.pathname, /* deliberately NOT window.location.href — that can carry forward a stale #hash from a previous sign-in and produce a malformed "##" redirect that Supabase's own client fails to parse */
        queryParams: { prompt: 'select_account' } /* Signing out of Practex only ever clears Practex's own session — it can't and shouldn't touch Google's separate login cookie in the browser. Without this, Google sees that cookie is still there and silently re-authenticates the same account with no picker. This forces the account chooser to actually show, every time. */
      }
    });
    if (res.error) throw res.error;
    /* Browser navigates to Google's consent screen and back — nothing else to do here. */
  } catch(e) {
    console.error('signInWithGoogle:', e);
    if (errEl) errEl.textContent = 'Could not start Google sign-in: ' + (e.message || e);
  }
}
async function signOutUser(){
  if (!supabaseClient) return;
  try {
    await supabaseClient.auth.signOut();
  } catch(e) {
    console.error('signOutUser:', e);
  }
  state.currentUser = null;
  state.mcqs = []; state.sources = {}; state.selectedPath = null; state.session = null; state.imageUrlMap = {};
  if (window.location.hash) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  closeModal();
  showAuthGate();
}
function renderAuthGateBody(){
  var body = document.getElementById('authGateBody');
  if (!body) return;
  if (!SUPABASE_CONFIGURED) {
    body.innerHTML =
      '<div class="auth-config-warning">Supabase isn\'t configured yet. Copy <code>config.example.js</code> ' +
      'to <code>config.js</code> in this same folder and fill in your project URL and anon key — see the ' +
      'setup guide for where to find them.</div>';
    return;
  }
  body.innerHTML =
    '<button class="google-signin-btn" data-action="google-sign-in">' + icon('log-in',17) + ' Continue with Google</button>' +
    '<div class="auth-error" id="authError"></div>';
}
function showAuthGate(){
  document.getElementById('appRoot').style.display = 'none';
  document.getElementById('loadingScreen').style.display = 'none';
  var gate = document.getElementById('authGate');
  gate.style.display = 'flex';
  renderAuthGateBody();
}
async function showApp(){
  document.getElementById('authGate').style.display = 'none';

  /* Chapter 4 bugfix — same-tab fast path, revised after a real QuotaExceededError
     report to split settings (tiny, sessionStorage, synchronous) from the library
     itself (large, sourced from the existing IndexedDB mirror instead — see the big
     comment above persistSessionCache() in practex-data-core.js for the full
     reasoning). Both need to succeed for the fast path to engage; if the mirror
     isn't there yet (brand new account/browser), fall through to a real full load
     rather than showing a library with settings but no questions. The pausedSession
     check still always runs fresh via reconcilePausedSession() — that part is never
     cached, on purpose, since a resumable session can appear from another device or
     an ungraceful exit at any moment. */
  var cache = loadSessionCache();
  var gotMirror = cache ? await applyMirrorAsLibraryFastPath() : false;
  if (cache && gotMirror) {
    applySessionCache(cache);
    document.getElementById('loadingScreen').style.display = 'none';
    document.getElementById('appRoot').style.display = 'grid';
    await reconcilePausedSession();
    /* Real, reproducible bug found via a live report: this fast path skipped
       reconcileSources() entirely — the only thing that catches a question
       whose source never got registered (e.g. an import interrupted between
       saveLibrary() finishing and saveSources() finishing — the questions
       themselves land fine, but the source never becomes a visible "book" in
       Book Shelf). loadLibrary() (the real-boot path) already self-heals this
       on every full load, but this fast path deliberately skips loadLibrary()
       for speed — meaning a session stuck taking this path (which can be
       indefinitely, since a reused tab keeps hitting it) never got the same
       healing, and the missing source could look permanently gone even though
       the questions were saved correctly the whole time. This check is cheap
       (just scans the already-loaded state.mcqs in memory) so there's no
       real cost to running it on every fast-path boot too, not just full ones. */
    if (reconcileSources()) saveSources();
    bootCurrentPage();
    /* THE cross-device sync bug: this fast path skips loadLibrary() entirely for
       speed, which also means it skips the only thing that ever checks whether the
       cloud has changed — e.g. a test finished on another device. A reload only
       clears sessionStorage when the TAB actually closes, not on refresh, so a
       reused tab would take this fast path forever and never see another device's
       progress no matter how many times it was refreshed or "Sync" was clicked
       (manualSync() had its own, separate version of this same bug — see the big
       comment above reconcileWithCloud() in practex-data-core.js).
       Fire-and-forget, silent, and throttled through the EXISTING autoSync()
       15-second minimum interval — reused as-is rather than inventing a second
       throttle — so rapid back-and-forth navigation doesn't refetch the whole
       library every single hop (which would undo the point of this fast path), but
       coming back after any real gap (finished a test elsewhere, stepped away)
       reliably catches up within moments of the page settling, not never. */
    autoSync();
    return;
  }

  /* No same-tab cache — this is a genuinely fresh session (new tab, browser reopened,
     or first load ever). Always a single, complete load before anything renders — no
     painting from a stale cache first and swapping in real data a few seconds later.
     That two-stage flow is exactly what made a truncated fetch look like data
     disappearing before, and even now that the fetch itself is fixed, showing
     something and then changing it is the wrong feeling to give someone who just
     went through that. One full, correct load, then render once. Image URLs load
     separately afterward, in the background — see the comment in loadLibrary(). */
  document.getElementById('loadingScreen').style.display = 'flex';
  document.getElementById('appRoot').style.display = 'none';

  var fillEl = document.getElementById('loadingFill');
  var mouseEl = document.getElementById('progressMouse');
  var msgEl = document.getElementById('loadingMsg');
  var etaEl = document.getElementById('loadingEta');
  var messages = ['Getting things ready…', 'Gathering your questions…', 'Almost there…', 'Just a little longer…'];
  var msgIdx = 0;
  var msgTimer = setInterval(function(){
    msgIdx = (msgIdx + 1) % messages.length;
    if (msgEl) msgEl.textContent = messages[msgIdx];
  }, 2200);

  var loadStartedAt = Date.now();
  await loadLibrary(function(loaded, total){
    var pct = total ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
    if (fillEl && total) fillEl.style.width = pct + '%';
    if (mouseEl && total) mouseEl.style.left = pct + '%'; /* runs along the real fill, not a decorative loop */
    if (msgEl && total) msgEl.textContent = 'Loaded ' + loaded.toLocaleString() + ' of ' + total.toLocaleString() + ' questions…';
    /* A genuine estimate from actual throughput so far, not a fake countdown —
       extrapolates from how long it took to get this far to how long the rest should
       take. Skipped for the first ~300ms, since a rate computed from almost no
       elapsed time swings wildly and would just flash a nonsense number briefly. */
    if (etaEl && total) {
      var elapsed = Date.now() - loadStartedAt;
      if (loaded >= total) {
        etaEl.textContent = 'Finishing up…';
      } else if (elapsed > 300 && loaded > 0) {
        var rate = loaded / elapsed; // rows per ms
        var remainingMs = (total - loaded) / rate;
        var remainingSec = Math.max(1, Math.round(remainingMs / 1000));
        etaEl.textContent = 'About ' + remainingSec + (remainingSec === 1 ? ' second' : ' seconds') + ' left';
      }
    }
  });
  clearInterval(msgTimer);

  document.getElementById('loadingScreen').style.display = 'none';
  document.getElementById('appRoot').style.display = 'grid';
  bootCurrentPage();
}

/* Chapter 4 (MPA) — page-specific boot, shared by both the fast (cached) and full
   (fresh) paths above, now that state.pausedSession has been reconciled from every
   source one way or another (cloud/mirror/sync-key/live crash-recovery). Runs once,
   right before the very first render() on whichever page we're actually on. */
function bootCurrentPage(){
  try { state.skullModeActive = localStorage.getItem('practex_skull_mode') === '1'; } catch(e) {} /* device-local display preference — same lightweight pattern as practex_landing_view, read once here regardless of which page/branch below runs */
  try {
    var storedSecs = parseInt(localStorage.getItem('practex_time_per_q'), 10);
    state.defaultTimePerQ = (!isNaN(storedSecs) && storedSecs >= 0) ? storedSecs : 60; /* seconds; 0 = no limit. Only the DEFAULT offered on a fresh test's gate screen — each session's own timePerQ, once chosen, travels with that session regardless of what this default changes to afterward. */
  } catch(e) { state.defaultTimePerQ = 60; }
  try { state.defaultAutoSkull = localStorage.getItem('practex_auto_skull') !== '0'; } catch(e) { state.defaultAutoSkull = true; } /* on by default */
  var onPracticePage = /practice\.html/.test(window.location.pathname);
  if (onPracticePage) {
    var hasSession = goToPracticeIfSessionPending(); /* navigates away itself if there's nothing to resume — see practex-learning-practice.js */
    if (!hasSession) return; /* navigation already in flight; rendering this page now would just flash stale content before the browser leaves it */
  } else {
    /* library.html (or a direct load of index.html, which redirects before this ever
       runs) — restore whatever view/path a pendingNavTargetUrl() redirect encoded, the
       same restoration applyPendingNav() used to do in-memory before MPA made that a
       real navigation instead. A plain visit with no query string just uses whatever
       state.view already defaults to. */
    var params = new URLSearchParams(window.location.search);
    var qView = params.get('view');
    var qPath = params.get('path');
    if (qPath) {
      state.selectedPath = qPath.split('␟');
      state.view = 'browse';
      state.expanded[qPath] = true;
      state.forceList = false;
      resetFolderFilters();
    } else if (qView) {
      state.view = qView;
      if (qView === 'bookshelf') {
        var qSource = params.get('source');
        if (qSource) state.bookshelfActiveSource = qSource; /* restores which specific book was open, not just the shelf grid — matches originContextToUrl()'s &source= param when a test was started from inside a book */
      }
    } else {
      /* A genuinely fresh visit — no navigation redirect brought us here — uses
         whichever landing view the person picked in Settings, defaulting to
         Library if they've never set one. Deliberately checked AFTER qView/qPath,
         so a real in-app navigation (e.g. clicking "Library" from Book Shelf)
         always wins over this default, which only applies to opening the site cold. */
      try {
        var savedLanding = localStorage.getItem('practex_landing_view');
        if (savedLanding === 'bookshelf') state.view = 'bookshelf';
      } catch(e) {}
    }
  }

  render();
  loadImageUrlMap().then(hydrateImages); /* background, not awaited — the initial screen has no images to show anyway */
}

/* ---------------- Init ---------------- */
/* Fix for a real, reported bug: drag-selecting text inside a modal (e.g. the days
   input in the study plan setup) closed the modal instead of just selecting text.
   Root cause — this is the textbook version of a well-known browser behavior, not
   specific to this app: when mousedown and the eventual click/mouseup land on
   DIFFERENT elements (exactly what a text-selection drag does — mousedown on the
   input, mouseup wherever the drag ends), the browser fires `click` on the NEAREST
   COMMON ANCESTOR of the two, not on either original element. Drag-selecting the
   text in a small input inside a narrow modal easily lets that final mouseup
   position land outside the modal card's bounds, so the computed click target
   becomes the backdrop itself — even though the gesture never actually intended to
   click the backdrop at all. The existing modal-backdrop-close handler only checked
   the click's resolved target, which is exactly the check this quirk defeats.
   The fix: track where mousedown ITSELF happened, and only treat it as a genuine
   "click to close" if mousedown ALSO started directly on the backdrop — a real
   backdrop click always satisfies both; a text-selection drag that merely
   resolves to the backdrop by the common-ancestor rule never does, since it
   started on the input. */
var lastMouseDownOnBackdrop = false;
document.addEventListener('mousedown', function(e){
  lastMouseDownOnBackdrop = !!(e.target && e.target.getAttribute && e.target.getAttribute('data-action') === 'modal-backdrop-close');
});

/* Guards against a real, reproducible bug: the in-app blocking import modal
   (see confirm-import) stops someone clicking away to another screen mid-
   import, but it can't stop the browser's OWN navigation controls — the back
   button, closing the tab, or a hard refresh all happen entirely outside the
   page's control. Any of those mid-import could interrupt the save sequence
   between saveLibrary() (the questions) finishing and saveSources() (the
   source registry) finishing — the questions land correctly, but the source
   never becomes a visible "book," which is exactly what led to a duplicate
   import (the person, seeing no source appear, assumed it hadn't worked and
   tried again). importInFlight is set for the exact duration of that risky
   window in confirm-import; while it's true, leaving triggers the browser's
   own "are you sure?" confirmation, not a custom message (browsers don't allow
   custom text here anymore) but enough to give a real chance to cancel. */
var importInFlight = false;
window.addEventListener('beforeunload', function(e){
  if (!importInFlight) return;
  e.preventDefault();
  e.returnValue = '';
});

async function init(){
  document.body.addEventListener('click', onClick); /* bound once — delegates for both #appRoot, #authGate, and #modalRoot */
  var importInput = document.getElementById('importFileInput');
  if (importInput) {
    importInput.addEventListener('change', function(e){
      var file = e.target.files && e.target.files[0];
      if (file) handleImportFileSelected(file);
      e.target.value = '';
    });
  }
  /* Paste a screenshot (Ctrl/Cmd+V) straight into the Edit Question modal to attach it —
     bound once here rather than per modal-open, same reasoning as the click delegation
     above: re-binding on every openEditModal() call would stack duplicate listeners. */
  /* Real bug found from a live report: pasted MCQ text sometimes vanished
     entirely instead of appearing in the textarea. Root cause — the handler
     below checked for ANY image item in the clipboard and unconditionally called
     preventDefault() when found, discarding whatever text was ALSO in the same
     clipboard payload. Many real copy sources put BOTH a text and an image
     representation on the clipboard at once (PDF viewers, rich text from Word/
     Docs, some screenshot/OCR tools) — so copying a block of MCQ text that
     happened to have an image anywhere in the source selection would silently
     eat the text and paste nothing. Text now always takes priority: if there's
     any substantial text on the clipboard, this lets the default paste proceed
     normally and doesn't touch the image at all — only a clipboard with NO real
     text gets treated as a pure image paste. */
  function clipboardHasSubstantialText(e){
    try {
      var t = (e.clipboardData.getData('text/plain') || e.clipboardData.getData('text') || '').trim();
      return t.length > 0;
    } catch(err) { return false; }
  }
  document.addEventListener('paste', function(e){
    if (clipboardHasSubstantialText(e)) return; /* let the default paste happen — text wins, never silently discarded for an incidental image on the same clipboard */
    if (state.editingMcqId) {
      var items = (e.clipboardData && e.clipboardData.items) || [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.indexOf('image/') === 0) {
          var file = items[i].getAsFile();
          if (file) { e.preventDefault(); attachImageToMcq(state.editingMcqId, file); }
          return;
        }
      }
      return;
    }
    /* Real friction reported: raw MCQ text pasted from PDFs often has an
       accompanying screenshot/diagram (histology, gross pathology) that until now
       had to be uploaded separately (e.g. via ClipMonkey) and its resulting link
       manually copied back in as #IMAGE_Q:/#IMAGE_A:. Pasting the image directly
       into the ingest textarea now does that whole round trip itself — same
       ImgBB pipeline as a real file upload, genuinely "as if uploaded from
       device," just triggered by paste instead of a file picker. */
    if (e.target && e.target.id === 'ingestArea') {
      var ingestItems = (e.clipboardData && e.clipboardData.items) || [];
      for (var j = 0; j < ingestItems.length; j++) {
        if (ingestItems[j].type && ingestItems[j].type.indexOf('image/') === 0) {
          var imgFile = ingestItems[j].getAsFile();
          if (imgFile) { e.preventDefault(); pasteImageIntoIngestArea(imgFile); }
          return;
        }
      }
    }
  });

  /* Every real "you might be reconnected now" moment gets its own listener —
     no single one covers every case. Switching back to the tab and the
     browser's own 'online' event (the one most people miss — it fires even
     if you never left the tab at all, signal just dropped and came back)
     are both genuinely necessary, not redundant. */
  document.addEventListener('visibilitychange', function(){ if (document.visibilityState === 'visible') autoSync(); });
  window.addEventListener('focus', autoSync);
  window.addEventListener('pageshow', function(e){ if (e.persisted) autoSync(); }); // restored from back/forward cache
  window.addEventListener('online', function(){ updateSyncIndicator(); autoSync(); });
  window.addEventListener('offline', updateSyncIndicator);

  /* Auto-persist on tab hide/close — Chapter 3. Previously this set state.pausedSession
     directly, live, the moment the tab was hidden — which had two real bugs, found by
     tracing this against the new question types: (1) the `!state.pausedSession` guard
     meant only the FIRST hide during a session ever snapshotted anything, so hide →
     come back → keep answering → close for real would silently resume from the STALE
     first snapshot, losing everything answered in between; and (2) setting
     state.pausedSession live meant just alt-tabbing and coming right back made the
     sidebar show a "Paused test — Resume" card for a session the person never actually
     left, since that card's visibility is driven directly by state.pausedSession being
     truthy in memory, not by whether they're still on screen.

     persistLiveSessionSync() fixes both: it writes fresh on every call (no one-shot
     guard), and it writes to a SEPARATE key that never touches state.pausedSession
     in-memory — so nothing changes on screen until the NEXT app load, and only if the
     browser closed ungracefully rather than reaching a normal exit. See the big
     comment above persistLiveSessionSync() in practex-data-core.js, and the
     reconciliation logic in loadLibrary() that adopts a leftover entry as a real
     pausedSession only when it's actually the freshest thing available. */
  document.addEventListener('visibilitychange', function(){
    if (document.visibilityState === 'hidden') persistLiveSessionSync();
  });
  window.addEventListener('pagehide', function(){
    persistLiveSessionSync();
  });

  if ('serviceWorker' in navigator) {
    /* Direct registration, not wrapped in a window 'load' listener — if this
       script runs after the document is already 'complete' (easy to happen
       with a large inline script near the end of <body>), a 'load' listener
       attached at that point would simply never fire. */
    navigator.serviceWorker.register('sw.js').catch(function(err){
      console.warn('Service worker registration failed — offline page loading unavailable, everything else is unaffected:', err);
    });
  }

  if (!supabaseClient) {
    document.getElementById('loadingScreen').style.display = 'none';
    showAuthGate();
    return;
  }

  var authInitialized = false;
  supabaseClient.auth.onAuthStateChange(function(event, session){
    /* This is the ONLY onAuthStateChange listener in the app — there used to be a
       second, older one registered here too, with none of the guards below. That
       duplicate is why switching tabs (which triggers a background TOKEN_REFRESHED
       as Supabase silently renews the short-lived access token) was re-triggering
       the full "Loading your library…" screen: the old listener called showApp()
       unconditionally on any SIGNED_IN-shaped event, bypassing every safeguard here.
       TOKEN_REFRESHED/USER_UPDATED should never touch the UI at all — they're pure
       session housekeeping, not a sign-in or sign-out. */
    if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
      if (session && session.user) state.currentUser = session.user; // keep the session object current, silently
      return;
    }
    if (event === 'SIGNED_OUT') {
      authInitialized = true;
      state.currentUser = null;
      showAuthGate();
      return;
    }
    /* Remaining events: INITIAL_SESSION (fires once on subscribe, waiting for any
       OAuth-redirect token in the URL to finish parsing first) and SIGNED_IN. */
    if (session && session.user) {
      if (authInitialized && state.currentUser && state.currentUser.id === session.user.id) { state.currentUser = session.user; return; } // already loaded — don't reload
      authInitialized = true;
      state.currentUser = session.user;
      /* Explicitly wipe any #access_token=... fragment once it's been consumed, rather
         than assuming the client library already did — leaving it in the address bar is
         what let a stale hash ride along into the next sign-in's redirectTo and produce
         a malformed "##" URL that fails to parse. */
      if (window.location.hash) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
      showApp();
    } else {
      authInitialized = true;
      state.currentUser = null;
      if (window.location.hash) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
      showAuthGate();
    }
  });
}
init();


document.addEventListener('keydown', function(e){
  if(state.view!=='practice' || !state.session) return;
  var active=document.activeElement;
  var typing=active && (active.tagName==='INPUT'||active.tagName==='TEXTAREA'||active.tagName==='SELECT'||active.isContentEditable);
  if(typing) return;
  var s=state.session;
  var isReviewing = s.viewIndex < s.index;
  var m=state.mcqs.find(function(x){return x.id===s.ids[s.viewIndex];}); /* the question actually on screen, not necessarily the frontier */
  if(!m) return;

  /* Left/Right move between questions regardless of review state — mirrors the
     Prev/Next buttons above the question. */
  if(e.key==='ArrowLeft'){ e.preventDefault(); if(s.viewIndex>0){ s.viewIndex--; render(); } return; }
  if(e.key==='ArrowRight'){ e.preventDefault(); if(s.viewIndex<s.index){ s.viewIndex++; render(); } return; }

  /* B (and F, kept for anyone already used to it) toggles bookmark — checked here,
     before the isReviewing gate below, specifically so it works on whichever
     question is currently on screen regardless of whether it's already been
     answered or not, same reasoning as Left/Right above. Bookmarking doesn't
     mutate answer state the way selecting/revealing does, so there's no reason
     for it to be restricted to the frontier question only.
     Deliberately checked BEFORE the letter-selects-an-option handler further down
     — "B" is almost always a real option letter (virtually every 4-option MCQ has
     one), so without this ordering, B would silently select option B instead of
     bookmarking on the overwhelming majority of questions, making the shortcut
     look broken for exactly the most common case. Selecting option B by keyboard
     still works fine via the number keys (1-9) below. */
  if(e.key==='b'||e.key==='B'||e.key==='f'||e.key==='F'){
    e.preventDefault(); m.flagged=!m.flagged; saveLibrary(); render(); return;
  }

  /* Everything below mutates answer state, so it only applies to the current frontier
     question — while reviewing a past one, selecting/revealing/advancing would
     silently act on a different (frontier) question than what's on screen otherwise. */
  if(isReviewing) return;

  /* Number keys 1-9 select the corresponding option (pre-reveal only) — only applies
     to the standard bubble-MCQ shape (m.options), so explicitly excluded for the newer
     types that don't use it, rather than relying on m.options being an empty array. */
  if(/^[1-9]$/.test(e.key) && !s.revealed && !m.isShortAnswer && !m.type){
    var idx=parseInt(e.key,10)-1;
    if(m.options[idx]){ e.preventDefault(); toggleOptionSelection(m, s, m.options[idx].letter); render(); }
    return;
  }

  /* Letter keys (A, C, D...) select the option with that letter — B and F never
     reach here, already consumed by the bookmark toggle above. */
  if(/^[a-zA-Z]$/.test(e.key) && !s.revealed && !m.isShortAnswer && !m.type){
    var letter=e.key.toUpperCase();
    var match=m.options.filter(function(o){ return o.letter===letter; })[0];
    if(match){ e.preventDefault(); toggleOptionSelection(m, s, letter); render(); return; }
  }

  /* Space: before reveal, acts as Check Answer (only if something is selected);
     after reveal, advances to the next question — same as clicking "Next question".
     Each of the 4 new types has its own "is this ready to check" condition and its
     own "pull the live value into s.selected" step, mirroring what their own
     Check-answer / Reveal-answer buttons already do via data-action handlers —
     this keyboard path has to do the same work manually since it bypasses those. */
  if(e.code==='Space'){
    e.preventDefault();
    /* Card has no check/reveal step at all — it's just read the content, then Next.
       Without this, it fell into the generic hasSelection fallback below, which is
       always false for a card (nothing is ever "selected"), so space silently did
       nothing — the one type where every other keyboard shortcut in this handler
       genuinely doesn't apply, since there's nothing to check an answer against. */
    if (m.type === 'card') { advanceAfterReveal(); return; }
    if(!s.revealed){
      var hasSelection;
      if (m.isShortAnswer) {
        hasSelection = !!(document.getElementById('shortAnswerInput') && document.getElementById('shortAnswerInput').value.trim());
        if (hasSelection) s.selected = document.getElementById('shortAnswerInput').value.trim();
      } else if (m.type === 'mnemonic') {
        hasSelection = !!(document.getElementById('shortAnswerInput') && document.getElementById('shortAnswerInput').value.trim());
        if (hasSelection) s.selected = document.getElementById('shortAnswerInput').value.trim();
      } else if (m.type === 'match') {
        hasSelection = !!(s.selected && s.selected.links && Object.keys(s.selected.links).length === m.pairs.length);
      } else if (m.type === 'sequence') {
        hasSelection = Array.isArray(s.selected) && s.selected.length === m.steps_correct_order.length; /* always true once initialized — a sequence question always has a full (if shuffled) order from the moment it's shown */
      } else if (m.type === 'cutoff') {
        var sliderEl = document.getElementById('cutoffSlider');
        if (sliderEl) s.selected = parseFloat(sliderEl.value); /* pull the live DOM value in case a keyboard-only interaction moved it without the drag listener firing */
        hasSelection = typeof s.selected === 'number' && !isNaN(s.selected);
      } else {
        hasSelection = !!(s.selected && s.selected.length);
      }
      if(!hasSelection) return;
      revealCurrent();
    } else {
      if ((m.isShortAnswer || m.type === 'mnemonic') && s.shortAnswerCorrect === null) return; /* must self-grade via the buttons first — otherwise this would silently record as wrong */
      /* Mirrors the render logic's own branching exactly — space should trigger
         whichever button is actually showing on screen. For a wrong match/sequence
         answer, that's "Show correct pairs/order" FIRST (a second space press after
         that reaches Next) — without this check, space would skip straight past that
         intermediate reveal step and jump to advancing, which never happened when
         clicking through by hand. */
      if (m.type === 'sequence') {
        var seqAllCorrect = Array.isArray(s.selected) && s.selected.every(function(origIdx, pos){ return origIdx === pos; });
        if (!seqAllCorrect) { animateSequenceToCorrect(m); return; }
      }
      if (m.type === 'match') {
        var matchAllCorrect = s.selected && s.selected.links && m.pairs.every(function(pair, i){ return s.selected.links[i] === i; });
        var matchShown = !!(s.selected && s.selected.correctPairsShown);
        if (!matchAllCorrect && !matchShown) { animateMatchToCorrect(m); return; }
      }
      advanceAfterReveal();
    }
    return;
  }
});

document.addEventListener('keydown', function (e) {
  if (e.key !== 'Backspace') return;

  var el = document.activeElement;
  var typing = el && (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable
  );

  if (typing) return;

  e.preventDefault();

  if (state.view === 'practice' && state.session) { requestLeavePractice(); return; }
  if (state.view !== 'browse') { state.view = 'browse'; state.forceList = false; render(); return; }

  if (!state.selectedPath) return;

  if (state.selectedPath.length === 1) {
    state.selectedPath = null;
    state.forceList = false;
  } else {
    state.selectedPath = state.selectedPath.slice(0, -1);
    state.forceList = false;
  }

  render();
});
