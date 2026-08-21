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
    return q.learning && (q.learning.due||0) <= now && !state.sleepingSubjects[q.subject] && !q.asleep;
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
     undo doesn't have a clean re-measurement) rather than guessing. */
  record(mcq,picked,correct,timeToAnswerMs,timeOnExplanationMs){

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
      expected:mcq.answer[0],
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
  if (!state.pausedSession) { window.location.href = 'library.html'; return false; }
  var restored = normalizePausedSessionForResume(state.pausedSession);
  if (!restored.ids.length) {
    showToast('That test looks corrupted and can\'t be resumed — sorry about that.');
    state.pausedSession = null;
    savePausedSession();
    clearLiveSessionSync();
    window.location.href = 'library.html';
    return false;
  }
  state.session = restored;
  state.pausedSession = null;
  state.view = 'practice';
  savePausedSession(); /* clears the paused_session column now that it's live again, so a stale copy can't linger and get re-offered */
  return true;
}

function startPractice(ids){
  var byId = {}; state.mcqs.forEach(function(m){ byId[m.id] = m; });
  if(state.learningMode && state.learningMode.enabled){
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
  for (var i = pool.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
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
    lastTimeToAnswerMs: null
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
  window.location.href = 'practice.html';
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

function renderPractice(){
  var s = state.session;
  var isReviewing = s.viewIndex < s.index;
  var m = state.mcqs.find(function(x){ return x.id === s.ids[s.viewIndex]; });
  if (!m) { state.view = 'summary'; return renderSummary(); }
  var result = isReviewing ? s.results[s.viewIndex] : null;
  var viewSelected = isReviewing ? (result ? result.selected : null) : s.selected;
  var viewRevealed = isReviewing ? true : s.revealed;
  var pct = Math.round((s.index / s.ids.length) * 100);

  var html = '<div class="practice-wrap">';
  html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;gap:10px;flex-wrap:wrap;">' +
    '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
    '<button class="btn btn-ghost btn-sm" data-action="leave-practice">' + icon('chevron-left',14) + ' Back</button>' +
    '<button class="btn btn-ghost btn-sm" data-action="practice-prev"' + (s.viewIndex > 0 ? '' : ' disabled') + ' title="Previous question">' + icon('chevron-left',14) + '</button>' +
    '<button class="btn btn-ghost btn-sm" data-action="practice-next"' + (s.viewIndex < s.index ? '' : ' disabled') + ' title="Next question">' + icon('chevron-right',14) + '</button>' +
    '<button class="btn btn-ghost btn-sm" data-action="open-question-overview" title="Question overview">' + icon('layout-grid',14) + ' Overview</button>' +
    (!isReviewing && s.undoStack && s.undoStack.length ? '<button class="undo-btn icon-inline" data-action="undo-answer">' + icon('undo',13) + ' Undo last answer</button>' : '') +
    '</div>' +
    bookmarkButton(m) +
    '</div>';

  if (isReviewing) {
    html += '<div class="reviewing-banner">' + icon('layout-grid',14) + ' Reviewing question ' + (s.viewIndex+1) + ' of ' + s.ids.length + ' — already answered.' +
      '<button class="link-btn" data-action="jump-to-current">Jump to current question ' + icon('chevron-right',12) + '</button></div>';
  }

  var nextM = state.mcqs.find(function(x){ return x.id === s.ids[s.index+1]; });
  var nextLabel = nextM && nextM.learning ? LearningEngine.classify(nextM) : (nextM ? 'new' : null);
  html += '<div class="practice-progress"><div class="progress-track"><div class="progress-fill" style="width:' + pct + '%;"></div></div>' +
    '<div class="progress-label">' + (s.index+1) + ' / ' + s.ids.length +
    (nextLabel ? '<br>Next: ' + escapeHtml(nextLabel) : '') + '</div></div>';

  /* New question types (match/sequence/cutoff/mnemonic) branch out here, before the
     bubble-MCQ/short-answer card markup below. Each owns its own answer-sheet body but
     shares the header/progress bar above and the qmeta/reveal-panel/notes conventions
     via the shared helpers passed in. */
  if (m.type === 'match')    { html += renderMatchBody(m, s, isReviewing, result, viewRevealed); html += '</div>'; return html; }
  if (m.type === 'sequence') { html += renderSequenceBody(m, s, isReviewing, result, viewRevealed); html += '</div>'; return html; }
  if (m.type === 'cutoff')   { html += renderCutoffBody(m, s, isReviewing, result, viewRevealed); html += '</div>'; return html; }
  if (m.type === 'mnemonic') { html += renderMnemonicBody(m, s, isReviewing, result, viewRevealed); html += '</div>'; return html; }

  html += '<div class="card answer-sheet">';
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
      html += '<div class="answer-footer" style="justify-content:flex-end;">' +
        '<button class="btn btn-primary" data-action="next-question">' + (s.index + 1 < s.ids.length ? 'Next question' : 'Finish session') + '</button></div>';
    }
    html += '</div>';
  }

  html += '</div></div>';
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
function renderMatchBody(m, s, isReviewing, result, viewRevealed){
  var viewSel = isReviewing ? (result ? result.selected : null) : s.selected;
  if (!isReviewing && !viewSel) {
    viewSel = { links: {}, rightOrder: shuffledIndices(m.pairs.length, m.id || 'match'), pendingLeft: null };
    s.selected = viewSel;
  }
  var rightOrder = viewSel && viewSel.rightOrder ? viewSel.rightOrder : shuffledIndices(m.pairs.length, m.id || 'match');
  var links = (viewSel && viewSel.links) || {};

  var html = '<div class="card answer-sheet">';
  html += qMetaAndStemHtml(m, s, m.stem);
  html += '<div class="multi-select-hint">' + icon('check-circle',13) + ' Tap an item on the left, then its match on the right</div>';
  html += '<div class="match-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:10px;">';

  html += '<div>';
  m.pairs.forEach(function(pair, i){
    var isLinked = links[i] !== undefined;
    var isPending = viewSel.pendingLeft === i;
    var cls = 'match-item';
    if (viewRevealed) cls += (links[i] === i ? ' match-correct' : ' match-wrong');
    else if (isLinked) cls += ' match-linked';
    else if (isPending) cls += ' match-pending';
    html += '<button class="' + cls + '" style="display:block;width:100%;text-align:left;margin-bottom:8px;padding:10px 12px;border-radius:8px;" ' +
      (viewRevealed || isReviewing ? 'disabled' : 'data-action="match-pick-left" data-i="' + i + '"') + '>' +
      (i+1) + '. ' + escapeHtml(pair.left) + '</button>';
  });
  html += '</div>';

  html += '<div>';
  rightOrder.forEach(function(origIdx){
    var pair = m.pairs[origIdx];
    var linkedToLeft = Object.keys(links).find(function(li){ return links[li] === origIdx; });
    var isLinked = linkedToLeft !== undefined;
    var cls = 'match-item';
    if (viewRevealed) cls += (isLinked && Number(linkedToLeft) === origIdx ? ' match-correct' : (isLinked ? ' match-wrong' : ''));
    else if (isLinked) cls += ' match-linked';
    html += '<button class="' + cls + '" style="display:block;width:100%;text-align:left;margin-bottom:8px;padding:10px 12px;border-radius:8px;" ' +
      (viewRevealed || isReviewing ? 'disabled' : 'data-action="match-pick-right" data-i="' + origIdx + '"') + '>' +
      escapeHtml(pair.right) + '</button>';
  });
  html += '</div></div>';

  var allLinked = Object.keys(links).length === m.pairs.length;
  if (!viewRevealed) {
    html += '<div class="answer-footer" style="justify-content:flex-end;">' +
      '<button class="btn btn-primary" data-action="reveal-mcq"' + (allLinked ? '' : ' disabled') + '>Check answer</button></div>';
  } else {
    html += renderRevealFooter(m, s, isReviewing);
  }
  html += '</div>';
  return html;
}

/* ---------------- SEQUENCE ---------------- */
function renderSequenceBody(m, s, isReviewing, result, viewRevealed){
  var viewSel = isReviewing ? (result ? result.selected : null) : s.selected;
  if (!isReviewing && !viewSel) {
    viewSel = shuffledIndices(m.steps_correct_order.length, m.id || 'sequence');
    s.selected = viewSel;
  }
  var order = viewSel || [];

  var html = '<div class="card answer-sheet">';
  html += qMetaAndStemHtml(m, s, m.stem);
  html += '<div class="multi-select-hint">' + icon('check-circle',13) + ' Use the arrows to put these in the correct order</div>';
  html += '<div class="seq-list" style="margin-top:10px;">';
  order.forEach(function(origIdx, pos){
    var isCorrectHere = viewRevealed && origIdx === pos;
    var cls = 'seq-item' + (viewRevealed ? (isCorrectHere ? ' seq-correct' : ' seq-wrong') : '');
    html += '<div class="' + cls + '" style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:9px;margin-bottom:7px;">' +
      '<span class="mono" style="min-width:18px;">' + (pos+1) + '</span>' +
      '<span style="flex:1;">' + escapeHtml(m.steps_correct_order[origIdx]) + '</span>';
    if (!viewRevealed && !isReviewing) {
      html += '<button class="btn btn-ghost btn-sm" data-action="seq-move-up" data-pos="' + pos + '"' + (pos===0?' disabled':'') + ' title="Move up">' + icon('chevron-left',14) + '</button>' +
        '<button class="btn btn-ghost btn-sm" data-action="seq-move-down" data-pos="' + pos + '"' + (pos===order.length-1?' disabled':'') + ' title="Move down">' + icon('chevron-right',14) + '</button>';
    }
    html += '</div>';
  });
  html += '</div>';

  if (!viewRevealed) {
    html += '<div class="answer-footer" style="justify-content:flex-end;">' +
      '<button class="btn btn-primary" data-action="reveal-mcq">Check answer</button></div>';
  } else {
    html += renderRevealFooter(m, s, isReviewing);
  }
  html += '</div>';
  return html;
}

/* ---------------- CUTOFF ---------------- */
function renderCutoffBody(m, s, isReviewing, result, viewRevealed){
  var viewSel = isReviewing ? (result ? result.selected : null) : s.selected;
  if (!isReviewing && (viewSel === null || viewSel === undefined)) {
    viewSel = (m.range[0] + m.range[1]) / 2;
    s.selected = viewSel;
  }

  var html = '<div class="card answer-sheet">';
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
    html += '<div class="view-sub" style="margin:10px 0;">Your side of the threshold: <b>' + escapeHtml(userSide) + '</b></div>';
    html += renderRevealFooter(m, s, isReviewing);
  }
  html += '</div>';
  return html;
}

/* ---------------- MNEMONIC ---------------- */
function renderMnemonicBody(m, s, isReviewing, result, viewRevealed){
  var viewSel = isReviewing ? (result ? result.selected : null) : s.selected;
  var testLetter = m.letters[m.testIndex];

  var html = '<div class="card answer-sheet">';
  html += qMetaAndStemHtml(m, s, m.stem);
  html += '<div class="mnem-grid" style="display:flex;flex-wrap:wrap;gap:9px;margin:14px 0;">';
  m.letters.forEach(function(l, i){
    var isTested = i === m.testIndex;
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
    html += '<div class="reveal-panel"><div class="view-sub"><b>' + escapeHtml(testLetter.letter) + '</b> = ' + escapeHtml(testLetter.meaning) + '</div></div>';
    html += renderNotesSection(m);
    if (isReviewing) {
      /* nothing to submit — movement via Prev/Next/Overview up top, same as other reviewed questions */
    } else if (s.shortAnswerCorrect === null || s.shortAnswerCorrect === undefined) {
      html += '<div class="view-sub" style="margin-top:14px;">Compare your answer above with the record — did you get it right?</div>';
      html += '<div class="answer-footer" style="justify-content:flex-end;gap:10px;">' +
        '<button class="btn btn-danger" data-action="self-grade" data-correct="false">' + icon('x',15) + ' I was wrong</button>' +
        '<button class="btn btn-primary" data-action="self-grade" data-correct="true">' + icon('check-circle',15) + ' I was right</button></div>';
    } else {
      html += '<div class="answer-footer" style="justify-content:flex-end;">' +
        '<button class="btn btn-primary" data-action="next-question">' + (s.index + 1 < s.ids.length ? 'Next question' : 'Finish session') + '</button></div>';
    }
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
    html += '<div class="answer-footer" style="justify-content:flex-end;">' +
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

function revealCurrent(){
  var s = state.session;
  s.revealed = true;
  s.lastTimeToAnswerMs = s.questionShownAt ? (Date.now() - s.questionShownAt) : null; /* silent timing — how long they deliberated before checking */
  s.revealedAt = Date.now();
  render();
}

/* Builds a readable "what did they pick" string for LearningEngine.record()'s history —
   used by getMostRepeatedWrong() to show recurring-mistake banners. Every question type
   needs to produce SOMETHING here or that banner silently stops working for that type. */
function pickedStrFor(m, selected){
  if (m.isShortAnswer || m.type === 'mnemonic') return selected || '';
  if (m.type === 'match') {
    if (!selected || !selected.links) return '';
    return Object.keys(selected.links).map(function(li){ return li + '→' + selected.links[li]; }).join(',');
  }
  if (m.type === 'sequence') return Array.isArray(selected) ? selected.join(',') : '';
  if (m.type === 'cutoff') return selected !== null && selected !== undefined ? String(selected) : '';
  return selected ? selected.join(',') : '';
}

async function advanceAfterReveal(){
  var s = state.session;
  var m = state.mcqs.find(function(x){ return x.id === s.ids[s.index]; });
  if (!m) return;
  var correct = evaluateCorrect(m, s.selected);
  var pickedStr = pickedStrFor(m, s.selected);
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
    selected: s.selected
  });

  LearningEngine.record(m, pickedStr, correct, timeToAnswerMs, timeOnExplanationMs); /* rating is auto-derived inside, from this question's own history and how long it took */

  var cls = LearningEngine.classify(m);
  if (s.stats && s.stats[cls] !== undefined) s.stats[cls]++;
  if (correct === true) s.stats.correct++;
  if (correct === false) s.stats.wrong++;

  s.results.push({ id: m.id, correct: correct, selected: s.selected });
  bumpStreak();

  var justAutoSlept = m.autoSlept;
  if (justAutoSlept) m.autoSlept = false; // one-shot — don't re-toast on a future render

  s.index++; s.selected = null; s.revealed = false; s.shortAnswerCorrect = null; s.viewIndex = s.index;
  s.questionShownAt = Date.now(); s.revealedAt = null; s.lastTimeToAnswerMs = null; /* start the clock fresh for whatever's next */
  if (s.index >= s.ids.length) { state.view = 'summary'; clearLiveSessionSync(); /* finished normally — this isn't an ungraceful exit, don't let it be adopted as a crash-recovery resume next load */ }
  render(); /* update the screen immediately — don't make the person wait on a network round trip just to see the next question */
  saveLibrary(); /* fire-and-forget in the background; it has its own error toast if it fails */
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
