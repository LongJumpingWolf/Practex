# MCQ Master Guide — PDF Chapter → Practex MCQ Bank

This is the methodology we've actually used, chapter after chapter, compiled from
our sessions together (most recently Ch. 32 Obstructive Lung Diseases, and the
Breast/Bone/Skin batch before that). Not a fresh guess — this is what's already
been applied consistently across every chapter you've had built this way.

---

## Step 0 — Which question TYPE, for which content (the decision that comes first)

This is the step that actually determines everything else, and it's a different
axis from "tier" below. Tier (Recall/Understanding/Application/Analysis) is about
*how hard* a question is. Type is about *what shape of fact* you're even looking
at — and the shape of the fact should decide the shape of the question, not the
other way around. Forcing every fact into a standard 4-option MCQ wastes the
other 5 formats Practex actually supports.

**The decision, in order — ask these in sequence for each unit from the concept map:**

**1. Is this fundamentally a sequence or process with a fixed order?**
→ **`sequence` type.** Anything where "what happens first/next/last" is the
actual thing being tested — e.g. the steps of wound healing (inflammation →
proliferation → remodeling), the coagulation cascade, the stages of a hypersensitivity
reaction. A standard MCQ asking "which comes first" is strictly worse than a
sequence question here, because it can only test one ordering relationship at a
time; sequence tests the whole chain at once.
*Don't use it for:* a list with no real order (e.g. "name the 4 types of X") —
that's a recall MCQ, not a sequence, even if you happen to be listing them 1–4.

**2. Is this fundamentally a set of pairs/associations?**
→ **`match` type.** Drug ↔ mechanism, organism ↔ stain result, genotype ↔
phenotype, eponym ↔ finding. If the core fact is "A goes with B, C goes with D,"
don't dress it up as 4 separate MCQs each testing one pairing — one match
question tests all the pairings at once and is more honest about what's actually
being asked of the student (recognize the *relationship*, not recall four
isolated facts).
*Don't use it for:* a single pairing on its own (e.g. just "Kartagener's = what
triad") — that's one recall MCQ, not a match set. Match needs ≥3 genuine pairs
to be worth it.

**3. Is this fundamentally a numeric threshold or cutoff?**
→ **`cutoff` type.** Reid's index >0.4, BMI categories, lab reference ranges,
Ghon focus size thresholds — anything where the actual test is "which side of
this number does X fall on." A standard MCQ can ask "what's the Reid's index
cutoff for chronic bronchitis," but a cutoff-type question tests the *application*
of the number (classify this value) more directly, which is usually the more
exam-relevant skill.

**4. Is this fundamentally a mnemonic/acronym the student needs to decode?**
→ **`mnemonic` type.** If the source material presents something as a memory
device (PAIN for the aortic dissection triad, VITAMIN CDEF for a differential
checklist), preserve it as a mnemonic-type question, don't quietly convert it
into a recall MCQ that throws away the memory scaffold the source clearly
intended you to use.

**5. Is this a fact with no real test value beyond "did you see this" —
i.e., pure exposure, not evaluation?**
→ **`card` type** (ungraded, no distractors). Rare facts, background context,
things worth having seen once but not worth quizzing (e.g. "this condition was
first described in 1969 by X"). If you can't write three genuine, plausible
wrong answers for it, that's usually the signal it belongs here instead of being
forced into a 4-option MCQ with weak distractors.

**6. Does this need a labeled image/diagram to actually test the point?**
→ Not a separate type — attach the image to whichever type actually fits
(usually a standard MCQ) via `#IMAGE_Q:`/`#IMAGE_A:` or `#IMAGE:`. Histology,
gross pathology, X-ray findings, a labeled diagram where the visual IS the
question, not just decoration next to it, all still go through this same
attachment mechanism — there's no `#TYPE: image` to switch to. If the
question would be exactly as valid with the image removed, it isn't really
image-dependent — it's a text question that happens to have an image nearby
(attach the image, but the type decision is unaffected by that).

**7. None of the above — it's a standard fact, relationship, or scenario.**
→ **Standard MCQ.** Then a second decision, which of the 4 standard subtypes:

  - **`recall`** — direct fact retrieval, no scenario needed. "What is X?" /
    "Which of the following is true of X?" Use when the fact stands alone and
    testing it straight is the honest test (e.g. "what are the components of
    the acinus").
  - **`vignette`** — a clinical scenario the student has to interpret, then
    apply a fact to. Use when the *real* exam skill is recognizing the concept
    *from a presentation*, not just stating the concept (e.g. a patient
    presentation that should make you think "this is chronic bronchitis," not
    just "what defines chronic bronchitis").
  - **`compare`** — two (or more) named, similar-looking things contrasted
    directly. Use when the actual exam trap is telling two things apart, not
    recalling either one individually (e.g. pink puffer vs. blue bloater,
    Reid's index in asthma vs. chronic bronchitis). If you're writing a
    question and find yourself needing to explain BOTH of two named entities
    to make the distractors work, that's the signal it should be `compare`,
    not two separate `recall` questions.
  - **`except`** — "all of the following are true EXCEPT." Use sparingly, and
    only when a list of ≥4 genuinely true facts about one concept exists and
    the odd-one-out is a real, plausible-looking near-miss — not when you're
    struggling to find 3 true statements and padding with obvious ones. A
    weak `except` question (where 3 options are trivially true and 1 is
    trivially false) tests reading comprehension, not knowledge — that's the
    failure mode to actively watch for.

**Worked example (Ch. 32, Obstructive Lung Diseases) — how this actually played
out:**
- "Acinus = respiratory bronchiole + alveolar duct + alveolar sac" → no order, no
  pairing, no cutoff, stands alone → **standard MCQ, recall**
- α1-antitrypsin genotype (PiMM/PiZZ/PiSS) → phenotype/risk mapping → **match**
  (3+ genuine pairs)
- Reid's index >0.4 = chronic bronchitis → **cutoff**
- Kartagener's triad (situs inversus + bronchiectasis + sinusitis) → could be
  recall, but since it's presented as a fixed named triad worth memorizing as a
  unit → reasonable as either **standard MCQ, recall** or, if the source frames
  it as a memory device, **mnemonic**
- "Pink puffer vs. blue bloater" contrast → **standard MCQ, compare** — it's one
  relationship (two named things contrasted on multiple features), not a set of
  independent pairs, so `match` would be the wrong fit here
- A scenario like "38-year-old smoker presents with barrel chest, pursed-lip
  breathing, minimal cyanosis..." → **standard MCQ, vignette** (tests
  recognition from presentation, not the definition itself)

---

## Step 1 — Concept map before a single question gets written

Before drafting anything, the chapter gets broken into **testable units** — not
pages, not paragraphs, actual discrete facts/relationships a question could be
built around. Each unit gets classified:

- **Core / high-yield** — definitions, named triads, pathogenesis sequences,
  classic exam-trap contrasts (e.g. Reid's index in chronic bronchitis vs.
  asthma, pink puffer vs. blue bloater, α1-AT genotypes)
- **Supporting** — detail that fills out a core concept but isn't independently
  exam-worthy
- **Trivia / footnote** — mentioned once, low yield, often folded into a
  distractor elsewhere rather than getting its own question

This pass also catches **source errors** before they get baked into a question —
reversed labels, ambiguous pathway arrows, answer-key mismatches, spelling
inconsistencies. These get flagged to you explicitly, not silently corrected or
silently left in. A question is never written on a point that looks like a
probable slide/notes error without flagging it first.

**As each unit gets identified, it also gets a TYPE assigned per Step 0 above** —
so the concept map isn't just "here are the facts," it's "here are the facts,
and here's what shape of question each one becomes."

## Step 2 — How many MCQs (not a fixed number, a calculation)

Page count is a bad proxy — a dense 7-page chapter can map to 45+ core units.
The actual formula:

- Core/high-yield units → target **3 touches** each (3 different tiers)
- Supporting units → **1–2 touches**
- Trivia units → **0–1 touch**, often just becomes a distractor instead

Sum the slots needed across all units, weighted by their tier, and that total —
not a round number picked first and filled toward — is the question count.
(Ch. 32 worked out to ~30 core units × ~1.6 avg touches + ~15 supporting ×
~1.3 ≈ 50.)

**Stop when**: every unit has ≥1 question, and every high-yield unit hits ≥3
tiers. Not before, not after.

## Step 3 — Four tiers, interleaved (not blocked by topic)

| Tier | Type | What it tests |
|---|---|---|
| 1 | Recall | Direct definition/fact retrieval |
| 2 | Understanding | Mechanism, "why," relationships between facts |
| 3 | Application | Vignette-style — apply the concept to a scenario |
| 4 | Analysis / Discrimination / Cumulative | Contrast two similar-looking concepts, or pull together multiple chapter threads |

Questions get **interleaved across topics**, not grouped — a block of 15
consecutive emphysema questions is worse for retention than emphysema
questions distributed through the set alongside asthma, bronchiectasis, etc.

Typical split for a standard-density chapter: roughly 15 / 13 / 12 / 10 across
the four tiers — this flexes with actual unit count, it isn't fixed.

## Step 4 — Writing each question

**For standard MCQ (recall/vignette/compare/except):**
- **Vignette stems** for Application/Analysis tiers — a real clinical scenario,
  not just "which of the following."
- **Exactly 4 options, A–D**, always.
- **Distractors are genuine near-misses** from the same chapter content — not
  random wrong facts. A distractor should represent a real, plausible
  misconception someone could actually hold.
- **Option lengths comparable** — the correct answer should never be
  identifiable just because it's the longest, most hedged, or most detailed
  option. If a correct answer naturally comes out longer, the distractors get
  enriched rather than the correct answer getting gutted.
- **Answer letter distribution balanced A–D** — no clustering on one letter
  across the set.
- **Every option gets a line in the explanation** — not just "why the answer is
  right," but why each of the three wrong options is wrong. Format:
  `- A) ✓ ...` / `- B) ✗ ...` etc.

**For the 5 non-standard types, the equivalent quality bar:**
- **Match** — pairs should be genuinely distinct, not overlapping enough to be
  confusable by construction rather than by knowledge (e.g. don't pair "PiMM"
  and "PiMZ" together unless the distinction between them is actually the
  point). Left and right sides should each make sense read alone, not require
  the other side for context.
- **Sequence** — the correct order should not be guessable from surface cues
  (e.g. don't accidentally list steps in the same order the source text
  happened to present them, if that's not actually diagnostic of knowing the
  real sequence).
- **Cutoff** — `#TESTVALUE` should sit close enough to `#THRESHOLD` to be a
  genuine test of knowing the exact number, not a value so far from the
  threshold that the classification is obvious regardless of whether the
  cutoff is known (e.g. testing 0.6 against a 0.4 threshold is a fair test;
  testing 0.95 is not).
- **Mnemonic** — `#TESTLETTER` should rotate across questions on the same
  mnemonic rather than always testing the same letter, so the whole device
  gets covered over multiple exposures, not just its first letter every time.
- **Card** — genuinely ungraded content only. If you catch yourself wanting to
  add "distractors" to a card, that's the signal it should have been a
  standard MCQ instead.

## Step 5 — Anti-duplication

If sample MCQs already exist for this chapter (from an earlier partial pass, or
provided as reference), the new set actively avoids repeating the same
fact/format combination — same underlying fact tested from a different angle or
phrasing is fine; same question in different words is not.

## Step 6 — Output format (Practex, per HANDOFF_BRIEF_v2)

```
#SOURCE: <textbook/notes name — be specific about whether these are original
questions written from chapter content, or drawn from an existing bank>

#SUBJECT: <Subject>
#CHAPTER: <Subject> > <Chapter> > <Subtopic>

#Q
<vignette or direct-recall stem>
#OPTIONS
A) <option>
B) <option>
C) <option>
D) <option>
#ANSWER: <letter> — or the exact text of the correct option (see below)
#EXPLANATION
- A) ✗/✓ <why>
- B) ✗/✓ <why>
- C) ✗/✓ <why>
- D) ✗/✓ <why>
#TIER: <Recall / Understanding / Application / Analysis>
#TAGS: <topic tags>
#END
```

**On `#ANSWER`** — real friction reported from actually building against this
guide: drafting the correct option first and distractors after naturally
clusters correct answers on "A" (42/48 landed on A in one real set, caught
only by a post-hoc rebalancing script). Two ways to write `#ANSWER` now:
- `#ANSWER: B` — the traditional way, a bare letter. Use this when converting
  *existing* PYQ/verbatim questions that already have a real, fixed answer
  key from the source — the letter should match the source faithfully.
- `#ANSWER: <the exact text of the correct option>` — for freshly-authored
  content. Write the options in whatever order is natural, mark the correct
  one by its actual text, and the parser reassigns all four options' final
  letters via a deterministic round-robin across the whole file — genuine
  balance is structural now, not something to remember to do or check for
  after the fact. The explanation's `- A) ✓ ...` lines get remapped
  automatically to match, so write them against whatever letters you used
  when drafting; the final output relabels everything consistently.

**On `#TIER`** — a dedicated field now, not buried inside `#TAGS` as a
"Tier1-Recall"-style tag. Still optional, but if it's genuinely knowable from
context, use the real field so tier can eventually be filtered/scheduled on
programmatically rather than string-parsed out of a tag list.

`#CHAPTER` must match your existing Practex tree exactly — this has been
corrected before (e.g. `Pathology > Cardiac Pathology > <subtopic>`, not
`Cardiovascular System > <subtopic>`). When in doubt, match the existing tree,
don't invent a new branch.

### Syntax for the 5 non-standard types

Same `#SUBJECT`/`#CHAPTER` header conventions apply. Every block starts with
`#TYPE:` then `#Q <stem>` (yes, `#Q` — same marker as standard MCQ, not
`#STEM`; this caught me out too when I first wrote this guide, and the
examples below are now checked directly against the real parser, not
reconstructed from memory):

**Match** (pairs — needs ≥3, and each pair line needs a number prefix):
```
#TYPE: match
#Q Match each genotype to its associated risk.
#PAIRS
1. PiMM = Normal risk
2. PiZZ = Severe deficiency, high risk, early-onset panacinar emphysema
3. PiSS = Intermediate risk
#TAGS: alpha1-antitrypsin, genotype
#END
```

**Sequence** (fixed order — steps also need a number prefix, in writing order,
not necessarily the correct order — the numbers are just line IDs, not a
claim about sequence):
```
#TYPE: sequence
#Q Place the phases of wound healing in the correct order.
#STEPS
1. Hemostasis
2. Inflammation
3. Proliferation
4. Remodeling
#TAGS: wound healing, phases
#END
```

**Cutoff** (numeric threshold classification — no `#ANSWER:` line; the
grading is built from `#THRESHOLD` and `#TESTVALUE` directly):
```
#TYPE: cutoff
#Q A Reid's index of 0.6 is most consistent with which diagnosis?
#RANGE: 0 1 0.1
#THRESHOLD: 0.4
#TESTVALUE: 0.6
#BELOW: Normal
#ABOVE: Chronic bronchitis
#TAGS: Reid's index, chronic bronchitis
#END
```
`#RANGE:` is three numbers — min, max, step — defining the slider the app
actually renders. `#BELOW`/`#ABOVE` are both required — the label for each
side of the threshold, not just the correct side.

**Mnemonic** (preserve the memory device, don't dissolve it into recall —
letter lines are NOT numbered, just `letter = meaning`):
```
#TYPE: mnemonic
#Q What does each letter of "PAIN" stand for in aortic dissection risk factors?
#LETTERS
P = Pregnancy
A = Aneurysm (pre-existing)
I = Inflammatory (vasculitis)
N = Neck/chest trauma
#TESTLETTER: A
#TAGS: aortic dissection, mnemonic
#END
```
`#TESTLETTER` can be a comma-separated list, or omitted entirely to mean "any
letter is fair game." One block covers the whole rotation now — real friction
reported from actually building against this guide: the old spec required one
full duplicated block per letter to test (SOFT PAINS, 9 letters → 8x the file
for one mnemonic, changing only which letter got tested). Which specific
letter actually gets tested is picked fresh each review session now, not once
at import — so it genuinely rotates over repeated study instead of only ever
testing whatever was picked the one time the file was parsed.

**Card** (ungraded exposure — front comes from `#Q`, not `#FRONT`):
```
#TYPE: card
#Q When was Kartagener syndrome first described, and by whom?
#BACK
1933, by Manes Kartagener — described the triad of situs inversus,
bronchiectasis, and chronic sinusitis.
#TAGS: Kartagener, history
#END
```

**A note on images**: there's no `#TYPE: image`. An image-heavy question
(histology, gross pathology, a labeled diagram) is a standard MCQ that
carries an image via `#IMAGE_Q:`/`#IMAGE_A:` (a real link) or `#IMAGE:
[description]` (a placeholder for a scanned page with no real link) — not a
separate type. Worth stating explicitly since Step 0 above used to imply
otherwise by listing "image" alongside the other 5 non-standard types; that's
been fixed.

---

## Step 7 — Validation (run programmatically, every time, before delivery)

- Every stem is unique — no duplicate questions
- Every question has exactly 4 options with unique text (no duplicate options
  within one question)
- Answer letter distribution is genuinely balanced, not just roughly so
- No option is a length outlier that gives away the answer
- Tier counts match what was planned
- Every core unit from the concept map has ≥1 question; every high-yield unit
  has ≥3

## Cross-cutting conventions (apply to Kardex decks too, not just Practex)

- `==highlight==` only on the specific load-bearing word/number/trap term —
  never a whole sentence, and never on a general (non-exception) fact
- Tables from the source stay as markdown tables, not fragmented across
  separate cards/questions
- Images get placed by matching their label text to existing content, never
  speculatively — an unlabeled or ambiguous image gets flagged for
  clarification rather than guessed at
- Source attribution is explicit and specific (e.g. "Ramdas Nayak — Exam
  Preparatory Manual for Undergraduates"), not generic
