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
const { gradeAnswer } = require('./grading');
const { nextState, pickItems } = require('./scheduler');
const { startLevel, ladderStep, pickNext, LEVEL_ORDER } = require('./ladder');
const { readableFilter, isId, oid, itemCode } = require('./access');
const { awardStudyActivity } = require('../gamification');

const MODES = ['cards', 'exercises', 'mixed', 'due', 'wrong', 'reading', 'ladder'];
const LEVELS = ['E', 'C', 'A'];
const MAX_SESSION_ITEMS = 50;
// XP: samma skala som glos-quizzen (10 per rätt), halva för "nästan".
const XP_CORRECT = 10;
const XP_PARTIAL = 5;
const XP_PERFECT_BONUS = 20; // helt rätt pass med minst 5 svar
// En pluggdag räknas (streak) om man svarat på något eller läst minst 2 minuter.
const STREAK_MIN_ACTIVE_SEC = 120;

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
  return StudyUnit.find(filter).lean();
}

/** Ett kort/en övning som den skickas till spelaren — UTAN facit. */
function publicItem(item, unit) {
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
    hints: item.hints || []
  };
  if (item.kind === 'card') {
    out.back = item.back; // ett kort vänds i klienten — baksidan är inget facit
  } else {
    out.answerType = item.answer?.type;
    if (item.answer?.type === 'choice') out.choices = item.answer.choices;
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
  }).lean();
  if (!items.length) return { error: 'empty', message: 'Nivåstegen behöver övningar på nivåerna E, C och A — här finns inga än.' };
  const states = await StudyItemState.find({ user: userId, item: { $in: items.map((i) => i._id) } }).lean();
  const stateMap = new Map(states.map((st) => [String(st.item), st]));
  const start = startLevel(items, stateMap);
  const pools = {};
  for (const l of LEVELS) {
    pools[l] = pickItems(items.filter((i) => i.level === l), stateMap, { mode: 'mixed', count: MAX_SESSION_ITEMS }).map((i) => i._id);
  }
  const first = pickNext(pools, [], start);
  const firstItem = items.find((i) => String(i._id) === first.itemId);
  const unitById = new Map(units.map((u) => [String(u._id), u]));
  const unit = unitById.get(String(firstItem.unit));
  const session = await StudySession.create({
    user: userId,
    kind: 'practice',
    units: [unit._id],
    subjects: [unit.subject],
    ladder: { level: first.level, reached: first.level, count, pools, served: [firstItem._id] }
  });
  return {
    session: { id: String(session._id), kind: session.kind },
    items: [publicItem(firstItem, unit)],
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

  const items = await StudyItem.find(query).lean();
  const states = await StudyItemState.find({ user: userId, item: { $in: items.map((i) => i._id) } }).lean();
  const stateMap = new Map(states.map((s) => [String(s.item), s]));
  const picked = pickItems(items, stateMap, { mode, count });
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
    subjects: [...new Set(picked.map((i) => unitById.get(String(i.unit)).subject))]
  });
  return {
    session: { id: String(session._id), kind: session.kind },
    items: picked.map((i) => publicItem(i, unitById.get(String(i.unit)))),
    total: items.length
  };
}

/**
 * Spara ett svar: användarens progress (spaced repetition) + historik.
 * Returnerar det nya StudyItemState — eller null för provfrågor, som inte
 * ingår i repetitionen (de visas aldrig i vanliga pass) och bara får historik.
 */
async function recordAttempt({ userId, item, unit, sessionId = null, source = 'app', mode = 'practice', result, given = '', feedback = '' }) {
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
    feedback: String(feedback ?? '').slice(0, 4000)
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

/** Svar i ett pass. Returnerar rättning + facit, eller { invalid, message } / { error }. */
async function answerInSession(userId, sessionId, item, unit, payload) {
  const session = await loadOpenSession(userId, sessionId);
  if (!session) return { error: 'session_gone' };
  const graded = gradeAnswer(item, payload);
  if (graded.invalid) return graded;
  const given = payload.answer !== undefined
    ? (item.answer?.type === 'choice' ? item.answer.choices[Number(payload.answer)] : payload.answer)
    : payload.self;
  const state = await recordAttempt({
    userId, item, unit, sessionId: session._id, source: 'app',
    mode: session.kind === 'review' ? 'review' : 'practice',
    result: graded.result, given
  });
  await touchSession(session, {
    inc: { answered: 1, correct: graded.result === 'correct' ? 1 : 0 },
    addToSet: { units: unit._id, subjects: unit.subject }
  });
  return {
    result: graded.result,
    expected: graded.expected ?? null,
    note: graded.note || null,
    solution: item.solution || '',
    modelAnswer: item.answer?.modelAnswer || '',
    state: state ? { box: state.box, dueAt: state.dueAt } : null,
    ...(session.ladder ? { ladder: await climbLadder(session, item, graded.result) } : {})
  };
}

/** Nivåstegen efter ett svar: ny nivå och nästa uppgift (null = passet är klart). */
async function climbLadder(session, item, result) {
  const lad = session.ladder;
  const levels = LEVELS.filter((l) => (lad.pools?.[l] || []).length);
  const step = ladderStep({ level: lad.level, up: lad.up, down: lad.down, reached: lad.reached }, result, levels);
  const served = [...(lad.served || []), item._id];
  const answered = (session.answered || 0) + 1;
  const pick = answered < lad.count ? pickNext(lad.pools, served, step.level) : null;
  // Tar nivån slut hamnar man på närmaste nivå som har kvar.
  const level = pick ? pick.level : step.level;
  const reached = LEVEL_ORDER.indexOf(level) > LEVEL_ORDER.indexOf(step.reached) ? level : step.reached;
  const order = (l) => LEVEL_ORDER.indexOf(l);
  const moved = order(level) > order(lad.level) ? 'up' : order(level) < order(lad.level) ? 'down' : null;
  let next = null;
  if (pick) {
    const nextItem = await StudyItem.findById(pick.itemId).lean();
    const nextUnit = nextItem ? await StudyUnit.findById(nextItem.unit).lean() : null;
    if (nextItem && nextUnit) next = publicItem(nextItem, nextUnit);
    served.push(oid(pick.itemId));
  }
  await StudySession.updateOne({ _id: session._id }, {
    $set: {
      'ladder.level': level,
      'ladder.up': moved ? 0 : step.up,
      'ladder.down': moved ? 0 : step.down,
      'ladder.reached': reached,
      'ladder.served': served
    }
  });
  return { level, reached, moved, answered, count: lad.count, next };
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
  const session = await loadOpenSession(userId, sessionId);
  if (!session) return { error: 'session_gone' };
  await touchSession(session);
  await StudySession.updateOne({ _id: session._id }, { $set: { endedAt: new Date() } });
  const fresh = await StudySession.findById(session._id).lean();

  const rows = await StudyAttempt.aggregate([
    { $match: { session: session._id } },
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
  const now = new Date();
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
  MODES, LEVELS, XP_CORRECT, XP_PARTIAL, resolveScopeUnits, publicItem, startSession, recordAttempt, answerInSession,
  pingSession, finishSession, recordPaperAttempt
};
