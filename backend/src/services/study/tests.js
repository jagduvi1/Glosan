// Övningsprov i Plugga. Eleven gör provet i appen (rättas på servern utan AI;
// öppna frågor bedömer eleven själv mot modellsvaret, efter inlämning) eller
// på papper (elevens AI rättar via MCP, record_paper_test). Resultatet: poäng
// per nivå E/C/A och ett uppskattat betyg (services/study/testGrading.js).
const StudyTest = require('../../models/StudyTest');
const StudyTestAttempt = require('../../models/StudyTestAttempt');
const StudyItem = require('../../models/StudyItem');
const StudyUnit = require('../../models/StudyUnit');
const StudySession = require('../../models/StudySession');
const { getSubject } = require('../../config/subjects');
const { termLabel } = require('../../utils/term');
const { gradeAnswer, formatNumber } = require('./grading');
const { loadUnit, isId, oid, itemCode } = require('./access');
const { recordAttempt, XP_CORRECT, XP_PARTIAL } = require('./practice');
const { awardStudyActivity } = require('../gamification');
const G = require('./testGrading');

const XP_TEST_BONUS = 20;
// Ett påbörjat prov i appen går att fortsätta (t.ex. efter omladdning) i 6 h.
const RESUME_WINDOW_MS = 6 * 60 * 60 * 1000;
const SELF_LEVELS = ['none', 'E', 'C', 'A'];

const maxOf = (p) => ({ E: p?.E || 0, C: p?.C || 0, A: p?.A || 0 });

async function loadTest(userId, testId) {
  if (!isId(testId)) return null;
  const test = await StudyTest.findById(testId);
  if (!test) return null;
  const access = await loadUnit(userId, test.unit, 'read');
  if (access.error) return null;
  return { test, unit: access.unit, isOwner: access.isOwner };
}

/** Provets frågor i ordning: [{ n, q, item }] (frågor vars uppgift raderats hoppas över). */
async function testItems(test) {
  const items = await StudyItem.find({ _id: { $in: test.questions.map((q) => q.item) } });
  const byId = new Map(items.map((i) => [String(i._id), i]));
  return test.questions
    .map((q) => ({ q, item: byId.get(String(q.item)) }))
    .filter((x) => x.item)
    .map((x, i) => ({ n: i + 1, ...x }));
}

const testMax = (qs) => G.sumPoints(qs.map((x) => maxOf(x.q.points)));

/** En fråga som eleven ser den — utan facit, ledtrådar eller modellsvar. */
function publicQuestion({ n, q, item }, unit) {
  const type = item.answer?.type;
  return {
    n,
    itemId: String(item._id),
    code: itemCode(unit, item),
    prompt: item.prompt,
    answerType: type,
    ...(type === 'choice' ? { choices: item.answer.choices } : {}),
    ...(type === 'number' && item.answer.unit ? { unitLabel: item.answer.unit } : {}),
    level: item.level || null,
    points: maxOf(q.points)
  };
}

function expectedAnswer(item) {
  const a = item.answer || {};
  if (a.type === 'number') return `${formatNumber(a.value)}${a.unit ? ` ${a.unit}` : ''}`;
  if (a.type === 'choice') return a.choices?.[a.correctIndex] ?? '';
  if (a.type === 'text') return a.accepted?.[0] ?? '';
  return '';
}

function unitBrief(unit) {
  const s = getSubject(unit.subject);
  return {
    id: String(unit._id),
    code: unit.code,
    title: unit.title,
    subject: unit.subject,
    subjectLabel: s?.label || unit.subject,
    emoji: s?.emoji || '',
    termLabel: termLabel(unit.term),
    gradeYear: unit.gradeYear ?? null
  };
}

const attemptBrief = (a) => ({
  id: String(a._id),
  source: a.source,
  startedAt: a.startedAt,
  finishedAt: a.finishedAt,
  score: a.score,
  max: a.max,
  grade: a.grade
});

function findOpenAttempt(userId, testId) {
  return StudyTestAttempt.findOne({
    user: oid(userId),
    test: testId,
    source: 'app',
    status: { $in: ['in_progress', 'awaiting_self'] },
    startedAt: { $gte: new Date(Date.now() - RESUME_WINDOW_MS) }
  }).sort({ startedAt: -1 });
}

/** Proven i ett område med elevens egna resultat (områdessidan). */
async function testsForUnit(userId, unit) {
  const tests = await StudyTest.find({ unit: unit._id }).sort({ createdAt: 1 }).lean();
  if (!tests.length) return [];
  const done = await StudyTestAttempt.find({ user: oid(userId), test: { $in: tests.map((t) => t._id) }, status: 'done' })
    .sort({ finishedAt: -1 }).lean();
  return tests.map((t) => {
    const mine = done.filter((a) => String(a.test) === String(t._id));
    const best = mine.reduce((b, a) => (!b || (a.score?.total || 0) > (b.score?.total || 0) ? a : b), null);
    return {
      id: String(t._id),
      title: t.title,
      description: t.description || '',
      questionCount: t.questions.length,
      max: G.sumPoints(t.questions.map((q) => maxOf(q.points))),
      timeLimitMin: t.timeLimitMin ?? null,
      attempts: mine.length,
      best: best ? attemptBrief(best) : null,
      last: mine[0] ? attemptBrief(mine[0]) : null
    };
  });
}

/** Provsidan: provet, betygsgränserna och mina försök. */
async function testOverview(userId, testId) {
  const loaded = await loadTest(userId, testId);
  if (!loaded) return null;
  const { test, unit } = loaded;
  const [qs, attempts, open] = await Promise.all([
    testItems(test),
    StudyTestAttempt.find({ user: oid(userId), test: test._id, status: 'done' }).sort({ finishedAt: -1 }).limit(20).lean(),
    findOpenAttempt(userId, test._id)
  ]);
  return {
    test: {
      id: String(test._id),
      title: test.title,
      description: test.description || '',
      timeLimitMin: test.timeLimitMin ?? null,
      questionCount: qs.length,
      max: testMax(qs),
      limits: test.gradeLimits,
      unit: unitBrief(unit)
    },
    attempts: attempts.map(attemptBrief),
    inProgress: open ? { id: String(open._id), status: open.status, startedAt: open.startedAt } : null
  };
}

/** Provet som papper (utskrift) — frågor och poäng, inget facit. */
async function testSheet(userId, testId) {
  const loaded = await loadTest(userId, testId);
  if (!loaded) return null;
  const { test, unit } = loaded;
  const qs = await testItems(test);
  return {
    test: {
      id: String(test._id),
      title: test.title,
      description: test.description || '',
      timeLimitMin: test.timeLimitMin ?? null,
      max: testMax(qs),
      limits: test.gradeLimits,
      unit: unitBrief(unit)
    },
    questions: qs.map((x) => publicQuestion(x, unit))
  };
}

function needsSelfView(attempt, qs) {
  const byItem = new Map(qs.map((x) => [String(x.item._id), x]));
  return attempt.answers
    .filter((a) => a.result === null)
    .map((a) => {
      const x = byItem.get(String(a.item));
      if (!x) return null;
      return {
        itemId: String(a.item),
        n: x.n,
        code: a.code,
        prompt: x.item.prompt,
        given: a.given,
        modelAnswer: x.item.answer?.modelAnswer || '',
        points: maxOf(x.q.points)
      };
    })
    .filter(Boolean);
}

/** Starta provet i appen — eller fortsätt ett påbörjat. */
async function startTest(userId, testId) {
  const loaded = await loadTest(userId, testId);
  if (!loaded) return null;
  const { test, unit } = loaded;
  const qs = await testItems(test);
  if (!qs.length) return { error: 'empty' };
  let attempt = await findOpenAttempt(userId, test._id);
  const resumed = Boolean(attempt);
  if (!attempt) {
    const session = await StudySession.create({ user: userId, kind: 'test', units: [unit._id], subjects: [unit.subject] });
    attempt = await StudyTestAttempt.create({
      user: userId,
      test: test._id,
      unit: unit._id,
      session: session._id,
      source: 'app',
      subject: unit.subject,
      unitTitle: unit.title,
      testTitle: test.title
    });
  }
  return {
    attempt: {
      id: String(attempt._id),
      status: attempt.status,
      startedAt: attempt.startedAt,
      sessionId: attempt.session ? String(attempt.session) : null,
      resumed
    },
    test: {
      id: String(test._id),
      title: test.title,
      description: test.description || '',
      timeLimitMin: test.timeLimitMin ?? null,
      max: testMax(qs),
      unit: unitBrief(unit)
    },
    questions: qs.map((x) => publicQuestion(x, unit)),
    ...(attempt.status === 'awaiting_self' ? { needsSelf: needsSelfView(attempt, qs) } : {})
  };
}

async function loadOwnAttempt(userId, attemptId) {
  if (!isId(attemptId)) return null;
  return StudyTestAttempt.findOne({ _id: oid(attemptId), user: oid(userId) });
}

async function loadAttemptContext(attempt) {
  const [test, unit] = await Promise.all([StudyTest.findById(attempt.test), StudyUnit.findById(attempt.unit)]);
  if (!test || !unit) return null;
  return { test, unit, qs: await testItems(test) };
}

/** Lägg till aktiv tid på provets pass (tak per aktivitet, som alla pass). */
async function touchSession(sessionId, extraSet = {}, end = false) {
  if (!sessionId) return;
  const session = await StudySession.findById(sessionId);
  if (!session) return;
  const now = new Date();
  const update = { $set: { ...extraSet } };
  if (!session.endedAt) {
    update.$inc = { activeSeconds: StudySession.activeIncrement(session.lastActiveAt, now) };
    update.$set.lastActiveAt = now;
    if (end) update.$set.endedAt = now;
  }
  await StudySession.updateOne({ _id: session._id }, update);
}

/**
 * Lämna in provet. answers: [{ itemId, answer }] — tal/text som sträng,
 * flerval som index. Obesvarade frågor ger 0 poäng. Ett svar som inte går att
 * tolka ("3 eller 4") räknas aldrig som fel: då sparas ingenting och eleven
 * får { invalid: [{ n, itemId, message }] } att rätta till.
 */
async function submitTest(userId, attemptId, answers = []) {
  const attempt = await loadOwnAttempt(userId, attemptId);
  if (!attempt || attempt.status !== 'in_progress') return { error: 'gone' };
  const ctx = await loadAttemptContext(attempt);
  if (!ctx) return { error: 'gone' };
  const { unit, qs } = ctx;
  const given = new Map();
  for (const a of answers) if (a && typeof a.itemId === 'string') given.set(a.itemId, a.answer);

  const invalid = [];
  const rows = [];
  for (const x of qs) {
    const raw = given.get(String(x.item._id));
    const empty = raw === undefined || raw === null || (typeof raw === 'string' && !raw.trim());
    const max = maxOf(x.q.points);
    const row = { item: x.item._id, code: itemCode(unit, x.item), max: G.withTotal(max) };
    const type = x.item.answer?.type;
    if (type === 'self') {
      rows.push({ ...row, given: empty ? '' : String(raw).slice(0, 500), result: null });
    } else if (empty) {
      rows.push({ ...row, given: '', result: 'wrong', points: G.withTotal({}) });
    } else {
      const g = gradeAnswer(x.item, { answer: raw });
      if (g.invalid) {
        invalid.push({ n: x.n, itemId: String(x.item._id), message: g.message });
        continue;
      }
      const shown = type === 'choice' ? x.item.answer.choices[Number(raw)] : String(raw);
      rows.push({ ...row, given: String(shown ?? '').slice(0, 500), result: g.result, points: G.withTotal(G.pointsForResult(max, g.result)) });
    }
  }
  if (invalid.length) return { invalid };

  attempt.answers = rows;
  attempt.submittedAt = new Date();
  if (rows.some((r) => r.result === null)) {
    attempt.status = 'awaiting_self';
    await attempt.save();
    await touchSession(attempt.session);
    return { status: 'awaiting_self', needsSelf: needsSelfView(attempt, qs) };
  }
  return finalize(attempt, ctx);
}

/**
 * Självbedömning av provets öppna frågor. assessments: [{ itemId, level }]
 * där level = 'none' | 'E' | 'C' | 'A'. Alla öppna frågor måste bedömas.
 */
async function assessTest(userId, attemptId, assessments = []) {
  const attempt = await loadOwnAttempt(userId, attemptId);
  if (!attempt || attempt.status !== 'awaiting_self') return { error: 'gone' };
  const ctx = await loadAttemptContext(attempt);
  if (!ctx) return { error: 'gone' };
  const levels = new Map();
  for (const a of assessments) if (a && typeof a.itemId === 'string') levels.set(a.itemId, a.level);
  const missing = [];
  for (const row of attempt.answers) {
    if (row.result !== null) continue;
    const level = levels.get(String(row.item));
    if (!SELF_LEVELS.includes(level)) {
      missing.push(row.code);
      continue;
    }
    const pts = G.pointsForSelfLevel(maxOf(row.max), level);
    row.selfLevel = level;
    row.points = G.withTotal(pts);
    row.result = G.resultFromPoints(pts, maxOf(row.max));
  }
  if (missing.length) return { missing };
  return finalize(attempt, ctx);
}

/**
 * Räkna ihop provet: poäng, uppskattat betyg, historik per fråga (för "Min
 * plugg"), passets tid, XP (10 per rätt, 5 per delvis, +20 för ett helt prov)
 * och streak.
 */
async function finalize(attempt, { test, unit, qs }) {
  const now = new Date();
  const score = G.sumPoints(attempt.answers.map((a) => a.points));
  const max = G.sumPoints(attempt.answers.map((a) => a.max));
  attempt.score = score;
  attempt.max = max;
  attempt.grade = G.estimateGrade(score, max, test.gradeLimits);
  attempt.status = 'done';
  attempt.finishedAt = now;
  if (!attempt.submittedAt) attempt.submittedAt = now;

  const itemById = new Map(qs.map((x) => [String(x.item._id), x.item]));
  let correct = 0;
  let partial = 0;
  for (const a of attempt.answers) {
    const item = itemById.get(String(a.item));
    if (!item) continue;
    if (a.result === 'correct') correct += 1;
    if (a.result === 'partial') partial += 1;
    await recordAttempt({
      userId: attempt.user, item, unit, sessionId: attempt.session, source: attempt.source, mode: 'test',
      result: a.result, given: a.given, feedback: a.feedback
    });
  }
  await touchSession(attempt.session, { answered: attempt.answers.length, correct }, true);
  const award = await awardStudyActivity(attempt.user, {
    xp: correct * XP_CORRECT + partial * XP_PARTIAL + XP_TEST_BONUS,
    subject: attempt.subject
  });
  attempt.xpEarned = award?.xpEarned || 0;
  await attempt.save();
  return {
    status: 'done',
    attemptId: String(attempt._id),
    score,
    max,
    grade: attempt.grade,
    xpEarned: attempt.xpEarned,
    streak: award?.streak || null
  };
}

/**
 * Ett prov gjort på papper som elevens AI har rättat. results: [{ itemId,
 * points: {E,C,A}, feedback?, given? }] — poängen begränsas till frågans max
 * per nivå, frågor som saknas ger 0. Returnerar resultatet + vilka koder som saknades.
 */
async function recordPaperTest(userId, test, unit, { results = [], overallFeedback = '', minutes = null } = {}) {
  const qs = await testItems(test);
  const byItem = new Map(results.map((r) => [String(r.itemId), r]));
  const now = new Date();
  const activeSeconds = Number.isFinite(minutes) && minutes > 0 ? Math.round(Math.min(minutes, 180) * 60) : 0;
  const session = await StudySession.create({
    user: userId, kind: 'test', units: [unit._id], subjects: [unit.subject],
    startedAt: now, lastActiveAt: now, endedAt: now, activeSeconds
  });
  const answers = qs.map((x) => {
    const r = byItem.get(String(x.item._id));
    const max = maxOf(x.q.points);
    const pts = r ? G.clampPoints(r.points, max) : { E: 0, C: 0, A: 0 };
    return {
      item: x.item._id,
      code: itemCode(unit, x.item),
      given: String(r?.given || '').slice(0, 500),
      result: G.resultFromPoints(pts, max),
      points: G.withTotal(pts),
      max: G.withTotal(max),
      feedback: String(r?.feedback || '').slice(0, 4000)
    };
  });
  const attempt = new StudyTestAttempt({
    user: userId, test: test._id, unit: unit._id, session: session._id, source: 'paper', status: 'in_progress',
    subject: unit.subject, unitTitle: unit.title, testTitle: test.title,
    startedAt: now, submittedAt: now, answers, overallFeedback: String(overallFeedback || '').slice(0, 4000)
  });
  const out = await finalize(attempt, { test, unit, qs });
  return { ...out, missing: qs.filter((x) => !byItem.has(String(x.item._id))).map((x) => itemCode(unit, x.item)) };
}

/** Resultatsidan för ett avslutat försök (bara ägaren). Facit visas först när provet är klart. */
async function attemptView(userId, attemptId) {
  if (!isId(attemptId)) return null;
  const a = await StudyTestAttempt.findOne({ _id: oid(attemptId), user: oid(userId) }).lean();
  if (!a) return null;
  if (a.status !== 'done') return { id: String(a._id), status: a.status, testId: String(a.test) };
  const [test, items] = await Promise.all([
    StudyTest.findById(a.test, 'gradeLimits').lean(),
    StudyItem.find({ _id: { $in: a.answers.map((x) => x.item) } }).lean()
  ]);
  const byId = new Map(items.map((i) => [String(i._id), i]));
  const s = getSubject(a.subject);
  return {
    id: String(a._id),
    status: a.status,
    source: a.source,
    testId: String(a.test),
    testExists: Boolean(test),
    testTitle: a.testTitle,
    unitId: String(a.unit),
    unitTitle: a.unitTitle,
    subject: a.subject,
    subjectLabel: s?.label || a.subject,
    emoji: s?.emoji || '',
    startedAt: a.startedAt,
    finishedAt: a.finishedAt,
    score: a.score,
    max: a.max,
    grade: a.grade,
    limits: test?.gradeLimits || null,
    overallFeedback: a.overallFeedback || '',
    xpEarned: a.xpEarned || 0,
    answers: a.answers.map((row, i) => {
      const item = byId.get(String(row.item));
      return {
        n: i + 1,
        code: row.code,
        prompt: item?.prompt || '',
        answerType: item?.answer?.type || null,
        level: item?.level || null,
        given: row.given,
        result: row.result,
        selfLevel: row.selfLevel,
        points: row.points,
        max: row.max,
        expected: item ? expectedAnswer(item) : '',
        solution: item?.solution || '',
        modelAnswer: item?.answer?.modelAnswer || '',
        feedback: row.feedback || ''
      };
    })
  };
}

module.exports = {
  XP_TEST_BONUS, loadTest, testItems, testsForUnit, testOverview, testSheet, startTest, submitTest, assessTest,
  recordPaperTest, attemptView, expectedAnswer, publicQuestion
};
