/**
 * "Min plugg" räknar dagar, veckor, månader och terminer i svensk tid, fast
 * servern kör i UTC — inklusive sommartidsbytena, då ett dygn har 23 eller
 * 25 timmar.
 */
const {
  tzOffsetMinutes, localYmd, parseYmd, startOfLocalDay, addDays, weekday, isoWeek, periodRange, daysBetween
} = require('./localTime');
const { splitSessionTime, effectiveStreak } = require('../services/study/activity');

describe('Swedish local time', () => {
  test('offset is +1 h in winter and +2 h in summer', () => {
    expect(tzOffsetMinutes(new Date('2026-01-15T12:00:00Z'))).toBe(60);
    expect(tzOffsetMinutes(new Date('2026-07-15T12:00:00Z'))).toBe(120);
  });

  test('a session at 23:30 Swedish time is on that day, not the UTC day', () => {
    expect(localYmd(new Date('2026-09-29T21:30:00Z'))).toBe('2026-09-29');
    expect(localYmd(new Date('2026-09-29T22:30:00Z'))).toBe('2026-09-30');
  });

  test('a local day starts at local midnight, also across the DST switches', () => {
    expect(startOfLocalDay('2026-09-29').toISOString()).toBe('2026-09-28T22:00:00.000Z');
    expect(startOfLocalDay('2026-01-15').toISOString()).toBe('2026-01-14T23:00:00.000Z');
    // 29 mars 2026: klockan ställs fram — dygnet har 23 timmar.
    expect(startOfLocalDay('2026-03-29').toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect(startOfLocalDay('2026-03-30').toISOString()).toBe('2026-03-29T22:00:00.000Z');
    // 25 oktober 2026: klockan ställs tillbaka — dygnet har 25 timmar.
    expect(startOfLocalDay('2026-10-25').toISOString()).toBe('2026-10-24T22:00:00.000Z');
    expect(startOfLocalDay('2026-10-26').toISOString()).toBe('2026-10-25T23:00:00.000Z');
  });

  test('dates are validated', () => {
    expect(parseYmd('2026-02-30')).toBeNull();
    expect(parseYmd('2026-9-1')).toBeNull();
    expect(parseYmd('2026-02-28')).toEqual({ y: 2026, m: 2, d: 28 });
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  test('weeks start on Monday and have ISO numbers, like Swedish calendars', () => {
    expect(weekday('2026-09-28')).toBe(0); // måndag
    expect(weekday('2026-10-04')).toBe(6); // söndag
    expect(isoWeek('2026-09-28')).toBe(40);
    expect(isoWeek('2027-01-01')).toBe(53); // 2026 har 53 veckor
    expect(isoWeek('2027-01-04')).toBe(1);
  });
});

describe('periods for "Min plugg"', () => {
  test('a week runs Monday to Sunday', () => {
    const r = periodRange('week', '2026-09-30');
    expect([r.start, r.end, r.prev]).toEqual(['2026-09-28', '2026-10-05', '2026-09-21']);
    expect(r.from.toISOString()).toBe('2026-09-27T22:00:00.000Z');
    expect(daysBetween(r.start, r.end)).toHaveLength(7);
  });

  test('a month and a term (VT jan–jun, HT jul–dec)', () => {
    expect(periodRange('month', '2026-02-10')).toMatchObject({ start: '2026-02-01', end: '2026-03-01', prev: '2026-01-01' });
    expect(periodRange('term', '2026-09-30')).toMatchObject({ start: '2026-07-01', end: '2027-01-01', prev: '2026-01-01' });
    expect(periodRange('term', '2027-03-01')).toMatchObject({ start: '2027-01-01', end: '2027-07-01', prev: '2026-07-01' });
  });

  test('dates far in the future or past fall back to today (audit)', () => {
    const today = localYmd();
    expect(periodRange('term', '9999-12-31').anchor).toBe(today);
    expect(periodRange('day', '0100-01-01').anchor).toBe(today);
    expect(() => periodRange('month', '9999-12-15')).not.toThrow();
  });

  test('garbage falls back to this week', () => {
    const r = periodRange('year', 'x');
    expect(r.period).toBe('week');
    expect(r.anchor).toBe(localYmd());
  });
});

describe('study time per subject', () => {
  test('split by the answers in the session', () => {
    const split = splitSessionTime({ activeSeconds: 300, subjects: ['matematik', 'fysik'] }, [
      { subject: 'matematik' }, { subject: 'matematik' }, { subject: 'fysik' }
    ]);
    expect(split).toEqual({ matematik: 200, fysik: 100 });
  });

  test('a reading session without answers is split evenly', () => {
    expect(splitSessionTime({ activeSeconds: 120, subjects: ['historia'] }, [])).toEqual({ historia: 120 });
    expect(splitSessionTime({ activeSeconds: 0, subjects: ['historia'] }, [])).toEqual({});
  });

  test('a streak that missed a day shows as broken', () => {
    const today = new Date();
    const threeDaysAgo = new Date(today.getTime() - 3 * 86400000);
    expect(effectiveStreak({ streak: { current: 4, longest: 9, lastActiveDay: today } })).toEqual({ current: 4, longest: 9 });
    expect(effectiveStreak({ streak: { current: 4, longest: 9, lastActiveDay: threeDaysAgo } })).toEqual({ current: 0, longest: 9 });
    expect(effectiveStreak(null)).toEqual({ current: 0, longest: 0 });
  });
});
