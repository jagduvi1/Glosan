// Poäng och betyg på övningsprov — rena funktioner, ingen AI.
//
// Som på de nationella proven ger varje fråga poäng på nivåerna E, C och A,
// t.ex. (1/1/0) = en E-poäng och en C-poäng. Betyget uppskattas med
// betygsgränser: totalt antal poäng, varav så många på C- eller A-nivå (för
// D/C) och på A-nivå (för B/A). Det är en UPPSKATTNING — läraren sätter betyg.

const LEVELS = ['E', 'C', 'A'];
const GRADES = ['A', 'B', 'C', 'D', 'E']; // högst först
const ZERO = Object.freeze({ E: 0, C: 0, A: 0 });

const withTotal = (p) => ({ E: p.E || 0, C: p.C || 0, A: p.A || 0, total: (p.E || 0) + (p.C || 0) + (p.A || 0) });

function sumPoints(list) {
  const out = { E: 0, C: 0, A: 0 };
  for (const p of list) for (const l of LEVELS) out[l] += p?.[l] || 0;
  return withTotal(out);
}

/** Standardpoäng för en fråga: 1 poäng på frågans nivå. */
function defaultPoints(level) {
  return { ...ZERO, [LEVELS.includes(level) ? level : 'E']: 1 };
}

/**
 * Poäng för ett automatiskt eller AI-bedömt resultat.
 *   rätt  → alla frågans poäng
 *   fel   → inga
 *   delvis → poängen på alla nivåer UTOM den högsta frågan ger poäng på —
 *            "rätt metod men ett slarvfel ger E-poängen". Ger frågan bara
 *            poäng på en nivå blir det hälften (avrundat nedåt) av dem.
 */
function pointsForResult(max, result) {
  if (result === 'correct') return { E: max.E, C: max.C, A: max.A };
  if (result !== 'partial') return { ...ZERO };
  const scored = LEVELS.filter((l) => max[l] > 0);
  if (scored.length <= 1) {
    const l = scored[0] || 'E';
    return { ...ZERO, [l]: Math.floor((max[l] || 0) / 2) };
  }
  const top = scored[scored.length - 1];
  return { E: top === 'E' ? 0 : max.E, C: top === 'C' ? 0 : max.C, A: 0 };
}

/**
 * Självbedömd öppen fråga: eleven väljer vilken nivå svaret når (enkla /
 * utvecklade / välutvecklade resonemang) och får frågans poäng upp till den
 * nivån. 'none' = inget av det.
 */
function pointsForSelfLevel(max, level) {
  const upto = { none: 0, E: 1, C: 2, A: 3 }[level] ?? 0;
  return { E: upto >= 1 ? max.E : 0, C: upto >= 2 ? max.C : 0, A: upto >= 3 ? max.A : 0 };
}

function resultFromPoints(earned, max) {
  const e = withTotal(earned).total;
  const m = withTotal(max).total;
  if (m > 0 && e >= m) return 'correct';
  return e > 0 ? 'partial' : 'wrong';
}

/** Begränsa AI:ns poäng till frågans max per nivå. */
function clampPoints(given, max) {
  const out = {};
  for (const l of LEVELS) out[l] = Math.max(0, Math.min(Math.floor(Number(given?.[l]) || 0), max[l] || 0));
  return out;
}

// Andel av maxpoängen som krävs, ungefär som på de nationella proven i
// matematik åk 9 (E ≈ 28 % av totalen; C ≈ 58 % varav 39 % av C+A-poängen;
// A ≈ 82 % varav 63 % av A-poängen). D och B ligger mellan.
const DEFAULT_SHARES = {
  E: { total: 0.28 },
  D: { total: 0.46, cOrA: 0.25 },
  C: { total: 0.58, cOrA: 0.39 },
  B: { total: 0.72, a: 0.42 },
  A: { total: 0.82, a: 0.63 }
};

function defaultGradeLimits(max) {
  const m = withTotal(max);
  const cOrAMax = m.C + m.A;
  const out = {};
  for (const [g, s] of Object.entries(DEFAULT_SHARES)) {
    out[g] = {
      total: Math.max(1, Math.ceil((s.total || 0) * m.total)),
      cOrA: Math.ceil((s.cOrA || 0) * cOrAMax),
      a: Math.ceil((s.a || 0) * m.A)
    };
  }
  return out;
}

/**
 * Betygsgränser från AI:n (t.ex. bokens eller lärarens: "E: 8 poäng, C: 14
 * varav 4 på C/A, A: 19 varav 3 på A"). Det som saknas fylls från
 * standardgränserna; D och B läggs mitt emellan.
 */
function gradeLimitsFrom(input, max) {
  const lim = defaultGradeLimits(max);
  if (!input) return lim;
  const m = withTotal(max);
  const set = (g, v) => {
    if (!v) return;
    lim[g] = {
      total: Math.min(m.total, Math.max(0, Math.floor(v.total ?? lim[g].total))),
      cOrA: Math.min(m.C + m.A, Math.max(0, Math.floor(v.cOrA ?? v.c_or_a ?? lim[g].cOrA))),
      a: Math.min(m.A, Math.max(0, Math.floor(v.a ?? lim[g].a)))
    };
  };
  set('E', input.E);
  set('C', input.C);
  set('A', input.A);
  const mid = (x, y) => Math.ceil((x + y) / 2);
  lim.D = { total: mid(lim.E.total, lim.C.total), cOrA: mid(lim.E.cOrA, lim.C.cOrA), a: 0 };
  lim.B = { total: mid(lim.C.total, lim.A.total), cOrA: lim.C.cOrA, a: mid(lim.C.a, lim.A.a) };
  return lim;
}

/**
 * Uppskattat betyg. Ett prov utan A-frågor kan inte visa A-kunskaper (högst
 * C), ett prov med bara E-frågor högst E.
 */
function estimateGrade(score, max, limits) {
  const s = withTotal(score);
  const m = withTotal(max);
  const reachable = { A: m.A > 0, B: m.A > 0, C: m.C + m.A > 0, D: m.C + m.A > 0, E: true };
  for (const g of GRADES) {
    if (!reachable[g]) continue;
    const l = limits[g];
    if (s.total >= l.total && s.C + s.A >= (l.cOrA || 0) && s.A >= (l.a || 0)) return g;
  }
  return 'F';
}

module.exports = {
  LEVELS, GRADES, sumPoints, withTotal, defaultPoints, pointsForResult, pointsForSelfLevel, resultFromPoints,
  clampPoints, defaultGradeLimits, gradeLimitsFrom, estimateGrade
};
