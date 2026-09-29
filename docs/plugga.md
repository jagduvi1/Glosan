# Plugga — school subjects in Glosan

Plugga turns Glosan from a vocabulary app into a study trainer for **every
school subject**: Matematik, Fysik, Kemi, Biologi, NO, Historia, Geografi,
Religionskunskap, Samhällskunskap, SO, Teknik and the languages. It is built
behind a feature flag and shown to more users step by step.

## Principles (decided with Johan, 2026-09-29)

1. **Content is created only through MCP.** The student photographs pages from
   the textbook and asks their own AI (Claude with Glosan connected) to create
   study material. The app has no content editors — it is for practising,
   choosing and organising.
2. **Glosan never calls an AI API in Plugga.** All AI work — creating content,
   checking a handwritten solution, grading an open answer — happens in the
   user's own AI through MCP. Glosan stores and serves data. (`routes/study.js`
   and the study MCP tools must never import `services/anthropic.js`.)
3. **The AI asks for the student's årskurs before creating anything.** It is
   stored on each unit and confirmed the next time ("förra gången åk 8 —
   stämmer det fortfarande?").
4. **The book's exercises are examples.** The AI writes its *own* exercises
   modelled on them (other numbers, same skills), with a reference to the
   book's exercise (`sourceRef: "uppg 3.14"`) so the student can compare.
5. **Levels follow the book.** When the student photographs pages the book
   marks as easy and as hard (nivå 1/2/3, grön/gul/röd, grund/fördjupning/
   utmaning), the AI maps them to **E / C / A** and creates exercises on every
   level in about the same proportions, with a progression inside each level.
   The app shows them as *Lätt · E*, *Medel · C*, *Svår · A*.
6. **Shareable.** A unit can be shared with friends — also people who have no
   AI. Everyone practises with their **own** progress; only the creator's AI
   changes the content, so corrections reach everyone.
7. **Study XP counts** toward the same XP and streak as the vocabulary quizzes.
8. **Everything is tracked** so the student can show a parent what they have
   done: today / this week / this month / this term.

## How content is organised

```
Ämne (subject)        fixed catalogue: config/subjects.js (NO and SO are groups)
 └─ Termin (term)     "HT 2026", "VT 2027" — set from the date, the AI can override
     └─ Område (unit) "Kapitel 3 — Ekvationer", code MA3, årskurs 8, source, test date
          ├─ Genomgång   explanation, "så gör du" step by step, examples, common mistakes
          ├─ Kort        flashcards (begrepp, questions, formulas)
          ├─ Övningar    exercises on levels E/C/A with hints and worked solutions
          └─ Övningsprov practice tests with E/C/A points (like the national tests)
```

- **Mappar** — the student's own groupings across subjects and terms
  ("Inför provet v. 42"), including shared units.
- **Practice scope** — one unit, several selected units, a whole subject and
  term ("all maths HT26"), a whole group ("all NO"), a folder, or a subject
  across all terms (before nationella prov in åk 9).
- Older terms stay browsable; spaced repetition keeps bringing old material back.

## Content types and answer types

| Answer type | Used for | Checked by |
|---|---|---|
| `number` | calculations (maths, physics, chemistry) — accepts `3,5`, `7/2`, `3 1/2`, `−2`, units | the app |
| `choice` | multiple choice (all subjects) | the app |
| `text` | short facts: a term, a year, a name — with accepted variants | the app |
| `self` | open questions: "förklara…", "visa hur…", "resonera…" (SO, NO, history, maths reasoning) | the student against the model answer and E/C/A criteria (enkla / utvecklade / välutvecklade resonemang, Lgr22) — or their own AI via the paper flow |

Later: `order` (timelines in history, steps of a method), `match` (term ↔
explanation), algebraic expressions, and generated maths problems.

## Pen and paper (the paper flow)

Every exercise has a short code: **MA3-14** = Matematik, unit 3, exercise 14
(`utils/studyCodes.js`; tolerant of handwriting: `ma3 14`, `MA 3–14`, …).

1. The student solves the exercise on paper and writes the code at the top.
2. They photograph it and ask their AI: "rätta MA3-14".
3. The AI fetches the exercise over MCP — prompt, answer, worked solution,
   level — and compares: is it right, where did it first go wrong, a hint
   (not the full solution), and what would lift it to the next level.
4. The AI records the result with its feedback (`StudyAttempt`, `source:
   'paper'`) — it counts toward statistics, spaced repetition and XP, and the
   student can re-read the tips in the app. **The photo is never stored.**

The same flow grades open answers, and later whole practice tests done on
paper (points per E/C/A level).

## Tracking — "Min plugg"

- Every answer is a `StudyAttempt` (which exercise, right/partly/wrong, in the
  app or on paper, the AI's feedback).
- Every study session is a `StudySession` with **active time**: each answer or
  ping (while a genomgång is visible) adds the time since the last activity,
  capped at two minutes — a screen left on is not study time.
- The "Min plugg" page shows today / week / month / term: time studied,
  exercises done and how many right, practice tests, a per-subject breakdown
  and a calendar — printable and shareable with a parent.
- History is denormalised (subject, unit title, exercise code) so it survives
  if a shared unit is later deleted by its creator.

## Sharing

Mirrors vocabulary-list sharing: share with friends, or a share link / QR code
(`/j/…`-style). Joining a unit adds you to its `sharedWith` — no copy — so the
creator's corrections reach everyone. Recipients practise with their own
progress (`StudyItemState` is per user) and can report "fel i facit", which
reaches the creator's AI. During the beta, recipients need the flag too.

## MCP (Fas 1–2)

All study tools carry `feature: 'study'` and are only registered for users with
the flag; the study section of the server instructions is added the same way
(`FEATURE_SECTIONS` in `mcp/instructions.js`).

- Create: `create_study_unit` (requires årskurs), `add_study_pages`,
  `add_flashcards`, `add_exercises` (in batches), `create_practice_test`
- Change: `update_study_item`, `delete_study_items`, `move_study_unit`,
  `resolve_flag`, folders
- Read: `list_study_units`, `get_study_unit`, `get_study_item` (by code, for
  the paper flow), `get_study_progress`, `list_study_mistakes`,
  `get_study_activity`
- Record: `record_paper_attempt`
- Prompts: `study_from_photos`, `check_my_solution`, `prepare_for_test`,
  `fix_reported_errors`

The creation workflow the instructions enforce: ask årskurs (and test date) →
identify subject, chapter and book from the photos → propose what will be
created (e.g. "1 genomgång, 20 kort, 30 övningar E/C/A, 1 prov") → wait for OK
→ create in batches → read the unit back and double-check every answer → send
the link.

## Rollout

- `User.features` (per account, admin page switch "Plugga (beta)") +
  `FEATURES_FOR_ALL=study` (env) to release for everyone. The env var is not
  wired into `docker-compose.prod.yml` yet — add
  `FEATURES_FOR_ALL=${FEATURES_FOR_ALL:-}` to the backend service at release
  time (and re-download the compose file on the VM).
- Backend: `requireFeature('study')` answers **404** without the flag — a
  hidden module can't be discovered by guessing URLs.
- Frontend: the "Plugga" nav item and `/plugga` exist only with the flag
  (`hasFeature(user, 'study')`; the user JSON carries the effective flags).
- MCP: tools, prompts and instructions are gated the same way.

## Data model

| Model | Holds |
|---|---|
| `StudyUnit` | creator, subject, term, gradeYear, code (MA3), title, description, source{book, chapter, pages}, examDate, sharedWith, archivedAt |
| `StudyPage` | a genomgång: markdown + LaTeX, rendered without raw HTML |
| `StudyItem` | a card or an exercise: prompt, back / answer spec, hints, solution, level E/C/A, skill, sourceRef, usage (practice/test), number (→ code) |
| `StudyItemState` | per user + item: Leitner box 0–5, dueAt, correct, wrong |
| `StudyAttempt` | per answer: result, source (app/paper), mode, given, AI feedback, denormalised subject/title/code |
| `StudySession` | per study session: kind, units, subjects, active seconds, answered, correct |
| `StudyFolder` | a Mapp: name, colour, units |

Unit codes come from `User.studyCodeCounters` (atomic `$inc`) and are never
reused, so an old paper's "MA3-14" can never point at a different exercise.
`services/studyData.js` owns the lifecycle: deleting units (with everyone's
progress on them), account deletion and the GDPR export.

## Phases

- **Fas 0 — foundation (done, hidden):** feature flags end to end, subject
  catalogue and terms, the data model above, GDPR export/delete, the hidden
  Plugga page (subjects per term), this document.
- **Fas 1 — create and practise:** the MCP tools and prompts (årskurs first,
  levels from the book, codes), genomgång rendering (Markdown + KaTeX,
  self-hosted for the CSP), flashcard and exercise players with per-user
  progress, practising by level and scope, the paper flow, "rapportera fel",
  activity tracking from the first session.
- **Fas 2 — share, test and "Min plugg":** sharing (friends, link/QR),
  practice tests (in the app and on paper, E/C/A points, grade estimate),
  "Min plugg" for parents, folders, XP, the level ladder (start at E, step up
  after a few right in a row, step down on repeated mistakes).
- **Fas 3 — extras:** generated maths problems (templates with variables — endless practice at no AI cost),
  timelines and matching for SO/NO, test-date planning, diagrams, then
  release to everyone.
