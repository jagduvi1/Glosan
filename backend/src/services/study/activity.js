// "Min plugg" — vad eleven har gjort en dag, vecka, månad eller termin: tid,
// uppgifter och resultat per ämne, vilka dagar, och en tidslinje med varje
// pass och vilka uppgifter det gällde. Byggt för att kunna visas för en
// förälder. Allt räknas i svensk lokal tid (utils/localTime.js).
const StudySession = require('../../models/StudySession');
const StudyAttempt = require('../../models/StudyAttempt');
const StudyUnit = require('../../models/StudyUnit');
const StudyTestAttempt = require('../../models/StudyTestAttempt');
const XpEvent = require('../../models/XpEvent');
const User = require('../../models/User');
const { getSubject } = require('../../config/subjects');
const { oid } = require('./access');
const { TZ, periodRange, daysBetween, localYmd } = require('../../utils/localTime');
const { effectiveStreak: sharedEffectiveStreak } = require('../gamification');

// Detaljerad tidslinje (varje pass med uppgifterna) för dag och vecka; för
// månad och termin en rad per dag — klicka dig in på dagen för detaljerna.
const DETAILED = new Set(['day', 'week']);
const MAX_TIMELINE_SESSIONS = 120;

const subjectInfo = (key) => {
  const s = getSubject(key);
  return { subject: key, label: s?.label || key, emoji: s?.emoji || '📚', color: s?.color || null };
};

/**
 * Passets tid per ämne: efter svaren i passet, annars lika delat mellan passets
 * ämnen. Ett svar kan vara en räknad rad (`n` svar, se loadAttempts).
 */
function splitSessionTime(session, attemptsInSession) {
  const secs = session.activeSeconds || 0;
  if (!secs) return {};
  if (attemptsInSession.length) {
    const per = {};
    let total = 0;
    for (const a of attemptsInSession) {
      per[a.subject] = (per[a.subject] || 0) + (a.n || 1);
      total += a.n || 1;
    }
    const out = {};
    for (const [subject, n] of Object.entries(per)) out[subject] = (secs * n) / total;
    return out;
  }
  const subjects = session.subjects?.length ? session.subjects : ['ovrigt'];
  return Object.fromEntries(subjects.map((s) => [s, secs / subjects.length]));
}

/**
 * Svaren i perioden. Dag och vecka: varje svar (tidslinjen visar dem). Månad
 * och termin: räknade i databasen — en rad per pass, ämne, resultat, källa och
 * svensk dag, med antalet i `n` — eftersom en termin kan vara tiotusentals svar.
 */
async function loadAttempts(uid, when, detailed) {
  if (detailed) {
    return StudyAttempt.find(
      { user: uid, createdAt: when },
      'session subject unit unitTitle itemCode source mode result createdAt given feedback'
    ).sort({ createdAt: 1 }).lean();
  }
  const rows = await StudyAttempt.aggregate([
    { $match: { user: uid, createdAt: when } },
    {
      $group: {
        _id: {
          session: '$session',
          subject: '$subject',
          result: '$result',
          source: '$source',
          day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: TZ } }
        },
        n: { $sum: 1 }
      }
    }
  ]);
  return rows.map((r) => ({ ...r._id, n: r.n }));
}

/**
 * Aktiviteten under en period. `period`: day | week | month | term,
 * `anchor`: ett lokalt datum i perioden (standard: idag).
 */
async function activityFor(userId, { period, anchor } = {}) {
  const range = periodRange(period, anchor);
  const detailed = DETAILED.has(range.period);
  const uid = oid(userId);
  const when = { $gte: range.from, $lt: range.to };

  const [sessionsRaw, attempts, xpRows, user, testsDone] = await Promise.all([
    StudySession.find({ user: uid, startedAt: when }, 'kind subjects units activeSeconds answered correct startedAt').sort({ startedAt: -1 }).lean(),
    loadAttempts(uid, when, detailed),
    XpEvent.aggregate([
      { $match: { user: uid, createdAt: when, sourceLang: { $regex: '^study:' } } },
      { $group: { _id: null, xp: { $sum: '$amount' } } }
    ]),
    User.findById(uid, 'streak').lean(),
    StudyTestAttempt.find({ user: uid, status: 'done', finishedAt: when }, 'test session source testTitle score max grade finishedAt').lean()
  ]);
  const testBySession = new Map(testsDone.filter((t) => t.session).map((t) => [String(t.session), t]));

  // Ett pass som öppnades och stängdes utan att något hände räknas inte.
  const sessions = sessionsRaw.filter((s) => (s.activeSeconds || 0) > 0 || (s.answered || 0) > 0);
  const bySession = new Map();
  for (const a of attempts) {
    const key = String(a.session || '');
    if (!bySession.has(key)) bySession.set(key, []);
    bySession.get(key).push(a);
  }

  const today = localYmd();
  const days = new Map(daysBetween(range.start, range.end).map((d) => [d, { date: d, activeSeconds: 0, answered: 0, correct: 0, subjects: new Set() }]));
  const subjects = new Map();
  const subj = (key) => {
    if (!subjects.has(key)) subjects.set(key, { ...subjectInfo(key), activeSeconds: 0, answered: 0, correct: 0 });
    return subjects.get(key);
  };

  const totals = { activeSeconds: 0, sessions: sessions.length, answered: 0, correct: 0, partial: 0, wrong: 0, paper: 0, tests: testsDone.length, daysStudied: 0, xp: xpRows[0]?.xp || 0 };
  for (const s of sessions) {
    totals.activeSeconds += s.activeSeconds || 0;
    const day = days.get(localYmd(s.startedAt));
    if (day) day.activeSeconds += s.activeSeconds || 0;
    for (const [key, secs] of Object.entries(splitSessionTime(s, bySession.get(String(s._id)) || []))) {
      subj(key).activeSeconds += secs;
      if (day) day.subjects.add(key);
    }
  }
  for (const a of attempts) {
    const n = a.n || 1;
    totals.answered += n;
    totals[a.result] += n;
    if (a.source === 'paper') totals.paper += n;
    const s = subj(a.subject);
    s.answered += n;
    if (a.result === 'correct') s.correct += n;
    const day = days.get(a.day || localYmd(a.createdAt));
    if (day) {
      day.answered += n;
      if (a.result === 'correct') day.correct += n;
      day.subjects.add(a.subject);
    }
  }
  const dayList = [...days.values()].map((d) => ({
    date: d.date,
    activeSeconds: Math.round(d.activeSeconds),
    answered: d.answered,
    correct: d.correct,
    emojis: [...d.subjects].map((k) => subjectInfo(k).emoji)
  }));
  totals.daysStudied = dayList.filter((d) => d.activeSeconds > 0 || d.answered > 0).length;

  let timeline;
  if (detailed) {
    const shown = sessions.slice(0, MAX_TIMELINE_SESSIONS);
    // Läspass har inga svar — titlarna hämtas från områdena (om de finns kvar).
    const unitIds = [...new Set(shown.flatMap((s) => (s.units || []).map(String)))];
    const units = unitIds.length ? await StudyUnit.find({ _id: { $in: unitIds.map(oid) } }, 'title').lean() : [];
    const titleOf = new Map(units.map((u) => [String(u._id), u.title]));
    timeline = {
      kind: 'sessions',
      sessions: shown.map((s) => {
        const items = bySession.get(String(s._id)) || [];
        const t = testBySession.get(String(s._id));
        const titles = [...new Set(items.length ? items.map((a) => a.unitTitle) : (s.units || []).map((id) => titleOf.get(String(id))))].filter(Boolean);
        return {
          id: String(s._id),
          kind: s.kind,
          at: s.startedAt,
          date: localYmd(s.startedAt),
          subjects: (s.subjects?.length ? s.subjects : [...new Set(items.map((a) => a.subject))]).map(subjectInfo),
          unitTitles: titles,
          activeSeconds: s.activeSeconds || 0,
          answered: items.length || s.answered || 0,
          correct: items.length ? items.filter((a) => a.result === 'correct').length : (s.correct || 0),
          ...(t ? { test: { attemptId: String(t._id), testId: String(t.test), title: t.testTitle, score: t.score, max: t.max, grade: t.grade, source: t.source } } : {}),
          items: items.map((a) => ({
            code: a.itemCode,
            unitId: a.unit ? String(a.unit) : null,
            result: a.result,
            source: a.source,
            mode: a.mode,
            ...(a.source === 'paper' && a.feedback ? { feedback: a.feedback } : {}),
            ...(a.given ? { given: a.given } : {})
          }))
        };
      }),
      more: Math.max(0, sessions.length - MAX_TIMELINE_SESSIONS)
    };
  } else {
    timeline = { kind: 'days', days: dayList.filter((d) => d.activeSeconds > 0 || d.answered > 0).reverse() };
  }

  return {
    period: range.period,
    anchor: range.anchor,
    start: range.start,
    end: range.end,
    prev: range.prev,
    next: range.next <= today ? range.next : null,
    today,
    totals: { ...totals, activeSeconds: Math.round(totals.activeSeconds) },
    bySubject: [...subjects.values()]
      .map((s) => ({ ...s, activeSeconds: Math.round(s.activeSeconds) }))
      .sort((a, b) => b.activeSeconds - a.activeSeconds || b.answered - a.answered),
    days: dayList,
    timeline,
    // Klara prov i perioden (i appen och på papper) — med poäng och betyg.
    tests: testsDone.map((t) => ({ testTitle: t.testTitle, finishedAt: t.finishedAt, source: t.source, score: t.score, max: t.max, grade: t.grade })),
    streak: effectiveStreak(user)
  };
}

/** Streaken som den är NU (services/gamification.js effectiveStreak). */
function effectiveStreak(user) {
  const { current, longest } = sharedEffectiveStreak(user?.streak);
  return { current, longest };
}

/** Kort sammanfattning för idag (Plugga-startsidan). */
async function todaySummary(userId) {
  const range = periodRange('day');
  const uid = oid(userId);
  const [rows, answered] = await Promise.all([
    StudySession.aggregate([
      { $match: { user: uid, startedAt: { $gte: range.from, $lt: range.to } } },
      { $group: { _id: null, secs: { $sum: '$activeSeconds' } } }
    ]),
    StudyAttempt.countDocuments({ user: uid, createdAt: { $gte: range.from, $lt: range.to } })
  ]);
  return { activeSeconds: rows[0]?.secs || 0, answered };
}

module.exports = { activityFor, todaySummary, splitSessionTime, effectiveStreak };
