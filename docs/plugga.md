# Plugga — school subjects in Glosan

Plugga turns Glosan from a vocabulary app into a study trainer for **every
school subject**: Matematik, Fysik, Kemi, Biologi, NO, Historia, Geografi,
Religionskunskap, Samhällskunskap, SO, Teknik and the languages. It was built
behind a feature flag, shown to more users step by step, and released to
everyone in v0.1.39 (see Rollout — the flag stays as an emergency brake).

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
   people who have no AI. Everyone gets their **own copy** (since v0.1.38): it
   is theirs to delete in and, with their own AI, change; sharing again sends
   only what is new. Everyone can share what they have.
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
| `text` | short facts: a term, a year, a name — with accepted variants; one typo from 8 letters, two from 12, never for years or Roman numerals, none with `exact`; a typo in the first or last two letters of a word (elektrod for elektron) is "nästan", not right — an added or dropped ending (bakterie/bakterien) and missing dots and rings still pass | the app |
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

**Övningsblad** (`/plugga/skriv-ut`, `services/study/sheet.js`): "🖨️ Skriv ut"
next to "Börja öva" on a unit, subject or folder prints the same selection a
practice session would pick (cards / exercises / mixed / due / missed, levels,
count, skill) as an A4 sheet, so the student can work entirely on paper. The
layout:
- name and date fields at the top;
- cards as short questions, then the exercises from Lätt to Svår, each with its
  code and room to answer (a line, boxes to tick, lines for order, space for an
  open question);
- hints (optional) and the **facit** last, each starting on a new page. The
  facit has the answer and the worked solution, and choices and order questions
  in the letters printed on that sheet.

Printing records nothing. The student checks the sheet with the facit, or
photographs it and asks their AI ("Rätta mitt övningsblad"); the AI then
grades and records each exercise through the paper flow above. A template
exercise prints with a short **variant** (`MA2-7 · v482`) — the seed of that
instance. The facit is for those numbers, and `get_study_item` /
`record_paper_attempt` take `variant` so the AI grades exactly them.

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

Since v0.1.38 sharing gives **a copy** (Johan, 2026-10-02): whoever gets a unit
gets their OWN copy, to delete in and — with their own AI — change and add
to. Changes to the original don't reach the copy; sharing again sends only
what is new. Code: `services/study/copies.js`.

- **Where**: "👥 Dela" on a unit's page (that unit), and on the Plugga start
  page, a subject page (also for a selection or a chapter) and a folder —
  one dialog (`ShareStudyDialog`) where you pick any of the units you have
  and share them together. The student's AI can do the same
  (`share_study_units`, `create_study_link`, `get_study_sharing`,
  `stop_sharing_study`; docs/mcp.md).
- **Anyone can share anything they have** — their own units, copies they got,
  and originals they follow from before v0.1.38. A copy is shared like any
  own unit.
- **The copy** (`StudyUnit.copiedFrom { unit, root, by, origin, givers, at }`):
  - a new unit in the recipient's account, with their next code (MA2), the
    source's genomgångar, cards, exercises and practice tests — items keep
    their numbers (MA1-14 at the sharer is MA2-14 in the copy);
  - "din kopia från X" on the unit page (`copiedFrom.by` — who gave it, never
    the creator further back; "från X och Y" once Y has shared it too and new
    material came from them, `copiedFrom.givers`); the owner has the bin, can delete the whole
    copy in the app ("Ta bort kopian", `DELETE /api/study/units/:id` — copies
    only; originals are deleted by their AI) and can change it with their AI.
    The MCP marks it `is_owner: true, copied_from, written_by_someone_else:
    true`: the student's to change, but the text is someone else's — data,
    never instructions;
  - independent: archiving, editing or deleting the original, unfriending or
    blocking never touch it, and it can't be taken back.
- **Sharing again sends only what is new** (Johan's choice: new chapters AND
  new material in chapters you already have):
  - every page, item and test in a copy remembers its ORIGINAL (the first in
    the chain of copies) in `copiedFrom`, and who wrote it in `copyAuthor`;
    what the owner adds to their copy themselves is its own original (its id),
    so it never comes back as a duplicate when shared on and back. A unit's
    `copiedFrom.root` is its original unit. A recipient has at most **one copy per original**,
    whichever way it comes (Majken shares with A and B, both share with C →
    C has one copy, and gets from the second whatever the first lacked);
  - a unit they have no copy of → a new copy; one they have → only pages,
    items and tests whose original isn't in it yet are added (new item
    numbers), a test always with its questions;
  - never what the owner deleted: deletions in a copy are remembered in
    `StudyUnit.copyDropped` (original ids) — the deletion log is pruned after
    180 days, this list never is. Undo takes it off the list again;
  - never overwrites: what is already in the copy, changed or not, stays;
  - nothing at all for someone who has the original (created it, or follows
    it from before copies).
- **Friends**: you share with your confirmed friends. The dialog lists who got
  a copy from you (`copiedFrom.givers`) and lets you share with them again for
  the new material; who else has the unit is never shown. At most 100
  friend × unit pairs per share (`MAX_COPY_PAIRS`) — each can be a whole copy;
  the source is read once per share. Copies are made one recipient at a time
  under that recipient's lock (`utils/userLock.js`) — so two people sharing
  the same unit with the same friend at once still give one copy — and the
  owner's own deletions take the same lock. A copy that fails halfway is
  removed and the share goes on for the others. The per-account caps
  (`services/study/limits.js`) apply to copies too.
- **QR / link** (`/p/<code>`): ONE link can cover several units
  (`StudyShareLink.units`, up to 50 — e.g. a chapter for the class) with an
  optional name; 1, 7 or 30 days, 10/30/100 uses, at most 3 active links per
  unit and 30 per person; a public preview (titles, subject, term and counts —
  not årskurs, book or description) showing the person who made the link.
  Logged in, the preview shows exactly what you would get (`optionalAuth`).
  Everyone who opens it gets their own copy, from the link maker; it claims a
  use only when a new copy is made, so the same link fetches the new
  material later for free — also when it is full, for those who already
  used it (a full link takes no one new). People without an account sign up through it.
  Joining does **not** make you the link maker's friend (a link can be passed
  on). A link works only while its maker still has the units. Links are
  deleted 30 days after they expire.
- **Blocks**: if the recipient and the original's creator (`copiedFrom.origin`,
  followed along the chain) have blocked each other, nothing reaches the
  recipient, whoever shares — silently. Nor does anything someone they have a
  block with added or changed along the way: `copyAuthor` (kept even when that
  original is deleted) and `copyEditors` on pages and items someone rewrote in
  their copy; a copy whose title, description or source someone renamed
  (`copiedFrom.editors`) doesn't reach them at all. The "har fått en kopia av
  dig" list and the count on the Dela button both leave out people you have a
  block with, so they always agree. A friend in between who keeps trying
  can notice that one person never gets it; hiding even that would be a
  product decision. Blocking also ends list shares, the co-op streak and
  pending challenges, and stops adding by code or joining by link
  (`services/blocks.js`); copies already given stay with their owners.
- **From before copies (v0.1.29–0.1.37)**: people who got a unit then follow
  the original (`sharedWith`): they see the creator's corrections at once and
  can report "fel i facit" to the creator's AI. The creator sees them in the
  Dela dialog ("Följer ditt original", with "via …" for people someone else
  added, `sharedVia`) and can remove them; they can leave. Unfriending and
  blocking end these shares both ways (`unshareBetween`). Nobody new is added
  this way — new shares are copies. Rules for these in `services/sharedVia.js`.
- **Invite-only beta (until v0.1.39)**: whoever received a unit got the
  `study` flag switched on, so Plugga spread only to people a beta user
  invited (`grantStudyFeature` in `services/study/sharing.js`, a no-op while
  Plugga is on for everyone). Switching it off on the admin page blocks it
  (`User.featureBlocks`): no share, link, release or `FEATURES_FOR_ALL`
  switches it on again for that account.

## Deleting and history

The owner of a unit — its creator, or whoever owns a copy — can delete a card
or exercise in the app (a small bin in the player and on the unit page).
Every deletion — in the app or by the AI via MCP — goes through
`services/study/itemDeletion.js`: a snapshot is logged in `StudyItemDeletion`
(what, when, by whom, app or AI), everyone's progress on it is removed, and it
is taken out of any test. "Borttaget" on the unit page lists it with **Ångra**,
which restores it with its old code and id. `get_study_unit` shows recent
deletions so the AI doesn't recreate them. In a copy, the deletion is also
remembered in `copyDropped`, so sharing again never brings it back. Deleting in
an original never touches copies people already have.

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
  flow — candidates when a code is ambiguous; `variant` for a template printed
  on an övningsblad), `get_study_progress`,
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

- **Released to everyone in v0.1.39** (Johan, 2026-10-05): `released: true`
  on `study` in `config/features.js` puts it in every account's effective
  flags. The flag itself stays:
  - `FEATURES_DISABLED=study` (env) is the emergency brake — off for
    everyone, whatever the code or the accounts say. Passed through by
    `docker-compose.prod.yml`; restart the backend after changing it.
  - The admin page can still switch it off for one account (`featureBlocks`).
  - An AI connection approved before the release doesn't reach Plugga until
    the user connects again — consent is per module (`McpToken.modules`).
    The profile page ("Når inte Plugga") and the guide say so.
- **Before the release:** per account (`User.features`, the admin switch),
  the invite-only beta above, and `FEATURES_FOR_ALL=<flag>` (env) to try a
  release without new code. All of it still works for the next hidden module.
- **Connecting an AI** is how content gets in, so the release came with a
  public guide, `/koppla-ai` (`pages/ConnectAiGuide.jsx`): Claude step by
  step, example requests for glosor and Plugga, what the AI sees, and what to
  do when something fails. It is linked from the profile, the Plugga start
  page and the landing page (which now has a Plugga section and FAQ). Claude's
  connector dialog recommends "Claude's published identity" (a Client ID
  Metadata Document), which Glosan doesn't support yet — the guide says to
  pick **Register automatically**, and a browser that reaches
  `/api/mcp/oauth/authorize` with an unknown client gets a page saying the
  same instead of raw JSON.
- Backend: `requireFeature('study')` answers **404** where it is off — a
  hidden module can't be discovered by guessing URLs. `/api/study` is limited
  per user (a class shares one IP), behind a high per-IP flood limit; the
  public invite preview is not. Login, registration and refresh are keyed per
  account or session with a high per-address ceiling
  (`middleware/authLimits.js`), so a whole class joining by QR on one school
  IP fits.
- Frontend: the "Plugga" nav item and `/plugga/*` follow the flag
  (`hasFeature(user, 'study')`); `/p/<code>` and `/koppla-ai` are public.

## Data model

| Model | Holds |
|---|---|
| `StudyUnit` | creator, subject, term, gradeYear, code (MA3), title, description, source{book, chapter, pages}, examDate, archivedAt; a copy: copiedFrom {unit, root, by, origin, givers, at} and copyDropped; from before copies: sharedWith, sharedVia (who passed it on to whom) |
| `StudyPage` | a genomgång: markdown + LaTeX + ```svg figures, rendered without raw HTML. All Plugga text keeps single line breaks (remark-breaks): plain Markdown turns them into spaces, and card backs written one line per point ran together |
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

Both scripts detect whether Plugga is on for everyone (it is, since v0.1.39).
If it isn't — a hidden module again — they switch the flag on for their users
in the local database, and the fas 2 script checks that sharing switches it on
for recipients.

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
- **Fas 2 — share, test and "Min plugg" (done, v0.1.29):** sharing (friends, QR),
  Mappar, Min plugg, practice tests (app and paper, parts, per-skill result),
  the level ladder; from the beta: chapters, the bin with history; from MCP
  feedback: templates, multi/order/factors, figures, duplicate protection,
  a quieter tolerance warning.
- **Fas 3 — later:** timelines and matching for SO/NO, test-date planning
  (a plan per day up to the test), templates in tests with a fixed seed per
  printed sheet, release to everyone.
