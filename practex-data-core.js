/* practex-data-core.js — extracted from Practex's index.html, Chapter 2 file split.
   Loaded via <script src> in fixed order; the original enclosing IIFE has been
   removed so these files share one global scope, same as the original single
   inline <script> block did internally. Order matters: this file must load
   after every file before it in the list, and before every file after it. */

/* ================= Supabase config =================
   Reads from window.PRACTEX_CONFIG, set by config.js (a separate file, not this one —
   see config.example.js). Keeping config out of this file means re-downloading or
   editing index.html never wipes out your keys; config.js is the one file you set up
   once and never touch again. The anon key is meant to be public/client-side — it only
   grants whatever your Row Level Security policies allow. */
var _cfg = window.PRACTEX_CONFIG || {};
var SUPABASE_URL = _cfg.SUPABASE_URL || '';
var SUPABASE_ANON_KEY = _cfg.SUPABASE_ANON_KEY || '';
var SUPABASE_CONFIGURED = !!SUPABASE_URL && !!SUPABASE_ANON_KEY;
var supabaseClient = (SUPABASE_CONFIGURED && window.supabase) ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
/* ===================================================== */


/* ================= Dev build indicator =================
   Flip this to true while actively iterating on a change across multiple messages,
   back to false once that change is complete and tested — lets a person tell, just
   from glancing at the browser tab, whether what's currently deployed is a
   work-in-progress build or the finished version, without digging through chat.
   When true, the tab title blinks/cycles an "updating" indicator instead of the
   normal title. Left false for a finished, tested delivery. */
var DEV_BUILD_IN_PROGRESS = false;
if (DEV_BUILD_IN_PROGRESS) {
  var devTitleDots = 0;
  setInterval(function(){
    devTitleDots = (devTitleDots + 1) % 4;
    document.title = '🔧 Updating' + '.'.repeat(devTitleDots) + ' — Practex';
  }, 500);
}

var state = {
  mcqs: [],
  sources: {},
  view: 'browse',
  selectedPath: null,
  filters: { sources: {}, tags: {}, status: 'all', tagPanelOpen: false, search: '' },
  forceList: false,
  session: null,
  sidebarOpen: false,
  expanded: {},
  learningMode: { enabled: true },
  darkMode: false,
  streak: { count: 0, lastDate: null },
  pausedSession: null,
  pendingStart: null,
  activeModal: null,
  fsrsCardExpanded: true,
  sleepingSubjects: {},
  pendingNav: null,
  clipboardNode: null,
  pendingDeckDelete: null,
  currentUser: null,
  imageUrlMap: {}, /* hash -> ImgBB URL, the only image-related thing that ever reaches Supabase (plain text) */
  editingMcqId: null,
  autoSleepEnabled: true,
  autoSleepStreak: 4,
  zipImportJob: null, /* {active, processed, total, attached, notFound, skippedNames} — survives navigating away mid-import */
  hasUnsyncedChanges: false, /* true whenever a save to Supabase has failed and hasn't been confirmed since — drives the retry loop and the sync status pill */
  lastSaveHadPermanentConflict: false, /* true right after a save fails specifically due to an ownership conflict (RLS) — a permanent failure, not something the retry loop should keep hammering */
  pendingImportPayload: null, /* a parsed JSON import file, waiting on the user to choose keep-progress vs start-fresh before it actually gets applied */
  pendingNoteDraft: null, /* {mcqId, images} while the Add Note modal is open, before it's actually saved onto the question */
  emptyFolders: [], /* array of path-arrays for folders created on purpose with nothing in them yet — the tree is otherwise entirely implied by which subject/chapterPath actual questions carry, so without this there's no way to represent "a folder that exists but has zero questions" at all */
  studyPlans: {}, /* keyed by "subject::Name" or "source::Name" or "all" — see createStudyPlan()/planTodayTarget() for the full design. Requires the study_plans column added to user_settings — see STUDY_PLANS_MIGRATION.sql */
  bookCoverDraft: null, /* {source} while the "set cover" upload is in progress */
  bookshelfActiveSource: null, /* which book is currently drilled into on the shelf — null means showing the shelf grid itself */
  skullModeActive: false, /* browsing/practice lens that scopes the whole library down to only skull-marked questions — see buildTree(), startPractice(), and the sidebar Skull Mode toggle. Read from localStorage at boot in bootCurrentPage(); a device-local display preference, not synced cross-account. */
  defaultTimePerQ: 60, /* seconds offered by default on a fresh test's gate screen — read from localStorage at boot, see bootCurrentPage() */
  defaultAutoSkull: true /* same — the gate screen's auto-skull toggle default */
};

/* ================= Local-first data mirror =================
   Supabase stays the source of truth for cross-device sync, but every save
   writes here FIRST, synchronously, unconditionally — before any network
   attempt. This is what makes offline use actually work (there's something
   to read/write to with zero signal) and makes a failed cloud save
   non-destructive (the edit still exists locally, and gets retried later —
   see retryUnsyncedChangesIfAny). Scoped per-user so switching accounts on
   the same browser can't leak one person's cached library into another's. */
/* The full mirror lives in IndexedDB, not localStorage — a full library (thousands of
   questions, each with history/notes/timing data) can realistically approach or
   exceed localStorage's typical 5-10MB per-origin quota, while IndexedDB's quota is
   an order of magnitude larger (commonly 50MB+, often a share of free disk space).
   IndexedDB writes are async though, which is fine for this — it's read on normal
   app load and written after every save, both of which have plenty of time to
   complete. The one case that genuinely needs a write to survive even if the tab
   closes mid-write — the auto-pause-on-close listeners in init() — uses a SEPARATE,
   tiny, genuinely-synchronous localStorage entry instead (see
   persistPausedSessionSync below), holding just one paused test's worth of data
   rather than the whole library, so it stays trivially within quota regardless of
   how large the library grows. */
var DATA_MIRROR_DB_NAME = 'practex_data_mirror_v1';
var DATA_MIRROR_STORE_NAME = 'mirror';
var dataMirrorDbPromise = null;
function openDataMirrorDb(){
  if (dataMirrorDbPromise) return dataMirrorDbPromise;
  dataMirrorDbPromise = new Promise(function(resolve, reject){
    var req = indexedDB.open(DATA_MIRROR_DB_NAME, 1);
    req.onupgradeneeded = function(){
      var db = req.result;
      if (!db.objectStoreNames.contains(DATA_MIRROR_STORE_NAME)) db.createObjectStore(DATA_MIRROR_STORE_NAME, { keyPath: 'key' });
    };
    req.onsuccess = function(){ resolve(req.result); };
    req.onerror = function(){ reject(req.error || new Error('Could not open local data mirror')); };
  });
  return dataMirrorDbPromise;
}
async function persistLocalMirror(){
  if (!state.currentUser) return;
  try {
    var payload = {
      key: 'current',
      version: 1,
      updatedAt: Date.now(),
      userId: state.currentUser.id,
      mcqs: state.mcqs,
      sources: state.sources,
      streak: state.streak,
      sleepingSubjects: state.sleepingSubjects,
      fsrsModeEnabled: state.learningMode.enabled,
      darkMode: state.darkMode,
      fsrsCardExpanded: state.fsrsCardExpanded,
      autoSleepEnabled: state.autoSleepEnabled,
      autoSleepStreak: state.autoSleepStreak,
      emptyFolders: state.emptyFolders,
      studyPlans: state.studyPlans,
      pausedSession: state.pausedSession
    };
    var db = await openDataMirrorDb();
    var tx = db.transaction(DATA_MIRROR_STORE_NAME, 'readwrite');
    await requestToPromise(tx.objectStore(DATA_MIRROR_STORE_NAME).put(payload));
  } catch(err) { console.warn('Local mirror save failed:', err); }
}
async function loadLocalMirror(){
  if (!state.currentUser) return null;
  try {
    var db = await openDataMirrorDb();
    var tx = db.transaction(DATA_MIRROR_STORE_NAME, 'readonly');
    var payload = await requestToPromise(tx.objectStore(DATA_MIRROR_STORE_NAME).get('current'));
    if (!payload || payload.userId !== state.currentUser.id) return null; // not this account's cache — don't leak it in
    return payload;
  } catch(err) { return null; }
}
/* The tiny, genuinely-synchronous companion to the above — see the big comment up
   top for why this exists separately. Holds just one paused session, never the
   library, so it's always trivially small regardless of how big the library gets. */
var PAUSED_SESSION_SYNC_KEY = 'practex_paused_session_sync_v1';
function persistPausedSessionSync(){
  if (!state.currentUser) return;
  try {
    localStorage.setItem(PAUSED_SESSION_SYNC_KEY, JSON.stringify({ userId: state.currentUser.id, pausedSession: state.pausedSession }));
  } catch(err) { console.warn('Paused-session quick-save failed:', err); }
}
function loadPausedSessionSync(){
  try {
    var raw = localStorage.getItem(PAUSED_SESSION_SYNC_KEY);
    if (!raw) return null;
    var payload = JSON.parse(raw);
    if (!state.currentUser || payload.userId !== state.currentUser.id) return null;
    return payload.pausedSession || null;
  } catch(err) { return null; }
}
/* Chapter 4 bugfix: startPractice() writes a fresh session into this key as its
   hand-off mechanism when navigating to practice.html (see startPractice() in
   practex-learning-practice.js). Once practice.html adopts it into a live
   state.session, that write becomes stale — but nothing was clearing it. The next
   reconciliation in loadLibrary() would find it still sitting there with its own
   pausedAt timestamp and re-adopt it as a genuine pause, even after the person
   explicitly chose "Leave without pausing." This must be called everywhere
   state.pausedSession is deliberately resolved to null — adopted into a live
   session, discarded as corrupted, or explicitly declined. */
function clearPausedSessionSync(){
  try { localStorage.removeItem(PAUSED_SESSION_SYNC_KEY); } catch(err) {}
}

/* ================= Chapter 4 bugfix: same-tab fast-boot path =================
   MPA means every library.html<->practice.html hop is a full document reload —
   which means loadLibrary() (a full Supabase fetch of the whole question library
   plus settings) was firing on EVERY navigation, not just once per session like it
   did as an SPA. Two real, reported symptoms of this: (1) a loading screen on every
   single hop instead of just the first, and (2) toggling FSRS mode then quickly
   starting a session could show it flip back — the fresh fetch on practice.html's
   reload could win a race against the (fire-and-forget) settings save from the
   toggle, silently overwriting the in-memory change with the stale pre-toggle value
   still on the server.

   Split into two tiers, deliberately:

   1. SETTINGS — tiny (a few hundred bytes), sessionStorage, synchronous. This is
      what actually closes the FSRS race: the toggle updates it INSTANTLY, with zero
      dependency on the async Supabase write landing before a navigation happens.
      Scoped to the tab's lifetime on purpose — same-tab navigation between our own
      two pages sees it, a genuinely new session (new tab, browser reopening)
      correctly does not, matching this app's existing "one full correct load, not a
      stale-then-fresh flicker" philosophy for any real new session.

   2. LIBRARY (mcqs + sources) — this used to also live in the same sessionStorage
      entry, which was the wrong call: with 6,000+ rich question objects that easily
      exceeds sessionStorage's ~5-10MB per-origin quota (confirmed happening in
      practice) and threw QuotaExceededError. The fix reuses the EXISTING local
      IndexedDB mirror (persistLocalMirror()/loadLocalMirror()) instead — it already
      has a much higher quota ceiling, and is ALREADY kept in sync on every single
      save (persistLocalMirror() runs unconditionally at the top of both
      saveUserSettings() and saveLibrary() — "local-first, before any network
      attempt" — so no new hook was even needed for this part). It's async
      (IndexedDB, not sessionStorage) but still entirely local — no network round
      trip — so it's just as effective at skipping the loading screen, just not
      quite as instant as a synchronous sessionStorage read would be.
   =============================================================================== */
var SESSION_CACHE_KEY = 'practex_session_cache_v1';
function persistSessionCache(){
  if (!state.currentUser) return;
  try {
    sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify({
      userId: state.currentUser.id,
      learningModeEnabled: state.learningMode ? state.learningMode.enabled : false,
      darkMode: state.darkMode,
      streak: state.streak,
      fsrsCardExpanded: state.fsrsCardExpanded,
      sleepingSubjects: state.sleepingSubjects,
      autoSleepEnabled: state.autoSleepEnabled,
      autoSleepStreak: state.autoSleepStreak,
      emptyFolders: state.emptyFolders,
      studyPlans: state.studyPlans,
    }));
  } catch(err) {
    /* This entry is now deliberately tiny (settings only, no question data) — should
       never realistically hit a quota. If it somehow still does, the only
       consequence is the FSRS-race fix and instant-settings part of the fast path
       stop engaging; the mcqs/sources fast path (via the IndexedDB mirror below) is
       entirely unaffected, since it doesn't depend on this key at all. */
    console.warn('Settings cache save failed (falls back to fresh settings next navigation, nothing lost):', err);
  }
}
function loadSessionCache(){
  try {
    var raw = sessionStorage.getItem(SESSION_CACHE_KEY);
    if (!raw) return null;
    var payload = JSON.parse(raw);
    if (!state.currentUser || payload.userId !== state.currentUser.id) return null;
    return payload;
  } catch(err) { return null; }
}
function applySessionCache(cache){
  state.learningMode.enabled = !!cache.learningModeEnabled;
  state.darkMode = !!cache.darkMode;
  state.streak = cache.streak || { count: 0, lastDate: null };
  state.fsrsCardExpanded = cache.fsrsCardExpanded !== false;
  state.sleepingSubjects = cache.sleepingSubjects || {};
  state.autoSleepEnabled = cache.autoSleepEnabled !== false;
  state.autoSleepStreak = cache.autoSleepStreak || 4;
  state.emptyFolders = cache.emptyFolders || [];
  state.studyPlans = cache.studyPlans || {};
}
/* The mcqs/sources half of the fast path — reads the EXISTING IndexedDB mirror
   directly rather than anything sessionStorage-based (see the big comment above).
   Returns true if it successfully hydrated state.mcqs/state.sources from a mirror
   matching the current user, false if there's no usable mirror yet (brand new
   account, or a browser that's never loaded this app before) — in which case the
   caller should fall through to a real full loadLibrary().  */
async function applyMirrorAsLibraryFastPath(){
  try {
    var mirror = await loadLocalMirror();
    if (!mirror || !Array.isArray(mirror.mcqs)) return false;
    state.mcqs = mirror.mcqs;
    state.sources = mirror.sources || {};
    return true;
  } catch(err) {
    return false;
  }
}
/* The pausedSession reconciliation piece of loadLibrary() is deliberately NOT part of
   the cache above and always runs fresh on every page load, cached or not — unlike
   the question library and settings (which only this tab can change, so this tab's
   own cache is authoritative), a resumable session can appear from another device or
   from an ungraceful exit at any moment, so checking it fresh every time is the
   actual correct behavior, not something to skip for speed. Extracted out of
   loadLibrary() so the session-cache fast path in showApp() can run just this cheap
   part without the expensive full mcqs fetch. */
async function reconcilePausedSession(){
  if (!state.currentUser || !supabaseClient) return;
  try {
    var setRes = await supabaseClient.from('user_settings').select('sources,paused_session').eq('user_id', state.currentUser.id).maybeSingle();
    if (setRes.error) throw setRes.error;
    var row = setRes.data;
    state.pausedSession = (row && row.paused_session) || null;
    var mirrorForPause = await loadLocalMirror();
    var syncPaused = loadPausedSessionSync();
    var liveSync = loadLiveSessionSync();
    var cloudPausedAt = state.pausedSession ? (state.pausedSession.pausedAt || 0) : 0;
    var mirrorPausedAt = mirrorForPause && mirrorForPause.pausedSession ? (mirrorForPause.pausedSession.pausedAt || 0) : 0;
    var syncPausedAt = syncPaused ? (syncPaused.pausedAt || 0) : 0;
    var liveSyncAt = liveSync ? (liveSync.savedAt || 0) : 0;
    var bestPausedAt = Math.max(cloudPausedAt, mirrorPausedAt, syncPausedAt, liveSyncAt);
    if (bestPausedAt > cloudPausedAt) {
      if (liveSyncAt === bestPausedAt) {
        state.pausedSession = liveSync.session;
        state.pausedSession.pausedAt = liveSync.savedAt;
        state.pausedSession.recoveredFromCrash = true;
      } else {
        state.pausedSession = (syncPausedAt === bestPausedAt) ? syncPaused : mirrorForPause.pausedSession;
      }
      saveUserSettings();
    }
    clearLiveSessionSync();
  } catch(e) {
    console.error('reconcilePausedSession:', e);
  }
}

/* ================= Chapter 3: continuous live-session persistence =================
   The functions above only ever wrote a snapshot at the MOMENT of an explicit pause,
   or the first time the tab was hidden mid-session — proven (by tracing the actual
   guard condition) to go stale if the tab is hidden once, then the person keeps
   answering more questions, then the tab is closed for good: the second close never
   re-snapshots, so "Resume" would silently roll back to the earlier point.

   This adds a SEPARATE key that's rewritten after every single practice-screen
   render while a session is live (cheap — one small synchronous localStorage write),
   completely independent of pause/hide events. It's deliberately kept separate from
   PAUSED_SESSION_SYNC_KEY rather than reusing it, because state.pausedSession's
   presence directly drives the "Paused test — Resume" card in the library view —
   writing to it continuously would make that card appear while someone is still
   actively mid-session, which is wrong. This key is only ever promoted into an
   actual pausedSession on the NEXT app load, and only if it wasn't cleanly cleared
   by a normal exit (session finished, explicitly paused, or explicitly left) —
   i.e. only in the case that actually indicates an ungraceful close.
   ===================================================================================== */
var LIVE_SESSION_SYNC_KEY = 'practex_live_session_sync_v1';
function persistLiveSessionSync(){
  if (!state.currentUser || !isMidSession()) return;
  try {
    localStorage.setItem(LIVE_SESSION_SYNC_KEY, JSON.stringify({
      userId: state.currentUser.id,
      session: state.session,
      savedAt: Date.now()
    }));
  } catch(err) { console.warn('Live-session quick-save failed:', err); }
}
function clearLiveSessionSync(){
  try { localStorage.removeItem(LIVE_SESSION_SYNC_KEY); } catch(err) {}
}
function loadLiveSessionSync(){
  try {
    var raw = localStorage.getItem(LIVE_SESSION_SYNC_KEY);
    if (!raw) return null;
    var payload = JSON.parse(raw);
    if (!state.currentUser || payload.userId !== state.currentUser.id) return null;
    return payload;
  } catch(err) { return null; }
}

var PALETTE = ['#2F5C7A','#B23A2E','#2F6E45','#8B5E9C','#C77B2E','#3D7D8C','#9C4F6E','#5C6B2F'];

function colorForSource(name){
  if (state.sources[name] && state.sources[name].color) return state.sources[name].color;
  var keys = Object.keys(state.sources);
  var idx = keys.indexOf(name);
  if (idx < 0) idx = keys.length;
  return PALETTE[idx % PALETTE.length];
}
/* Backfills any source a question actually references but that never got registered
   in state.sources — the two are supposed to always stay in sync, but a JSON import
   whose own "sources" metadata blob happened to be incomplete could add real
   questions with a source string that never got a matching registry entry. That's
   invisible almost everywhere (Manage Sources reads only from state.sources), except
   the Book Shelf, which deliberately cross-checks against real mcq.source values as a
   safety net — which is exactly how this class of gap actually got noticed. Called
   after any load/import so it self-heals regardless of how the gap happened, not just
   the one import path this was originally found through. */
function reconcileSources(){
  var changed = false;
  state.mcqs.forEach(function(m){
    if (m.source && !state.sources[m.source]) {
      state.sources[m.source] = { color: colorForSource(m.source) };
      changed = true;
    }
  });
  return changed;
}

function uid(){ return 'm_' + Math.random().toString(36).slice(2,10) + Date.now().toString(36); }

/* ================= Image storage (ImgBB via a server relay, never Supabase) =================
   Same architecture as Kardex's image pipeline: compress client-side, cache locally in
   IndexedDB (instant redraws, works offline), and mirror to ImgBB through a server-side
   relay so any signed-in device can pull the same image down later via a plain URL.
   Only that {hash: url} map is ever synced to Supabase — as plain text in the
   mcq_image_urls table — never raw image bytes. The actual ImgBB call happens in
   /api/upload-image.js (a Vercel serverless function, not in this file) so the ImgBB
   API key stays a server-side secret instead of sitting in this page's source. See
   SUPABASE_SETUP.md for how to deploy that function and set IMGBB_API_KEY. */
var IMAGE_DB_NAME = 'practex_images_v1';
var IMAGE_STORE_NAME = 'images';
var IMAGE_MAX_DIM = 1600;   // longest edge, in px, after resize
var IMAGE_QUALITY = 0.82;   // WebP/JPEG quality, 0-1
var imageDbPromise = null;

function requestToPromise(request){
  return new Promise(function(resolve, reject){
    request.onsuccess = function(){ resolve(request.result); };
    request.onerror = function(){ reject(request.error || new Error('IndexedDB request failed')); };
  });
}
function openImageDb(){
  if (imageDbPromise) return imageDbPromise;
  imageDbPromise = new Promise(function(resolve, reject){
    var req = indexedDB.open(IMAGE_DB_NAME, 1);
    req.onupgradeneeded = function(){
      var db = req.result;
      if (!db.objectStoreNames.contains(IMAGE_STORE_NAME)) db.createObjectStore(IMAGE_STORE_NAME, { keyPath: 'hash' });
    };
    req.onsuccess = function(){ resolve(req.result); };
    req.onerror = function(){ reject(req.error || new Error('Could not open image store')); };
  });
  return imageDbPromise;
}
function readFileAsDataUrl(file){
  return new Promise(function(resolve, reject){
    var reader = new FileReader();
    reader.onload = function(){ resolve(reader.result); };
    reader.onerror = function(){ reject(new Error('Could not read image')); };
    reader.readAsDataURL(file);
  });
}
async function computeSha256(buffer){
  var hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer)).map(function(b){ return b.toString(16).padStart(2,'0'); }).join('');
}
/* Resizes + re-encodes before anything is ever stored, so bandwidth and storage stay
   cheap without the person having to think about it. Falls back to the original file
   untouched if compression fails or doesn't actually help. */
async function compressImageForUpload(file){
  var originalMime = file.type || 'image/png';
  try {
    if (!('createImageBitmap' in window)) return { blob: file, mimeType: originalMime };
    if (originalMime === 'image/gif') return { blob: file, mimeType: originalMime }; // don't destroy animation
    var bitmap = await createImageBitmap(file);
    var width = bitmap.width, height = bitmap.height;
    var scale = Math.min(1, IMAGE_MAX_DIM / Math.max(width, height));
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
    var canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, width, height);
    if (bitmap.close) bitmap.close();
    var targetMime = 'image/webp';
    var blob = await new Promise(function(resolve){ canvas.toBlob(resolve, targetMime, IMAGE_QUALITY); });
    if (!blob) return { blob: file, mimeType: originalMime };
    if (scale < 1 || blob.size < file.size) return { blob: blob, mimeType: targetMime };
    return { blob: file, mimeType: originalMime }; // compression didn't help — keep original
  } catch(err) {
    console.warn('Image compression skipped, using original', err);
    return { blob: file, mimeType: originalMime };
  }
}
var imageCloudSyncWarnedOnce = false;
function warnImageCloudSyncFailed(err){
  if (imageCloudSyncWarnedOnce) return;
  imageCloudSyncWarnedOnce = true;
  console.warn('Image cloud sync failed — images are still saved locally on this device. ' +
    '(Check that IMGBB_API_KEY is set on your hosting provider and /api/upload-image is deployed.)', err);
}
/* Fire-and-forget: uploads a locally-cached image to ImgBB so other devices can find
   it, then records the resulting URL. Safe to call repeatedly — a hash that already
   has a URL is a no-op rather than a duplicate upload. */
async function uploadImageToCloud(hash, mimeType, blob){
  if (!state.currentUser) return; // not signed in — local-only, nothing to sync to
  if (state.imageUrlMap[hash]) return;
  try {
    var dataUrl = await readFileAsDataUrl(blob);
    var base64 = (dataUrl.split(',')[1]) || '';
    if (!base64) throw new Error('Could not read image data for upload');
    var res = await fetch('/api/upload-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: base64 })
    });
    var data = await res.json().catch(function(){ return null; });
    if (res.ok && data && data.url) {
      state.imageUrlMap[hash] = data.url;
      saveImageUrl(hash, data.url);
    } else {
      warnImageCloudSyncFailed(data && data.error ? data.error : ('HTTP ' + res.status));
    }
  } catch(err) {
    warnImageCloudSyncFailed(err);
  }
}
async function saveImageUrl(hash, url){
  if (!state.currentUser || !supabaseClient) return;
  try {
    var res = await supabaseClient.from('mcq_image_urls').upsert({ hash: hash, user_id: state.currentUser.id, url: url });
    if (res.error) throw res.error;
  } catch(err) { console.error('saveImageUrl:', err); }
}
async function loadImageUrlMap(){
  state.imageUrlMap = {};
  if (!state.currentUser || !supabaseClient) return;
  try {
    var PAGE_SIZE = 1000;
    var from = 0;
    while (true) {
      var res = await supabaseClient.from('mcq_image_urls').select('hash,url').eq('user_id', state.currentUser.id).range(from, from + PAGE_SIZE - 1);
      if (res.error) throw res.error;
      var rows = res.data || [];
      rows.forEach(function(row){ state.imageUrlMap[row.hash] = row.url; });
      if (rows.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
  } catch(err) { console.error('loadImageUrlMap:', err); }
}
async function downloadImageFromCloud(hash){
  var url = state.imageUrlMap[hash];
  if (!url) return null;
  try {
    var res = await fetch(url);
    if (!res.ok) return null;
    var blob = await res.blob();
    return { blob: blob, mimeType: blob.type || undefined };
  } catch(err) { return null; }
}
async function storeImageFromFile(file){
  var compressed = await compressImageForUpload(file);
  var blob = compressed.blob, mimeType = compressed.mimeType;
  var dataUrl = await readFileAsDataUrl(blob);
  var buffer = await blob.arrayBuffer();
  var hash = await computeSha256(buffer);
  var db = await openImageDb();
  var tx = db.transaction(IMAGE_STORE_NAME, 'readwrite');
  var store = tx.objectStore(IMAGE_STORE_NAME);
  var existing = await requestToPromise(store.get(hash));
  if (!existing) await requestToPromise(store.put({ hash: hash, mimeType: mimeType, dataUrl: dataUrl }));
  uploadImageToCloud(hash, mimeType, blob); // background — don't block the UI on network
  return hash;
}
/* Same underlying pipeline as storeImageFromFile above (compress, hash, cache
   locally) — the difference is this AWAITS the cloud upload instead of firing it
   in the background, because the caller needs a real, working ImgBB URL back
   immediately (for pasting inline as #IMAGE_Q:/#IMAGE_A: text), not just a local
   hash. Used by the paste-image-into-textarea feature — see bindEvents() in
   practex-events-init.js. Returns null for the url if the upload genuinely fails
   (e.g. offline) — the caller is expected to handle that by leaving the
   placeholder text in place rather than inserting a broken reference. */
async function storeImageFromFileAwaitingUrl(file){
  var compressed = await compressImageForUpload(file);
  var blob = compressed.blob, mimeType = compressed.mimeType;
  var dataUrl = await readFileAsDataUrl(blob);
  var buffer = await blob.arrayBuffer();
  var hash = await computeSha256(buffer);
  var db = await openImageDb();
  var tx = db.transaction(IMAGE_STORE_NAME, 'readwrite');
  var store = tx.objectStore(IMAGE_STORE_NAME);
  var existing = await requestToPromise(store.get(hash));
  if (!existing) await requestToPromise(store.put({ hash: hash, mimeType: mimeType, dataUrl: dataUrl }));
  await uploadImageToCloud(hash, mimeType, blob); // awaited here, unlike storeImageFromFile — this caller specifically needs the URL back
  return { hash: hash, url: state.imageUrlMap[hash] || null };
}
async function getImageRecord(hash){
  if (!hash) return null;
  var db = await openImageDb();
  var tx = db.transaction(IMAGE_STORE_NAME, 'readonly');
  return requestToPromise(tx.objectStore(IMAGE_STORE_NAME).get(hash));
}
/* Returns a displayable data URL for a hash — local cache first (instant), falling
   back to the ImgBB URL (and re-caching locally) for images synced in from another
   device that this browser hasn't seen yet. */
async function resolveImageRef(hash){
  if (!hash) return null;
  /* A directly-linked image (from #IMAGE_Q:/#IMAGE_A: in the source text, or an
     already-resolved export) needs no lookup at all — just use it as-is. This is
     also what makes exported images portable across accounts: a plain link works
     anywhere, whereas a hash only ever resolves for the account that uploaded it. */
  if (/^https?:\/\//i.test(hash)) return hash;
  var record = await getImageRecord(hash);
  if (record) return record.dataUrl;
  var cloud = await downloadImageFromCloud(hash);
  if (!cloud) return null;
  var dataUrl = await readFileAsDataUrl(cloud.blob);
  try {
    var db = await openImageDb();
    var tx = db.transaction(IMAGE_STORE_NAME, 'readwrite');
    await requestToPromise(tx.objectStore(IMAGE_STORE_NAME).put({ hash: hash, mimeType: cloud.mimeType || 'application/octet-stream', dataUrl: dataUrl }));
  } catch(err) {}
  return dataUrl;
}
/* =============================================================================== */


function escapeHtml(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ---------------- Lucide-style icons (inline SVG, vanilla — no dependency) ---------------- */
var ICON_PATHS = {
  bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  menu: '<line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  'chevron-left': '<path d="m15 18-6-6 6-6"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'chevron-up': '<path d="m18 15-6-6-6 6"/>',
  'check-circle': '<path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/>',
  moon: '<path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/>',
  'more-vertical': '<circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/>',
  'log-in': '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" x2="3" y1="12" y2="12"/>',
  'wifi-off': '<path d="M12 20h.01"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/><path d="M5 12.859a10 10 0 0 1 5.17-2.69"/><path d="M19 12.859a10 10 0 0 0-2.007-1.523"/><path d="M2 8.82a15 15 0 0 1 4.177-2.643"/><path d="M22 8.82a15 15 0 0 0-11.288-3.764"/><path d="m2 2 20 20"/>',
  'refresh-cw': '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  'layout-grid': '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  notes: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4V3z"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  scissors: '<circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12"/><path d="M20 4 8.12 15.88"/><circle cx="6" cy="18" r="3"/><path d="M14.8 14.8 20 20"/>',
  'trash-2': '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
  'corner-up-right': '<polyline points="15 14 20 9 15 4"/><path d="M4 20v-7a4 4 0 0 1 4-4h12"/>',
  clipboard: '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  'folder-plus': '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/><line x1="12" x2="12" y1="10" y2="16"/><line x1="9" x2="15" y1="13" y2="13"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  list: '<path d="M3 5h.01"/><path d="M3 12h.01"/><path d="M3 19h.01"/><path d="M8 5h13"/><path d="M8 12h13"/><path d="M8 19h13"/>'
};
function icon(name, size){
  size = size || 16;
  return '<svg class="lucide-icon" width="'+size+'" height="'+size+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(ICON_PATHS[name]||'')+'</svg>';
}

function showToast(msg){
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(function(){ t.classList.remove('show'); }, 2600);
}

/* ---------------- Storage (Supabase, scoped to the signed-in user) ---------------- */
function applyMirrorToState(mirror, skipMcqs){
  if (!mirror) return;
  if (!skipMcqs && Array.isArray(mirror.mcqs)) state.mcqs = mirror.mcqs;
  state.sources = mirror.sources || {};
  state.pausedSession = mirror.pausedSession || null;
  state.learningMode.enabled = mirror.fsrsModeEnabled !== false;
  state.darkMode = !!mirror.darkMode;
  state.streak = mirror.streak || { count: 0, lastDate: null };
  state.fsrsCardExpanded = mirror.fsrsCardExpanded !== false;
  state.sleepingSubjects = mirror.sleepingSubjects || {};
  state.autoSleepEnabled = mirror.autoSleepEnabled !== false;
  state.autoSleepStreak = mirror.autoSleepStreak || 4;
  state.emptyFolders = Array.isArray(mirror.emptyFolders) ? mirror.emptyFolders : [];
  state.studyPlans = mirror.studyPlans || {};
}
async function fetchAllMcqRows(userId, onProgress){
  /* Supabase/PostgREST caps rows per request (commonly 1000 by default) — a plain
     unbounded select() silently truncates past that instead of erroring, so a
     library bigger than the cap would only ever partially load with no visible sign
     anything was wrong. Fixed by paging through everything with .range() instead.
     Fired in PARALLEL rather than one page after another — the first request asks
     Supabase for the exact total count up front, so every remaining page can be
     requested at once instead of waiting on each one in sequence. For a library in
     the thousands this is the difference between ~8 round trips added together and
     ~8 round trips happening at the same time. onProgress(loaded, total), if given,
     fires as each individual page actually resolves — genuine progress, not a fake
     animation, since pages complete at different times even when fired together. */
  var PAGE_SIZE = 1000;
  var first = await supabaseClient.from('mcqs').select('data', { count: 'exact' }).eq('user_id', userId).range(0, PAGE_SIZE - 1);
  if (first.error) throw first.error;
  var all = (first.data || []).slice();
  var total = typeof first.count === 'number' ? first.count : all.length;
  if (onProgress) onProgress(all.length, total);
  if (all.length >= total) return all;

  var loaded = all.length;
  var pagePromises = [];
  var pageResults = [];
  for (var from = PAGE_SIZE; from < total; from += PAGE_SIZE) {
    pagePromises.push(
      supabaseClient.from('mcqs').select('data').eq('user_id', userId).range(from, from + PAGE_SIZE - 1).then(function(res){
        if (res.error) throw res.error;
        var rows = res.data || [];
        loaded += rows.length;
        if (onProgress) onProgress(loaded, total);
        pageResults.push(rows);
      })
    );
  }
  await Promise.all(pagePromises);
  for (var i = 0; i < pageResults.length; i++) {
    all = all.concat(pageResults[i]);
  }
  return all;
}
async function loadLibrary(onProgress){
  if (!state.currentUser || !supabaseClient) { state.mcqs = []; state.sources = {}; return; }
  var usedMirrorFallback = false;
  try {
    var mcqRows = await fetchAllMcqRows(state.currentUser.id, onProgress);
    state.mcqs = mcqRows.map(function(row){ return row.data; });
  } catch(e) {
    console.error('loadLibrary (mcqs):', e);
    var mirror = await loadLocalMirror();
    if (mirror && Array.isArray(mirror.mcqs)) {
      state.mcqs = mirror.mcqs;
      usedMirrorFallback = true;
    } else {
      state.mcqs = [];
      showToast('Could not load your library — no local copy available either.');
    }
  }
  try {
    var setRes = await supabaseClient.from('user_settings').select('*').eq('user_id', state.currentUser.id).maybeSingle();
    if (setRes.error) throw setRes.error;
    var row = setRes.data;
    state.sources = (row && row.sources) || {};
    state.pausedSession = (row && row.paused_session) || null;
    /* Reconcile against BOTH local pause sources — the tiny synchronous localStorage
       entry (guaranteed to have survived an actual tab close) and the full IndexedDB
       mirror's own pausedSession (kept current on every normal save). Whichever of
       the three — cloud, sync entry, mirror — has the newest pausedAt wins, and if a
       local one wins, it gets pushed up to Supabase now that we're back online and
       have time to actually save it properly. */
    var mirrorForPause = await loadLocalMirror();
    var syncPaused = loadPausedSessionSync();
    var liveSync = loadLiveSessionSync(); /* leftover only if the last exit wasn't graceful — see the big comment above persistLiveSessionSync() */
    var cloudPausedAt = state.pausedSession ? (state.pausedSession.pausedAt || 0) : 0;
    var mirrorPausedAt = mirrorForPause && mirrorForPause.pausedSession ? (mirrorForPause.pausedSession.pausedAt || 0) : 0;
    var syncPausedAt = syncPaused ? (syncPaused.pausedAt || 0) : 0;
    var liveSyncAt = liveSync ? (liveSync.savedAt || 0) : 0;
    var bestPausedAt = Math.max(cloudPausedAt, mirrorPausedAt, syncPausedAt, liveSyncAt);
    if (bestPausedAt > cloudPausedAt) {
      if (liveSyncAt === bestPausedAt) {
        /* Adopting an ungraceful-exit snapshot — reuses the exact same "Paused test /
           Resume" UI and resume-paused action as a deliberate pause, just tagged so the
           card can say something more accurate than "Paused" for a crash it didn't ask for. */
        state.pausedSession = liveSync.session;
        state.pausedSession.pausedAt = liveSync.savedAt;
        state.pausedSession.recoveredFromCrash = true;
      } else {
        state.pausedSession = (syncPausedAt === bestPausedAt) ? syncPaused : mirrorForPause.pausedSession;
      }
      saveUserSettings(); /* best-effort push-up, not awaited — loadLibrary() shouldn't block on this */
    }
    clearLiveSessionSync(); /* whatever happened, it's been reconciled into pausedSession (or discarded as stale) — either way it shouldn't linger to be re-adopted again next load */
    state.learningMode.enabled = row ? (row.fsrs_mode_enabled !== false) : false; /* brand-new accounts start in plain practice mode — FSRS is opt-in, not the default */
    state.darkMode = !!(row && row.dark_mode);
    state.streak = (row && row.streak) || { count: 0, lastDate: null };
    state.fsrsCardExpanded = row ? (row.fsrs_card_expanded !== false) : true;
    state.sleepingSubjects = (row && row.sleeping_subjects) || {};
    state.autoSleepEnabled = row ? (row.auto_sleep_enabled !== false) : true;
    state.autoSleepStreak = (row && row.auto_sleep_streak) || 4;
    state.emptyFolders = (row && row.empty_folders) || [];
    state.studyPlans = (row && row.study_plans) || {};
  } catch(e) {
    console.error('loadLibrary (settings):', e);
    var mirror2 = await loadLocalMirror();
    if (mirror2) {
      applyMirrorToState(mirror2, true); /* skip mcqs — that fetch may have already succeeded above; don't clobber it with a possibly-stale mirror copy */
      usedMirrorFallback = true;
    }
  }
  /* Image URLs are deliberately NOT awaited here — the initial screen (subject
     folders) shows zero images, so there's no reason to make the whole library wait
     on a table that only matters once you're actually looking at a specific question.
     Fired from showApp() in the background instead, right after the real (core
     question) data is already on screen. */
  if (reconcileSources()) saveSources(); /* heals any question whose source never got registered — self-correcting on every load, regardless of how the gap happened */
  if (usedMirrorFallback) {
    state.hasUnsyncedChanges = true; // whatever's cached locally hasn't been confirmed against the server this session
    showToast('Loaded from your local copy — looks like you\'re offline. Changes will sync once you\'re back.');
  } else {
    persistLocalMirror(); /* refresh the offline-fallback cache with this known-correct load — otherwise it could keep holding a stale/incomplete snapshot from before the pagination fix indefinitely, until something else happened to trigger a save */
  }
  persistSessionCache(); /* Chapter 4 — seeds the same-tab fast path so the NEXT library.html<->practice.html hop in this tab doesn't need a full reload; see the big comment above persistSessionCache() */
  purgeExpiredTrash(); /* fire-and-forget, not awaited — a real full load only happens once per genuinely new session (new tab, reopened browser), which is exactly the right frequency for a background tidiness check like this; not run on the same-tab fast path on purpose */
}
/* All the small per-user preferences live in one row so toggling any of them is a
   single upsert rather than a separate table/network round trip each. */
async function saveUserSettings(){
  persistLocalMirror(); /* local-first, unconditional, before any network attempt */
  persistSessionCache(); /* Chapter 4 bugfix — keeps the same-tab fast path current the instant a toggle changes (FSRS, dark mode, etc), synchronously, with no dependency on the async Supabase write below landing before a navigation happens. This is what closes the "toggle FSRS then quickly start a session and it silently reverts" race — the next page's fast-path read now sees this change immediately, not whatever was last confirmed by the network. */
  state.lastSaveHadPermanentConflict = false; /* this table is keyed by user_id only, so it can't hit the cross-account collision saveLibrary() can — reset here anyway so a stale value from an earlier saveLibrary() call can't mislead a caller checking this flag after just calling this function alone */
  if (!state.currentUser || !supabaseClient) return;
  try {
    var res = await supabaseClient.from('user_settings').upsert({
      user_id: state.currentUser.id,
      sources: state.sources,
      paused_session: state.pausedSession,
      fsrs_mode_enabled: state.learningMode.enabled,
      dark_mode: state.darkMode,
      streak: state.streak,
      fsrs_card_expanded: state.fsrsCardExpanded,
      sleeping_subjects: state.sleepingSubjects,
      auto_sleep_enabled: state.autoSleepEnabled,
      auto_sleep_streak: state.autoSleepStreak,
      empty_folders: state.emptyFolders,
      study_plans: state.studyPlans,
      updated_at: new Date().toISOString()
    });
    if (res.error) throw res.error;
    state.hasUnsyncedChanges = false;
    updateSyncIndicator();
  } catch(e) {
    console.error('saveUserSettings:', e);
    state.hasUnsyncedChanges = true;
    updateSyncIndicator();
  }
}
function saveFsrsCardExpanded(){ return saveUserSettings(); }
function saveSleepingSubjects(){ return saveUserSettings(); }
function saveFsrsMode(){ return saveUserSettings(); }
function saveDarkMode(){ return saveUserSettings(); }
function saveStreak(){ return saveUserSettings(); }
function saveAutoSleepSettings(){ return saveUserSettings(); }
async function saveSources(){ return saveUserSettings(); }
async function savePausedSession(){ return saveUserSettings(); }
function dateStr(ts){
  var d = new Date(ts);
  return d.getFullYear() + '-' + (d.getMonth()+1) + '-' + d.getDate();
}
function bumpStreak(){
  var today = dateStr(Date.now());
  if (state.streak.lastDate === today) return;
  var yesterday = dateStr(Date.now() - 86400000);
  if (state.streak.lastDate === yesterday) state.streak.count = (state.streak.count||0) + 1;
  else state.streak.count = 1;
  state.streak.lastDate = today;
  saveStreak();
}

/* ================= Sync resilience: retry + multi-trigger + visible status =================
   A failed background save doesn't just vanish — it stays flagged
   (state.hasUnsyncedChanges) and gets retried the next time any of several
   real-world "you might be back" moments happen: refocusing the tab,
   switching back to it, the browser's own online event firing, being
   restored from the back/forward cache, or — as a catch-all in case none of
   those fire for some reason — a 30-second safety-net timer regardless.

   REWRITTEN after a real cross-device sync failure report — traced to a serious
   gap: every sync path here (auto-retry, the 30s timer, the sync-status-pill
   click, and manualSync() below) was PUSH-ONLY. None of them ever re-fetched
   from Supabase — so a device with nothing locally unsynced (the common case:
   you didn't just edit anything) would NEVER check whether another device had
   pushed something newer, no matter how many times you clicked "sync" or how
   long you waited. Worse, pressing sync on a stale device would silently
   overwrite the cloud's newer copy with this device's older one.

   Modeled directly on Kardex's doSync(), which already solves this correctly:
   pull-then-push-to-reconfirm when this device has nothing of its own to
   protect; push-then-pull-to-reconfirm when it does (so an unsynced local edit
   isn't destroyed by the pull, but the device still ends up current either way).
   loadLibrary() is Practex's real "pull everything" function — it was already
   being called once at boot, just never again after that. */
var syncInFlight = false;
var lastAutoSyncAt = 0;
var AUTO_SYNC_MIN_INTERVAL_MS = 15000; // throttle — don't hammer retries more than once per 15s

/* ================= Trash (soft delete, 30-day retention) =================
   Modeled directly on Kardex's own trash feature (TRASH_RETENTION_DAYS = 30 there
   too) — the pattern is proven, this just adapts it to Practex's flat mcq-array
   data model instead of Kardex's nested deck tree, which is simpler here: a soft-
   deleted question is just an mcq with m.trashedAt set, still sitting in state.mcqs
   and still synced normally via the existing saveLibrary() upsert — no separate
   trash table, no snapshot/skeleton reconstruction needed, since the row was never
   actually removed. buildTree() (practex-render-library.js) excludes anything with
   trashedAt set, which is what makes it invisible to browsing/counting/practicing
   everywhere at once, from one filter, rather than needing to be re-checked at
   every individual read site. */
var TRASH_RETENTION_DAYS = 30;

function trashedMcqs(){
  return state.mcqs.filter(function(m){ return !!m.trashedAt; });
}

/* One canonical group key, shared between renderTrashView() (which builds the
   grouped rows) and the restore/delete-forever group actions (which need to
   find the exact same set of items again from just the key stored on a button).
   Items trashed together (one whole source or folder deletion) share both a
   trashedFrom label and an identical trashedAt timestamp — delete-source and
   deleteDeck() both compute that timestamp once and stamp every item in the
   same operation with it, so grouping on type+label+trashedAt reconstructs
   "everything that went into the bin in this one action." Anything with no
   trashedFrom (trashed before this existed) falls back to its own single-item
   group, keyed by id so two such items never collide. */
function trashGroupKeyOf(m){
  return m.trashedFrom ? (m.trashedFrom.type + '␟' + m.trashedFrom.label + '␟' + m.trashedAt) : ('single␟' + m.id + '␟' + m.trashedAt);
}

/* Real bug found via a live report: buildTree() was fixed to exclude trashed items
   when Trash was built, but that was the ONLY place — every other count/list/stats
   function across the app (Book Shelf per-book counts, sidebar due/misconception
   stats, dashboard totals, tag filters, search-all, the due-review queue, Manage
   Sources counts) still iterated state.mcqs directly with no trashedAt check at all,
   so a soft-deleted question kept fully counting everywhere except the one place
   that was actually fixed — exactly the "29 outside, 10 inside" symptom reported.
   liveMcqs() is the single, canonical "what should count as part of the library
   right now" list — every one of those call sites below now goes through this
   instead of state.mcqs directly, so this can't silently drift out of sync again
   the next time something new gets added that needs the same exclusion. */
function liveMcqs(){
  return state.mcqs.filter(function(m){ return !m.trashedAt; });
}

/* Same idea as liveMcqs(), one layer up: the handful of root-level "whole library"
   fallbacks (root Start Practice, root Export-current-view, the flat "All subjects"
   list) build their pool straight from liveMcqs() instead of buildTree(), so they
   don't automatically pick up buildTree()'s own Skull Mode filter the way every
   chapter/subject/book-scoped view does. This wrapper gives those specific call
   sites the same behavior without duplicating the filter logic at each one. */
function skullScoped(list){
  return state.skullModeActive ? list.filter(function(m){ return (m.skullCount||0) > 0; }) : list;
}

/* Gathers every distinct image hash already used ANYWHERE within one source —
   question images, answer images, and note images alike — so a note can reuse
   one of them instead of re-uploading a duplicate. This is genuinely linking,
   not copying: pushing the same hash into a new note's images array just adds
   another reference to the one already-stored/already-ImgBB-mirrored image,
   the same way a question's own images/answerImages arrays already work when
   multiple questions happen to share a hash. Newest-used-first, so recently
   relevant images (most likely to be worth reusing) surface before older ones. */
function collectImageHashesForSource(sourceName){
  var seen = {};
  var ordered = [];
  var scoped = liveMcqs().filter(function(m){ return m.source === sourceName; });
  // Newest additions first — addedAt descending — so recently-added questions'
  // images (most likely relevant to whatever's being noted right now) surface first.
  scoped.slice().sort(function(a, b){ return (b.addedAt || 0) - (a.addedAt || 0); }).forEach(function(m){
    var hashes = (m.images || []).concat(m.answerImages || []);
    (m.notes || []).forEach(function(n){ hashes = hashes.concat(n.images || []); });
    hashes.forEach(function(h){
      if (h && !seen[h]) { seen[h] = true; ordered.push(h); }
    });
  });
  return ordered;
}

/* ================= Duplicate detection (max 3 copies of the same question) =================
   Deliberately allows UP TO 3 copies of the same question — repeated exposure to the
   same question is a genuine, intentional part of spaced-repetition practice, not a
   mistake to eliminate entirely. Only excess beyond that gets removed, whether found
   by the manual "Clean up duplicates" pass (practex-import-content.js) or caught live
   during import (the confirm-import handler in practex-events-init.js). Both routes
   share this exact same core logic so "duplicate" and "which copies to keep" can't
   silently mean something different depending on which path found them. */
var MAX_DUPLICATE_COPIES = 3;

function normalizedQuestionText(m){
  return questionDisplayText(m).trim().toLowerCase().replace(/\s+/g, ' ');
}

/* Given a candidate list of mcqs (existing library, a fresh import batch, or both
   combined), groups by normalized text and decides which copies to KEEP (up to 3 per
   group) versus which are EXCESS. Keep-priority favors whichever copies are most
   costly to lose: real learning history first (actual FSRS progress shouldn't be
   thrown away), then not-asleep, then flagged/noted (deliberate user investment),
   then earliest addedAt as a final, stable tiebreak. */
function partitionDuplicates(mcqs){
  var groups = {};
  mcqs.forEach(function(m){
    var key = normalizedQuestionText(m);
    if (!key) return; // blank/empty text can't be meaningfully deduped — leave it alone rather than guessing
    if (!groups[key]) groups[key] = [];
    groups[key].push(m);
  });
  var keep = [];
  var excess = [];
  var duplicateGroupCount = 0;
  Object.keys(groups).forEach(function(key){
    var group = groups[key];
    if (group.length <= MAX_DUPLICATE_COPIES) { keep = keep.concat(group); return; }
    duplicateGroupCount++;
    var sorted = group.slice().sort(function(a, b){
      var ah = (a.learning && a.learning.history) ? a.learning.history.length : 0;
      var bh = (b.learning && b.learning.history) ? b.learning.history.length : 0;
      if (ah !== bh) return bh - ah; // more history first — real progress is the most costly thing to lose
      var aAsleep = a.asleep ? 1 : 0, bAsleep = b.asleep ? 1 : 0;
      if (aAsleep !== bAsleep) return aAsleep - bAsleep; // not-asleep first
      var aInvested = (a.flagged || (a.notes && a.notes.length)) ? 1 : 0;
      var bInvested = (b.flagged || (b.notes && b.notes.length)) ? 1 : 0;
      if (aInvested !== bInvested) return bInvested - aInvested; // flagged/annotated first — deliberate user care
      return (a.addedAt || 0) - (b.addedAt || 0); // earliest first — stable, deterministic final tiebreak
    });
    keep = keep.concat(sorted.slice(0, MAX_DUPLICATE_COPIES));
    excess = excess.concat(sorted.slice(MAX_DUPLICATE_COPIES));
  });
  return { keep: keep, excess: excess, duplicateGroupCount: duplicateGroupCount };
}

/* ================= Study plans =================
   Built for exactly the problem a real load reported: FSRS showing "6000 due today"
   the moment a large library is imported is technically accurate and completely
   unusable. A plan takes a scope (one subject, one book/source, or the whole
   library) and a number of days, and paces coverage of that scope across those days
   — not a fixed daily quota that goes stale, but recomputed fresh each time from
   whatever's actually left and however many days actually remain, so falling behind
   or getting ahead both redistribute naturally instead of needing to be managed by
   hand. Persisted via the study_plans column on user_settings — see
   STUDY_PLANS_MIGRATION.sql for the (required, one-time) schema change this needs. */

function planKeyFor(scopeType, scopeValue){
  return scopeType === 'all' ? 'all' : (scopeType + '::' + scopeValue);
}

function planScopeMcqs(plan){
  if (plan.scopeType === 'all') return liveMcqs();
  if (plan.scopeType === 'subject') return liveMcqs().filter(function(m){ return m.subject === plan.scopeValue; });
  if (plan.scopeType === 'source') return liveMcqs().filter(function(m){ return m.source === plan.scopeValue; });
  return [];
}

/* The actual pacing math. totalQuestions/days are fixed at plan creation (the
   original commitment); totalCompleted grows as the plan is worked through.
   Recomputing "how many today" from whatever's ACTUALLY left and however many days
   ACTUALLY remain — rather than a flat totalQuestions/days computed once — is what
   makes this self-correcting: skip a few days and tomorrow's number goes up
   automatically; get ahead and it goes down. Never divides by zero or a negative —
   daysRemaining is floored at 1, so even on or past the last day there's still a
   real, honest target instead of an error or an infinite one. */
function planTodayTarget(plan){
  var daysElapsed = Math.floor((Date.now() - plan.createdAt) / 86400000);
  var daysRemaining = Math.max(1, plan.days - daysElapsed);
  var questionsRemaining = Math.max(0, plan.totalQuestions - plan.totalCompleted);
  return Math.ceil(questionsRemaining / daysRemaining);
}

/* Which questions actually make up "today's target" — never-seen-before questions
   first (a plan's primary purpose is usually first-pass coverage of a big import),
   then whatever's been seen least recently among the rest, so working through a
   plan naturally cycles through the whole scope rather than fixating on whatever
   happens to sort first by id. Deliberately NOT limited to "currently due" — a
   plan's job is coverage within a timeframe, not spaced-repetition timing, which is
   why startPractice() skips its own getLearningQueue re-filter for a planKey'd
   session (see the comment there). */
function planSelectQuestions(plan, count){
  var pool = planScopeMcqs(plan).slice();
  pool.sort(function(a, b){
    var aH = (a.learning && a.learning.history) ? a.learning.history.length : 0;
    var bH = (b.learning && b.learning.history) ? b.learning.history.length : 0;
    if ((aH === 0) !== (bH === 0)) return aH === 0 ? -1 : 1; // never-seen first
    var aLast = (a.learning && a.learning.lastReviewed) || 0;
    var bLast = (b.learning && b.learning.lastReviewed) || 0;
    return aLast - bLast; // least-recently-reviewed first among the rest
  });
  return pool.slice(0, count).map(function(m){ return m.id; });
}

function createStudyPlan(scopeType, scopeValue, days){
  var key = planKeyFor(scopeType, scopeValue);
  var plan = { scopeType: scopeType, scopeValue: scopeValue, days: days, createdAt: Date.now(), totalCompleted: 0 };
  plan.totalQuestions = planScopeMcqs(plan).length; /* snapshot at creation — the original commitment stays stable even as the library changes later; re-planning is just deleting and creating again */
  state.studyPlans[key] = plan;
  return plan;
}

function cancelStudyPlan(key){
  delete state.studyPlans[key];
}

/* Entry point for "Continue today's plan" — computes today's target, selects the
   questions, and starts a session tagged with planKey so advanceAfterReveal() can
   credit progress back to the right plan as each question gets answered. */
function startPlanSession(key){
  var plan = state.studyPlans[key];
  if (!plan) { showToast('That plan no longer exists.'); return; }
  var target = planTodayTarget(plan);
  if (target <= 0 || plan.totalCompleted >= plan.totalQuestions) { showToast('This plan is already complete!'); return; }
  var ids = planSelectQuestions(plan, target);
  if (!ids.length) { showToast('Nothing left to practice for this plan right now.'); return; }
  requestStartPractice(ids, state.learningMode.enabled, key);
}

/* Runs once per real boot (not on the same-tab fast path — trash purging is a
   background-tidiness concern, not something that needs to happen on every single
   library<->practice hop). Anything past the retention window gets permanently
   removed — from state.mcqs AND the server — same as Kardex's purgeExpiredTrash(). */
async function purgeExpiredTrash(){
  var cutoff = Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  var expired = state.mcqs.filter(function(m){ return m.trashedAt && m.trashedAt < cutoff; });
  if (!expired.length) return;
  var expiredIds = expired.map(function(m){ return m.id; });
  var candidateHashes = [];
  expired.forEach(function(m){
    (m.images || []).forEach(function(h){ candidateHashes.push(h); });
    (m.answerImages || []).forEach(function(h){ candidateHashes.push(h); });
  });
  state.mcqs = state.mcqs.filter(function(m){ return !m.trashedAt || m.trashedAt >= cutoff; });
  await deleteMcqRows(expiredIds);
  await purgeOrphanedImageHashes(candidateHashes);
}

async function reconcileWithCloud(opts){
  opts = opts || {};
  if (!state.currentUser || !supabaseClient) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    if (!opts.silent) showToast('You\'re offline — Practex will sync automatically once you\'re back.');
    return;
  }
  if (syncInFlight) return;
  /* Mid-session, a PULL would wholesale-replace state.mcqs — the exact objects the
     active practice screen is reading/writing to right now — which risks discarding
     a not-yet-committed local learning update from earlier in THIS session if the
     pull lands between an answer and its own saveLibrary() call finishing. A PUSH is
     still safe mid-session (it doesn't touch state.mcqs wholesale, just uploads the
     current array — which per-answer commits are already keeping current), so this
     only skips the pull half, not the whole reconciliation — clicking sync
     mid-practice should still visibly do something, not silently no-op. */
  var midSession = typeof isMidSession === 'function' && isMidSession();
  syncInFlight = true;
  updateSyncIndicator();
  try {
    var pushed;
    if (midSession) {
      pushed = await pushLocalChanges();
    } else if (state.hasUnsyncedChanges) {
      pushed = await pushLocalChanges();
      await loadLibrary();
      if (pushed) pushed = await pushLocalChanges(); // re-confirm lockstep, same as Kardex's doSync()
    } else {
      await loadLibrary();
      pushed = await pushLocalChanges();
    }
    if (!midSession) render(); /* the pull may have brought in real changes (another device's answers, edits) — reflect them on screen. Mid-session, nothing was pulled, so nothing to re-render for this reason. */
    if (!opts.silent) {
      showToast(state.hasUnsyncedChanges ? 'Could not fully sync — check your connection and try again.' : 'Synced.');
    }
  } catch (err) {
    console.error('reconcileWithCloud:', err);
    if (!opts.silent) showToast('Sync failed — check your connection and try again.');
  } finally {
    syncInFlight = false;
    updateSyncIndicator();
  }
}
async function pushLocalChanges(){
  await saveLibrary();
  await saveUserSettings();
  return !state.hasUnsyncedChanges;
}

async function retryUnsyncedChangesIfAny(){
  return reconcileWithCloud({ silent: true });
}
setInterval(retryUnsyncedChangesIfAny, 30000);

function autoSync(){
  if (!state.currentUser) return;
  var now = Date.now();
  if (now - lastAutoSyncAt < AUTO_SYNC_MIN_INTERVAL_MS) return;
  lastAutoSyncAt = now;
  retryUnsyncedChangesIfAny();
}

/* Re-renders just the small status pill in the sidebar rather than the whole
   app — cheap, and safe to call from anywhere including mid-network-request. */
function updateSyncIndicator(){
  var el = document.getElementById('syncStatusPill');
  if (!el) return; // not on a screen that shows it right now — nothing to update
  el.outerHTML = renderSyncStatusPill();
}
/* Always visible when signed in — not hidden-by-default. A status indicator that
   disappears the moment everything's fine is easy to mistake for "not there at all";
   this always shows something, and doubles as a manual "sync now" button. */
function renderSyncStatusPill(){
  if (!state.currentUser) return '<div id="syncStatusPill"></div>';
  var offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  var cls, label, iconName;
  if (syncInFlight) { cls = 'syncing'; label = 'Syncing…'; iconName = 'refresh-cw'; }
  else if (offline) { cls = 'offline'; label = 'Offline — saved locally'; iconName = 'wifi-off'; }
  else if (state.hasUnsyncedChanges) { cls = 'unsynced'; label = 'Unsynced — tap to retry'; iconName = 'refresh-cw'; }
  else { cls = 'synced'; label = 'Synced'; iconName = 'check-circle'; }
  return '<div id="syncStatusPill" class="sync-status-pill ' + cls + '" data-action="manual-sync" role="button" tabindex="0" title="Click to sync now">' +
    icon(iconName, 13) + ' ' + label + '</div>';
}
async function manualSync(){
  /* Was push-only (saveLibrary + saveUserSettings, no pull) — the exact bug this
     whole section was rewritten to fix. Now the same real pull-and-reconcile logic
     as the auto-retry path, just not silent, so a manual click always gives an
     honest "did this actually catch up" result instead of a false "Synced." */
  return reconcileWithCloud({ silent: false });
}
/* Upserts the current in-memory library in one batched request (Postgres upsert
   accepts an array, so this is a single round trip regardless of library size).
   Note: this does NOT delete rows that were removed locally — see deleteMcqRows(). */
async function saveLibrary(onProgress){
  /* onProgress is optional — every existing call site keeps working exactly as
     before with zero behavior change; only a caller that actually wants to show
     real progress (e.g. the import flow, see confirm-import) passes one. Called
     as onProgress({completed, total}) after each batch. */
  onProgress = onProgress || function(){};
  persistLocalMirror(); /* local-first, unconditional, before any network attempt */
  persistSessionCache(); /* Chapter 4 bugfix — same reasoning as saveUserSettings(): keeps this tab's fast-path copy of the library current the instant it changes in memory, independent of the async Supabase upsert below */
  state.lastSaveHadPermanentConflict = false;
  if (!state.currentUser || !supabaseClient) return;
  if (!state.mcqs.length) return;
  try {
    var rows = state.mcqs.map(function(m){
      return { id: m.id, user_id: state.currentUser.id, data: m, updated_at: new Date().toISOString() };
    });
    /* Sent in batches, not one giant request — the whole library gets re-upserted on
       every save (simplest correct thing when nothing tracks which rows actually
       changed), and at thousands of rich question objects that single request could
       approach real request-payload-size limits and start failing silently. Batches
       keep each request comfortably small regardless of how large the library gets;
       upsert is idempotent, so re-sending an already-correct batch on a retry is
       wasteful but harmless, never destructive. */
    var SAVE_BATCH_SIZE = 300;
    for (var bi = 0; bi < rows.length; bi += SAVE_BATCH_SIZE) {
      var batch = rows.slice(bi, bi + SAVE_BATCH_SIZE);
      var res = await supabaseClient.from('mcqs').upsert(batch);
      if (res.error) throw res.error;
      onProgress({ completed: Math.min(bi + SAVE_BATCH_SIZE, rows.length), total: rows.length });
    }
    state.hasUnsyncedChanges = false;
    updateSyncIndicator();
  } catch(e) {
    console.error('saveLibrary:', e);
    if (e && e.code === '42501') {
      /* Row-level-security rejection — this means one or more of these question IDs
         already exist in the table under a DIFFERENT account (e.g. a JSON export from
         one sign-in imported while signed into another). This is a permanent conflict,
         not a network hiccup — retrying it automatically forever would just repeat the
         same failure, so this deliberately does NOT set hasUnsyncedChanges (which
         would otherwise queue it for the retry loop). Say so plainly instead of a
         generic "could not save", and flag it so callers (e.g. the import flow) don't
         also show a misleading "success" message right after this one. */
      state.lastSaveHadPermanentConflict = true;
      showToast('Some questions couldn\'t sync — they already exist under a different Practex account. Sign in as whichever account originally created them.');
      return;
    }
    state.hasUnsyncedChanges = true;
    updateSyncIndicator();
  }
}
/* Explicit server-side delete for questions removed locally (deck delete is currently
   the only path that removes mcqs — upsert alone never deletes rows). */
async function deleteMcqRows(ids){
  if (!state.currentUser || !supabaseClient || !ids || !ids.length) return;
  try {
    /* Same batching reasoning as saveLibrary — deleting a whole large deck (e.g. an
       entire subject) at once as one .in('id', ids) filter risks hitting URL-length
       limits for very large id lists, since that filter goes into the query string. */
    var DELETE_BATCH_SIZE = 300;
    for (var di = 0; di < ids.length; di += DELETE_BATCH_SIZE) {
      var idBatch = ids.slice(di, di + DELETE_BATCH_SIZE);
      var res = await supabaseClient.from('mcqs').delete().eq('user_id', state.currentUser.id).in('id', idBatch);
      if (res.error) throw res.error;
    }
  } catch(e) {
    console.error('deleteMcqRows:', e);
    showToast('Could not delete those questions on the server.');
  }
}
/* Images are content-addressed by hash and can legitimately be shared across multiple
   questions (the same diagram attached to 3 questions only ever uploads once). So this
   only actually deletes a hash's local cache entry, cloud URL row, and ImgBB reference
   record once NOTHING in the current library still points at it — checked fresh against
   state.mcqs at call time, after whatever removal already happened. Safe to call with
   hashes that turn out to still be in use; they're just left alone. */
async function purgeOrphanedImageHashes(candidateHashes){
  if (!candidateHashes || !candidateHashes.length) return;
  var stillUsed = {};
  state.mcqs.forEach(function(m){
    (m.images || []).forEach(function(h){ stillUsed[h] = true; });
    (m.answerImages || []).forEach(function(h){ stillUsed[h] = true; });
  });
  var orphaned = candidateHashes.filter(function(h, i){ return h && !stillUsed[h] && candidateHashes.indexOf(h) === i; });
  if (!orphaned.length) return;
  try {
    var db = await openImageDb();
    var tx = db.transaction(IMAGE_STORE_NAME, 'readwrite');
    var store = tx.objectStore(IMAGE_STORE_NAME);
    orphaned.forEach(function(h){ store.delete(h); });
  } catch(err) { console.error('purgeOrphanedImageHashes (local):', err); }
  orphaned.forEach(function(h){ delete state.imageUrlMap[h]; });
  if (state.currentUser && supabaseClient) {
    try {
      var res = await supabaseClient.from('mcq_image_urls').delete().eq('user_id', state.currentUser.id).in('hash', orphaned);
      if (res.error) throw res.error;
    } catch(err) { console.error('purgeOrphanedImageHashes (cloud):', err); }
  }
}
function exportLibrary(){
  exportMcqSubset(state.mcqs, 'library');
}
/* Reused by both the Settings "export everything" button and the Library browser's
   "Export this view" action — the export itself doesn't need to know or care whether
   it's the whole library or something scoped by folder/filters, it just needs the
   final list of questions to write out. Sources are trimmed to only the ones actually
   represented in this subset, so a scoped export doesn't drag in irrelevant source
   metadata for content that isn't included. */
/* Turns whatever's in an images/answerImages array into plain http(s) links only —
   an internal hash reference only ever resolves for the account that uploaded it
   (it's a lookup key into that account's own mcq_image_urls rows and local
   IndexedDB cache), so exporting raw hashes silently breaks images the moment the
   file is opened anywhere else. A hash with no resolved URL yet (upload still in
   flight, or never completed) is dropped rather than exported as a dead reference. */
function resolveImageRefsToLinks(refs){
  if (!refs || !refs.length) return [];
  var out = [];
  refs.forEach(function(ref){
    if (/^https?:\/\//i.test(ref)) { out.push(ref); return; }
    var url = state.imageUrlMap[ref];
    if (url) out.push(url);
  });
  return out;
}
function exportMcqSubset(mcqs, filenameLabel){
  if (!mcqs.length) { showToast('Nothing to export.'); return; }
  var relevantSources = {};
  mcqs.forEach(function(m){ if (state.sources[m.source]) relevantSources[m.source] = state.sources[m.source]; });
  var exportMcqs = mcqs.map(function(m){
    var copy = JSON.parse(JSON.stringify(m));
    copy.images = resolveImageRefsToLinks(copy.images);
    copy.answerImages = resolveImageRefsToLinks(copy.answerImages);
    if (Array.isArray(copy.notes)) {
      copy.notes.forEach(function(n){ n.images = resolveImageRefsToLinks(n.images); });
    }
    return copy;
  });
  var payload = {
    exportedAt: Date.now(),
    version: 1,
    mcqs: exportMcqs,
    sources: relevantSources,
    streak: state.streak
  };
  var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  var stamp = new Date().toISOString().slice(0,10);
  a.href = url;
  a.download = 'practex-' + (filenameLabel || 'export') + '-' + stamp + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
  showToast(mcqs.length + ' question' + (mcqs.length===1?'':'s') + ' exported.');
}
