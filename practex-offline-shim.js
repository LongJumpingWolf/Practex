/* practex-offline-shim.js
   ---------------------------------------------------------------------------
   Loaded as an EXTRA script, after the 5 real app files and after their normal
   init() has already run (and, right now, shown the login screen, since
   Supabase Auth is unreachable). This takes over immediately afterward:

   1. Kills all outbound network calls for the rest of this session by nulling
      supabaseClient — every save/sync function in the real app already has an
      "if (!state.currentUser || !supabaseClient) return/fallback" guard at its
      top (see saveLibrary, saveUserSettings, etc. in practex-data-core.js), so
      this alone makes every one of them a safe local-only no-op without
      touching a single line of that logic.
   2. Reads straight from THIS BROWSER's existing local mirror
      (practex_data_mirror_v1, populated by ordinary earlier use of the real
      app on this exact device) and hydrates state from it directly —
      bypassing login and loadLibrary() entirely.
   3. Renders the real app UI. Everything downstream — practice, timers, skull
      mode, images (resolveImageRef() already checks the local image cache
      first, before ever needing a cloud URL) — is completely unmodified,
      because none of it actually depends on Supabase being reachable, only on
      state being populated and supabaseClient being present-or-absent.

   Single device only, on purpose: the local mirror only exists in the browser
   it was written from. This is meant to be temporary, while real account
   access gets sorted out — nothing here is a replacement for the real sync.
   Never overwrites or deletes the local mirror; if anything goes wrong, the
   original data this shim reads from is untouched. */
(async function offlineBoot(){
  // Not on library.html or practice.html (e.g. a stray include on some other
  // page) — do nothing.
  if (!document.getElementById('authGate') && !document.getElementById('appRoot')) return;

  window.PRACTEX_OFFLINE_MODE = true; // read by practexPageUrl() in practex-data-core.js — makes every internal redirect (start/resume/leave practice, "back to library", plan/dashboard links) stay on the -offline pages instead of bouncing back out to the real login-gated ones. Set FIRST, before anything else, since startPractice() etc. can fire from user clicks at any point after this.

  supabaseClient = null; // see the big comment above — this alone makes every existing save/sync call a safe no-op

  // NOT loadLocalMirror() — that helper requires state.currentUser to already be
  // set AND match the mirror's own userId (it's an identity check meant for the
  // normal "already logged in, confirm this cache is really theirs" case). Here
  // we're trying to discover the user FROM the mirror in the first place — there's
  // no live auth to cross-check against anyway in offline mode — so this reads
  // the same record directly via the same low-level helpers, without that gate.
  var mirror = null;
  try {
    var db = await openDataMirrorDb();
    var tx = db.transaction(DATA_MIRROR_STORE_NAME, 'readonly');
    mirror = await requestToPromise(tx.objectStore(DATA_MIRROR_STORE_NAME).get('current'));
  } catch (e) { console.error('offline shim: could not read local mirror:', e); }

  if (!mirror) {
    /* Genuinely nothing on this device yet — not an error state, just what a
       brand-new account looks like before anyone's added anything. The old
       version of this shim treated it as a dead end (a blocking "no data found"
       screen with nowhere to go) — but there's no real reason it has to be:
       "Add source" doesn't touch Supabase for the actual paste/parse/save-locally
       part at all (only the eventual cloud sync does, which is already a safe
       no-op — see the top comment). So this device just starts as an empty
       library, exactly like any fresh signup, and the person can paste content
       into it directly, or use import-offline-backup.html if they have a backup
       from elsewhere — that page still exists, it just isn't the only door now. */
    mirror = {
      key: 'current', version: 1, updatedAt: Date.now(),
      userId: 'offline-local-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
      mcqs: [], sources: {}, streak: { count: 0, lastDate: null }, sleepingSubjects: {},
      fsrsModeEnabled: false, darkMode: false, fsrsCardExpanded: true,
      autoSleepEnabled: true, autoSleepStreak: 4, emptyFolders: [], studyPlans: {},
      pausedSession: null
    };
    try {
      var seedDb = await openDataMirrorDb();
      var seedTx = seedDb.transaction(DATA_MIRROR_STORE_NAME, 'readwrite');
      seedTx.objectStore(DATA_MIRROR_STORE_NAME).put(mirror);
      await requestToPromise(seedTx.objectStore(DATA_MIRROR_STORE_NAME).get('current')); // just to await the transaction settling before moving on
    } catch (e) { console.error('offline shim: could not seed a fresh local identity:', e); } // non-fatal — worst case this device just regenerates a new empty identity next boot too, still usable, just doesn't persist across reloads until a write succeeds
  }

  // A believable-enough fake session object — just enough for userDisplayInfo()
  // and anywhere else in the app that reads state.currentUser's shape, without
  // ever touching the network.
  state.currentUser = { id: mirror.userId, email: 'Offline mode', user_metadata: { full_name: 'Offline mode' } };
  applyMirrorToState(mirror, false); // false = don't skip mcqs, load everything — this also sets the mirror's own state.pausedSession as a baseline, reconciled against fresher local sources next

  /* The real app's reconcilePausedSession() does exactly this comparison — mirror
     vs. the two localStorage safety nets below — but it bails out immediately on
     "if (!supabaseClient) return", since it also tries a cloud read first. That
     guard is correct for the online app (no point reconciling without checking
     the cloud too) but means offline mode never got ANY reconciliation at all —
     it only ever saw whatever the mirror happened to have, which is written
     asynchronously and can easily lose a race against a reload or an actual tab
     close. Replicated here without the cloud row, since there isn't one:
       - PAUSED_SESSION_SYNC_KEY: written synchronously the instant "Pause & leave"
         is clicked — durable even if the mirror's own async write hadn't landed
         yet. This is why "pause, immediately reload" was inconsistent before.
       - LIVE_SESSION_SYNC_KEY: rewritten on every practice-screen render while a
         session is live, completely independent of any explicit pause — this is
         what an ungraceful tab close or reload mid-test actually needs, and
         nothing was ever checking it in offline mode at all. */
  var mirrorPausedAt = mirror.pausedSession ? (mirror.pausedSession.pausedAt || 0) : 0;
  var syncPaused = loadPausedSessionSync();
  var syncPausedAt = syncPaused ? (syncPaused.pausedAt || 0) : 0;
  var liveSync = loadLiveSessionSync();
  var liveSyncAt = liveSync ? (liveSync.savedAt || 0) : 0;
  var bestPausedAt = Math.max(mirrorPausedAt, syncPausedAt, liveSyncAt);
  if (bestPausedAt > mirrorPausedAt) {
    if (liveSyncAt === bestPausedAt) {
      state.pausedSession = liveSync.session;
      state.pausedSession.pausedAt = liveSync.savedAt;
      state.pausedSession.recoveredFromCrash = true; // renderBrowse() shows this distinctly — "Recovered session", not "Paused test", since the person didn't choose this
    } else {
      state.pausedSession = syncPaused;
    }
    saveUserSettings(); // offline-safe (see the top comment) — writes the winning choice back into the mirror so the next boot doesn't need to redo this comparison
  }
  clearLiveSessionSync(); // matches reconcilePausedSession()'s own unconditional clear — whether or not it won, a stale crash-recovery entry shouldn't linger and get re-offered on a future boot after this one's already been resolved one way or the other

  if (typeof reconcileSources === 'function' && reconcileSources()) {
    saveSources(); // safe no-op over the network now (supabaseClient is null); still persists locally via persistLocalMirror() at the top of saveUserSettings()
  }

  var authGateEl = document.getElementById('authGate');
  var loadingEl = document.getElementById('loadingScreen');
  var appRootEl = document.getElementById('appRoot');
  if (authGateEl) authGateEl.style.display = 'none';
  if (loadingEl) loadingEl.style.display = 'none';
  if (appRootEl) appRootEl.style.display = 'grid';

  if (typeof bootCurrentPage === 'function') bootCurrentPage(); // same page-specific boot the real app uses (practice.html session reconciliation, skull-mode/timer localStorage defaults) — all already local-only
  if (typeof render === 'function') render();

  // The sync status pill's states ("Synced" / "Unsynced" / "Syncing…") all
  // describe a relationship with the cloud that doesn't exist in this mode —
  // rather than risk it showing something misleading, hide it outright.
  var style = document.createElement('style');
  style.textContent = '#syncStatusPill{display:none !important;}';
  document.head.appendChild(style);
})();
