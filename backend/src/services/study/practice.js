// Pluggpass i Plugga: starta ett pass, rätta svar, spara progress och
// historik per användare, räkna aktiv tid, avsluta med XP och streak — och
// papperslösningar som användarens AI rättat via MCP. Används av både
// routes/study.js och MCP-verktygen (mcp/tools/study.js).
const StudyUnit = require('../../models/StudyUnit');
const StudyItem = require('../../models/StudyItem');
const StudyItemState = require('../../models/StudyItemState');
const StudyAttempt = require('../../models/StudyAttempt');
const StudySession = require('../../models/StudySession');
const StudyFolder = require('../../models/StudyFolder');
const { SUBJECT_KEYS, subjectsInGroup } = require('../../config/subjects');
const { isValidTerm } = require('../../utils/term');
const { gradeAnswer, describeAnswer } = require('./grading');
const { nextState, pickItems } = require('./scheduler');
const { startLevel, ladderStep, pickNext, LEVEL_ORDER } = require('./ladder');
const { instance, newSeed } = require('./templates');
const { readableFilter, isId, oid, itemCode } = require('./access');
const { awardStudyActivity } = require('../gamification');

const MODES = ['cards', 'exercises', 'mixed', 'due', 'wrong', 'reading', 'ladder'];
const LEVELS = ['E', 'C', 'A'];
const MAX_SESSION_ITEMS = 50;
// Taket för vad ett pass väljer bland ("Repetera allt" över många områden):
// urvalet görs på ett fåtal fält, och bara de valda hämtas hela.
const MAX_SCOPE_UNITS = 200;
const MAX_CANDIDATES = 3000;
const UNIT_FIELDS = '_id user code title subject term';
const PICK_FIELDS = '_id unit kind level number';
const STATE_FIELDS = 'item box dueAt lastResult correct wrong lastSeenAt';
// XP: samma skala som glos-quizzen (10 per rätt), halva för "nästan".
const XP_CORRECT = 10;
const XP_PARTIAL = 5;
const XP_PERFECT_BONUS = 20; // helt rätt pass med minst 5 svar
// En pluggdag räknas (streak) om man svarat på något eller läst minst 2 minuter.
const STREAK_MIN_ACTIVE_SEC = 120;
// En papperrättning som skickas igen inom så här lång tid är en omsändning.
const PAPER_DUPLICATE_MS = 10 * 60 * 1000;

/**
 * Områdena ett pass omfattar. scope: { unitIds } ELLER { folderId } (en
 * mapp) ELLER { subject | group, term, allTerms } — "allt i Matte HT26",
 * "allt NO", "all matte alla terminer". Tomt omfång = allt man kan läsa
 * (t.ex. "Repetera allt").
 */
async function resolveScopeUnits(userId, scope = {}) {
  const filter = { ...readableFilter(userId), archivedAt: null };
  const ids = Array.isArray(scope.unitIds) ? scope.unitIds.filter(isId).map(oid) : [];
  if (ids.length) {
    filter._id = { $in: ids.slice(0, 50) };
  } else if (scope.folderId !== undefined) {
    // Direkt mot StudyFolder (inte services/study/folders.js) — undviker en
    // require-cirkel practice → folders → views → practice.
    const folder = isId(scope.folderId)
      ? await StudyFolder.findOne({ _id: oid(scope.folderId), user: oid(userId) }, 'units').lean()
      : null;
    filter._id = { $in: folder ? folder.units.slice(0, 200) : [] };
  } else {
    if (SUBJECT_KEYS.includes(scope.subject)) filter.subject = scope.subject;
    else if (scope.group === 'no' || scope.group === 'so') filter.subject = { $in: subjectsInGroup(scope.group) };
    if (isValidTerm(scope.term) && !scope.allTerms) filter.term = scope.term;
  }
  return StudyUnit.find(filter, UNIT_FIELDS).sort({ createdAt: -1 }).limit(MAX_SCOPE_UNITS).lean();
}

/** De valda uppgifterna hela, i urvalets ordning. */
async function loadPicked(picked) {
  const full = await StudyItem.find({ _id: { $in: picked.map((i) => i._id) } }).lean();
  const byId = new Map(full.map((i) => [String(i._id), i]));
  return picked.map((i) => byId.get(String(i._id))).filter(Boolean);
}

/**
 * Blanda en lista (Fisher–Yates). Helt slumpad — även rätt ordning kan komma
 * upp, annars avslöjar blandningen något om svaret. `rand` kan vara seedad
 * (samma blandning varje gång ett provförsök öppnas).
 */
function shuffled(list, rand = Math.random) {
  const a = [...(list || [])];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Ett frö (32 bitar, FNV-1a) ur en text, t.ex. försökets och frågans id. */
function seedFrom(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Ett kort/en övning som den skickas till spelaren — UTAN facit. Med
 * `userId` får uppgiften `own` (användaren skapade området och får ta bort den).
 */
function publicItem(item, unit, userId = null) {
  const out = {
    id: String(item._id),
    code: itemCode(unit, item),
    unitId: String(unit._id),
    unitTitle: unit.title,
    subject: unit.subject,
    kind: item.kind,
    prompt: item.prompt,
    level: item.level || null,
    skill: item.skill || '',
    sourceRef: item.sourceRef || '',
    hints: item.hints || [],
    ...(userId ? { own: String(unit.user?._id || unit.user) === String(userId) } : {})
  };
  // Mallövning: nya tal varje gång. Fröet följer med och skickas tillbaka med svaret.
  if (item.template) {
    out.templated = true;
    try {
      const seed = newSeed();
      const inst = instance(item, seed);
      Object.assign(out, { prompt: inst.prompt, hints: inst.hints, seed });
    } catch { /* trasig mall — rättningen säger till */ }
  }
  if (item.kind === 'card') {
    out.back = item.back; // ett kort vänds i klienten — baksidan är inget facit
  } else {
    out.answerType = item.answer?.type;
    if (item.answer?.type === 'choice' || item.answer?.type === 'multi') out.choices = item.answer.choices;
    // Ordna: alternativen blandade (helt slumpat — ibland redan i rätt ordning).
    if (item.answer?.type === 'order') out.items = shuffled(item.answer.choices);
    if (item.answer?.type === 'number' && item.answer.unit) out.unitLabel = item.answer.unit;
    // Öppna frågor bedömer eleven själv mot modellsvaret — det måste finnas i
    // klienten (dolt tills eleven väljer "Visa modellsvar"), precis som
    // baksidan på ett kort.
    if (item.answer?.type === 'self') out.modelAnswer = item.answer.modelAnswer;
  }
  return out;
}

/**
 * Nivåstegen: bara övningar med nivå. Varje nivå får en turordning (dags att
 * repetera → svaga → nya → resten); passet börjar på elevens nivå och nästa
 * uppgift väljs efter varje svar (answerInSession).
 */
async function startLadder(userId, units, count) {
  const items = await StudyItem.find({
    unit: { $in: units.map((u) => u._id) }, usage: 'practice', kind: 'exercise', level: { $in: LEVELS }
  }, PICK_FIELDS).limit(MAX_CANDIDATES).lean();
  if (!items.length) return { error: 'empty', message: 'Nivåstegen behöver övningar på nivåerna E, C och A — här finns inga än.' };
  const states = await StudyItemState.find({ user: userId, item: { $in: items.map((i) => i._id) } }, STATE_FIELDS).lean();
  const stateMap = new Map(states.map((st) => [String(st.item), st]));
  const start = startLevel(items, stateMap);
  const pools = {};
  for (const l of LEVELS) {
    pools[l] = pickItems(items.filter((i) => i.level === l), stateMap, { mode: 'mixed', count: MAX_SESSION_ITEMS }).map((i) => i._id);
  }
  const first = pickNext(pools, [], start);
  const firstItem = await StudyItem.findById(first.itemId).lean();
  const unitById = new Map(units.map((u) => [String(u._id), u]));
  const unit = unitById.get(String(firstItem.unit));
  const session = await StudySession.create({
    user: userId,
    kind: 'practice',
    units: [unit._id],
    subjects: [unit.subject],
    ladder: { level: first.level, reached: first.level, count, pools, served: [firstItem._id] },
    answeredItems: []
  });
  return {
    session: { id: String(session._id), kind: session.kind },
    items: [publicItem(firstItem, unit, userId)],
    total: items.length,
    ladder: { level: first.level, reached: first.level, count, levels: LEVELS.filter((l) => pools[l].length) }
  };
}

/** Starta ett pass. Returnerar { session, items, total } eller { error }. */
async function startSession(userId, params = {}) {
  const mode = MODES.includes(params.mode) ? params.mode : 'mixed';
  const units = await resolveScopeUnits(userId, params);
  if (!units.length) return { error: 'not_found', message: 'Hittade inga områden att öva på.' };
  const subjects = [...new Set(units.map((u) => u.subject))];

  if (mode === 'reading') {
    const session = await StudySession.create({ user: userId, kind: 'reading', units: units.map((u) => u._id), subjects });
    return { session: { id: String(session._id), kind: session.kind }, items: [], total: 0 };
  }

  const levels = Array.isArray(params.levels) ? params.levels.filter((l) => LEVELS.includes(l)) : [];
  const count = Math.min(Math.max(parseInt(params.count, 10) || 15, 1), MAX_SESSION_ITEMS);
  if (mode === 'ladder') return startLadder(userId, units, count);
  const query = { unit: { $in: units.map((u) => u._id) }, usage: 'practice' };
  if (mode === 'cards') query.kind = 'card';
  if (mode === 'exercises') query.kind = 'exercise';
  // Kort har ofta ingen nivå — ett nivåfilter gäller övningarna.
  if (levels.length) query.$or = [{ level: { $in: levels } }, { kind: 'card', level: null }];
  // Öva på en färdighet ("Positionssystemet") — t.ex. från provresultatet.
  const skills = Array.isArray(params.skills) ? params.skills.filter((x) => typeof x === 'string' && x.trim()).slice(0, 10) : [];
  if (skills.length) query.skill = { $in: skills };

  const items = await StudyItem.find(query, PICK_FIELDS).limit(MAX_CANDIDATES).lean();
  const states = await StudyItemState.find({ user: userId, item: { $in: items.map((i) => i._id) } }, STATE_FIELDS).lean();
  const stateMap = new Map(states.map((s) => [String(s.item), s]));
  const picked = await loadPicked(pickItems(items, stateMap, { mode, count }));
  if (!picked.length) {
    const why = mode === 'due' ? 'Inget att repetera just nu — bra jobbat!'
      : mode === 'wrong' ? 'Du har inga missade uppgifter här.'
        : 'Det finns inga uppgifter här än.';
    return { error: 'empty', message: why };
  }
  const unitById = new Map(units.map((u) => [String(u._id), u]));
  const session = await StudySession.create({
    user: userId,
    kind: mode === 'due' || mode === 'wrong' ? 'review' : 'practice',
    units: [...new Set(picked.map((i) => String(i.unit)))].map(oid),
    subjects: [...new Set(picked.map((i) => unitById.get(String(i.unit)).subject))],
    served: picked.map((i) => i._id),
    answeredItems: []
  });
  return {
    session: { id: String(session._id), kind: session.kind },
    items: picked.map((i) => publicItem(i, unitById.get(String(i.unit)), userId)),
    total: items.length
  };
}

/**
 * Spara ett svar: användarens progress (spaced repetition) + historik.
 * Returnerar det nya StudyItemState — eller null för provfrågor, som inte
 * ingår i repetitionen (de visas aldrig i vanliga pass) och bara får historik.
 */
async function recordAttempt({ userId, item, unit, sessionId = null, source = 'app', mode = 'practice', result, given = '', feedback = '', seed = null }) {
  const now = new Date();
  let next = null;
  if (item.usage !== 'test') {
    const prev = await StudyItemState.findOne({ user: userId, item: item._id }).lean();
    next = nextState(prev, result, now);
    await StudyItemState.updateOne(
      { user: userId, item: item._id },
      { $set: { ...next, unit: unit._id } },
      { upsert: true }
    );
  }
  await StudyAttempt.create({
    user: userId,
    item: item._id,
    unit: unit._id,
    session: sessionId,
    subject: unit.subject,
    unitTitle: unit.title,
    itemCode: itemCode(unit, item),
    source,
    mode,
    result,
    given: String(given ?? '').slice(0, 500),
    feedback: String(feedback ?? '').slice(0, 4000),
    seed
  });
  return next;
}

async function loadOpenSession(userId, sessionId) {
  if (!isId(sessionId)) return null;
  return StudySession.findOne({ _id: oid(sessionId), user: userId, endedAt: null });
}

/** Lägg till aktiv tid (tak per aktivitet — en lysande skärm är inte plugg). */
async function touchSession(session, extra = {}) {
  const now = new Date();
  const inc = StudySession.activeIncrement(session.lastActiveAt, now);
  await StudySession.updateOne(
    { _id: session._id },
    { $inc: { activeSeconds: inc, ...(extra.inc || {}) }, $set: { lastActiveAt: now }, ...(extra.addToSet ? { $addToSet: extra.addToSet } : {}) }
  );
}

const hasId = (list, id) => (list || []).some((x) => String(x) === String(id));

/**
 * Svar i ett pass. Returnerar rättning + facit, eller { invalid, message } /
 * { error: 'session_gone' | 'not_in_session' | 'already_answered' }.
 */
async function answerInSession(userId, sessionId, item, unit, payload) {
  const session = await loadOpenSession(userId, sessionId);
  if (!session) return { error: 'session_gone' };
  // Bara uppgifter som passet har delat ut, och bara en gång var.
  if (!hasId(session.ladder ? session.ladder.served : session.served, item._id)) return { error: 'not_in_session' };
  if (hasId(session.answeredItems, item._id)) return { error: 'already_answered' };
  // Mallövning: rätta mot talen i just den instans eleven såg (fröet).
  let gradedItem = item;
  let solution = item.solution || '';
  let seed = null;
  if (item.template) {
    seed = Number(payload.seed);
    if (!Number.isInteger(seed) || seed <= 0) return { invalid: true, message: 'Uppgiften behöver laddas om — starta passet igen.' };
    try {
      const inst = instance(item, seed);
      gradedItem = { kind: item.kind, answer: inst.answer };
      solution = inst.solution;
    } catch {
      return { invalid: true, message: 'Uppgiften gick inte att räkna ut — rapportera felet så rättar AI:n den.' };
    }
  }
  const graded = gradeAnswer(gradedItem, payload);
  if (graded.invalid) return graded;
  // Anspråk på svaret i ett steg: två samtidiga svar (dubbeltryck, två
  // flikar) på samma uppgift räknas en gång, och inget räknas efter "Avsluta".
  const claimed = await StudySession.findOneAndUpdate(
    { _id: session._id, endedAt: null, answeredItems: { $ne: item._id } },
    { $push: { answeredItems: item._id } },
    { new: true, projection: { answeredItems: 1 } }
  ).lean();
  if (!claimed) return { error: 'already_answered' };
  const given = payload.answer !== undefined ? describeAnswer(item, payload.answer) : payload.self;
  const state = await recordAttempt({
    userId, item, unit, sessionId: session._id, source: 'app',
    mode: session.kind === 'review' ? 'review' : 'practice',
    result: graded.result, given, seed
  });
  await touchSession(session, {
    inc: { answered: 1, correct: graded.result === 'correct' ? 1 : 0 },
    addToSet: { units: unit._id, subjects: unit.subject }
  });
  return {
    result: graded.result,
    expected: graded.expected ?? null,
    note: graded.note || null,
    solution,
    modelAnswer: item.answer?.modelAnswer || '',
    state: state ? { box: state.box, dueAt: state.dueAt } : null,
    ...(session.ladder ? { ladder: await climbLadder(session, graded.result, claimed.answeredItems.length) } : {})
  };
}

/**
 * Nästa uppgift i nivåstegen som eleven fortfarande får läsa (ett område kan
 * ha slutat delas mitt i passet). Returnerar { pick, item, unit } eller null.
 */
async function nextLadderItem(userId, pools, served, level) {
  const skipped = [...served];
  for (let tries = 0; tries < 10; tries++) {
    const pick = pickNext(pools, skipped, level);
    if (!pick) return null;
    const item = await StudyItem.findOne({ _id: oid(pick.itemId), usage: 'practice' }).lean();
    const unit = item ? await StudyUnit.findOne({ _id: item.unit, ...readableFilter(userId), archivedAt: null }).lean() : null;
    if (item && unit) return { pick, item, unit };
    skipped.push(oid(pick.itemId));
  }
  return null;
}

/**
 * Nivåstegen efter ett svar: ny nivå och nästa uppgift (null = passet är
 * klart). `moved` och `reached` räknas bara på det eleven klarat (3 rätt i
 * rad / 2 fel i rad) — tar en nivå slut på uppgifter byts nivån tyst.
 */
async function climbLadder(session, result, answered) {
  const lad = session.ladder;
  const levels = LEVELS.filter((l) => (lad.pools?.[l] || []).length);
  const step = ladderStep({ level: lad.level, up: lad.up, down: lad.down, reached: lad.reached }, result, levels);
  const found = answered < lad.count ? await nextLadderItem(session.user, lad.pools, lad.served || [], step.level) : null;
  const level = found ? found.pick.level : step.level;
  const order = (l) => LEVEL_ORDER.indexOf(l);
  // Ett förtjänat steg visas bara om nivån faktiskt gick åt det hållet.
  const moved = step.moved === 'up' && order(level) > order(lad.level) ? 'up'
    : step.moved === 'down' && order(level) < order(lad.level) ? 'down' : null;
  const changed = level !== lad.level;
  await StudySession.updateOne({ _id: session._id }, {
    $set: {
      'ladder.level': level,
      'ladder.up': changed ? 0 : step.up,
      'ladder.down': changed ? 0 : step.down,
      'ladder.reached': step.reached
    },
    ...(found ? { $push: { 'ladder.served': found.item._id } } : {})
  });
  return {
    level,
    reached: step.reached,
    moved,
    answered,
    count: lad.count,
    next: found ? publicItem(found.item, found.unit, session.user) : null
  };
}

async function pingSession(userId, sessionId) {
  const session = await loadOpenSession(userId, sessionId);
  if (!session) return { error: 'session_gone' };
  await touchSession(session);
  return { ok: true };
}

/**
 * Avsluta ett pass: XP per ämne (10 per rätt, 5 per nästan, bonus för ett
 * helt rätt pass) och en streak-tick om man verkligen pluggat.
 */
async function finishSession(userId, sessionId) {
  if (!isId(sessionId)) return { error: 'session_gone' };
  const now = new Date();
  // Avsluta i ett steg: bara ett anrop får stänga passet och dela ut XP, även
  // om "Avsluta" och sidbytet (unmount) skickar varsitt samtidigt.
  const session = await StudySession.findOneAndUpdate(
    { _id: oid(sessionId), user: oid(userId), endedAt: null },
    { $set: { endedAt: now } },
    { new: false, projection: { lastActiveAt: 1, startedAt: 1 } }
  ).lean();
  if (!session) return { error: 'session_gone' };
  const fresh = await StudySession.findOneAndUpdate(
    { _id: session._id },
    { $inc: { activeSeconds: StudySession.activeIncrement(session.lastActiveAt, now) }, $set: { lastActiveAt: now } },
    { new: true }
  ).lean();

  const rows = await StudyAttempt.aggregate([
    // user + createdAt ger indexet { user, createdAt } — session saknar eget index.
    { $match: { user: oid(userId), createdAt: { $gte: session.startedAt }, session: session._id } },
    { $group: { _id: { subject: '$subject', result: '$result' }, n: { $sum: 1 } } }
  ]);
  const bySubject = {};
  let correct = 0;
  let partial = 0;
  for (const r of rows) {
    const xp = r._id.result === 'correct' ? XP_CORRECT : r._id.result === 'partial' ? XP_PARTIAL : 0;
    bySubject[r._id.subject] = (bySubject[r._id.subject] || 0) + xp * r.n;
    if (r._id.result === 'correct') correct += r.n;
    if (r._id.result === 'partial') partial += r.n;
  }
  const answered = fresh.answered || 0;
  const perfect = answered >= 5 && correct === answered;
  const subjects = Object.keys(bySubject);
  if (perfect && subjects.length) bySubject[subjects[0]] += XP_PERFECT_BONUS;

  const studied = answered > 0 || (fresh.activeSeconds || 0) >= STREAK_MIN_ACTIVE_SEC;
  let xpEarned = 0;
  let award = null;
  const entries = Object.entries(bySubject);
  if (!entries.length && studied) entries.push([fresh.subjects?.[0] || 'ovrigt', 0]);
  for (const [i, [subject, xp]] of entries.entries()) {
    const r = await awardStudyActivity(userId, { xp, subject, tickStreakToo: studied && i === 0 });
    if (r) {
      xpEarned += r.xpEarned;
      if (i === 0) award = r;
    }
  }
  return {
    answered,
    correct,
    partial,
    perfect,
    activeSeconds: fresh.activeSeconds || 0,
    xpEarned,
    xp: award?.xp ?? null,
    streak: award?.streak ?? null,
    streakChange: award?.streakChange ?? 'unchanged',
    ladderReached: fresh.ladder?.reached || null
  };
}

/**
 * En papperslösning som användarens AI har rättat via MCP. Blir ett eget
 * kort pass (kind 'paper') så tiden och uppgiften syns i "Min plugg", ger
 * XP och räknas som pluggdag. AI:ns återkoppling sparas för eleven.
 */
async function recordPaperAttempt(userId, item, unit, { result, feedback, given = '', minutes = null }) {
  // Provfrågor rättas som ett helt prov (record_paper_test).
  if (item.usage === 'test') return { error: 'test_item' };
  const now = new Date();
  // Samma rättning igen inom 10 minuter (AI:n försöker om efter ett nätfel)
  // räknas inte två gånger. En ny rättning (annan återkoppling) räknas.
  const same = await StudyAttempt.findOne({
    user: oid(userId),
    item: item._id,
    source: 'paper',
    result,
    feedback: String(feedback ?? '').slice(0, 4000),
    createdAt: { $gte: new Date(now.getTime() - PAPER_DUPLICATE_MS) }
  }, 'createdAt').lean();
  if (same) {
    const state = await StudyItemState.findOne({ user: userId, item: item._id }).lean();
    return { duplicate: true, recordedAt: same.createdAt, state, xpEarned: 0, streak: null };
  }
  const activeSeconds = Number.isFinite(minutes) && minutes > 0 ? Math.round(Math.min(minutes, 60) * 60) : 0;
  const session = await StudySession.create({
    user: userId,
    kind: 'paper',
    units: [unit._id],
    subjects: [unit.subject],
    startedAt: now,
    lastActiveAt: now,
    endedAt: now,
    activeSeconds,
    answered: 1,
    correct: result === 'correct' ? 1 : 0
  });
  const state = await recordAttempt({
    userId, item, unit, sessionId: session._id, source: 'paper', mode: 'practice', result, given, feedback
  });
  const xp = result === 'correct' ? XP_CORRECT : result === 'partial' ? XP_PARTIAL : 0;
  const award = await awardStudyActivity(userId, { xp, subject: unit.subject });
  return { state, xpEarned: award?.xpEarned || 0, streak: award?.streak || null };
}

module.exports = {
  MODES, LEVELS, XP_CORRECT, XP_PARTIAL, resolveScopeUnits, publicItem, shuffled, seedFrom, startSession, recordAttempt, answerInSession,
  pingSession, finishSession, recordPaperAttempt
};
