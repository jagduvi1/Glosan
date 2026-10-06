/**
 * Streak-reglerna (services/gamification.js): dagar i rad förlänger, en
 * missad dag börjar om på 1 nästa gång man övar, och det som visas är
 * streaken som den är NU — 0 efter en missad dag, fast den sparade siffran
 * räknas om först vid nästa övning. Dagar räknas i svensk tid.
 */
const { tickStreak, effectiveStreak, effectiveCoopCurrent, startOfDay } = require('./gamification');

const day = (iso) => startOfDay(new Date(iso));

describe('tickStreak', () => {
  test('days in a row extend it; the same day changes nothing; a missed day starts over at 1', () => {
    const u = { streak: { current: 0, longest: 0, lastActiveDay: null } };
    expect(tickStreak(u, day('2026-10-01T15:00:00+02:00'))).toBe('started');
    expect(tickStreak(u, day('2026-10-01T20:00:00+02:00'))).toBe('unchanged');
    expect(tickStreak(u, day('2026-10-02T07:00:00+02:00'))).toBe('continued');
    expect(tickStreak(u, day('2026-10-03T21:00:00+02:00'))).toBe('continued');
    expect([u.streak.current, u.streak.longest]).toEqual([3, 3]);
    expect(tickStreak(u, day('2026-10-05T10:00:00+02:00'))).toBe('reset'); // 4 oktober missad
    expect([u.streak.current, u.streak.longest]).toEqual([1, 3]);
  });

  test('a day is a Swedish day: 23.30 and 00.30 are two days in a row', () => {
    const u = { streak: { current: 1, longest: 1, lastActiveDay: day('2026-10-01T23:30:00+02:00') } };
    expect(tickStreak(u, day('2026-10-02T00:30:00+02:00'))).toBe('continued');
  });

  test('the switch to winter time (a 25-hour day) is still one day', () => {
    const u = { streak: { current: 4, longest: 4, lastActiveDay: day('2026-10-24T18:00:00+02:00') } };
    expect(tickStreak(u, day('2026-10-25T18:00:00+01:00'))).toBe('continued');
    expect(u.streak.current).toBe(5);
  });
});

describe('effectiveStreak — the streak as it is now', () => {
  const streak = { current: 3, longest: 5, lastActiveDay: day('2026-10-02T12:00:00+02:00') };

  test('practised today: alive and done for today', () => {
    expect(effectiveStreak(streak, new Date('2026-10-02T21:00:00+02:00'))).toEqual({ current: 3, longest: 5, today: true });
  });

  test('practised yesterday: still alive, but not done today (the grey flame)', () => {
    expect(effectiveStreak(streak, new Date('2026-10-03T08:00:00+02:00'))).toEqual({ current: 3, longest: 5, today: false });
    expect(effectiveStreak(streak, new Date('2026-10-03T23:59:00+02:00')).current).toBe(3);
  });

  test('a missed day: 0, even before it has been recounted — the best ever stays', () => {
    expect(effectiveStreak(streak, new Date('2026-10-04T00:01:00+02:00'))).toEqual({ current: 0, longest: 5, today: false });
  });

  test('never practised', () => {
    expect(effectiveStreak(null)).toEqual({ current: 0, longest: 0, today: false });
    expect(effectiveStreak({ current: 0, longest: 2, lastActiveDay: null })).toEqual({ current: 0, longest: 2, today: false });
  });
});

test('a co-op streak is 0 once you have not both practised yesterday or today', () => {
  const coop = { current: 4, lastBothActiveDay: day('2026-10-02T12:00:00+02:00') };
  expect(effectiveCoopCurrent(coop, new Date('2026-10-03T12:00:00+02:00'))).toBe(4);
  expect(effectiveCoopCurrent(coop, new Date('2026-10-04T12:00:00+02:00'))).toBe(0);
  expect(effectiveCoopCurrent({ current: 2, lastBothActiveDay: null })).toBe(0);
});
