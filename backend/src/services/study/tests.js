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
const { gradeAnswer, formatNumber, formatFactors, describeAnswer } = require('./grading');
const { loadUnit, isId, oid, itemCode } = require('./access');
const { recordAttempt, shuffled, seedFrom, XP_CORRECT, XP_PARTIAL } = require('./practice');
const { mulberry32 } = require('./templates');
const { awardStudyActivity } = require('../gamification');
const G = require('./testGrading');

const XP_TEST_BONUS = 20;
// Ett påbörjat prov i appen går att fortsätta (t.ex. efter omladdning) i 6 h.
const RESUME_WINDOW_MS = 6 * 60 * 60 * 1000;
// Samma prov ger XP en gång per dygn — facit syns ju efter första försöket.
const TEST_XP_WINDOW_MS = 24 * 60 * 60 * 1000;
// En papperrättning som skickas igen inom så här lång tid är en omsändning.
const PAPER_DUPLICATE_MS = 10 * 60 * 1000;
const SELF_LEVELS = ['none', 'E', 'C', 'A'];
// Nätet och klicket efter "tiden är slut" får ta en stund innan servern
// räknar inlämningen som sen.
const DEADLINE_GRACE_MS = 60 * 1000;

const maxOf = (p) => ({ E: p?.E || 0, C: p?.C || 0, A: p?.A || 0 });
// eslint-disable-next-line no-unused-vars
const withoutAnswers = ({ answers, ...rest }) => rest;

/** Betygsgränserna för provets nuvarande maxpoäng (skalade om frågor tagits bort). */
const limitsFor = (test, max) => G.scaleLimits(test.gradeLimits, test.baseMax, max);

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

/**
 * En fråga som eleven ser den — utan facit, ledtrådar eller modellsvar.
 * `shuffleKey` (försökets id) ger samma blandning av en ordna-fråga varje
 * gång provet öppnas igen; utan den blandas den på nytt (utskrift).
 */
function publicQuestion({ n, q, item }, unit, shuffleKey = null) {
  const type = item.answer?.type;
  const rand = shuffleKey ? mulberry32(seedFrom(`${shuffleKey}:${item._id}`)) : Math.random;
  return {
    n,
    itemId: String(item._id),
    code: itemCode(unit, item),
    prompt: item.prompt,
    answerType: type,
    ...(type === 'choice' || type === 'multi' ? { choices: item.answer.choices } : {}),
    ...(type === 'order' ? { items: shuffled(item.answer.choices, rand) } : {}),
    ...(type === 'number' && item.answer.unit ? { unitLabel: item.answer.unit } : {}),
    level: item.level || null,
    points: maxOf(q.points),
    part: q.part || ''
  };
}

function expectedAnswer(item) {
  const a = item.answer || {};
  if (a.type === 'number') return `${formatNumber(a.value)}${a.unit ? ` ${a.unit}` : ''}`;
  if (a.type === 'choice') return a.choices?.[a.correctIndex] ?? '';
  if (a.type === 'text') return a.accepted?.[0] ?? '';
  if (a.type === 'multi') return (a.correctIndices || []).map((i) => a.choices?.[i]).filter(Boolean).join(', ');
  if (a.type === 'order') return (a.choices || []).join(' → ');
  if (a.type === 'factors') return formatFactors(a.factors || []);
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

/** Provets sista inlämningstid (null = ingen tidsgräns). */
const deadlineOf = (test, attempt) => (test.timeLimitMin ? new Date(new Date(attempt.startedAt).getTime() + test.timeLimitMin * 60 * 1000) : null);

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
      limits: limitsFor(test, testMax(qs)),
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
      limits: limitsFor(test, testMax(qs)),
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
      // Klockan i appen räknar mot serverns tid, inte datorns.
      deadline: deadlineOf(test, attempt),
      serverNow: new Date(),
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
    questions: qs.map((x) => publicQuestion(x, unit, String(attempt._id))),
    ...(attempt.status === 'awaiting_self' ? { needsSelf: needsSelfView(attempt, qs) } : {})
  };
}

async function loadOwnAttempt(userId, attemptId) {
  if (!isId(attemptId)) return null;
  return StudyTestAttempt.findOne({ _id: oid(attemptId), user: oid(userId) });
}

/** Provet, området (om eleven fortfarande får läsa det) och frågorna. */
async function loadAttemptContext(attempt) {
  const [test, access] = await Promise.all([StudyTest.findById(attempt.test), loadUnit(attempt.user, attempt.unit, 'read')]);
  if (!test || access.error) return null;
  return { test, unit: access.unit, qs: await testItems(test) };
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
 * får { invalid: [{ n, itemId, message }] } att rätta till. `lenient` (när
 * tiden tagit slut — och alltid efter tidsgränsen) räknar i stället ett
 * oläsbart svar som obesvarat, så provet alltid går att lämna in.
 */
async function submitTest(userId, attemptId, answers = [], { lenient = false } = {}) {
  const attempt = await loadOwnAttempt(userId, attemptId);
  if (!attempt || attempt.status !== 'in_progress') return { error: 'gone' };
  const ctx = await loadAttemptContext(attempt);
  if (!ctx) return { error: 'gone' };
  const { unit, qs } = ctx;
  const deadline = deadlineOf(ctx.test, attempt);
  const lateMs = deadline ? Date.now() - deadline.getTime() : 0;
  const late = lateMs > DEADLINE_GRACE_MS;
  const forgiving = lenient || late;
  const given = new Map();
  for (const a of answers) if (a && typeof a.itemId === 'string') given.set(a.itemId, a.answer);

  const invalid = [];
  const rows = [];
  for (const x of qs) {
    const raw = given.get(String(x.item._id));
    const empty = raw === undefined || raw === null || (typeof raw === 'string' && !raw.trim()) || (Array.isArray(raw) && raw.length === 0);
    const max = maxOf(x.q.points);
    const row = { item: x.item._id, code: itemCode(unit, x.item), max: G.withTotal(max) };
    const type = x.item.answer?.type;
    if (type === 'self') {
      rows.push({ ...row, given: empty ? '' : String(raw).slice(0, 500), result: null });
    } else if (empty) {
      rows.push({ ...row, given: '', result: 'wrong', points: G.withTotal({}) });
    } else {
      const g = gradeAnswer(x.item, { answer: raw });
      if (g.invalid && forgiving) {
        rows.push({ ...row, given: describeAnswer(x.item, raw).slice(0, 500), result: 'wrong', points: G.withTotal({}) });
        continue;
      }
      if (g.invalid) {
        invalid.push({ n: x.n, itemId: String(x.item._id), message: g.message });
        continue;
      }
      rows.push({ ...row, given: describeAnswer(x.item, raw).slice(0, 500), result: g.result, points: G.withTotal(G.pointsForResult(max, g.result)) });
    }
  }
  if (invalid.length) return { invalid };

  const now = new Date();
  const lateSec = late ? Math.round(lateMs / 1000) : 0;
  if (rows.some((r) => r.result === null)) {
    // Lämna in i ett steg: en andra inlämning (dubbelklick, två flikar) hittar inget öppet prov.
    const claimed = await StudyTestAttempt.findOneAndUpdate(
      { _id: attempt._id, status: 'in_progress' },
      { $set: { answers: rows, submittedAt: now, status: 'awaiting_self', lateSec } },
      { new: true }
    );
    if (!claimed) return { error: 'gone' };
    await touchSession(attempt.session);
    return { status: 'awaiting_self', needsSelf: needsSelfView(claimed, qs) };
  }
  return withoutAnswers(await finalize(attempt, rows, ctx, { from: 'in_progress', submittedAt: now, lateSec }));
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
  const rows = attempt.answers.map((r) => (typeof r.toObject === 'function' ? r.toObject() : r));
  return withoutAnswers(await finalize(attempt, rows, ctx, { from: 'awaiting_self' }));
}

/** Frågan som den ser ut nu — sparas i försöket när det blir klart. */
function questionSnapshot({ q, item }) {
  const cut = (s, n) => String(s || '').slice(0, n);
  return {
    prompt: cut(item.prompt, 4000),
    answerType: item.answer?.type || '',
    level: item.level || '',
    skill: cut(item.skill, 80),
    part: cut(q.part, 60),
    expected: cut(expectedAnswer(item), 3000),
    solution: cut(item.solution, 8000),
    modelAnswer: cut(item.answer?.modelAnswer, 4000)
  };
}

/**
 * Räkna ihop provet: poäng, uppskattat betyg, historik per fråga (för "Min
 * plugg"), passets tid, XP (10 per rätt, 5 per delvis, +20 för ett helt prov —
 * en gång per prov och dygn) och streak. `from` = statusen försöket måste ha:
 * bara ett anrop kan göra det klart, så XP aldrig delas ut två gånger.
 * Returnerar resultatet, eller { error: 'gone' }.
 */
async function finalize(attempt, rows, { test, unit, qs }, { from = null, submittedAt = null, lateSec = undefined } = {}) {
  const now = new Date();
  const byItem = new Map(qs.map((x) => [String(x.item._id), x]));
  const answers = rows.map((row) => {
    const x = byItem.get(String(row.item));
    return x ? { ...row, ...questionSnapshot(x) } : row;
  });
  const score = G.sumPoints(answers.map((a) => a.points));
  const max = G.sumPoints(answers.map((a) => a.max));
  const limits = limitsFor(test, max);
  const fields = {
    answers, score, max, limits,
    grade: G.estimateGrade(score, max, limits),
    status: 'done',
    finishedAt: now,
    submittedAt: submittedAt || attempt.submittedAt || now,
    ...(lateSec !== undefined ? { lateSec } : {})
  };
  if (from) {
    const claimed = await StudyTestAttempt.findOneAndUpdate({ _id: attempt._id, status: from }, { $set: fields }, { new: true });
    if (!claimed) return { error: 'gone' };
  } else {
    attempt.set(fields);
    await attempt.save();
  }

  let correct = 0;
  let partial = 0;
  for (const a of answers) {
    const x = byItem.get(String(a.item));
    if (!x) continue;
    if (a.result === 'correct') correct += 1;
    if (a.result === 'partial') partial += 1;
    await recordAttempt({
      userId: attempt.user, item: x.item, unit, sessionId: attempt.session, source: attempt.source, mode: 'test',
      result: a.result, given: a.given, feedback: a.feedback
    });
  }
  await touchSession(attempt.session, { answered: answers.length, correct }, true);
  const xpToday = await StudyTestAttempt.exists({
    _id: { $ne: attempt._id },
    user: attempt.user,
    test: attempt.test,
    status: 'done',
    xpEarned: { $gt: 0 },
    finishedAt: { $gte: new Date(now.getTime() - TEST_XP_WINDOW_MS) }
  });
  const award = await awardStudyActivity(attempt.user, {
    xp: xpToday ? 0 : correct * XP_CORRECT + partial * XP_PARTIAL + XP_TEST_BONUS,
    subject: attempt.subject
  });
  const xpEarned = award?.xpEarned || 0;
  await StudyTestAttempt.updateOne({ _id: attempt._id }, { $set: { xpEarned } });
  return {
    status: 'done',
    attemptId: String(attempt._id),
    score,
    max,
    grade: fields.grade,
    xpEarned,
    xpLimited: Boolean(xpToday),
    streak: award?.streak || null,
    answers
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
  const missing = qs.filter((x) => !byItem.has(String(x.item._id))).map((x) => itemCode(unit, x.item));
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
  const overall = String(overallFeedback || '').slice(0, 4000);

  // Samma rättning igen inom 10 minuter (AI:n försöker om efter ett nätfel)
  // räknas inte två gånger — då kommer det sparade resultatet tillbaka.
  const signature = (rows, text) => JSON.stringify([text, rows.map((a) => [String(a.item), a.points?.E, a.points?.C, a.points?.A, a.feedback || ''])]);
  const recent = await StudyTestAttempt.find({
    user: oid(userId), test: test._id, source: 'paper', status: 'done',
    finishedAt: { $gte: new Date(now.getTime() - PAPER_DUPLICATE_MS) }
  }).lean();
  const same = recent.find((a) => signature(a.answers, a.overallFeedback) === signature(answers, overall));
  if (same) {
    return {
      status: 'done', duplicate: true, attemptId: String(same._id), score: same.score, max: same.max, grade: same.grade,
      xpEarned: 0, streak: null, bySkill: skillReport(same.answers), missing
    };
  }

  const activeSeconds = Number.isFinite(minutes) && minutes > 0 ? Math.round(Math.min(minutes, 180) * 60) : 0;
  const session = await StudySession.create({
    user: userId, kind: 'test', units: [unit._id], subjects: [unit.subject],
    startedAt: now, lastActiveAt: now, endedAt: now, activeSeconds
  });
  const attempt = new StudyTestAttempt({
    user: userId, test: test._id, unit: unit._id, session: session._id, source: 'paper', status: 'in_progress',
    subject: unit.subject, unitTitle: unit.title, testTitle: test.title,
    startedAt: now, submittedAt: now, answers, overallFeedback: overall
  });
  const { answers: saved, ...out } = await finalize(attempt, answers, { test, unit, qs });
  return { ...out, bySkill: skillReport(saved), missing };
}

/** Resultatsidan för ett avslutat försök (bara ägaren). Facit visas först när provet är klart. */
async function attemptView(userId, attemptId) {
  if (!isId(attemptId)) return null;
  const a = await StudyTestAttempt.findOne({ _id: oid(attemptId), user: oid(userId) }).lean();
  if (!a) return null;
  if (a.status !== 'done') return { id: String(a._id), status: a.status, testId: String(a.test) };
  // Frågorna läses ur försökets ögonblicksbild från inlämningen — inte ur
  // uppgifterna, som kan ha ändrats, tagits bort eller slutat delas sedan.
  const test = await StudyTest.findById(a.test, 'gradeLimits').lean();
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
    limits: a.limits || test?.gradeLimits || null,
    overallFeedback: a.overallFeedback || '',
    xpEarned: a.xpEarned || 0,
    lateSec: a.lateSec || 0,
    answers: a.answers.map((row, i) => ({
      n: i + 1,
      code: row.code,
      prompt: row.prompt || '',
      answerType: row.answerType || null,
      level: row.level || null,
      given: row.given,
      result: row.result,
      selfLevel: row.selfLevel,
      points: row.points,
      max: row.max,
      expected: row.expected || '',
      solution: row.solution || '',
      modelAnswer: row.modelAnswer || '',
      feedback: row.feedback || '',
      part: row.part || '',
      skill: row.skill || ''
    })),
    bySkill: skillReport(a.answers)
  };
}

/**
 * Resultat per färdighet (frågornas `skill` i försöket): poäng av max och
 * koderna — så eleven ser VAD som behöver övas, och kan öva på just det.
 */
function skillReport(answers) {
  const by = new Map();
  for (const row of answers) {
    const skill = row.skill;
    if (!skill) continue;
    if (!by.has(skill)) by.set(skill, { skill, earned: 0, max: 0, codes: [] });
    const r = by.get(skill);
    r.earned += row.points?.total || 0;
    r.max += row.max?.total || 0;
    r.codes.push(row.code);
  }
  return [...by.values()].sort((x, y) => (x.earned / x.max) - (y.earned / y.max));
}

module.exports = {
  XP_TEST_BONUS, loadTest, testItems, testsForUnit, testOverview, testSheet, startTest, submitTest, assessTest,
  recordPaperTest, attemptView, expectedAnswer, publicQuestion, skillReport
};
