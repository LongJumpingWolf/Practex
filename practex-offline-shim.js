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

  if (!mirror || !Array.isArray(mirror.mcqs) || !mirror.mcqs.length) {
    var gate = document.getElementById('authGate');
    var loading = document.getElementById('loadingScreen');
    if (loading) loading.style.display = 'none';
    if (gate) {
      gate.style.display = 'flex';
      gate.innerHTML = '<div style="max-width:420px;margin:auto;padding:32px;text-align:center;color:#EAF0F5;">' +
        '<h2 style="margin-bottom:10px;">No offline copy found on this device</h2>' +
        '<p style="opacity:0.8;line-height:1.5;">Offline mode reads straight from this browser\'s own local storage — it only works on the exact device/browser Practex was normally used on before. Try opening this page on that device instead.</p>' +
        '</div>';
    }
    return;
  }

  // A believable-enough fake session object — just enough for userDisplayInfo()
  // and anywhere else in the app that reads state.currentUser's shape, without
  // ever touching the network.
  state.currentUser = { id: mirror.userId, email: 'Offline mode', user_metadata: { full_name: 'Offline mode' } };
  applyMirrorToState(mirror, false); // false = don't skip mcqs, load everything

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
