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
  bookCoverDraft: null, /* {source} while the "set cover" upload is in progress */
  bookshelfActiveSource: null /* which book is currently drilled into on the shelf — null means showing the shelf grid itself */
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
    var cloudPausedAt = state.pausedSession ? (state.pausedSession.pausedAt || 0) : 0;
    var mirrorPausedAt = mirrorForPause && mirrorForPause.pausedSession ? (mirrorForPause.pausedSession.pausedAt || 0) : 0;
    var syncPausedAt = syncPaused ? (syncPaused.pausedAt || 0) : 0;
    var bestPausedAt = Math.max(cloudPausedAt, mirrorPausedAt, syncPausedAt);
    if (bestPausedAt > cloudPausedAt) {
      state.pausedSession = (syncPausedAt === bestPausedAt) ? syncPaused : mirrorForPause.pausedSession;
      saveUserSettings(); /* best-effort push-up, not awaited — loadLibrary() shouldn't block on this */
    }
    state.learningMode.enabled = row ? (row.fsrs_mode_enabled !== false) : false; /* brand-new accounts start in plain practice mode — FSRS is opt-in, not the default */
    state.darkMode = !!(row && row.dark_mode);
    state.streak = (row && row.streak) || { count: 0, lastDate: null };
    state.fsrsCardExpanded = row ? (row.fsrs_card_expanded !== false) : true;
    state.sleepingSubjects = (row && row.sleeping_subjects) || {};
    state.autoSleepEnabled = row ? (row.auto_sleep_enabled !== false) : true;
    state.autoSleepStreak = (row && row.auto_sleep_streak) || 4;
    state.emptyFolders = (row && row.empty_folders) || [];
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
}
/* All the small per-user preferences live in one row so toggling any of them is a
   single upsert rather than a separate table/network round trip each. */
async function saveUserSettings(){
  persistLocalMirror(); /* local-first, unconditional, before any network attempt */
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
   those fire for some reason — a 30-second safety-net timer regardless. */
var syncInFlight = false;
var lastAutoSyncAt = 0;
var AUTO_SYNC_MIN_INTERVAL_MS = 15000; // throttle — don't hammer retries more than once per 15s

async function retryUnsyncedChangesIfAny(){
  if (!state.hasUnsyncedChanges || !state.currentUser || !supabaseClient || syncInFlight) return;
  syncInFlight = true;
  updateSyncIndicator();
  try {
    await saveLibrary();
    await saveUserSettings();
  } finally {
    syncInFlight = false;
    updateSyncIndicator();
  }
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
  if (!state.currentUser || !supabaseClient) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    showToast('You\'re offline — Practex will sync automatically once you\'re back.');
    return;
  }
  if (syncInFlight) return;
  syncInFlight = true;
  updateSyncIndicator();
  try {
    await saveLibrary();
    await saveUserSettings();
    showToast(state.hasUnsyncedChanges ? 'Could not sync — check your connection and try again.' : 'Synced.');
  } finally {
    syncInFlight = false;
    updateSyncIndicator();
  }
}
/* Upserts the current in-memory library in one batched request (Postgres upsert
   accepts an array, so this is a single round trip regardless of library size).
   Note: this does NOT delete rows that were removed locally — see deleteMcqRows(). */
async function saveLibrary(){
  persistLocalMirror(); /* local-first, unconditional, before any network attempt */
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
