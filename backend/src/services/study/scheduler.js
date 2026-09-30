// Spaced repetition (Leitner) och urval av uppgifter till ett pluggpass.
// Rena funktioner — enkla att förklara för en elev: "det du kan kommer
// tillbaka mer sällan, det du missar kommer tillbaka direkt".
const { BOX_INTERVAL_DAYS } = require('../../models/StudyItemState');
const { localYmd } = require('../../utils/localTime');

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Nästa tillstånd efter ett svar.
 *   rätt    → upp en låda (ny → 1), tillbaka om 1/2/4/8/16 dagar
 *   nästan  → samma låda (minst 1), tillbaka imorgon
 *   fel     → låda 1, tillbaka direkt (dyker upp i "Repetera" och "Bara fel")
 * Rätt igen samma dag (efter ett rätt) flyttar inte upp fler lådor — tre pass
 * i rad ska inte skicka en uppgift en vecka bort första dagen.
 */
function nextState(prev, result, now = new Date()) {
  const box0 = prev?.box || 0;
  let box;
  let dueAt;
  if (result === 'correct') {
    const againToday = prev?.lastResult === 'correct' && prev.lastSeenAt && localYmd(new Date(prev.lastSeenAt)) === localYmd(now);
    box = againToday ? Math.max(1, box0) : Math.min(5, Math.max(1, box0 + 1));
    dueAt = new Date(now.getTime() + BOX_INTERVAL_DAYS[box] * DAY_MS);
  } else if (result === 'partial') {
    box = Math.max(1, box0);
    dueAt = new Date(now.getTime() + DAY_MS);
  } else {
    box = 1;
    dueAt = new Date(now.getTime());
  }
  return {
    box,
    dueAt,
    correct: (prev?.correct || 0) + (result === 'correct' ? 1 : 0),
    wrong: (prev?.wrong || 0) + (result === 'wrong' ? 1 : 0),
    lastResult: result,
    lastSeenAt: now
  };
}

function shuffle(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const isDue = (st, now) => !!st && !!st.dueAt && new Date(st.dueAt) <= now;
const isWeak = (st) => !!st && (st.lastResult === 'wrong' || (st.wrong || 0) > (st.correct || 0));

/**
 * Välj uppgifter till ett pass. `items`: kandidaterna (redan filtrerade på
 * omfång, typ och nivå). `states`: Map(itemId → StudyItemState).
 * Lägen:
 *   'due'   — bara det som är dags att repetera
 *   'wrong' — bara det eleven har missat
 *   annars  — dags att repetera → svaga → nya → resten (minst nyligen sedda)
 * Inom varje grupp blandas ordningen, så att färdigheter varvas.
 */
function pickItems(items, states, { mode = 'mixed', count = 15, now = new Date(), rng = Math.random } = {}) {
  const st = (it) => states.get(String(it._id));
  let pool;
  if (mode === 'due') {
    pool = shuffle(items.filter((it) => isDue(st(it), now)), rng);
  } else if (mode === 'wrong') {
    pool = shuffle(items.filter((it) => isWeak(st(it))), rng);
  } else {
    const due = [];
    const weak = [];
    const fresh = [];
    const rest = [];
    for (const it of items) {
      const s = st(it);
      if (!s) fresh.push(it);
      else if (isDue(s, now)) due.push(it);
      else if (isWeak(s)) weak.push(it);
      else rest.push(it);
    }
    rest.sort((a, b) => new Date(st(a).lastSeenAt || 0) - new Date(st(b).lastSeenAt || 0));
    // Nya uppgifter tas i områdets ordning (lätt → svår), de andra blandas.
    fresh.sort((a, b) => (a.number || 0) - (b.number || 0));
    pool = [...shuffle(due, rng), ...shuffle(weak, rng), ...fresh, ...rest];
  }
  return pool.slice(0, count);
}

module.exports = { nextState, pickItems, isDue, isWeak, DAY_MS };
