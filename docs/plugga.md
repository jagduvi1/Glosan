# Plugga — school subjects in Glosan

Plugga turns Glosan from a vocabulary app into a study trainer for **every
school subject**: Matematik, Fysik, Kemi, Biologi, NO, Historia, Geografi,
Religionskunskap, Samhällskunskap, SO, Teknik and the languages. It is built
behind a feature flag and shown to more users step by step.

## Principles (decided with Johan, 2026-09-29)

1. **Content is created only through MCP.** The student photographs pages from
   the textbook and asks their own AI (Claude with Glosan connected) to create
   study material. The app has no content editors — it is for practising,
   choosing and organising. (The one exception: the creator can delete a card
   or exercise they don't find good — logged, and undoable.)
2. **Glosan never calls an AI API in Plugga.** All AI work — creating content,
   checking a handwritten solution, grading a test done on paper — happens in
   the user's own AI through MCP. Glosan stores, grades by rules and serves.
   (`study.noAi.test.js` resolves every `require` in the Plugga files, transitively,
   and fails if any of them reaches `services/anthropic.js` or `@anthropic-ai/*`.)
3. **The AI asks for the student's årskurs before creating anything.** It is
   stored on each unit and confirmed the next time.
4. **The book's exercises are examples.** The AI writes its *own* exercises
   modelled on them, with a reference to the book's exercise (`sourceRef`).
   Drill exercises become **templates** that get new numbers every time.
5. **Levels follow the book.** The book's markings (nivå 1/2/3, grön/gul/röd)
   map to **E / C / A**, shown as *Lätt · E*, *Medel · C*, *Svår · A*.
6. **Shareable.** A unit can be shared with friends or by QR code — also with
   people who have no AI. Everyone practises with their **own** progress; only
   the creator's AI changes the content, so corrections reach everyone.
7. **Study XP counts** toward the same XP and streak as the vocabulary quizzes.
8. **Everything is tracked** so the student can show a parent what they have
   done: today / this week / this month / this term ("Min plugg").

## How content is organised

```
Ämne (subject)        fixed catalogue: config/subjects.js (NO and SO are groups)
 └─ Termin (term)     "HT 2026", "VT 2027" — set from the date, the AI can override
     └─ Kapitel       units with the same source.book + source.chapter, grouped on the subject page
         └─ Område    "Kapitel 2 Tal — Plugg", code MA2, årskurs 7, source, test date
              ├─ Genomgång    explanation, "så gör du" step by step, examples, figures
              ├─ Kort         flashcards (begrepp, questions, formulas)
              ├─ Övningar     exercises on levels E/C/A with hints and worked solutions
              └─ Prov         practice tests with parts and E/C/A points
```

- **Kapitel** — automatic: the subject page groups units whose book and
  chapter match ("2 Tal" and "2 Tal — 2.1, 2.2" are the same chapter;
  `components/study/chapters.js`), with "Välj hela kapitlet".
- **Mappar** — the student's own groupings across subjects and terms
  ("Inför provet v. 42"), including shared units. Practise a whole folder.
- **Practice scope** — one unit, several, a chapter, a whole subject and term,
  a group ("all NO"), a folder, one skill, or a subject across all terms.

## Answer types

| Type | Used for | Checked by |
|---|---|---|
| `number` | calculations — accepts `3,5`, `7/2`, `3 1/2`, `−2`, `1 000`, units | the app |
| `choice` | one right alternative | the app |
| `multi` | several right ("Vilka av talen är primtal?") — only right picks but some missing = nearly | the app |
| `order` | put in order (numbers, a timeline, the steps of a method) — 3–8 items, shuffled at random (a test attempt keeps its order) | the app |
| `factors` | a product in any order ("Primtalsfaktorisera 90" → `2·3·3·5`, `2·3²·5`) — the right product with other factors = nearly | the app |
| `text` | short facts: a term, a year, a name — with accepted variants; one typo from 8 letters, two from 12, never for years or Roman numerals, none with `exact` | the app |
| `self` | open questions ("förklara", "resonera"), SO/NO/history | the student against the model answer and E/C/A criteria — or their AI via the paper flow |

An unreadable answer ("3 eller 4", "tjugo", a blank choice) is never counted as
wrong: the student is asked to write it again. Only when a timed test runs out
is it counted as unanswered, so the test can always be handed in.

**Templates** (`services/study/templates.js`). A number exercise can have
variables (`int`, `decimal`, `pick`, `calc`), conditions (`where`) and an
answer expression (`answer.expr`). The prompt, hints and solution use
`{{n}}` / `{{ expression }}` (`{{n:tex}}` inside `$…$`). The expression
language is small and safe — numbers, `+ - * / % ^`, comparisons, and
`round floor ceil abs sqrt min max gcd lcm digit digits posname` — parsed by
hand, never `eval`, own properties only. Each time the exercise is served the
server picks a random **seed**, renders the instance and sends the seed with
it; the answer comes back with the seed and is graded against exactly those
numbers. Nothing is stored. A template is checked with 30 instances when the
AI creates it. Tests never use templates (everyone gets the same test).

**Figures** (`services/study/figures.js`). Number lines, factor trees and
geometry are drawn by the AI as SVG in a ```` ```svg ```` block inside any
text. The app renders them as `<img>` data URLs — an SVG in an image can never
run script or load anything — and the server refuses scripts, links, images,
styles, handlers and animation when they are written.

## Pen and paper (the paper flow)

Every exercise has a short code: **MA3-14** = Matematik, unit 3, exercise 14
(`utils/studyCodes.js`; tolerant of handwriting: `ma3 14`, `MA 3–14`, …).

1. The student solves the exercise on paper and writes the code at the top.
2. They photograph it and ask their AI: "rätta MA3-14".
3. The AI fetches the exercise over MCP (`get_study_item`) and compares: is it
   right, where did it first go wrong, a hint, and what would lift it a level.
4. The AI records the result with its feedback (`record_paper_attempt`) — it
   counts toward statistics, spaced repetition and XP (XP once per exercise
   and day), and the student can re-read the tips in the app. **The photo is
   never stored.** The same record sent again within 10 minutes (an AI retry)
   is recognised and not counted twice.

Codes are unique per creator, so a friend's shared unit can have the same code
as one of the student's own (both "MA1"). When a code matches items in several
units, the tools return the candidates (with a prompt excerpt) instead of
picking one — the AI compares with the photo and asks.

For a template exercise the numbers differ each time: "Lös på papper" copies
the exact task the student solved into the text for the AI.

**Practice tests on paper**: the test page prints a sheet with the codes and
points; the student photographs their answers and the AI grades each question
(`get_practice_test` + `record_paper_test`, points capped per question).

## Practice tests

`create_practice_test` builds a test like the real one or the national tests:
questions worth points on E, C and A (default 1 point on the question's
level), parts (`part`: "Del A — utan miniräknare"), an optional time limit and
grade limits (the book's or teacher's, otherwise modelled on the national
tests). The questions are items with `usage: 'test'` and codes, hidden from
normal practice — and a practice session refuses to reveal their answers.

In the app: one page like a real test, a timer with auto-submit, a local
draft and resume, unreadable answers returned (not counted as wrong), then
self-assessment of open questions (enkla / utvecklade / välutvecklade), then
the result: points per level, an **estimated grade** (only an estimate — the
teacher grades), the answers with solutions, and **per skill** with "Öva" on
that skill. Test answers don't enter spaced repetition.

- The timer counts against the server's deadline (the device clock is
  corrected), and at time-out the answers lock and the test is handed in.
  The server enforces the deadline too: a submit more than a minute late is
  accepted leniently and recorded as late (`lateSec`).
- Submitting and self-assessing are atomic — a double click or a second tab
  never finishes a test twice — and a test pays XP once per 24 hours.
- Grade limits are set for the test's max (`baseMax`); when questions are
  deleted they scale down with it. The limits used and each question as it
  was are stored on the attempt, so a result reads the same later.

## Nivåstege

A practice mode that starts at the student's level (the lowest where less
than 70 % sits) and follows them: three right in a row steps up, two wrong in
a row steps down, "nearly" stands still. The ladder lives on the session
(`StudySession.ladder`); each answer returns the next exercise. When a level
runs out of exercises the ladder moves on quietly — "moved" and "highest
level" only count steps the student earned.

## Tracking — "Min plugg"

- Every answer is a `StudyAttempt` (which exercise, result, app or paper, the
  AI's feedback, the template seed).
- Every study session is a `StudySession` with **active time**: each answer or
  ping (while a genomgång is read or a test is written) adds the time since the
  last activity, capped at two minutes. A session accepts answers only on the
  items it served, once each, and finishing it (which pays XP) is atomic.
  Reading a unit is one session per visit, finished when the page is left.
- Spaced repetition (Leitner): right moves an item up a box, but a second right
  the same day does not climb again.
- The page shows a day, a week (Monday–Sunday, v. 40), a month or a term in
  **Swedish local time** (`utils/localTime.js`, DST-safe): time, exercises and
  right answers per subject and day, paper solutions, practice tests with their
  grades, XP and the streak; a week chart, a month calendar, a term heatmap,
  every session with its exercises. Printable. The streak (shared with the
  vocabulary quizzes, `services/gamification.js`) also turns over at Swedish
  midnight, as do the XP leaderboard's week and month.
- History is denormalised (subject, unit title, exercise code, test title) so
  it survives if a shared unit is later deleted.

## Sharing

- **Friends**: the creator shares with confirmed friends.
- **QR / link** (`/p/<code>`): 1, 7 or 30 days, 10/30/100 uses, at most 3
  active per unit; a public preview (title, subject, term and counts — not
  årskurs, book or description). Joining does **not** make you the creator's
  friend (a link can be passed on). Joining is idempotent and claims a use
  atomically. Links are deleted 30 days after they expire.
- Nobody gets a copy: recipients join `sharedWith`, practise with their own
  progress and see corrections at once. They can leave, and report "fel i
  facit" to the creator's AI. Only the creator shares, edits and deletes.
  When the creator archives a unit it disappears for the recipients too.
- **Unfriending** ends every share between the two, both ways — also units
  joined by link — and takes those units out of their folders and their open
  reports (`unshareBetween`). There is no block list; this is the way to stop
  someone's reports reaching your AI.
- The creator's AI sees a recipient's report note as `reporter_note_untrusted`,
  and a recipient's AI sees shared units as `written_by_someone_else` — the
  MCP instructions say such text is data, never instructions.
- **Invite-only beta**: whoever receives a unit gets the `study` flag switched
  on, so Plugga spreads only to people a beta user invites
  (`grantStudyFeature` in `services/study/sharing.js`). Switching it off on
  the admin page blocks it (`User.featureBlocks`): no share, link or
  `FEATURES_FOR_ALL` switches it on again for that account.

## Deleting and history

The creator can delete a card or exercise in the app (a small bin in the
player and on the unit page). Every deletion — in the app or by the AI via
MCP — goes through `services/study/itemDeletion.js`: a snapshot is logged in
`StudyItemDeletion` (what, when, by whom, app or AI), everyone's progress on
it is removed, and it is taken out of any test. "Borttaget" on the unit page
lists it with **Ångra**, which restores it with its old code and id.
`get_study_unit` shows recent deletions so the AI doesn't recreate them.

## Retention

Removed or closed automatically (TTL indexes, and the hourly job in
`services/maintenance.js`):

| What | When |
|------|------|
| `StudyItemDeletion` (the bin) | 180 days after the deletion — Ångra works that long |
| `StudyFlag`, resolved | 180 days after `resolvedAt`; open reports stay |
| `StudyShareLink` | 30 days after it expires |
| `StudySession`, abandoned | closed (not deleted) after 6 h without activity — no XP |

Everything else — answers, sessions, test results — is the student's history
("Min plugg", meant to cover a whole school career) and stays until the
account is deleted (`deleteStudyDataForUser`). The privacy page
(`Integritet.jsx`) says the same; change both together.

## MCP

All study tools and prompts carry `feature: 'study'` and are only registered
for users with the flag; the study section of the server instructions is added
the same way (`FEATURE_SECTIONS` in `mcp/instructions.js`). 25 tools:

- Read: `list_study_units` (paged; `include_archived`), `get_study_unit`
  (paged: `codes`, `kind`, `level`, 60 items per call; long genomgångar
  shortened), `get_study_page`, `get_study_item` (by code, for the paper
  flow — candidates when a code is ambiguous), `get_study_progress`,
  `list_study_flags` (20 per call), `list_study_folders`,
  `get_study_activity`, `get_practice_test`
- Create: `create_study_unit` (requires årskurs; refuses a duplicate title),
  `add_study_pages`, `add_flashcards`, `add_exercises` (skips duplicates),
  `create_practice_test`
- Change: `update_study_page`, `update_study_item` (re-checked like a new
  exercise; `template: null` removes a template), `update_study_unit`,
  `save_study_folder`, `resolve_study_flag`
- Record: `record_paper_attempt`, `record_paper_test`
- Delete: `delete_study_items` (logged, undoable for practice items),
  `delete_study_page` (returns the page so it can be re-added),
  `delete_practice_test`, `delete_study_unit`
- Prompts: `study_from_photos`, `check_my_solution`, `prepare_for_test`,
  `check_my_test`

The creation workflow the instructions enforce: ask årskurs (and test date) →
identify subject, book, chapter and the book's levels → propose what will be
created → wait for OK → create in batches → read the unit back and verify
every answer → send the link.

## Rollout

- `User.features` (per account, admin page switch "Plugga (beta)"), the
  invite-only beta above, `FEATURES_FOR_ALL=study` (env) to release for
  everyone, and `FEATURES_DISABLED=study` (env) as the emergency brake — off
  for everyone, whatever the accounts say. Both are passed through by
  `docker-compose.prod.yml`; restart the backend after changing them.
- Backend: `requireFeature('study')` answers **404** without the flag — a
  hidden module can't be discovered by guessing URLs. `/api/study` is limited
  per user (a class shares one IP), behind a high per-IP flood limit; the
  public invite preview is not. Known gap: login, registration and
  `/api/auth/refresh` are still limited per IP, so a whole class joining by
  QR on one school IP can hit them — fix together with the real client IP
  behind Cloudflare (see the audit).
- Frontend: the "Plugga" nav item and `/plugga/*` exist only with the flag
  (`hasFeature(user, 'study')`); `/p/<code>` is public.

## Data model

| Model | Holds |
|---|---|
| `StudyUnit` | creator, subject, term, gradeYear, code (MA3), title, description, source{book, chapter, pages}, examDate, sharedWith, archivedAt |
| `StudyPage` | a genomgång: markdown + LaTeX + ```svg figures, rendered without raw HTML |
| `StudyItem` | a card or exercise: prompt, back / answer (number · choice · multi · order · factors · text · self; `expr` for templates), hints, solution, level E/C/A, skill, sourceRef, usage (practice/test), number (→ code), template |
| `StudyItemState` | per user + item: Leitner box 0–5, dueAt, correct, wrong |
| `StudyAttempt` | per answer: result, source (app/paper), mode, given, AI feedback, template seed, denormalised subject/title/code |
| `StudySession` | per study session: kind, units, subjects, active seconds, answered, correct, ladder |
| `StudyFolder` | a Mapp: name, colour, units |
| `StudyFlag` | a "fel i facit" report to the creator |
| `StudyShareLink` | a QR/link: unit, code, expiry, max uses, who used it, revoked |
| `StudyTest` | a practice test: questions (item, points E/C/A, part), time limit, grade limits |
| `StudyTestAttempt` | a test done in the app or on paper: answers with points, score, max, estimated grade, AI feedback |
| `StudyItemDeletion` | a deleted card/exercise: snapshot, who, app or AI, restored |

Unit codes come from `User.studyCodeCounters` (atomic `$inc`) and item numbers
from `StudyUnit.itemCounter`; neither is ever reused, so within one creator's
units an old paper's "MA3-14" can never point at a different exercise (and a
restored item gets its old code back). Across creators codes can repeat — see
the paper flow for how the tools handle that. `services/studyData.js` owns the lifecycle: deleting units
(with everyone's progress, tests, links and logs), account deletion and the
GDPR export.

## Code map

| Piece | Where |
|---|---|
| MCP tools, prompts, instructions | `mcp/tools/study.js`, `mcp/prompts.js`, `FEATURE_SECTIONS.study` in `mcp/instructions.js` |
| Who may read / change what | `services/study/access.js` — read = own + shared units, change = creator only |
| Grading (no AI) | `services/study/grading.js` |
| Templates · figures | `services/study/templates.js` · `services/study/figures.js` |
| Spaced repetition, picking a session | `services/study/scheduler.js` |
| Sessions, attempts, XP | `services/study/practice.js` |
| Nivåstege | `services/study/ladder.js` |
| Practice tests · scoring | `services/study/tests.js` · `services/study/testGrading.js` |
| Min plugg | `services/study/activity.js`, `utils/localTime.js` |
| Mappar · sharing · deletion log | `services/study/folders.js` · `sharing.js` · `itemDeletion.js` |
| Unit lists and pages | `services/study/views.js` — the app payload never carries answers or solutions before answering |
| XP and streaks | `services/gamification.js` — shared with the vocabulary quiz |
| REST | `routes/study.js` (behind the flag), `routes/studyInvites.js` (public preview + join) |
| Frontend | `pages/Plugga*.jsx`, `pages/JoinStudyUnit.jsx`, `components/StudyMarkdown.jsx`, `components/study/*` |

## Testing locally

```bash
cd backend && npm test
FRONTEND_URL=http://localhost:8080 docker compose up --build -d
cd backend && node scripts/plugga-e2e.mjs http://localhost:8080       # fas 1
cd backend && node scripts/plugga-fas2-e2e.mjs http://localhost:8080  # fas 2 + the MCP feedback fixes
```

Both scripts work with and without `FEATURES_FOR_ALL=study`; without it (as in
prod) they switch the flag on for their users in the local database, and the
fas 2 script checks that sharing switches it on for recipients.

## Rolling back

Fas 2 stores items an older release can't handle: `multi`, `order` and
`factors` answers and template exercises (`answer.expr`, no `value`). v0.1.28
would show them without an answer field, grade every answer wrong
("rätt svar: undefined") and knock the students' Leitner boxes down. Before
re-tagging an older image as `:latest`, hide those items from practice
(v0.1.28 serves only `usage: 'practice'`):

```js
// mongosh glosan — before rolling back
db.studyitems.updateMany(
  { $or: [{ template: { $exists: true } }, { 'answer.type': { $in: ['multi', 'order', 'factors'] } }], usage: 'practice' },
  { $set: { usage: 'test', rollbackHidden: true } }
)
// after rolling forward again
db.studyitems.updateMany({ rollbackHidden: true }, { $set: { usage: 'practice' }, $unset: { rollbackHidden: '' } })
```

The other fas 2 collections (tests, links, deletions) simply sit unused by the
older release. Restoring a database dump from before a release drops the whole
database first (`scripts/backup/restore.sh`), so no newer collections are
left pointing at missing data.

## Phases

- **Fas 0 — foundation (done, v0.1.28):** feature flags, subjects and terms,
  the data model, GDPR export/delete, the hidden Plugga page.
- **Fas 1 — create and practise (done, v0.1.28):** MCP tools and prompts,
  genomgångar with KaTeX, flashcard and exercise players, per-user progress,
  the paper flow, "rapportera fel", tracking, study XP and streaks.
- **Fas 2 — share, test and "Min plugg" (PR #118, not released yet):** sharing (friends, QR),
  Mappar, Min plugg, practice tests (app and paper, parts, per-skill result),
  the level ladder; from the beta: chapters, the bin with history; from MCP
  feedback: templates, multi/order/factors, figures, duplicate protection,
  a quieter tolerance warning.
- **Fas 3 — later:** timelines and matching for SO/NO, test-date planning
  (a plan per day up to the test), templates in tests with a fixed seed per
  printed sheet, release to everyone.
