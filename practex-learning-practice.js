/* practex-learning-practice.js — extracted from Practex's index.html, Chapter 2 file split.
   Loaded via <script src> in fixed order; the original enclosing IIFE has been
   removed so these files share one global scope, same as the original single
   inline <script> block did internally. Order matters: this file must load
   after every file before it in the list, and before every file after it. */
/* ---------------- Practice / session ---------------- */

function getLearningQueue(ids){
  var now = Date.now();
  var byId = {};
  state.mcqs.forEach(function(m){ byId[m.id]=m; });
  var due = ids.map(function(id){ return byId[id]; }).filter(Boolean).filter(function(q){
    return q.learning && !q.trashedAt && (q.learning.due||0) <= now && !state.sleepingSubjects[q.subject] && !q.asleep;
  });
  due.sort(function(a,b){
    var order={misconception:0,noconcept:1,learning:2,mastered:3,new:4};
    return (order[getLearningState(a)]??9)-(order[getLearningState(b)]??9);
  });
  return due.map(function(q){return q.id;});
}


/* ================= FSRS-inspired scheduler ================= */
var DAY = 24*60*60*1000;
var FSRS_W = [0.4, 0.6, 2.4, 5.8, 4.93, 0.94, 0.86, 0.01, 1.49, 0.14, 0.94, 2.18, 0.05, 0.34, 1.26, 0.29, 2.61];

function fsrsClamp(v, lo, hi){ return Math.min(hi, Math.max(lo, v)); }
function fsrsInitStability(rating){ return Math.max(0.1, FSRS_W[rating-1]); }
function fsrsInitDifficulty(rating){
  return fsrsClamp(FSRS_W[4] - Math.exp(FSRS_W[5]*(rating-1)) + 1, 1, 10);
}
function fsrsNextDifficulty(difficulty, rating){
  var deltaD = -FSRS_W[6]*(rating-3);
  var dPrime = difficulty + deltaD*(10-difficulty)/9;
  var anchor = fsrsInitDifficulty(4);
  return fsrsClamp(FSRS_W[7]*anchor + (1-FSRS_W[7])*dPrime, 1, 10);
}
function fsrsRetrievability(elapsedDays, stability){
  if (!stability || stability <= 0) return 0;
  return Math.pow(0.9, elapsedDays / stability);
}
function fsrsNextStability(difficulty, stability, r, rating){
  if (rating === 1) {
    return Math.max(0.1,
      FSRS_W[11] * Math.pow(difficulty, -FSRS_W[12]) *
      (Math.pow(stability + 1, FSRS_W[13]) - 1) *
      Math.exp((1 - r) * FSRS_W[14])
    );
  }
  var hardPenalty = rating === 2 ? FSRS_W[15] : 1;
  var easyBonus = rating === 4 ? FSRS_W[16] : 1;
  return Math.max(0.1, stability * (
    1 + Math.exp(FSRS_W[8]) * (11 - difficulty) * Math.pow(stability, -FSRS_W[9]) *
    (Math.exp((1 - r) * FSRS_W[10]) - 1) * hardPenalty * easyBonus
  ));
}
/* fsrsState: {stability, difficulty, reps, lapses, lastReview} | null (first review) */
function fsrsStep(fsrsState, rating, now){
  var out;
  if (!fsrsState || !fsrsState.reps) {
    out = { stability: fsrsInitStability(rating), difficulty: fsrsInitDifficulty(rating), reps: 1, lapses: rating===1?1:0 };
  } else {
    var elapsedDays = fsrsState.lastReview ? (now - fsrsState.lastReview) / DAY : 0;
    var r = fsrsRetrievability(elapsedDays, fsrsState.stability);
    out = {
      stability: fsrsNextStability(fsrsState.difficulty, fsrsState.stability, r, rating),
      difficulty: fsrsNextDifficulty(fsrsState.difficulty, rating),
      reps: fsrsState.reps + 1,
      lapses: fsrsState.lapses + (rating===1?1:0)
    };
  }
  out.lastReview = now;
  return out;
}
function fsrsIntervalDays(stability){ return Math.max(1/144, stability); } /* requestRetention=0.9 -> interval == stability (days), floor 10min */
/* ============================================================ */

/* ================= Learning Engine (Phase 3) ================= */
const LearningEngine={

  MAX_HISTORY:8,
  SLOW_ANSWER_MS: 45000,       // deliberated more than 45s before checking — treated as hesitant, not confident
  SLOW_EXPLANATION_MS: 20000,  // spent more than 20s on the explanation — treated as "actually studying it", not skimming

  /* timeToAnswerMs/timeOnExplanationMs are optional — pass null if unavailable (e.g.
     undo doesn't have a clean re-measurement) rather than guessing.
     resolvedMnemonicIndex (optional, 6th param): for mnemonic questions, which
     letter was actually tested THIS encounter — passed in explicitly rather than
     re-derived here, since re-deriving would pick a NEW random letter and record
     the wrong "expected" answer for what was actually asked. */
  record(mcq,picked,correct,timeToAnswerMs,timeOnExplanationMs,resolvedMnemonicIndex){

    if(!mcq.learning){
      mcq.learning={
        due:Date.now(),
        interval:0,
        history:[],
        lastReviewed:null,
        fsrs:null
      };
    }
    if(mcq.learning.fsrs===undefined) mcq.learning.fsrs=null;

    var remarks = this.deriveRemarks(correct, timeToAnswerMs, timeOnExplanationMs);

    mcq.learning.history.push({
      correct,
      picked,
      rating:null,
      expected: expectedAnswerStrFor(mcq, resolvedMnemonicIndex), /* was mcq.answer[0] unconditionally — threw for any type without m.answer set, killing advanceAfterReveal() mid-execution. See the big comment above expectedAnswerStrFor(). */
      ts:Date.now(),
      timeToAnswerMs: (typeof timeToAnswerMs === 'number') ? timeToAnswerMs : null,
      timeOnExplanationMs: (typeof timeOnExplanationMs === 'number') ? timeOnExplanationMs : null,
      remarks: remarks
    });

    if(mcq.learning.history.length>this.MAX_HISTORY){
      mcq.learning.history.splice(
        0,
        mcq.learning.history.length-this.MAX_HISTORY
      );
    }

    /* Auto-derive an Again/Hard/Good/Easy-equivalent (1-4) rating from the question's
       own tracked history, instead of asking the user to self-report one after every
       question. classify() below reflects history INCLUDING the attempt just pushed. */
    const rating = this.deriveRating(mcq, correct, timeToAnswerMs);
    mcq.learning.history[mcq.learning.history.length-1].rating = rating;

    this.schedule(mcq, rating);
    this.checkAutoSleep(mcq);

  },

  /* Lightweight, background-only qualitative tags per attempt — not shown during
     practice itself, just recorded for later review (the question's History modal)
     and to inform deriveRating below. Purely heuristic flat thresholds, not adjusted
     per question length — a reasonable starting point, not a precise model. */
  deriveRemarks(correct, timeToAnswerMs, timeOnExplanationMs){
    var remarks = [];
    var slow = typeof timeToAnswerMs === 'number' && timeToAnswerMs > this.SLOW_ANSWER_MS;
    var fast = typeof timeToAnswerMs === 'number' && timeToAnswerMs < 5000;
    if (correct && slow) remarks.push('Hesitant — took a while but got there');
    else if (correct && fast) remarks.push('Confident — quick and correct');
    else if (correct === false && fast) remarks.push('Rushed — answered quickly but missed it');
    else if (correct === false && slow) remarks.push('Struggled — spent time and still missed it');
    if (typeof timeOnExplanationMs === 'number' && timeOnExplanationMs > this.SLOW_EXPLANATION_MS) {
      remarks.push('Reviewed the explanation closely');
    }
    return remarks;
  },

  deriveRating(mcq, correct, timeToAnswerMs){
    if(!correct) return 1; // Again — wrong this round, always, no exceptions

    const cls = this.classify(mcq);
    var rating;
    if(cls === 'misconception' || cls === 'noconcept') rating = 2; // Hard — right this time, but the pattern says you're not solid
    else if(cls === 'mastered') rating = 4; // Easy
    else rating = 3; // Good — new / learning

    /* A correct answer that took unusually long is a weaker fluency signal than the
       classification alone suggests — nudge the rating down a notch (never below
       Hard, since it was still right) so FSRS doesn't push the interval out as
       aggressively as it would for a fast, confident correct answer. This is the
       "extra edge" — response time feeding the scheduler, not just right/wrong. */
    if (typeof timeToAnswerMs === 'number' && timeToAnswerMs > this.SLOW_ANSWER_MS && rating > 2) {
      rating -= 1;
    }
    return rating;
  },

  /* Puts a question to sleep on its own (independent of subject-level sleep) once
     it's been answered correctly N times in a row — same due-date pause and
     Start-Practice exclusion subject-sleep gets, just scoped to one question instead
     of a whole deck. Purely additive to a streak of correct answers; a single wrong
     answer resets the streak naturally since history stops being all-correct. */
  checkAutoSleep(mcq){
    if (!state.autoSleepEnabled || mcq.asleep) return;
    var streakNeeded = state.autoSleepStreak || 4;
    var h = mcq.learning.history;
    if (h.length < streakNeeded) return;
    var recent = h.slice(-streakNeeded);
    if (recent.every(function(x){ return x.correct === true; })) {
      mcq.asleep = true;
      mcq.autoSlept = true; // one-shot flag — the caller shows a toast and clears it
    }
  },

  classify(mcq){

    const h=mcq.learning.history;

    if(h.length<3){
      return "new";
    }

    const correct=h.filter(x=>x.correct).length;
    const wrong=h.filter(x=>!x.correct);

    const correctRate=correct/h.length;

    let wrongConsistency=0;

    if(wrong.length>=2){

      const freq={};

      wrong.forEach(x=>{
        freq[x.picked]=(freq[x.picked]||0)+1;
      });

      wrongConsistency=Math.max(...Object.values(freq))/wrong.length;

    }

    const last2=h.slice(-2).every(x=>x.correct);

    if(
      wrong.length>=2 &&
      wrongConsistency>=0.6
    ){
      return "misconception";
    }

    if(
      correctRate>=0.7 &&
      last2
    ){
      return "mastered";
    }

    if(correct>0){
      return "learning";
    }

    return "noconcept";

  },

  schedule(mcq, rating){

    const clsState=this.classify(mcq);

    const now=Date.now();

    mcq.learning.state=clsState;

    /* Real FSRS stability/difficulty step drives the base interval. */
    mcq.learning.fsrs = fsrsStep(mcq.learning.fsrs, rating, now);
    var intervalDays = fsrsIntervalDays(mcq.learning.fsrs.stability);

    /* Pedagogical ceilings: cards flagged as a recurring misconception or showing no
       grasp of the concept get pulled back sooner than raw FSRS math alone would
       schedule them, regardless of this review's rating — that part is deliberate,
       it's the "focus more on the wrong ones" behavior.
       "new" (fewer than 3 attempts so far) is different: it should ONLY be crammed
       back quickly if you actually struggled (rating 1-2). A confidently correct
       first answer (rating 3-4) has no evidence it needs to be seen again in 10
       minutes — capping it there anyway was overriding the real FSRS-computed
       interval (often several days) on literally every question's first two
       attempts, which is why a full day's questions kept coming right back the
       next day regardless of how well they went. */
    if (clsState === 'misconception') intervalDays = Math.min(intervalDays, 0.5);       /* ≤ 12h */
    else if (clsState === 'noconcept') intervalDays = Math.min(intervalDays, 30/1440);  /* ≤ 30m */
    else if (clsState === 'new' && rating <= 2) intervalDays = Math.min(intervalDays, 10/1440); /* ≤ 10m — only when you actually struggled */

    /* This is exam-prep MCQ practice, not an open-ended flashcard deck meant to be
       remembered forever — even a thoroughly "mastered" question should resurface at
       least monthly rather than drift out for a whole season the way pure FSRS math
       alone would eventually push a high-stability card. */
    var MAX_PRACTICE_INTERVAL_DAYS = 30;
    intervalDays = Math.min(intervalDays, MAX_PRACTICE_INTERVAL_DAYS);

    mcq.learning.interval = intervalDays * DAY;
    mcq.learning.lastReviewed = now;
    mcq.learning.due = now + mcq.learning.interval;

  },

  /* Re-derives a question's due date from data ALREADY stored on it (its existing
     FSRS stability, its own classification, and the rating its last attempt actually
     got) without touching or re-simulating any history. This exists because the
     ceiling logic above was buggy for a while — it force-capped "new" questions to a
     10-minute interval regardless of how confidently correct they were, throwing away
     a perfectly correct FSRS-computed stability every time. That stability was never
     wrong, only the ceiling applied on top of it was — so a question answered before
     the fix doesn't need to be re-answered or re-graded, just re-scheduled using the
     current (fixed) ceiling rules against the number that was already right. Anchored
     to the last actual review time, not "now" — this reconstructs what the due date
     should have been computed as back then, not a fresh interval starting today.
     Safe to run on every question, repeatedly — a question already scheduled under
     the current rules just recomputes to the same due date, no-op. */
  recomputeDue(mcq){
    if (!mcq.learning || !mcq.learning.fsrs || !mcq.learning.history || !mcq.learning.history.length) return false;
    const clsState = this.classify(mcq);
    const lastEntry = mcq.learning.history[mcq.learning.history.length - 1];
    const rating = lastEntry.rating || 3;
    const anchor = mcq.learning.lastReviewed || mcq.learning.fsrs.lastReview || Date.now();

    var intervalDays = fsrsIntervalDays(mcq.learning.fsrs.stability);
    if (clsState === 'misconception') intervalDays = Math.min(intervalDays, 0.5);
    else if (clsState === 'noconcept') intervalDays = Math.min(intervalDays, 30/1440);
    else if (clsState === 'new' && rating <= 2) intervalDays = Math.min(intervalDays, 10/1440);
    intervalDays = Math.min(intervalDays, 30);

    const newInterval = intervalDays * DAY;
    const newDue = anchor + newInterval;
    const changed = Math.round(newDue) !== Math.round(mcq.learning.due || 0);
    mcq.learning.state = clsState;
    mcq.learning.interval = newInterval;
    mcq.learning.due = newDue;
    return changed;
  }

};
/* ============================================================ */

function getLearningState(mcq){
  return LearningEngine.classify(mcq);
}

function getMostRepeatedWrong(mcq){
  const wrong={};
  mcq.learning.history
    .filter(x=>!x.correct)
    .forEach(x=>{
      wrong[x.picked]=(wrong[x.picked]||0)+1;
    });
  let max=0;
  let option="-";
  Object.entries(wrong).forEach(([k,v])=>{
    if(v>max){
      max=v;
      option=k;
    }
  });
  return option;
}

function renderExplanation(mcq){
  var imgs = mcq.answerImages || [];
  var imagesHtml = imgs.length ? '<div class="qimage-grid">' + imgs.map(function(hash){
    return '<div class="qimage-thumb"><img data-hash-src="' + escapeHtml(hash) + '" data-action="view-mcq-image" data-hash="' + escapeHtml(hash) + '" alt=""></div>';
  }).join('') + '</div>' : '';
  return imagesHtml + (mcq.explanation ? '<div class="reveal-explain">' + renderContent(mcq.explanation) + '</div>' : '');
}

/* Raw skull+flames SVG markup, shared by every skull button in the app (the
   per-question practice-footer button below, and the sidebar's Skull Mode toggle
   in practex-render-library.js). One copy so the pixel art never drifts out of
   sync between the two places it's used.

   Ported directly from the approved final asset (skull-fire-button-final.zip,
   SkullIgnitionButton.tsx's NeutralSkullButton — the reference design based on
   the hand-drawn sketch). REFERENCE_GRID is the actual source of truth, encoded
   row-by-row exactly as that file has it (W = bone, K = dark, . = empty) and
   rotated 90° clockwise at render time the same way the source component does,
   rather than hand-transcribing 188 individual rects — verified byte-for-byte
   identical against the real component's output before landing this. No separate
   eye-glow rect this time (the final design doesn't have one — only the flames
   ignite); the drop-shadow-for-contrast hack from earlier iterations is gone too,
   since this shape carries its own black outline. */
function skullSvgMarkup(){
  var REFERENCE_GRID = [
    "..WWWKKKK......",
    "..WKKWWWWK.....",
    ".KKWWKKKWWK....",
    ".KWWKKKKKWWKKK.",
    "KWWWKKKKKWWWWWK",
    "KWWWKKKKKWWWWWK",
    "KWWWWKKKWWWWKKK",
    "KWWWWWWWWKKWWWK",
    "KWWWWWWWWKKWWWK",
    "KWWWWKKKWWWWKKK",
    "KWWWKKKKKWWWWWK",
    "KWWWKKKKKWWWWWK",
    ".KWWKKKKKWWKKK.",
    ".KKWWKKKWWK....",
    "...KKWWWWK.....",
    ".....KKKK......"
  ];
  var CELL = 7, GRID_X = 8, GRID_Y = 18;
  var REMOVED_GRID_CELLS = { '2-14':1, '2-15':1, '3-15':1, '4-15':1 };
  var cols = REFERENCE_GRID[0].length, rows = REFERENCE_GRID.length;
  /* Adjacent same-size rects that only just touch edge-to-edge show faint seams at
     small render sizes (anti-aliasing sampling right at the shared boundary) —
     reads as a visible grid instead of one solid shape. Padding each cell slightly
     past its true edge makes neighboring cells overlap a hair instead of exactly
     touching, which erases the seams; imperceptible at this scale since it's under
     10% of a single cell. */
  var OVERLAP = 0.6;
  var skullRects = '';
  for (var c = 0; c < cols; c++) {
    for (var r = 0; r < rows; r++) {
      var cell = REFERENCE_GRID[rows - 1 - r][c];
      if (cell === '.' || REMOVED_GRID_CELLS[c + '-' + r]) continue;
      skullRects += '<rect x="' + (GRID_X + r * CELL) + '" y="' + (GRID_Y + c * CELL) + '" width="' + (CELL + OVERLAP) + '" height="' + (CELL + OVERLAP) + '" fill="' + (cell === 'W' ? '#f8f7f0' : '#242023') + '"/>';
    }
  }
  return '<svg viewBox="0 0 120 146" aria-hidden="true" shapeRendering="crispEdges">' +
      '<g class="flames">' +
        '<g class="flame flame-a"><path d="M0 102V72H8V58H16V48H24V38H32V54H24V70H16V102Z" fill="#ef3d1f"/><path d="M8 96V72H16V60H24V50H24V78H16V96Z" fill="#ff5a1f"/></g>' +
        '<g class="flame flame-b"><path d="M24 90V54H32V40H40V28H48V16H56V44H48V58H40V90Z" fill="#ef3d1f"/><path d="M32 84V58H40V46H48V32H48V74H40V84Z" fill="#ff5a1f"/><path d="M40 78V58H48V48H48V70Z" fill="#ffd24a"/></g>' +
        '<g class="flame flame-c"><path d="M48 84V32H56V18H64V0H72V14H80V30H88V84Z" fill="#ef3d1f"/><path d="M56 80V36H64V24H72V16H72V38H80V80Z" fill="#ff5a1f"/><path d="M64 76V40H72V30H72V68Z" fill="#ffd24a"/></g>' +
        '<g class="flame flame-d"><path d="M72 90V54H80V40H88V28H96V16H104V44H96V58H88V90Z" fill="#ef3d1f"/><path d="M80 84V58H88V46H96V32H96V74H88V84Z" fill="#ff5a1f"/><path d="M88 78V58H96V48H96V70Z" fill="#ffd24a"/></g>' +
        '<g class="flame flame-e"><path d="M88 102V72H96V54H88V38H96V48H104V58H112V72H120V102Z" fill="#ef3d1f"/><path d="M96 96V78H104V50H104V60H112V72H120V96Z" fill="#ff5a1f"/></g>' +
      '</g>' +
      '<g class="skull">' + skullRects + '</g>' +
    '</svg>';
}

/* The skull button — sits beside "Next question"/"Next"/"Finish session" (the label
   varies by question type, see the 4 render*Body callers below) wherever that button
   appears. Pressing it agrees to see this exact question again before the test ends,
   at a random not-yet-reached point (see the skull-question handler in
   practex-events-init.js for the actual re-queue logic and why it isn't just appended
   to the end). Ignites and disables itself for the occurrence just acted on — the SAME
   question can still be skulled again on a later occurrence within this session, that's
   the whole mechanism, so the "already actioned" check keyed on s.index rather than
   m.id is deliberate, not an oversight. */
function renderSkullButton(m, s){
  var ignited = !!(s.skulledPositions && s.skulledPositions[s.index]);
  return '<button type="button" class="skull-fire-btn' + (ignited ? ' is-ignited' : '') + '" data-action="skull-question" data-id="' + escapeHtml(m.id) + '"' + (ignited ? ' disabled' : '') +
    ' aria-pressed="' + (ignited ? 'true' : 'false') + '" title="' + (ignited ? 'Queued — you\'ll see this again before the test ends' : 'Need more practice on this one? See it again later in this test') + '">' +
    skullSvgMarkup() +
  '</button>';
}

function renderReveal(mcq){
  const state=LearningEngine.classify(mcq);
  const hist=mcq.learning.history||[];
  const justAnsweredCorrectly=hist.length && hist[hist.length-1].correct===true;
  let banner="";
  switch(state){
    case "new":
      banner='';
      break;
    case "noconcept":
      banner='<div class="learning-banner noconcept">No Concept<br>Your incorrect answers don\'t follow a pattern.<br>Focus on understanding the concept instead of memorizing.</div>';
      break;
    case "misconception":
      var trap=getMostRepeatedWrong(mcq);
      if(justAnsweredCorrectly){
        /* classify() looks at the whole recent pattern, not just this attempt — so it's
           entirely possible to land on "misconception" right after answering correctly
           (e.g. 2 of your last 3 attempts leaned on the same wrong option, but this one
           landed). The underlying signal is still worth keeping — it's still scheduled
           to come back sooner than a clean pass would warrant — but saying "you've
           repeatedly selected X" in the same breath as "Correct" reads as a flat
           contradiction, so the wording needs to actually reflect what just happened. */
        banner='<div class="learning-banner misconception">Good, But Keep An Eye On This<br>Right this time — but you\'ve often picked <strong>' + escapeHtml(trap) + '</strong> before, so it\'s scheduled to come back sooner than usual.</div>';
      } else {
        banner='<div class="learning-banner misconception">Recurring Misconception<br>You\'ve repeatedly selected <strong>' + escapeHtml(trap) + '</strong><br>Review why this option is incorrect.</div>';
      }
      break;
    case "learning":
      banner='<div class="learning-banner learning">Recovering<br>You\'re beginning to answer this correctly.</div>';
      break;
    case "mastered":
      banner='<div class="learning-banner mastered">Mastered<br>Excellent consistency.<br>This question will appear less often.</div>';
      break;
  }
  return banner + renderExplanation(mcq);
}

/* Shared by both the manual "Resume test" click (practex-events-init.js) and the
   automatic boot sequence on practice.html itself (goToPracticeIfSessionPending()
   below) — was previously duplicated logic inline in the resume-paused action handler
   only; extracted here in Chapter 4 so the two paths can't drift apart. Defensive
   normalization — a paused/handed-off session saved by an older version of the app
   (or corrupted some other way) could be missing fields the current code expects.
   Without this, a missing viewIndex specifically made the practice view look up
   s.ids[undefined], find no question, and silently jump straight to a 0%/empty
   summary screen instead of resuming anything. */
function normalizePausedSessionForResume(pausedSession){
  var restored = JSON.parse(JSON.stringify(pausedSession));
  if (!Array.isArray(restored.ids)) restored.ids = [];
  if (typeof restored.index !== 'number' || restored.index < 0) restored.index = 0;
  if (restored.index > restored.ids.length) restored.index = restored.ids.length;
  if (typeof restored.viewIndex !== 'number' || restored.viewIndex < 0 || restored.viewIndex > restored.index) restored.viewIndex = restored.index;
  if (!Array.isArray(restored.results)) restored.results = [];
  if (!Array.isArray(restored.undoStack)) restored.undoStack = [];
  if (!restored.stats) restored.stats = { correct:0, wrong:0, misconception:0, learning:0, mastered:0, noconcept:0 };
  if (restored.shortAnswerCorrect === undefined) restored.shortAnswerCorrect = null;
  if (typeof restored.timePerQ !== 'number') restored.timePerQ = 0; /* older paused sessions from before the timer existed — treat as "no limit" rather than guessing a duration */
  if (typeof restored.autoSkullEnabled !== 'boolean') restored.autoSkullEnabled = true;
  if (typeof restored.autoSkullCount !== 'number') restored.autoSkullCount = 0;
  restored.timerStartedAt = null; /* never trust a wall-clock reference from before the page reloaded — the gate screen always restarts the current question's timer fresh on resume, see startQuestionTimerFor() */
  restored.timerFrozenPct = null;
  restored.timedOut = false;
  return restored;
}

/* Chapter 4 (MPA) boot entry point for practice.html specifically — called once after
   loadLibrary() resolves (which already reconciles state.pausedSession across cloud/
   mirror/sync-key/live-crash-recovery, per Chapter 3). Whether the person got here by
   starting a brand-new session (startPractice() above) or clicking "Resume test" on
   library.html, both hand off through the exact same state.pausedSession field — so
   this one function is the single place that turns "there's a pausedSession waiting"
   into an actual live practice screen. If there's nothing to resume (direct URL visit,
   stale bookmark, browser back button after a session already ended), there's nothing
   for this page to show, so it sends the person back to the library rather than
   rendering an empty practice screen. */
function goToPracticeIfSessionPending(){
  if (!state.pausedSession) { window.location.href = practexPageUrl('library.html'); return false; }
  var restored = normalizePausedSessionForResume(state.pausedSession);
  if (!restored.ids.length) {
    showToast('That test looks corrupted and can\'t be resumed — sorry about that.');
    state.pausedSession = null;
    savePausedSession();
    clearLiveSessionSync();
    clearPausedSessionSync(); /* bugfix — see the comment above this function's definition in practex-data-core.js */
    window.location.href = practexPageUrl('library.html');
    return false;
  }
  /* Always true on arrival, whether this was a brand-new session (already true, this
     is a no-op) or a resume of one that was mid-question when paused — every arrival
     at practice.html shows the "ready to start / continue where you left off" gate
     screen first, never drops straight back into a live countdown the person wasn't
     looking at when they left. */
  restored.awaitingStart = true;
  state.session = restored;
  state.pausedSession = null;
  state.view = 'practice';
  savePausedSession(); /* clears the paused_session column now that it's live again, so a stale copy can't linger and get re-offered */
  clearPausedSessionSync(); /* bugfix — the sync copy that got us HERE is now stale the moment it's adopted; leaving it would let it resurface later even after an explicit "leave without pausing" */
  return true;
}

function startPractice(ids, planKey){
  var byId = {}; state.mcqs.forEach(function(m){ byId[m.id] = m; });
  /* A plan session already did its own selection (planSelectQuestions) — re-filtering
     through getLearningQueue here would silently collapse it back down to only
     currently-due questions, defeating the entire point of a plan (systematic
     coverage of the whole scope over N days, not just today's FSRS-due subset). */
  if(!planKey && state.learningMode && state.learningMode.enabled){
    ids = getLearningQueue(ids);
  }
  var pool = ids.map(function(id){ return byId[id]; }).filter(Boolean);
  if(!pool.length){
    if(state.learningMode && state.learningMode.enabled){
      alert("✓ You're caught up!\n\nNothing is scheduled for review yet.\n\nDisable FSRS Mode to practice all questions.");
    } else {
      showToast('No questions to practice with those filters.');
    }
    return;
  }
  if (!planKey && state.skullModeActive) {
    /* Skull Mode: deliberately NOT shuffled. The whole point is surfacing the
       questions you've told it you need more of, worst-offenders first — a random
       order would bury the ones you've skulled five times behind ones you've only
       skulled once. Ties (equal skullCount, including the ordinary case of everyone
       being skulled exactly once) keep whatever order the pool arrived in. */
    pool.sort(function(a, b){ return (b.skullCount||0) - (a.skullCount||0); });
  } else {
    for (var i = pool.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    }
  }
  var freshSession = {
    ids: pool.map(function(m){ return m.id; }),
    index: 0,
    viewIndex: 0, /* which question is currently displayed — usually equals index (the frontier), but can sit behind it while reviewing an already-answered question */
    selected: null,
    revealed: false,
    shortAnswerCorrect: null,
    results: [],
    undoStack: [],
    stats: { correct:0, wrong:0, misconception:0, learning:0, mastered:0, noconcept:0 },
    questionShownAt: Date.now(), /* silent timing — when the current question first became interactive */
    revealedAt: null,            /* silent timing — when it was revealed, so time-on-explanation can be measured */
    lastTimeToAnswerMs: null,
    planKey: planKey || null, /* tags this session as belonging to a study plan — advanceAfterReveal() checks this to update plan progress as each question is answered */
    originContext: currentNavOriginContext(), /* where this session was started from — pendingNavTargetUrl() falls back to this on exit so leaving a test returns to where it actually began, not always the bare library root */
    /* Per-question timer + auto-skull-on-mistake — configured on the gate screen
       (renderPracticeGateScreen) before the first question, and re-editable there
       again on every resume. Chosen once per session, not a global toggle — a plan
       session or a quick 5-question drill might legitimately want different timing
       than a full mock test. Seeded from the device's last-used defaults so the
       gate screen doesn't start blank every time. */
    timePerQ: state.defaultTimePerQ || 0,
    autoSkullEnabled: state.defaultAutoSkull !== false,
    autoSkullCount: 0, /* this session's own tally, shown on the resume/gate screen — separate from the question's persisted skullCount, which is lifetime across all sessions */
    timerStartedAt: null,
    timerFrozenPct: null,
    timedOut: false,
    awaitingStart: true /* gates renderPractice() — see the big comment on goToPracticeIfSessionPending() for why this is also force-set true on every resume, not just here */
  };
  /* Chapter 4 (MPA): practice now lives on its own page, so a freshly-started session
     has to survive the navigation the same way a resumed one does — there is no
     shared in-memory state across a real page load. Handing it off through
     state.pausedSession reuses the exact reconciliation and normalization machinery
     Chapter 3 already built and tested (multi-source freshness comparison, defensive
     field normalization on resume) rather than inventing a second, parallel path. It's
     tagged neither "paused" nor "recoveredFromCrash" — practice.html's boot sequence
     (see goToPracticeIfSessionPending() in practex-events-init.js) treats any
     pausedSession it finds on arrival as "the session to show", regardless of how it
     got there. */
  state.pausedSession = freshSession;
  state.pausedSession.pausedAt = Date.now();
  persistPausedSessionSync();
  savePausedSession(); /* best-effort, not awaited — practice.html's own boot re-reconciles against Supabase/mirror/sync-key anyway, same as any resume */
  window.location.href = practexPageUrl('practice.html');
}

/* Birds-eye view of the whole session — jump to any already-reached question, see at
   a glance what's correct/wrong/unattempted, and which ones are bookmarked. */
function openQuestionOverview(){
  var s = state.session;
  if (!s) return;
  var html = '<h3>Question overview</h3>';
  html += '<div class="q-ov-legend">' +
    '<span class="q-ov-legend-item"><span class="q-ov-dot correct"></span>Correct</span>' +
    '<span class="q-ov-legend-item"><span class="q-ov-dot wrong"></span>Wrong</span>' +
    '<span class="q-ov-legend-item"><span class="q-ov-dot upcoming"></span>Not attempted</span>' +
    '<span class="q-ov-legend-item">' + icon('bookmark',11) + ' Bookmarked</span>' +
    '</div>';
  html += '<div class="q-ov-grid">';
  s.ids.forEach(function(id, i){
    var mcq = state.mcqs.find(function(x){ return x.id === id; });
    var result = s.results[i];
    var statusCls = 'upcoming';
    if (result) statusCls = result.correct ? 'correct' : (result.correct === false ? 'wrong' : 'unknown');
    var reachable = i <= s.index;
    var isCurrent = i === s.viewIndex;
    html += '<button class="q-ov-cell ' + statusCls + (isCurrent ? ' current' : '') + (!reachable ? ' locked' : '') + '"' +
      (reachable ? ' data-action="jump-to-question" data-index="' + i + '"' : ' disabled title="Not reached yet"') + '>' +
      (i+1) +
      (mcq && mcq.flagged ? '<span class="q-ov-bookmark">' + icon('bookmark',9) + '</span>' : '') +
      '</button>';
  });
  html += '</div>';
  html += '<div class="action-row" style="margin-top:14px;margin-bottom:0;"><button class="btn btn-ghost" data-action="close-modal">Close</button></div>';
  showRichModal(html, 'narrow');
}

/* The screen shown before the first question of a fresh session, AND again every
   time a paused session is resumed (see the comment on goToPracticeIfSessionPending()
   for why both funnel through the same s.awaitingStart flag). Lets the person set —
   or, on a resume, re-adjust — per-question timing and auto-skull before actually
   looking at a question, and on a resume shows how far they'd already gotten. */
/* Derives a human-readable "where is this test actually from" label straight from
   the pool's own questions, rather than trusting originContext alone (accurate for
   how someone navigated TO start-practice, but "Practice Everything" from the
   library root has no meaningful selectedPath at all, and a study plan or the
   skull-mode queue don't either) — this always has an answer because it's just
   reading what's actually in the session, the same way the "N questions" count
   right next to it already does. One id->mcq lookup built once, not a repeated
   .find() per id, since "Practice Everything" can mean thousands of ids. */
function gateLocationLabel(s){
  var byId = {};
  state.mcqs.forEach(function(m){ byId[m.id] = m; });
  var fullPaths = {}, subjects = {};
  s.ids.forEach(function(id){
    var m = byId[id];
    if (!m) return;
    var subj = m.subject || 'Unknown';
    var full = subj + (m.chapterPath && m.chapterPath.length ? ' > ' + m.chapterPath.join(' > ') : '');
    fullPaths[full] = true;
    subjects[subj] = true;
  });
  var fullKeys = Object.keys(fullPaths);
  if (fullKeys.length === 1) return fullKeys[0]; // every question in this test shares one exact chapter — the common, expected case
  var subjKeys = Object.keys(subjects);
  if (subjKeys.length === 1) return subjKeys[0] + ' — ' + fullKeys.length + ' chapters'; // one subject, several chapters (e.g. a study plan spanning a unit)
  if (subjKeys.length <= 3) return subjKeys.join(', '); // a handful of subjects — still worth naming them
  return subjKeys.length + ' subjects'; // e.g. "Practice Everything" — naming all of them would just be noise
}

function renderPracticeGateScreen(){
  var s = state.session;
  var isResume = s.results.length > 0;
  var mm = Math.floor((s.timePerQ||0) / 60);
  var ss = (s.timePerQ||0) % 60;
  var chipSecs = [30, 60, 120];
  var matchesChip = chipSecs.indexOf(s.timePerQ) !== -1;

  var html = '<div class="practice-wrap"><div class="card gate-card">';
  html += '<h2 class="serif" style="margin:0 0 4px;">' + (isResume ? 'Continue where you left off?' : 'Ready to start?') + '</h2>';
  html += '<div class="gate-location">' + escapeHtml(gateLocationLabel(s)) + '</div>';
  html += '<div class="view-sub" style="margin-bottom:' + (isResume ? '18' : '22') + 'px;">' + s.ids.length + ' question' + (s.ids.length===1?'':'s') + (isResume ? ' — question ' + (s.index+1) + ' of ' + s.ids.length : '') + '</div>';

  if (isResume) {
    html += '<div class="gate-progress">' +
      '<div class="gate-row-label">Progress so far</div>' +
      '<div class="gate-progress-grid">' +
        '<div class="gate-progress-cell"><div class="gate-progress-num">' + s.results.length + '</div><div class="gate-progress-lbl">Attempted</div></div>' +
        '<div class="gate-progress-cell right"><div class="gate-progress-num">' + s.stats.correct + '</div><div class="gate-progress-lbl">Right</div></div>' +
        '<div class="gate-progress-cell wrong"><div class="gate-progress-num">' + s.stats.wrong + '</div><div class="gate-progress-lbl">Wrong</div></div>' +
        '<div class="gate-progress-cell skulled"><div class="gate-progress-num">' + (s.autoSkullCount||0) + '</div><div class="gate-progress-lbl">Skulled</div></div>' +
      '</div></div>';
  }

  html += '<div class="config-row"><div class="gate-row-label">Time per question</div><div class="time-chips">' +
    [30,60,120].map(function(secs){
      var label = secs === 30 ? '30s' : (secs/60) + ' min';
      return '<button type="button" class="time-chip' + (s.timePerQ===secs?' active':'') + '" data-action="set-gate-time-chip" data-secs="' + secs + '">' + label + '</button>';
    }).join('') +
    '<button type="button" class="time-chip none' + (s.timePerQ===0?' active':'') + '" data-action="set-gate-time-chip" data-secs="0">No limit</button>' +
    '</div></div>';

  html += '<div class="config-row"><div class="gate-row-label">Or set a custom time</div><div class="mmss-wrap">' +
    '<div class="mmss-box' + (!matchesChip && s.timePerQ>0 ? ' active' : '') + '">' +
      '<input type="text" id="gateMmInput" inputmode="numeric" maxlength="2" placeholder="00" value="' + (mm ? String(mm).padStart(2,'0') : '') + '" aria-label="Minutes">' +
      '<span class="colon">:</span>' +
      '<input type="text" id="gateSsInput" inputmode="numeric" maxlength="2" placeholder="00" value="' + (ss ? String(ss).padStart(2,'0') : '') + '" aria-label="Seconds">' +
    '</div><span class="mmss-caption">mm : ss</span></div></div>';

  html += '<div class="config-row"><div class="gate-row-label">On a mistake or timeout</div>' +
    '<div class="autoskull-row">' +
      '<button type="button" class="skull-fire-btn' + (s.autoSkullEnabled ? ' is-ignited' : ' is-off') + '" data-action="toggle-gate-autoskull" style="width:30px;" aria-pressed="' + (s.autoSkullEnabled?'true':'false') + '" title="' + (s.autoSkullEnabled ? 'Auto-skull is on — click to turn off' : 'Auto-skull is off — click to turn on') + '">' + skullSvgMarkup() + '</button>' +
      '<div class="autoskull-text">Auto-skull the question<div class="sub">Marked wrong questions get queued for extra practice automatically</div></div>' +
      '<span class="onoff-pill ' + (s.autoSkullEnabled?'on':'off') + '">' + (s.autoSkullEnabled?'ON':'OFF') + '</span>' +
    '</div></div>';

  html += '<button class="btn btn-primary gate-start-btn" data-action="dismiss-gate-screen">' + (isResume ? 'Continue test' : 'Start test') + '</button>';
  html += '</div></div>';
  return html;
}

function renderPractice(){
  var s = state.session;
  if (s.awaitingStart) return renderPracticeGateScreen();
  var isReviewing = s.viewIndex < s.index;
  var m = state.mcqs.find(function(x){ return x.id === s.ids[s.viewIndex]; });
  if (!m) { state.view = 'summary'; return renderSummary(); }
  var result = isReviewing ? s.results[s.viewIndex] : null;
  var viewSelected = isReviewing ? (result ? result.selected : null) : s.selected;
  var viewRevealed = isReviewing ? true : s.revealed;
  var pct = Math.round((s.index / s.ids.length) * 100);
  var nextM = state.mcqs.find(function(x){ return x.id === s.ids[s.index+1]; });
  var nextLabelForToolbar = nextM && nextM.learning ? LearningEngine.classify(nextM) : (nextM ? 'new' : null);

  var html = '<div class="practice-wrap">';
  html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;gap:10px;flex-wrap:wrap;">' +
    '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
    '<button class="btn btn-ghost btn-sm" data-action="leave-practice">' + icon('chevron-left',14) + ' Back</button>' +
    '<button class="btn btn-ghost btn-sm" data-action="practice-prev"' + (s.viewIndex > 0 ? '' : ' disabled') + ' title="Previous question">' + icon('chevron-left',14) + '</button>' +
    '<button class="btn btn-ghost btn-sm" data-action="practice-next"' + (s.viewIndex < s.index ? '' : ' disabled') + ' title="Next question">' + icon('chevron-right',14) + '</button>' +
    '<button class="btn btn-ghost btn-sm" data-action="open-question-overview" title="Question overview">' + icon('layout-grid',14) + ' Overview</button>' +
    '<span class="mono" style="font-size:12px;color:var(--ink-soft);margin-left:2px;"' + (nextLabelForToolbar ? ' title="Next: ' + escapeHtml(nextLabelForToolbar) + '"' : '') + '>' + (s.index+1) + ' / ' + s.ids.length + '</span>' +
    (!isReviewing && s.undoStack && s.undoStack.length ? '<button class="undo-btn icon-inline" data-action="undo-answer">' + icon('undo',13) + ' Undo last answer</button>' : '') +
    '</div>' +
    bookmarkButton(m) +
    '</div>';

  if (isReviewing) {
    html += '<div class="reviewing-banner">' + icon('layout-grid',14) + ' Reviewing question ' + (s.viewIndex+1) + ' of ' + s.ids.length + ' — already answered.' +
      '<button class="link-btn" data-action="jump-to-current">Jump to current question ' + icon('chevron-right',12) + '</button></div>';
  }

  /* New question types (match/sequence/cutoff/mnemonic) branch out here, before the
     bubble-MCQ/short-answer card markup below. Each owns its own answer-sheet body but
     shares the header/progress bar above and the qmeta/reveal-panel/notes conventions
     via the shared helpers passed in. Computed once here (rather than once per branch)
     since m/s/isReviewing are already in scope and identical either way. */
  var timerBarHtml = renderTimerBar(m, s, isReviewing);
  if (m.type === 'match')    { html += renderMatchBody(m, s, isReviewing, result, viewRevealed, timerBarHtml); html += '</div>'; return html; }
  if (m.type === 'sequence') { html += renderSequenceBody(m, s, isReviewing, result, viewRevealed, timerBarHtml); html += '</div>'; return html; }
  if (m.type === 'cutoff')   { html += renderCutoffBody(m, s, isReviewing, result, viewRevealed, timerBarHtml); html += '</div>'; return html; }
  if (m.type === 'mnemonic') { html += renderMnemonicBody(m, s, isReviewing, result, viewRevealed, timerBarHtml); html += '</div>'; return html; }
  if (m.type === 'card')     { html += renderCardBody(m, s, isReviewing, result, viewRevealed); html += '</div>'; return html; }

  html += '<div class="card">' + timerBarHtml + '<div class="answer-sheet">';
  html += '<div class="qmeta"><span class="qnum mono">Q.' + (s.viewIndex+1) + '</span><div class="qmeta-tags">' +
    '<span class="source-pill" style="background:' + colorForSource(m.source) + '">' + escapeHtml(m.source) + '</span>' +
    m.tags.map(function(t){ return '<span class="tag-pill">' + escapeHtml(t) + '</span>'; }).join('') +
    '</div></div>';

  if (m.passage) html += '<div class="passage-box">' + renderContent(m.passage) + '</div>';
  html += '<div class="qtext">' + renderContent(m.question) + '</div>';
  if (m.images && m.images.length) {
    html += '<div class="qimage-grid">' + m.images.map(function(hash){
      return '<div class="qimage-thumb"><img data-hash-src="' + escapeHtml(hash) + '" data-action="view-mcq-image" data-hash="' + escapeHtml(hash) + '" alt=""></div>';
    }).join('') + '</div>';
  }

  if (m.isShortAnswer) {
    html += '<div class="short-answer-box"><textarea id="shortAnswerInput" placeholder="Type your answer, then reveal to check yourself" ' + (viewRevealed ? 'disabled' : '') + '>' + escapeHtml(viewSelected||'') + '</textarea></div>';
    if (!viewRevealed) {
      html += '<div class="answer-footer" style="justify-content:flex-end;"><button class="btn btn-primary" data-action="reveal-short">Reveal answer</button></div>';
    }
  } else {
    if (m.answer.length > 1) {
      html += '<div class="multi-select-hint">' + icon('check-circle',13) + ' Select all that apply — ' + m.answer.length + ' correct answers</div>';
    }
    html += '<div class="bubbles">';
    m.options.forEach(function(opt){
      var isSelected = viewSelected && viewSelected.indexOf(opt.letter) !== -1;
      var isCorrectLetter = m.answer.indexOf(opt.letter) !== -1;
      var cls = 'bubble';
      if (isSelected) cls += ' selected';
      if (viewRevealed) {
        cls += ' locked';
        if (isCorrectLetter) cls += ' reveal-correct';
        else if (isSelected) cls += ' reveal-wrong';
      }
      html += '<button class="' + cls + '" ' + (isReviewing || viewRevealed ? 'disabled' : '') + ' data-action="select-option" data-letter="' + opt.letter + '">' +
        '<span class="bubble-mark"><span class="bubble-letter">' + opt.letter + '</span></span>' +
        '<span class="bubble-text">' + escapeHtml(opt.text) + '</span></button>';
    });
    html += '</div>';
    if (!viewRevealed) {
      html += '<div class="answer-footer" style="justify-content:flex-end;">' +
        '<button class="btn btn-primary" data-action="reveal-mcq"' + (s.selected && s.selected.length ? '' : ' disabled') + '>Check answer</button></div>';
    }
  }

  if (viewRevealed) {
    var needsSelfGrade = !isReviewing && m.isShortAnswer && s.shortAnswerCorrect === null;
    var isCorrect = isReviewing ? (result ? result.correct : null) : evaluateCorrect(m, s.selected);
    html += '<div class="reveal-panel">';
    if (needsSelfGrade) {
      html += '<div class="reveal-verdict pending">Grade yourself</div>';
    } else {
      html += '<div class="reveal-verdict ' + (isCorrect ? 'correct' : 'wrong') + '">' + (isCorrect ? 'Correct' : (m.answer[0]==='UNKNOWN' ? 'No answer key on record' : 'Not quite')) + '</div>';
    }
    if (!m.isShortAnswer && m.answer[0] !== 'UNKNOWN') {
      html += '<div class="view-sub" style="margin-bottom:8px;">Correct answer: ' + m.answer.join(', ') + '</div>';
    }
    if (m.isShortAnswer) {
      html += '<div class="view-sub" style="margin-bottom:8px;">Answer on record: ' + escapeHtml(m.answer[0]) + '</div>';
    }
    html += renderReveal(m);
    html += renderNotesSection(m); /* end of explanation, always — this is the one spot notes show during practice, deliberately never before reveal */
    if (isReviewing) {
      /* Nothing to submit here — movement happens via the Prev/Next/Overview controls up top. */
    } else if (needsSelfGrade) {
      html += '<div class="view-sub" style="margin-top:14px;">Compare your answer above with the record — did you get it right?</div>';
      html += '<div class="answer-footer" style="justify-content:flex-end;gap:10px;">' +
        '<button class="btn btn-danger" data-action="self-grade" data-correct="false">' + icon('x',15) + ' I was wrong</button>' +
        '<button class="btn btn-primary" data-action="self-grade" data-correct="true">' + icon('check-circle',15) + ' I was right</button></div>';
    } else {
      html += '<div class="answer-footer" style="justify-content:flex-end;gap:10px;">' +
        renderSkullButton(m, s) +
        '<button class="btn btn-primary" data-action="next-question">' + (s.index + 1 < s.ids.length ? 'Next question' : 'Finish session') + '</button></div>';
    }
    html += '</div>';
  }

  html += '</div></div></div>';
  return html;
}

/* Multi-answer ("select all that apply") questions toggle each option in/out of the
   selection; single-answer questions replace the whole selection with just this one. */
/* =============================================================================
   NEW QUESTION TYPES — match / sequence / cutoff / mnemonic
   Each renderXBody() returns a complete, self-closing '<div class="card
   answer-sheet">...</div>' string, reusing the same qmeta/qtext/image markup
   conventions as the standard bubble-MCQ card above so they read identically
   in the UI. Grading logic lives in evaluateCorrect() below; advanceAfterReveal()
   is extended to build a readable pickedStr for LearningEngine.record().
   ============================================================================= */

function qMetaAndStemHtml(m, s, stemText){
  var tags = Array.isArray(m.tags) ? m.tags : (m.tags ? String(m.tags).split(/\s+/).filter(Boolean) : []);
  var html = '<div class="qmeta"><span class="qnum mono">Q.' + (s.viewIndex+1) + '</span><div class="qmeta-tags">' +
    '<span class="source-pill" style="background:' + colorForSource(m.source) + '">' + escapeHtml(m.source || '') + '</span>' +
    tags.map(function(t){ return '<span class="tag-pill">' + escapeHtml(t) + '</span>'; }).join('') +
    '</div></div>';
  html += '<div class="qtext">' + renderContent(stemText || '') + '</div>';
  if (m.images && m.images.length) {
    html += '<div class="qimage-grid">' + m.images.map(function(hash){
      return '<div class="qimage-thumb"><img data-hash-src="' + escapeHtml(hash) + '" data-action="view-mcq-image" data-hash="' + escapeHtml(hash) + '" alt=""></div>';
    }).join('') + '</div>';
  }
  return html;
}

/* Pure array-move helper — the actual reordering logic behind sequence drag, kept
   separate from all the DOM/pointer-event handling so it's testable on its own
   without a real browser layout engine. Moves the item at fromIndex to toIndex,
   shifting everything between them by one slot, same semantics as any standard
   sortable-list reorder. */
function moveArrayItem(arr, fromIndex, toIndex){
  var copy = arr.slice();
  if (fromIndex === toIndex || fromIndex < 0 || fromIndex >= copy.length || toIndex < 0 || toIndex >= copy.length) return copy;
  var item = copy.splice(fromIndex, 1)[0];
  copy.splice(toIndex, 0, item);
  return copy;
}

/* "Show correct order" — animates the CURRENT (possibly wrong) arrangement into the
   correct one, rather than just re-rendering straight to it. Standard FLIP technique:
/* Shared FLIP-animation core, extracted so sequence's "show correct order" and
   match's "show correct pairs" (below) don't duplicate the same measure-commit-
   remeasure-invert mechanic. See animateSequenceToCorrect for the full technique
   explanation. containerId/itemSelector/idAttr identify which elements to track;
   commitFn does the actual state mutation + render() in between the two measurements. */
function animateFlipReorder(containerId, itemSelector, idAttr, commitFn){
  var container = typeof document !== 'undefined' ? document.getElementById(containerId) : null;
  var firstRects = {};
  if (container) {
    Array.prototype.forEach.call(container.querySelectorAll(itemSelector), function(el){
      var id = el.getAttribute(idAttr);
      if (el.getBoundingClientRect) firstRects[id] = el.getBoundingClientRect();
    });
  }

  commitFn();

  var newContainer = typeof document !== 'undefined' ? document.getElementById(containerId) : null;
  if (!newContainer) return; /* no DOM to animate against — state is still correct, just no visible motion */
  Array.prototype.forEach.call(newContainer.querySelectorAll(itemSelector), function(el){
    var id = el.getAttribute(idAttr);
    var first = firstRects[id];
    if (!first || !el.getBoundingClientRect) return;
    var last = el.getBoundingClientRect();
    var deltaY = first.top - last.top;
    if (!deltaY) return;
    el.style.transition = 'none';
    el.style.transform = 'translateY(' + deltaY + 'px)';
    void el.offsetHeight; /* force reflow so the browser registers the starting position before the transition below is allowed to animate toward 0 */
    el.style.transition = '';
    el.style.transform = '';
  });
}

/* "Show correct order" — animates the CURRENT (possibly wrong) arrangement into the
   correct one, rather than just re-rendering straight to it. Standard FLIP technique:
   measure positions before the reorder (First), commit the state change and let a
   normal render() lay everything out in its new order (Last), then for each item
   apply an instant inverse transform back to where it visually WAS (Invert) and
   immediately transition it to zero (Play) — the CSS transition on .seq-item's
   transform (library.html/practice.html) is what makes that transition visible as
   motion instead of an instant snap. data-step-id is what lets an item's identity
   survive the reorder — origIdx never changes for a given step, only its position
   does, so this is genuinely animating "this step slid from here to there", not
   just whatever happened to occupy a DOM slot before and after. */
function animateSequenceToCorrect(m){
  /* Preserve the person's ACTUAL (wrong) attempt for scoring before overwriting
     state.session.selected for display — unlike match (where rightOrder is purely
     cosmetic and links stays untouched), sequence's selected array IS both the
     display order and the scored answer, so overwriting it here would otherwise
     silently launder a wrong attempt into a "correct" one the moment advanceAfterReveal()
     runs, corrupting FSRS scheduling with a false signal that this was actually known.
     advanceAfterReveal() checks for this snapshot and scores against it instead. */
  state.session.preRevealSelected = state.session.selected.slice();
  animateFlipReorder('seqList', '.seq-item', 'data-step-id', function(){
    state.session.selected = m.steps_correct_order.map(function(_, i){ return i; }); /* the fully correct order, by definition — now just for DISPLAY */
    render();
  });
}

/* "Show correct pairs" — same FLIP technique as sequence above, applied to match's
   right-hand column. The right column's DISPLAY order (rightOrder) is what's
   shuffled, never the pairing data itself — reordering rightOrder to plain
   [0,1,2,...n-1] makes row i's right item become exactly pair i's own right side,
   which by construction is the correct match for row i's left item (left is always
   rendered in natural pairs order, never shuffled). The existing red/green coloring
   already keys off m.pairs identity (origIdx) rather than visual row position, so
   realigning the rows this way doesn't touch or need to touch that logic at all —
   it just makes the existing correctness coloring trivial to read at a glance,
   since "your pick" and "the right answer" now sit in the same row for direct
   comparison instead of needing to be traced across a shuffled column. */
function animateMatchToCorrect(m){
  state.session.selected.correctPairsShown = true; /* THE fix — without this, allCorrect (computed from the honest, unchanged `links`) never becomes true, so the render kept re-showing this same button forever instead of ever reaching Next. links is deliberately left untouched — this only changes what's DISPLAYED, the actual scored answer stays the person's real (wrong) attempt. */
  animateFlipReorder('matchRightCol', '.match-item[data-right-id]', 'data-right-id', function(){
    state.session.selected.rightOrder = m.pairs.map(function(_, i){ return i; });
    render();
  });
}

function shuffledIndices(n, seedKey){
  /* Deterministic-per-question shuffle so re-renders (which happen on every click)
     don't visually reshuffle the right-hand column mid-interaction. Seeded off the
     question id so the same question always shuffles the same way for a given user. */
  var arr = []; for (var i=0;i<n;i++) arr.push(i);
  var seed = 0; for (var c=0;c<seedKey.length;c++) seed = (seed * 31 + seedKey.charCodeAt(c)) >>> 0;
  function rand(){ seed = (seed * 1103515245 + 12345) >>> 0; return (seed / 4294967296); }
  for (var j = arr.length - 1; j > 0; j--) {
    var k = Math.floor(rand() * (j + 1));
    var tmp = arr[j]; arr[j] = arr[k]; arr[k] = tmp;
  }
  return arr;
}

/* ---------------- MATCH ---------------- */
function renderMatchBody(m, s, isReviewing, result, viewRevealed, timerBarHtml){
  var viewSel = isReviewing ? (result ? result.selected : null) : s.selected;
  if (!isReviewing && !viewSel) {
    viewSel = { links: {}, rightOrder: shuffledIndices(m.pairs.length, m.id || 'match'), pendingLeft: null };
    s.selected = viewSel;
  }
  var rightOrder = viewSel && viewSel.rightOrder ? viewSel.rightOrder : shuffledIndices(m.pairs.length, m.id || 'match');
  var links = (viewSel && viewSel.links) || {};

  var html = '<div class="card">' + timerBarHtml + '<div class="answer-sheet">';
  html += qMetaAndStemHtml(m, s, m.stem);
  html += '<div class="multi-select-hint">' + icon('check-circle',13) + ' Tap an item on the left, then try any match on the right — it stays open to change until you tap a different left item or tap it again.</div>';
  html += '<div class="match-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:10px;">';

  html += '<div>';
  m.pairs.forEach(function(pair, i){
    var isLinked = links[i] !== undefined;
    var isActive = viewSel.pendingLeft === i;
    var cls = 'match-item';
    if (viewRevealed) {
      cls += (links[i] === i ? ' match-correct' : ' match-wrong');
    } else {
      /* Pair color is keyed off the LEFT's own index (i), never the right item it
         happens to be linked to — so it stays the same color for this left no matter
         which right gets tried against it while it's active. Both sides of the SAME
         pair always share the same color, which is the actual point: color is what
         shows you a pairing, not row position (the right column is shuffled). */
      if (isLinked) cls += ' match-pair-' + (i % 6);
      if (isActive) cls += ' match-active'; /* stays marked active even once linked — this is what "still freely editable" looks like */
    }
    html += '<button class="' + cls + '" data-left-id="' + i + '" style="display:block;width:100%;text-align:left;margin-bottom:8px;padding:10px 12px;border-radius:8px;" ' +
      (viewRevealed || isReviewing ? 'disabled' : 'data-action="match-pick-left" data-i="' + i + '"') + '>' +
      (i+1) + '. ' + escapeHtml(pair.left) + '</button>';
  });
  html += '</div>';

  /* id here is what animateMatchToCorrect() measures/animates against — the container
     for the right column specifically, since that's the only side whose display
     order ever changes (left is always plain pairs order, never shuffled). */
  html += '<div id="matchRightCol">';
  rightOrder.forEach(function(origIdx){
    var pair = m.pairs[origIdx];
    var linkedToLeft = Object.keys(links).find(function(li){ return links[li] === origIdx; });
    var isLinked = linkedToLeft !== undefined;
    var cls = 'match-item';
    if (viewRevealed) {
      cls += (isLinked && Number(linkedToLeft) === origIdx ? ' match-correct' : (isLinked ? ' match-wrong' : ''));
    } else if (isLinked) {
      cls += ' match-pair-' + (Number(linkedToLeft) % 6); /* same color as its left partner, by definition */
    }
    /* data-right-id survives regardless of revealed/disabled state — unlike data-i,
       which only exists on the interactive (non-disabled) version of this button —
       so it's what gives animateMatchToCorrect() a stable identity to key the FLIP
       animation off of even after reveal has disabled the click action itself. */
    html += '<button class="' + cls + '" data-right-id="' + origIdx + '" style="display:block;width:100%;text-align:left;margin-bottom:8px;padding:10px 12px;border-radius:8px;" ' +
      (viewRevealed || isReviewing ? 'disabled' : 'data-action="match-pick-right" data-i="' + origIdx + '"') + '>' +
      escapeHtml(pair.right) + '</button>';
  });
  html += '</div></div>';

  var allLinked = Object.keys(links).length === m.pairs.length;
  var anyLinked = Object.keys(links).length > 0;
  var allCorrect = m.pairs.every(function(pair, i){ return links[i] === i; });
  var correctPairsShown = !!(viewSel && viewSel.correctPairsShown);
  if (!viewRevealed) {
    html += '<div class="answer-footer" style="justify-content:space-between;">' +
      (anyLinked ? '<button class="btn btn-ghost" data-action="match-reset">' + icon('undo',14) + ' Reset all</button>' : '<span></span>') +
      '<button class="btn btn-primary" data-action="reveal-mcq"' + (allLinked ? '' : ' disabled') + '>Check answer</button></div>';
  } else if (!allCorrect && !isReviewing && !correctPairsShown) {
    /* THE bug this was found and fixed for: allCorrect is (correctly, deliberately)
       computed from links, which "Show correct pairs" never touches — only the
       cosmetic rightOrder changes, so allCorrect stays false forever after a wrong
       attempt, and without checking correctPairsShown here too, this branch would
       keep re-showing this same button instead of ever reaching Next. */
    html += '<div class="reveal-panel">';
    html += '<div class="reveal-verdict wrong">Not quite</div>';
    html += renderNotesSection(m);
    html += '<div class="answer-footer" style="justify-content:flex-end;">' +
      '<button class="btn btn-primary" data-action="match-show-correct">' + icon('corner-up-right',14) + ' Show correct pairs</button></div>';
    html += '</div>';
  } else {
    html += renderRevealFooter(m, s, isReviewing);
  }
  html += '</div></div>';
  return html;
}

/* ---------------- SEQUENCE ---------------- */
function renderSequenceBody(m, s, isReviewing, result, viewRevealed, timerBarHtml){
  var viewSel = isReviewing ? (result ? result.selected : null) : s.selected;
  if (!isReviewing && !viewSel) {
    viewSel = shuffledIndices(m.steps_correct_order.length, m.id || 'sequence');
    s.selected = viewSel;
  }
  var order = viewSel || [];
  var interactive = !viewRevealed && !isReviewing;
  var allCorrect = order.length && order.every(function(origIdx, pos){ return origIdx === pos; });

  var html = '<div class="card">' + timerBarHtml + '<div class="answer-sheet">';
  html += qMetaAndStemHtml(m, s, m.stem);
  html += '<div class="multi-select-hint">' + icon('check-circle',13) + (interactive ? ' Drag to reorder, or use the arrows' : '') + '</div>';
  /* data-step-id is the STABLE identity FLIP animation keys off of — origIdx never
     changes for a given step even as its position (pos) does, which is exactly what's
     needed to correctly animate "this specific step slid from here to there" rather
     than accidentally animating whatever happens to occupy a DOM slot before/after. */
  html += '<div class="seq-list" id="seqList" data-interactive="' + (interactive ? '1' : '0') + '" style="margin-top:10px;">';
  order.forEach(function(origIdx, pos){
    var isCorrectHere = viewRevealed && origIdx === pos;
    var cls = 'seq-item' + (viewRevealed ? (isCorrectHere ? ' seq-correct' : ' seq-wrong') : '');
    html += '<div class="' + cls + '" data-step-id="' + origIdx + '" data-pos="' + pos + '">';
    if (interactive) {
      html += '<span class="seq-drag-handle" title="Drag to reorder">' + icon('menu',15) + '</span>';
    }
    html += '<span class="mono seq-num">' + (pos+1) + '</span>' +
      '<span class="seq-text">' + escapeHtml(m.steps_correct_order[origIdx]) + '</span>';
    if (interactive) {
      html += '<button class="btn btn-ghost btn-sm" data-action="seq-move-up" data-pos="' + pos + '"' + (pos===0?' disabled':'') + ' title="Move up">' + icon('chevron-left',14) + '</button>' +
        '<button class="btn btn-ghost btn-sm" data-action="seq-move-down" data-pos="' + pos + '"' + (pos===order.length-1?' disabled':'') + ' title="Move down">' + icon('chevron-right',14) + '</button>';
    }
    html += '</div>';
  });
  html += '</div>';

  if (!viewRevealed) {
    html += '<div class="answer-footer" style="justify-content:flex-end;">' +
      '<button class="btn btn-primary" data-action="reveal-mcq">Check answer</button></div>';
  } else if (!allCorrect && !isReviewing) {
    /* Wrong on the first check — offer to watch it animate into the correct order,
       rather than only showing static red/green coloring on whatever order they left
       it in. Deliberately doesn't auto-advance to "Next question" yet — seeing the
       correct order animate into place IS the answer reveal for this question type. */
    html += '<div class="reveal-panel">';
    html += '<div class="reveal-verdict wrong">Not quite</div>';
    html += renderNotesSection(m);
    html += '<div class="answer-footer" style="justify-content:flex-end;">' +
      '<button class="btn btn-primary" data-action="seq-show-correct">' + icon('corner-up-right',14) + ' Show correct order</button></div>';
    html += '</div>';
  } else {
    html += renderRevealFooter(m, s, isReviewing);
  }
  html += '</div></div>';
  return html;
}

/* ---------------- CUTOFF ---------------- */
function renderCutoffBody(m, s, isReviewing, result, viewRevealed, timerBarHtml){
  var viewSel = isReviewing ? (result ? result.selected : null) : s.selected;
  if (!isReviewing && (viewSel === null || viewSel === undefined)) {
    viewSel = (m.range[0] + m.range[1]) / 2;
    s.selected = viewSel;
  }

  var html = '<div class="card">' + timerBarHtml + '<div class="answer-sheet">';
  html += qMetaAndStemHtml(m, s, m.stem + (m.testValue !== undefined ? '' : ''));
  if (m.testValue !== undefined) {
    html += '<div class="passage-box">A value of <b class="mono">' + m.testValue + '</b> is given. Drag the slider to where you\'d classify it, then check.</div>';
  }
  html += '<div class="slider-wrap" style="margin-top:14px;">';
  html += '<div class="mono" id="cutoffVal" style="font-size:26px;font-weight:600;margin-bottom:10px;">' + Number(viewSel).toFixed(m.range[2] < 1 ? 1 : 0) + '</div>';
  html += '<input type="range" id="cutoffSlider" min="' + m.range[0] + '" max="' + m.range[1] + '" step="' + m.range[2] + '" value="' + viewSel + '"' +
    (viewRevealed || isReviewing ? ' disabled' : '') + ' style="width:100%;">';
  html += '</div>';

  if (!viewRevealed) {
    html += '<div class="answer-footer" style="justify-content:flex-end;">' +
      '<button class="btn btn-primary" data-action="reveal-mcq">Check answer</button></div>';
  } else {
    var userSide = Number(viewSel) < m.threshold ? m.below : m.above;
    html += '<div class="reveal-explain"><p>Your side of the threshold: <b>' + escapeHtml(userSide) + '</b></p></div>';
    html += renderRevealFooter(m, s, isReviewing);
  }
  html += '</div></div>';
  return html;
}

/* Resolves which mnemonic letter is actually being tested THIS encounter. A fresh
   random pick per session (cached for the duration of that one encounter, via
   s.mnemonicPicks) rather than a single pick baked in at import time — that's what
   makes #TESTLETTER's rotation real: reviewing the same mnemonic across different
   sessions can land on a different letter each time, actually covering the whole
   thing over repeated study, instead of only ever testing whatever got picked once
   when the file was first parsed. Falls back to the legacy single m.testIndex field
   for any already-imported content from before this change (that data has
   testIndex but not testIndices). */
function resolveMnemonicTestIndex(m, s){
  if (m.type !== 'mnemonic') return undefined;
  var candidates = (m.testIndices && m.testIndices.length) ? m.testIndices
    : (typeof m.testIndex === 'number') ? [m.testIndex]
    : (m.letters ? m.letters.map(function(_, li){ return li; }) : [0]);
  if (s) {
    if (!s.mnemonicPicks) s.mnemonicPicks = {};
    if (s.mnemonicPicks[m.id] === undefined) s.mnemonicPicks[m.id] = candidates[Math.floor(Math.random() * candidates.length)];
    return s.mnemonicPicks[m.id];
  }
  return candidates[Math.floor(Math.random() * candidates.length)]; // no session context (e.g. a preview outside practice) — a fresh pick each call is fine there, nothing needs to stay stable across renders
}

/* ---------------- MNEMONIC ---------------- */
function renderMnemonicBody(m, s, isReviewing, result, viewRevealed, timerBarHtml){
  var viewSel = isReviewing ? (result ? result.selected : null) : s.selected;
  var resolvedIdx = (isReviewing && result && typeof result.resolvedMnemonicIndex === 'number') ? result.resolvedMnemonicIndex : resolveMnemonicTestIndex(m, s);
  var testLetter = m.letters[resolvedIdx];

  var html = '<div class="card">' + timerBarHtml + '<div class="answer-sheet">';
  html += qMetaAndStemHtml(m, s, m.stem);
  html += '<div class="mnem-grid" style="display:flex;flex-wrap:wrap;gap:9px;margin:14px 0;">';
  m.letters.forEach(function(l, i){
    var isTested = i === resolvedIdx;
    html += '<div class="mnem-letter" style="width:42px;height:42px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-weight:600;' +
      (isTested ? 'background:var(--emerald-700,#1F5C4A);color:#fff;' : 'border:1px solid var(--line,#ccc);') + '">' + escapeHtml(l.letter) + '</div>';
  });
  html += '</div>';
  html += '<div class="view-sub">What does the highlighted letter stand for?</div>';

  if (!viewRevealed) {
    html += '<div class="short-answer-box"><textarea id="shortAnswerInput" placeholder="Type your answer, then reveal to check yourself">' + escapeHtml(viewSel || '') + '</textarea></div>';
    html += '<div class="answer-footer" style="justify-content:flex-end;"><button class="btn btn-primary" data-action="reveal-short">Reveal answer</button></div>';
  } else {
    html += '<div class="view-sub" style="margin-bottom:8px;">You answered: ' + escapeHtml(viewSel || '(blank)') + '</div>';
    html += '<div class="reveal-panel"><div class="reveal-explain"><b>' + escapeHtml(testLetter.letter) + '</b> = ' + escapeHtml(testLetter.meaning) + '</div></div>';
    html += renderNotesSection(m);
    if (isReviewing) {
      /* nothing to submit — movement via Prev/Next/Overview up top, same as other reviewed questions */
    } else if (s.shortAnswerCorrect === null || s.shortAnswerCorrect === undefined) {
      html += '<div class="view-sub" style="margin-top:14px;">Compare your answer above with the record — did you get it right?</div>';
      html += '<div class="answer-footer" style="justify-content:flex-end;gap:10px;">' +
        '<button class="btn btn-danger" data-action="self-grade" data-correct="false">' + icon('x',15) + ' I was wrong</button>' +
        '<button class="btn btn-primary" data-action="self-grade" data-correct="true">' + icon('check-circle',15) + ' I was right</button></div>';
    } else {
      html += '<div class="answer-footer" style="justify-content:flex-end;gap:10px;">' +
        renderSkullButton(m, s) +
        '<button class="btn btn-primary" data-action="next-question">' + (s.index + 1 < s.ids.length ? 'Next question' : 'Finish session') + '</button></div>';
    }
  }
  html += '</div></div>';
  return html;
}

/* ---------------- CARD (pure-reading, no grading) ----------------
   "It's like card decks only" — a straight read: front, back, tap Next. No check-
   answer step, no right/wrong, deliberately excluded from FSRS scheduling and the
   correct/wrong session stats entirely (see the skip in advanceAfterReveal() and
   evaluateCorrect() below) — the whole point is exposure, not grading. */
function renderCardBody(m, s, isReviewing, result, viewRevealed){
  var html = '<div class="card answer-sheet">';
  html += qMetaAndStemHtml(m, s, m.front);
  if (m.back) {
    html += '<div class="reveal-panel" style="margin-top:10px;"><div class="reveal-explain">' + renderContent(m.back) + '</div></div>';
  }
  html += renderNotesSection(m);
  if (!isReviewing) {
    html += '<div class="answer-footer" style="justify-content:flex-end;gap:10px;">' +
      renderSkullButton(m, s) +
      '<button class="btn btn-primary" data-action="next-question">' + (s.index + 1 < s.ids.length ? 'Next' : 'Finish session') + '</button></div>';
  }
  html += '</div>';
  return html;
}

/* Shared reveal footer for the 3 objectively-graded new types (match/sequence/cutoff) —
   mirrors the standard bubble-MCQ reveal-panel/next-question pattern exactly. */
function renderRevealFooter(m, s, isReviewing){
  var result = isReviewing ? s.results[s.viewIndex] : null;
  var isCorrect = isReviewing ? (result ? result.correct : null) : evaluateCorrect(m, s.selected);
  var html = '<div class="reveal-panel">';
  html += '<div class="reveal-verdict ' + (isCorrect ? 'correct' : 'wrong') + '">' + (isCorrect ? 'Correct' : 'Not quite') + '</div>';
  html += renderReveal(m);
  html += renderNotesSection(m);
  if (!isReviewing) {
    html += '<div class="answer-footer" style="justify-content:flex-end;gap:10px;">' +
      renderSkullButton(m, s) +
      '<button class="btn btn-primary" data-action="next-question">' + (s.index + 1 < s.ids.length ? 'Next question' : 'Finish session') + '</button></div>';
  }
  html += '</div>';
  return html;
}

function toggleOptionSelection(m, s, letter){
  if (m.answer.length > 1) {
    var sel = s.selected ? s.selected.slice() : [];
    var idx = sel.indexOf(letter);
    if (idx === -1) sel.push(letter); else sel.splice(idx, 1);
    s.selected = sel;
  } else {
    s.selected = [letter];
  }
}

function evaluateCorrect(m, selected){
  /* Card is pure reading — no selection ever exists for it, so it must be checked
     before the "selected === null -> false" line below, or every card would
     incorrectly evaluate as "wrong" the instant it's touched. */
  if (m.type === 'card') return null;
  if (selected === null || selected === undefined) return false;
  /* mnemonic is self-graded, same mechanism as isShortAnswer — there's no reliable
     objective checker for free-text "what does this letter mean" answers. */
  if (m.isShortAnswer || m.type === 'mnemonic') {
    var sg = state.session && state.session.shortAnswerCorrect;
    return sg === true ? true : (sg === false ? false : null); /* null = not self-graded yet */
  }
  if (m.type === 'match') {
    if (!selected.links) return false;
    var n = m.pairs.length;
    if (Object.keys(selected.links).length !== n) return false;
    for (var i = 0; i < n; i++) { if (selected.links[i] !== i) return false; }
    return true;
  }
  if (m.type === 'sequence') {
    if (!Array.isArray(selected) || selected.length !== m.steps_correct_order.length) return false;
    for (var j = 0; j < selected.length; j++) { if (selected[j] !== j) return false; }
    return true;
  }
  if (m.type === 'cutoff') {
    /* Graded on classification (which side of the threshold), not proximity to an
       exact number — guessing a cutoff to the decimal isn't a meaningful skill, but
       correctly classifying a given value against it is. Requires m.testValue. */
    if (typeof selected !== 'number' || isNaN(selected)) return false;
    if (m.testValue === undefined) return null; /* malformed question — can't grade, don't silently mark wrong */
    var userSide = selected < m.threshold ? 'below' : 'above';
    var trueSide = m.testValue < m.threshold ? 'below' : 'above';
    return userSide === trueSide;
  }
  if (m.answer.indexOf('UNKNOWN') !== -1) return null;
  var a = selected.slice().sort().join(',');
  var b = m.answer.slice().sort().join(',');
  return a === b;
}

/* ---------------- Per-question timer ----------------
   Deliberately NOT driven by a full render() every tick — that would rebuild the
   whole practice DOM every second, which is wasteful and (per the searchInput
   precedent in bindEvents()) risks fighting focus/animation smoothness for no
   reason. Instead one interval directly mutates the bar's own width/class each
   tick, and only calls into the real render pipeline at the two moments that
   actually change state: the question changing, and timeout. */
var _qTimerIntervalId = null;
var _qTimerKey = null; /* "<sessionIndex>:<mcqId>" the running interval currently belongs to — lets the render function detect "this is a different question than what's ticking" without needing a separate explicit stop/start call at every advance site */

function stopQuestionTimer(){
  if (_qTimerIntervalId) clearInterval(_qTimerIntervalId);
  _qTimerIntervalId = null;
  _qTimerKey = null;
}

function tickQuestionTimer(){
  var s = state.session;
  if (!s || s.revealed || s.awaitingStart) { stopQuestionTimer(); return; }
  var fillEl = document.getElementById('qTimerFill');
  if (!fillEl) { stopQuestionTimer(); return; } /* navigated away from the live question view entirely (review, overview, back to library) */
  var elapsed = (Date.now() - s.timerStartedAt) / 1000;
  var remaining = Math.max(0, s.timePerQ - elapsed);
  var pct = (remaining / s.timePerQ) * 100;
  fillEl.style.width = pct + '%';
  fillEl.classList.toggle('danger', remaining > 0 && remaining <= 10);
  if (remaining <= 0) {
    stopQuestionTimer();
    onQuestionTimeout();
  }
}

/* Renders the bar itself AND, as a side effect, makes sure exactly one interval is
   running for whichever question is actually current — starting a fresh one the
   moment it notices s.index/mcq.id changed since the last tick, stopping it once
   revealed. Called from inside each question type's own card markup (right after
   its opening <div class="card ...">), so "on top of the question's own container"
   falls out naturally rather than needing a separate fixed-position overlay. */
function renderTimerBar(m, s, isReviewing){
  if (isReviewing || m.type === 'card' || !s.timePerQ) { stopQuestionTimer(); return ''; }
  var key = s.index + ':' + m.id;
  if (s.revealed) {
    stopQuestionTimer();
    var frozenPct = (s.timerFrozenPct != null) ? s.timerFrozenPct : 0;
    return '<div class="q-timer-track"><div class="q-timer-fill frozen" style="width:' + frozenPct + '%;"></div></div>';
  }
  if (_qTimerKey !== key) {
    stopQuestionTimer();
    if (!s.timerStartedAt) s.timerStartedAt = Date.now(); /* only (re)stamp if not already running for this exact question — avoids restarting the clock on every incidental re-render */
    _qTimerKey = key;
    _qTimerIntervalId = setInterval(tickQuestionTimer, 500);
  }
  var elapsed0 = (Date.now() - s.timerStartedAt) / 1000;
  var remaining0 = Math.max(0, s.timePerQ - elapsed0);
  var pct0 = (remaining0 / s.timePerQ) * 100;
  return '<div class="q-timer-track"><div class="q-timer-fill' + (remaining0 <= 10 ? ' danger' : '') + '" id="qTimerFill" style="width:' + pct0 + '%;"></div></div>';
}

/* Forces the current question to reveal as wrong, the same way a real (but empty)
   manual answer would — see evaluateCorrect(): selected === null/undefined always
   grades false for every gradable type except mnemonic/short-answer, which self-grade
   via s.shortAnswerCorrect instead, so that's set directly for those. Actual skulling
   and the "you ran out of time" vs "you got it wrong" wording both happen generically
   in advanceAfterReveal() / the reveal panel, not here — this function's only job is
   making evaluateCorrect() land on false, uniformly, regardless of question type. */
function onQuestionTimeout(){
  var s = state.session;
  if (!s || s.revealed || s.awaitingStart) return;
  var m = state.mcqs.find(function(x){ return x.id === s.ids[s.index]; });
  if (!m || m.type === 'card') return; /* card is ungraded — renderTimerBar() already refuses to run a timer for it, this is just a defensive second check */
  if (m.isShortAnswer || m.type === 'mnemonic') { s.shortAnswerCorrect = false; }
  else { s.selected = null; }
  s.timedOut = true;
  revealCurrent();
}

function revealCurrent(){
  var s = state.session;
  if (s.timePerQ) {
    if (s.timedOut) {
      s.timerFrozenPct = 0;
    } else {
      var elapsed = (Date.now() - (s.timerStartedAt || Date.now())) / 1000;
      s.timerFrozenPct = Math.max(0, Math.min(100, (Math.max(0, s.timePerQ - elapsed) / s.timePerQ) * 100));
    }
  }
  stopQuestionTimer();
  s.revealed = true;
  s.lastTimeToAnswerMs = s.questionShownAt ? (Date.now() - s.questionShownAt) : null; /* silent timing — how long they deliberated before checking */
  s.revealedAt = Date.now();
  render();
}

/* Builds a readable "what did they pick" string for LearningEngine.record()'s history —
   used by getMostRepeatedWrong() to show recurring-mistake banners. Every question type
   needs to produce SOMETHING here or that banner silently stops working for that type. */
function pickedStrFor(m, selected){
  if (m.type === 'card') return ''; /* nothing was picked — pure reading, no selection ever exists */
  if (m.isShortAnswer || m.type === 'mnemonic') return selected || '';
  if (m.type === 'match') {
    if (!selected || !selected.links) return '';
    return Object.keys(selected.links).map(function(li){ return li + '→' + selected.links[li]; }).join(',');
  }
  if (m.type === 'sequence') return Array.isArray(selected) ? selected.join(',') : '';
  if (m.type === 'cutoff') return selected !== null && selected !== undefined ? String(selected) : '';
  return selected ? selected.join(',') : '';
}

/* THE bug: LearningEngine.record() read mcq.answer[0] unconditionally, on every single
   answer commit, for every question type — including the 4 new ones, which never had
   m.answer set at all when created via the real Add Source parser (parseLibraryText()
   in practex-render-library.js). mcq.answer[0] on undefined threw, killing
   advanceAfterReveal() mid-execution — before it ever reached render() — which is
   exactly why clicking "Next question" or a self-grade button looked like it did
   nothing at all: the click handler started running and silently died partway through.
   Mirrors pickedStrFor() above — same per-type shape, but describing the CORRECT
   answer for the review-history "expected:" field, not what the person picked. */
function expectedAnswerStrFor(m, resolvedMnemonicIndex){
  if (m.type === 'card') return ''; /* nothing to grade against — see the skip in advanceAfterReveal() below, this shouldn't even be called for cards, but returning cleanly here rather than falling into a type this function doesn't recognize */
  if (m.isShortAnswer || m.type === 'mnemonic') {
    if (m.type === 'mnemonic' && m.letters) {
      var idx = (typeof resolvedMnemonicIndex === 'number') ? resolvedMnemonicIndex : resolveMnemonicTestIndex(m, null);
      if (m.letters[idx]) return m.letters[idx].meaning;
    }
    return (m.answer && m.answer[0]) || '';
  }
  if (m.type === 'match') {
    if (!Array.isArray(m.pairs)) return '';
    return m.pairs.map(function(p, i){ return i + '→' + i; }).join(','); // correct match is always "each left with its own index" — see evaluateCorrect()
  }
  if (m.type === 'sequence') {
    return Array.isArray(m.steps_correct_order) ? m.steps_correct_order.map(function(_, i){ return i; }).join(',') : '';
  }
  if (m.type === 'cutoff') {
    return (typeof m.testValue === 'number' && typeof m.threshold === 'number')
      ? (m.testValue < m.threshold ? 'below ' + m.threshold : 'above ' + m.threshold)
      : '';
  }
  return (m.answer && m.answer[0]) || 'UNKNOWN'; // standard MCQ types — unchanged behavior, m.answer is always present here
}

/* The actual skull re-queue mechanics, shared by the manual skull-question button
   (events-init.js) and the auto-skull-on-mistake/timeout hook in advanceAfterReveal()
   below. See the manual handler's own comment for why the re-queue lands at a random
   point at least one question ahead rather than predictably at the end or immediately
   next. Returns true if it actually skulled something (false if this exact occurrence
   was already skulled once already — the position-keyed guard is what allows the SAME
   question to be skulled again on a genuinely later occurrence without this call
   silently double-counting the one you're looking at right now). */
function performAutoSkull(mcq, s){
  if (!mcq || !s) return false;
  if (!s.skulledPositions) s.skulledPositions = {};
  if (s.skulledPositions[s.index]) return false;
  s.skulledPositions[s.index] = true;
  mcq.skullCount = (mcq.skullCount || 0) + 1;
  s.autoSkullCount = (s.autoSkullCount || 0) + 1;
  var remainingStart = s.index + 2;
  if (remainingStart < s.ids.length) {
    var insertAt = remainingStart + Math.floor(Math.random() * (s.ids.length - remainingStart + 1));
    s.ids.splice(insertAt, 0, mcq.id);
  } else {
    s.ids.push(mcq.id);
  }
  return true;
}

async function advanceAfterReveal(){
  var s = state.session;
  var m = state.mcqs.find(function(x){ return x.id === s.ids[s.index]; });
  if (!m) return;
  /* If "Show correct order" was used on a sequence question, preRevealSelected holds
     the person's real (wrong) attempt — score against THAT, not the post-reveal
     display state, so a wrong answer they had to be shown never gets recorded as if
     they'd gotten it right on their own. See the big comment on animateSequenceToCorrect. */
  var scoringSelected = s.preRevealSelected !== undefined ? s.preRevealSelected : s.selected;
  var correct = evaluateCorrect(m, scoringSelected);
  var pickedStr = pickedStrFor(m, scoringSelected);
  var timeToAnswerMs = s.lastTimeToAnswerMs;
  var timeOnExplanationMs = s.revealedAt ? (Date.now() - s.revealedAt) : null;

  if (!s.undoStack) s.undoStack = [];
  s.undoStack.push({
    mcqId: m.id,
    learningBefore: JSON.parse(JSON.stringify(m.learning)),
    asleepBefore: m.asleep,
    statsBefore: JSON.parse(JSON.stringify(s.stats)),
    resultsLenBefore: s.results.length,
    index: s.index,
    selected: scoringSelected /* the honest original attempt, not the post-reveal display state — undo should restore what was actually there */
  });

  if (m.type !== 'card') {
    LearningEngine.record(m, pickedStr, correct, timeToAnswerMs, timeOnExplanationMs, m.type === 'mnemonic' ? resolveMnemonicTestIndex(m, s) : undefined); /* rating is auto-derived inside, from this question's own history and how long it took */
  }
  /* Card is deliberately excluded from LearningEngine.record() entirely — not "always
     pass," genuinely skipped. It was never answered, so it shouldn't get an attempt
     history entry, an FSRS-derived rating, or a scheduling nudge at all. m.learning.history
     stays empty forever for a card, same as a question that's simply never been seen —
     classify() already handles empty history gracefully ("new"), no special-case needed
     there. This is what "no answering, just read" means end to end, not just on screen. */

  var cls = LearningEngine.classify(m);
  if (s.stats && s.stats[cls] !== undefined && m.type !== 'card') s.stats[cls]++;
  if (correct === true) s.stats.correct++;
  var justAutoSkulled = false;
  if (correct === false) {
    s.stats.wrong++;
    if (s.autoSkullEnabled) justAutoSkulled = performAutoSkull(m, s); /* "mistake" covers both a genuinely wrong pick and a forced-wrong timeout (onQuestionTimeout() sets selected/shortAnswerCorrect the same way a real wrong answer would) — evaluateCorrect() can't tell the two apart and doesn't need to */
  }

  s.results.push({ id: m.id, correct: correct, selected: scoringSelected, resolvedMnemonicIndex: (m.type === 'mnemonic' ? resolveMnemonicTestIndex(m, s) : undefined) }); /* same reasoning — reviewing this question later should show what was actually chosen (and for mnemonic, which letter was actually tested at the time), not something re-derived fresh */
  bumpStreak();

  /* Plan progress — credited once per question actually advanced past, matching
     every other per-question tally above (card excluded for the same reason it's
     excluded from stats/FSRS: it was never actually answered). Uses saveUserSettings()
     specifically (not saveLibrary(), which handles state.mcqs) since study plans live
     in state.studyPlans, a separate piece of synced state. */
  if (s.planKey && state.studyPlans[s.planKey] && m.type !== 'card') {
    state.studyPlans[s.planKey].totalCompleted++;
    saveUserSettings();
  }

  var justAutoSlept = m.autoSlept;
  if (justAutoSlept) m.autoSlept = false; // one-shot — don't re-toast on a future render

  var wasTimedOut = s.timedOut;
  s.index++; s.selected = null; s.revealed = false; s.shortAnswerCorrect = null; s.viewIndex = s.index;
  s.timerStartedAt = null; s.timerFrozenPct = null; s.timedOut = false; /* fresh countdown for whatever's next — renderTimerBar() re-stamps timerStartedAt the moment it notices the question changed */
  delete s.preRevealSelected; /* reset for whatever question comes next — this flag only ever applies to the one question it was captured for */
  s.questionShownAt = Date.now(); s.revealedAt = null; s.lastTimeToAnswerMs = null; /* start the clock fresh for whatever's next */
  if (s.index >= s.ids.length) { state.view = 'summary'; clearLiveSessionSync(); /* finished normally — this isn't an ungraceful exit, don't let it be adopted as a crash-recovery resume next load */ }
  render(); /* update the screen immediately — don't make the person wait on a network round trip just to see the next question */
  saveLibrary(); /* fire-and-forget in the background; it has its own error toast if it fails */
  if (justAutoSkulled) showToast((wasTimedOut ? '⏱️ Time\'s up — marked wrong' : '✗ Marked wrong') + ' and skulled for extra practice.');
  else if (wasTimedOut) showToast('⏱️ Time\'s up — marked wrong.');
  if (justAutoSlept) showToast('That question is asleep now — ' + (state.autoSleepStreak||4) + ' correct in a row. Wake it anytime from its row in the library.');
}

async function undoLastAnswer(){
  var s = state.session;
  if (!s || !s.undoStack || !s.undoStack.length) return;
  var last = s.undoStack.pop();
  var mm = state.mcqs.find(function(x){ return x.id === last.mcqId; });
  if (mm) {
    mm.learning = last.learningBefore;
    if ('asleepBefore' in last) mm.asleep = last.asleepBefore; /* undo the auto-sleep too, if that's what this attempt triggered */
  }
  s.results.length = last.resultsLenBefore;
  s.stats = last.statsBefore;
  s.index = last.index;
  s.viewIndex = s.index;
  s.selected = last.selected;
  s.revealed = true;
  s.shortAnswerCorrect = null; /* re-grade on the way back in, rather than trusting a stale self-grade */
  s.revealedAt = Date.now(); s.lastTimeToAnswerMs = null; /* fresh timing for whatever rating they give it this time */
  render();
  saveLibrary();
}

function renderSummary(){
  var s = state.session;
  var total = s.results.length;
  var correct = s.results.filter(function(r){ return r.correct === true; }).length;
  var scored = s.results.filter(function(r){ return r.correct !== null; }).length;
  var pct = scored ? Math.round((correct / scored) * 100) : 0;
  var byId = {}; state.mcqs.forEach(function(m){ byId[m.id] = m; });

  var classCounts = { mastered:0, learning:0, misconception:0, noconcept:0 };
  s.results.forEach(function(r){
    var m = byId[r.id];
    if (!m || !m.learning) return;
    var cls = LearningEngine.classify(m);
    if (classCounts[cls] !== undefined) classCounts[cls]++;
  });

  var html = '<div class="practice-wrap"><div class="card summary-card">';
  html += '<div class="score-ring' + (pct >= 60 ? ' good' : '') + '"><div class="score-big serif">' + pct + '%</div><div class="score-sub">' + correct + ' / ' + scored + ' scored</div></div>';
  html += '<div class="serif" style="font-size:19px;">Session complete</div>';
  html += '<div class="view-sub">' + total + ' question' + (total===1?'':'s') + ' attempted this round.</div>';

  html += '<div class="summary-breakdown">';
  html += '<div class="summary-row"><span>Questions</span><span>' + total + '</span></div>';
  html += '<div class="summary-row"><span>Accuracy</span><span>' + pct + '%</span></div>';
  html += '<div class="summary-row"><span>Mastered</span><span>' + classCounts.mastered + '</span></div>';
  html += '<div class="summary-row"><span>Learning</span><span>' + classCounts.learning + '</span></div>';
  html += '<div class="summary-row"><span>Misconceptions</span><span>' + classCounts.misconception + '</span></div>';
  html += '<div class="summary-row"><span>No Concept</span><span>' + classCounts.noconcept + '</span></div>';
  html += '</div>';

  var wrongIds = s.results.filter(function(r){ return r.correct === false; }).map(function(r){ return r.id; });
  html += '<div class="action-row" style="justify-content:center;margin-top:22px;">';
  if (wrongIds.length) html += '<button class="btn btn-primary" data-action="retry-wrong" data-ids="' + wrongIds.join(',') + '">Retry the ' + wrongIds.length + ' missed</button>';
  html += '<button class="btn btn-ghost" data-action="back-to-library">Back to library</button>';
  html += '</div>';

  html += '</div></div>';
  return html;
}
