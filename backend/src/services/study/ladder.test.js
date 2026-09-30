/**
 * Nivåstegen: börja på rätt nivå, 3 rätt i rad → upp, 2 fel i rad → ner,
 * "nästan" står still, och tar en nivå slut går stegen till närmaste nivå.
 */
const { startLevel, ladderStep, pickNext } = require('./ladder');

const item = (id, level) => ({ _id: id, level });

describe('where the ladder starts', () => {
  const items = [item('e1', 'E'), item('e2', 'E'), item('e3', 'E'), item('c1', 'C'), item('c2', 'C'), item('a1', 'A')];

  test('a new student starts at E', () => {
    expect(startLevel(items, new Map())).toBe('E');
  });

  test('once 70 % of E sits, start at C; when C sits too, at A', () => {
    const sits = (ids) => new Map(ids.map((id) => [id, { box: 3 }]));
    expect(startLevel(items, sits(['e1', 'e2']))).toBe('E'); // 67 %
    expect(startLevel(items, sits(['e1', 'e2', 'e3']))).toBe('C');
    expect(startLevel(items, sits(['e1', 'e2', 'e3', 'c1', 'c2']))).toBe('A');
    expect(startLevel(items, sits(['e1', 'e2', 'e3', 'c1', 'c2', 'a1']))).toBe('A');
  });

  test('levels without exercises are skipped', () => {
    expect(startLevel([item('c1', 'C'), item('a1', 'A')], new Map())).toBe('C');
    expect(startLevel([], new Map())).toBeNull();
  });
});

describe('climbing', () => {
  const levels = ['E', 'C', 'A'];
  const climb = (results, start = 'E', lv = levels) => results.reduce((st, r) => ladderStep(st, r, lv), { level: start, reached: start });

  test('three right in a row steps up', () => {
    expect(climb(['correct', 'correct'])).toMatchObject({ level: 'E', up: 2, moved: null });
    expect(climb(['correct', 'correct', 'correct'])).toMatchObject({ level: 'C', up: 0, moved: 'up', reached: 'C' });
  });

  test('a miss resets the streak; two in a row step down', () => {
    expect(climb(['correct', 'correct', 'wrong', 'correct'], 'C')).toMatchObject({ level: 'C', up: 1 });
    expect(climb(['wrong', 'wrong'], 'C')).toMatchObject({ level: 'E', moved: 'down', reached: 'C' });
  });

  test('"nearly" stands still', () => {
    expect(climb(['correct', 'correct', 'partial', 'correct'])).toMatchObject({ level: 'E', up: 1 });
  });

  test('never above the top or below the bottom, and only to levels that exist', () => {
    expect(climb(['correct', 'correct', 'correct'], 'A')).toMatchObject({ level: 'A', moved: null });
    expect(climb(['wrong', 'wrong'], 'E')).toMatchObject({ level: 'E', moved: null });
    expect(climb(['correct', 'correct', 'correct'], 'E', ['E', 'A'])).toMatchObject({ level: 'A', moved: 'up' });
  });
});

describe('picking the next exercise', () => {
  const pools = { E: ['e1', 'e2'], C: ['c1'], A: ['a1'] };

  test('from the current level, in order, skipping what was shown', () => {
    expect(pickNext(pools, [], 'E')).toEqual({ itemId: 'e1', level: 'E' });
    expect(pickNext(pools, ['e1'], 'E')).toEqual({ itemId: 'e2', level: 'E' });
  });

  test('an empty level moves to the nearest one with exercises left (up before down)', () => {
    expect(pickNext(pools, ['e1', 'e2'], 'E')).toEqual({ itemId: 'c1', level: 'C' });
    expect(pickNext(pools, ['c1'], 'C')).toEqual({ itemId: 'a1', level: 'A' });
    expect(pickNext(pools, ['c1', 'a1'], 'C')).toEqual({ itemId: 'e1', level: 'E' });
    expect(pickNext(pools, ['e1', 'e2', 'c1', 'a1'], 'A')).toBeNull();
  });
});
