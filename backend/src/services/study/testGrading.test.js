/**
 * Poäng och uppskattat betyg på övningsprov — som på de nationella proven:
 * poäng per nivå E/C/A och betygsgränser med krav på poäng på C/A- och A-nivå.
 */
const G = require('./testGrading');

describe('points per question', () => {
  test('default: 1 point on the question\'s level', () => {
    expect(G.defaultPoints('C')).toEqual({ E: 0, C: 1, A: 0 });
    expect(G.defaultPoints(null)).toEqual({ E: 1, C: 0, A: 0 });
  });

  test('right gives all, wrong none', () => {
    expect(G.pointsForResult({ E: 1, C: 1, A: 0 }, 'correct')).toEqual({ E: 1, C: 1, A: 0 });
    expect(G.pointsForResult({ E: 1, C: 1, A: 0 }, 'wrong')).toEqual({ E: 0, C: 0, A: 0 });
  });

  test('partly right keeps everything below the highest level', () => {
    expect(G.pointsForResult({ E: 1, C: 1, A: 0 }, 'partial')).toEqual({ E: 1, C: 0, A: 0 });
    expect(G.pointsForResult({ E: 1, C: 1, A: 1 }, 'partial')).toEqual({ E: 1, C: 1, A: 0 });
    // bara en nivå: hälften, avrundat nedåt
    expect(G.pointsForResult({ E: 0, C: 2, A: 0 }, 'partial')).toEqual({ E: 0, C: 1, A: 0 });
    expect(G.pointsForResult({ E: 0, C: 0, A: 1 }, 'partial')).toEqual({ E: 0, C: 0, A: 0 });
  });

  test('a self-assessed open answer earns the points up to the level it reached', () => {
    const max = { E: 1, C: 1, A: 1 };
    expect(G.pointsForSelfLevel(max, 'none')).toEqual({ E: 0, C: 0, A: 0 });
    expect(G.pointsForSelfLevel(max, 'E')).toEqual({ E: 1, C: 0, A: 0 });
    expect(G.pointsForSelfLevel(max, 'C')).toEqual({ E: 1, C: 1, A: 0 });
    expect(G.pointsForSelfLevel(max, 'A')).toEqual({ E: 1, C: 1, A: 1 });
    expect(G.pointsForSelfLevel({ E: 0, C: 0, A: 2 }, 'C')).toEqual({ E: 0, C: 0, A: 0 });
  });

  test('result from points', () => {
    expect(G.resultFromPoints({ E: 1, C: 1, A: 0 }, { E: 1, C: 1, A: 0 })).toBe('correct');
    expect(G.resultFromPoints({ E: 1, C: 0, A: 0 }, { E: 1, C: 1, A: 0 })).toBe('partial');
    expect(G.resultFromPoints({ E: 0, C: 0, A: 0 }, { E: 1, C: 1, A: 0 })).toBe('wrong');
  });

  test('the AI can never give more than the question is worth', () => {
    expect(G.clampPoints({ E: 5, C: -1, A: 1.7 }, { E: 1, C: 1, A: 1 })).toEqual({ E: 1, C: 0, A: 1 });
    expect(G.clampPoints(undefined, { E: 1, C: 0, A: 0 })).toEqual({ E: 0, C: 0, A: 0 });
  });
});

describe('estimated grade', () => {
  // Ungefär som ett nationellt prov i matte åk 9: 28 E-, 25 C- och 19 A-poäng.
  const max = { E: 28, C: 25, A: 19 };
  const limits = G.defaultGradeLimits(max);

  test('default limits follow the national tests\' proportions', () => {
    expect(limits.E).toEqual({ total: 21, cOrA: 0, a: 0 });
    expect(limits.C).toEqual({ total: 42, cOrA: 18, a: 0 });
    expect(limits.A).toEqual({ total: 60, cOrA: 0, a: 12 });
  });

  test('from F to A', () => {
    expect(G.estimateGrade({ E: 10, C: 2, A: 0 }, max, limits)).toBe('F');
    expect(G.estimateGrade({ E: 24, C: 2, A: 0 }, max, limits)).toBe('E');
    expect(G.estimateGrade({ E: 26, C: 12, A: 0 }, max, limits)).toBe('D');
    expect(G.estimateGrade({ E: 27, C: 16, A: 3 }, max, limits)).toBe('C');
    expect(G.estimateGrade({ E: 28, C: 20, A: 9 }, max, limits)).toBe('B');
    expect(G.estimateGrade({ E: 28, C: 24, A: 14 }, max, limits)).toBe('A');
  });

  test('lots of easy points alone never reach C', () => {
    expect(G.estimateGrade({ E: 28, C: 14, A: 0 }, max, limits)).not.toBe('C');
  });

  test('a test without A questions can at most show C; only E questions at most E', () => {
    const noA = { E: 6, C: 4, A: 0 };
    expect(G.estimateGrade(noA, noA, G.defaultGradeLimits(noA))).toBe('C');
    const onlyE = { E: 8, C: 0, A: 0 };
    expect(G.estimateGrade(onlyE, onlyE, G.defaultGradeLimits(onlyE))).toBe('E');
  });

  test('limits from the book or teacher, with D and B in between', () => {
    const m = { E: 10, C: 8, A: 5 };
    const l = G.gradeLimitsFrom({ E: { total: 8 }, C: { total: 14, c_or_a: 4 }, A: { total: 19, a: 3 } }, m);
    expect(l.E).toEqual({ total: 8, cOrA: 0, a: 0 });
    expect(l.C).toEqual({ total: 14, cOrA: 4, a: 0 });
    expect(l.A).toEqual({ total: 19, cOrA: 0, a: 3 });
    expect(l.D).toEqual({ total: 11, cOrA: 2, a: 0 });
    expect(l.B).toEqual({ total: 17, cOrA: 4, a: 2 });
    // orimliga gränser kapas till provets max
    expect(G.gradeLimitsFrom({ E: { total: 99 } }, m).E.total).toBe(23);
  });
});

describe('scaleLimits (audit)', () => {
  const base = { E: 10, C: 8, A: 6 };
  const limits = G.gradeLimitsFrom({ E: { total: 8 }, C: { total: 14, c_or_a: 4 }, A: { total: 19, a: 3 } }, base);

  test('unchanged when no question was removed', () => {
    expect(G.scaleLimits(limits, base, base)).toEqual(limits);
  });

  test('scaled down with the max when questions are removed, so A stays reachable', () => {
    const now = { E: 10, C: 8, A: 3 }; // hälften av A-frågorna borttagna
    const l = G.scaleLimits(limits, base, now);
    expect(l.A.a).toBe(2); // 3 · 3/6 = 1,5 → 2
    expect(l.A.total).toBeLessThanOrEqual(21);
    expect(G.estimateGrade(now, now, l)).toBe('A');
    // utan skalning var A-gränsen 19 av 21 med 3 A-poäng — nåbar, men E-gränsen följer också med
    expect(l.E.total).toBe(Math.ceil(8 * 21 / 24));
  });

  test('without baseMax the limits are only capped at the max', () => {
    const l = G.scaleLimits(limits, undefined, { E: 5, C: 2, A: 1 });
    expect(l.A).toEqual({ total: 8, cOrA: 0, a: 1 });
    expect(l.E.total).toBe(8);
  });
});
