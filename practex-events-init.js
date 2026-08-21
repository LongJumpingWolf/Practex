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
}

async function onClick(e){
  var el = e.target.closest('[data-action]');
  if (!el) return;
  var action = el.getAttribute('data-action');

  if (action === 'toggle-sidebar') { state.sidebarOpen = !state.sidebarOpen; render(); return; }
  if (action === 'manual-sync') { manualSync(); return; }
  if (action === 'set-view') { if (guardNavigation(action, el)) return; state.view = el.getAttribute('data-view'); state.sidebarOpen = false; render(); return; }
  if (action === 'open-dashboard') { if (guardNavigation(action, el)) return; state.view = 'dashboard'; state.sidebarOpen = false; render(); return; }
  if (action === 'toggle-fsrs-mode') {
    state.learningMode.enabled = !state.learningMode.enabled;
    saveFsrsMode();
    showToast('FSRS Mode ' + (state.learningMode.enabled ? 'enabled' : 'disabled'));
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
    var enteringShelf = state.view !== 'bookshelf';
    state.view = enteringShelf ? 'bookshelf' : 'browse';
    state.bookshelfActiveSource = null; /* always start fresh at the shelf grid, whichever direction this switch just went */
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
  if (action === 'sign-out') { signOutUser(); return; }
  if (action === 'google-sign-in') { signInWithGoogle(); return; }
  if (action === 'start-queue-preview') { state.view = 'queuepreview'; state.sidebarOpen = false; render(); return; }
  if (action === 'start-due-session') {
    var dueIds = getLearningQueue(state.mcqs.map(function(m){return m.id;}));
    requestStartPractice(dueIds, true);
    return;
  }
  if (action === 'start-study-ahead') {
    var tomorrow = Date.now() + 86400000;
    var byId = {}; state.mcqs.forEach(function(m){ byId[m.id]=m; });
    var ids = state.mcqs.filter(function(q){ return (q.learning.due||0) <= tomorrow; }).map(function(q){ return q.id; });
    requestStartPractice(ids, true);
    return;
  }
  if (action === 'start-practice-all') {
    var allIds = state.mcqs.map(function(m){ return m.id; });
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
    var ids = node ? collectIds(node) : state.mcqs.map(function(m){ return m.id; });
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
    var expIds = (expSearchAll || !expNode) ? state.mcqs.map(function(m){ return m.id; }) : collectIds(expNode);
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
    reportHtml += '<div class="action-row"><button class="btn btn-primary" data-action="confirm-import">Import ' + result.mcqs.length + ' questions</button></div>';
    reportEl.innerHTML = reportHtml;
    reportEl._pending = result.mcqs;
    return;
  }

  if (action === 'confirm-import') {
    var reportEl2 = document.getElementById('parseReport');
    var pending = reportEl2 && reportEl2._pending;
    if (!pending || !pending.length) return;
    pending.forEach(function(m){
      if (!state.sources[m.source]) state.sources[m.source] = { color: colorForSource(m.source) };
    });
    state.mcqs = state.mcqs.concat(pending);
    document.getElementById('ingestArea').value = '';
    state.view = 'browse';
    showToast('Saving ' + pending.length + ' question' + (pending.length===1?'':'s') + '…');
    render();
    /* Deliberately AWAITED, not fire-and-forget — this is exactly the operation that
       broke before: showing "success" and letting you navigate/reload away while the
       actual Supabase write was still in flight meant a reload could abort it before
       it ever reached the server, silently losing the whole import. Bulk import is
       rare enough that the extra wait is worth the correctness; frequent taps
       (Next question, Bookmark, etc.) stay optimistic on purpose. */
    await saveLibrary();
    await saveSources();
    if (state.lastSaveHadPermanentConflict) {
      /* saveLibrary() already showed a specific explanation — don't pile a misleading
         "success" message on top of it. */
    } else if (state.hasUnsyncedChanges) {
      showToast(pending.length + ' question' + (pending.length===1?'':'s') + ' saved locally — will sync once you\'re back online.');
    } else {
      showToast(pending.length + ' question' + (pending.length===1?'':'s') + ' imported and saved.');
    }
    return;
  }

  if (action === 'delete-source') {
    var srcName = el.getAttribute('data-source');
    if (!confirm('Delete "' + srcName + '" and all its MCQs? This cannot be undone.')) return;
    var removedSrcIds = state.mcqs.filter(function(m){ return m.source === srcName; }).map(function(m){ return m.id; });
    state.mcqs = state.mcqs.filter(function(m){ return m.source !== srcName; });
    delete state.sources[srcName];
    showToast('Deleting source…');
    render();
    /* Awaited, and an explicit delete rather than an upsert of what's left — upsert
       only ever updates/inserts rows present in the payload, it never removes rows
       that are simply missing from it, so this always needed a real DELETE call. */
    await deleteMcqRows(removedSrcIds);
    await saveSources();
    showToast('Source deleted.');
    return;
  }

  if (action === 'clear-all') {
    if (!confirm('Delete your entire Practex library? This cannot be undone.')) return;
    var allMcqIds = state.mcqs.map(function(m){ return m.id; });
    state.mcqs = [];
    state.sources = {};
    state.selectedPath = null;
    showToast('Clearing your library…');
    render();
    await deleteMcqRows(allMcqIds); /* same reasoning as delete-source above — upsert can't remove rows */
    await saveSources();
    showToast('Library cleared.');
    return;
  }

  if (action === 'close-modal') { state.pendingNav = null; closeModal(); return; }
  if (action === 'modal-backdrop-close') { if (e.target === el) { state.pendingNav = null; closeModal(); } return; }
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
      /* Awaited — a rename/move/copy/delete is rare and high-stakes enough that
         showing "done" and letting a reload interrupt the actual save (aborting it
         mid-flight, same failure mode that lost imports) is worse than the extra
         half-second wait. Frequent taps during practice stay optimistic on purpose. */
      await saveLibrary(); await saveSleepingSubjects();
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
      var removedMcqs = deleteDeck(delArr);
      var removedIds = removedMcqs.map(function(m){ return m.id; });
      if (state.selectedPath && state.selectedPath.join('␟').indexOf(delPath) === 0) {
        state.selectedPath = null; state.forceList = false;
      }
      closeModal(); render();
      showToast('Deleted ' + removedIds.length + ' question' + (removedIds.length===1?'':'s') + '.');
      var candidateHashes = [];
      removedMcqs.forEach(function(m){
        (m.images || []).forEach(function(h){ candidateHashes.push(h); });
        (m.answerImages || []).forEach(function(h){ candidateHashes.push(h); });
      });
      await deleteMcqRows(removedIds);
      await purgeOrphanedImageHashes(candidateHashes);
    } else {
      closeModal();
    }
    return;
  }
  if (action === 'leave-practice') { requestLeavePractice(); return; }
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
    if(pending){ state.learningMode.enabled=pending.learningEnabled; startPractice(pending.ids); }
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
    sel.pendingLeft = parseInt(el.getAttribute('data-i'), 10);
    render();
    return;
  }
  if (action === 'match-pick-right') {
    if (state.session.revealed) return;
    var sel2 = state.session.selected;
    if (!sel2 || sel2.pendingLeft === null || sel2.pendingLeft === undefined) return;
    var rightIdx = parseInt(el.getAttribute('data-i'), 10);
    sel2.links[sel2.pendingLeft] = rightIdx;
    sel2.pendingLeft = null;
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

  if (action === 'retry-wrong') {
    var ids2 = el.getAttribute('data-ids').split(',').filter(Boolean);
    startPractice(ids2);
    return;
  }

  if (action === 'back-to-library') {
    state.session = null;
    window.location.href = 'library.html';
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
    bootCurrentPage();
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
    }
  }

  render();
  loadImageUrlMap().then(hydrateImages); /* background, not awaited — the initial screen has no images to show anyway */
}

/* ---------------- Init ---------------- */
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
  document.addEventListener('paste', function(e){
    if (!state.editingMcqId) return;
    var items = (e.clipboardData && e.clipboardData.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].type && items[i].type.indexOf('image/') === 0) {
        var file = items[i].getAsFile();
        if (file) { e.preventDefault(); attachImageToMcq(state.editingMcqId, file); }
        break;
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

  /* Letter keys (A, B, C, D...) select the option with that letter */
  if(/^[a-zA-Z]$/.test(e.key) && !s.revealed && !m.isShortAnswer && !m.type){
    var letter=e.key.toUpperCase();
    var match=m.options.filter(function(o){ return o.letter===letter; })[0];
    if(match){ e.preventDefault(); toggleOptionSelection(m, s, letter); render(); return; }
  }

  /* F toggles bookmark */
  if(e.key==='f'||e.key==='F'){
    e.preventDefault(); m.flagged=!m.flagged; saveLibrary(); render(); return;
  }

  /* Space: before reveal, acts as Check Answer (only if something is selected);
     after reveal, advances to the next question — same as clicking "Next question".
     Each of the 4 new types has its own "is this ready to check" condition and its
     own "pull the live value into s.selected" step, mirroring what their own
     Check-answer / Reveal-answer buttons already do via data-action handlers —
     this keyboard path has to do the same work manually since it bypasses those. */
  if(e.code==='Space'){
    e.preventDefault();
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
