/**
 * Spaced repetition och passurval i Plugga.
 */
const { nextState, pickItems, DAY_MS } = require('./scheduler');
const { tickStreak, startOfDay, subjectXpTotal } = require('../gamification');

const NOW = new Date('2026-10-05T10:00:00Z');

describe('nextState (Leitner)', () => {
  test('a new item answered right goes to box 1, due tomorrow', () => {
    const s = nextState(null, 'correct', NOW);
    expect(s).toMatchObject({ box: 1, correct: 1, wrong: 0, lastResult: 'correct' });
    expect(s.dueAt.getTime() - NOW.getTime()).toBe(DAY_MS);
  });

  test('right answers climb the boxes with growing intervals, capped at box 5', () => {
    let s = null;
    let at = NOW;
    const days = [];
    for (let i = 0; i < 7; i++) {
      s = nextState(s, 'correct', at);
      days.push(Math.round((s.dueAt - at) / DAY_MS));
      at = s.dueAt; // svarar när den är dags igen
    }
    expect(days).toEqual([1, 2, 4, 8, 16, 16, 16]);
    expect(s.box).toBe(5);
  });

  test('right again the same day does not climb further (audit)', () => {
    let s = nextState(null, 'correct', NOW);
    s = nextState(s, 'correct', new Date(NOW.getTime() + 60 * 60 * 1000));
    s = nextState(s, 'correct', new Date(NOW.getTime() + 2 * 60 * 60 * 1000));
    expect(s).toMatchObject({ box: 1, correct: 3 });
    // Efter ett fel samma dag får ett rätt klättra som vanligt.
    const afterWrong = nextState({ box: 1, lastResult: 'wrong', lastSeenAt: NOW }, 'correct', NOW);
    expect(afterWrong.box).toBe(2);
    // Nästa dag klättrar den igen.
    expect(nextState(s, 'correct', new Date(NOW.getTime() + DAY_MS)).box).toBe(2);
  });

  test('a wrong answer drops to box 1 and is due immediately', () => {
    const s = nextState({ box: 4, correct: 5, wrong: 0 }, 'wrong', NOW);
    expect(s).toMatchObject({ box: 1, correct: 5, wrong: 1, lastResult: 'wrong' });
    expect(s.dueAt.getTime()).toBe(NOW.getTime());
  });

  test('"nearly" keeps the box and comes back tomorrow', () => {
    const s = nextState({ box: 3, correct: 2, wrong: 1 }, 'partial', NOW);
    expect(s).toMatchObject({ box: 3, correct: 2, wrong: 1, lastResult: 'partial' });
    expect(s.dueAt.getTime() - NOW.getTime()).toBe(DAY_MS);
  });
});

describe('pickItems', () => {
  const item = (id, number) => ({ _id: id, number });
  const items = [item('new1', 1), item('new2', 2), item('due', 3), item('weak', 4), item('fine', 5)];
  const states = new Map([
    ['due', { box: 2, dueAt: new Date(NOW - 1000), lastSeenAt: new Date(NOW - 3 * DAY_MS), correct: 2, wrong: 0 }],
    ['weak', { box: 1, dueAt: new Date(NOW.getTime() + DAY_MS), lastResult: 'wrong', correct: 0, wrong: 2, lastSeenAt: new Date(NOW - DAY_MS) }],
    ['fine', { box: 4, dueAt: new Date(NOW.getTime() + 5 * DAY_MS), lastResult: 'correct', correct: 4, wrong: 0, lastSeenAt: new Date(NOW - 2 * DAY_MS) }]
  ]);
  const rng = () => 0.42;

  test('mixed: due first, then weak, then new in book order, then the rest', () => {
    const ids = pickItems(items, states, { now: NOW, rng }).map((i) => i._id);
    expect(ids).toEqual(['due', 'weak', 'new1', 'new2', 'fine']);
  });

  test('count limits the session', () => {
    expect(pickItems(items, states, { now: NOW, rng, count: 2 }).map((i) => i._id)).toEqual(['due', 'weak']);
  });

  test('"due" mode only returns what is due; "wrong" only what was missed', () => {
    expect(pickItems(items, states, { mode: 'due', now: NOW, rng }).map((i) => i._id)).toEqual(['due']);
    expect(pickItems(items, states, { mode: 'wrong', now: NOW, rng }).map((i) => i._id)).toEqual(['weak']);
  });
});

describe('streak (shared by vocabulary quizzes and Plugga)', () => {
  const day = (s) => startOfDay(new Date(s));

  test('starts, continues, is unchanged the same day, resets after a gap', () => {
    const u = { streak: { current: 0, longest: 0, lastActiveDay: null } };
    expect(tickStreak(u, day('2026-10-01T12:00:00Z'))).toBe('started');
    expect(tickStreak(u, day('2026-10-01T18:00:00Z'))).toBe('unchanged');
    expect(tickStreak(u, day('2026-10-02T09:00:00Z'))).toBe('continued');
    expect(u.streak).toMatchObject({ current: 2, longest: 2 });
    expect(tickStreak(u, day('2026-10-05T09:00:00Z'))).toBe('reset');
    expect(u.streak).toMatchObject({ current: 1, longest: 2 });
  });

  test('days are Swedish days: 23.30 and 00.30 are two days in a row (audit)', () => {
    const u = { streak: { current: 0, longest: 0, lastActiveDay: null } };
    // Sommartid (UTC+2): båda ligger på samma UTC-dygn, men på två svenska.
    expect(tickStreak(u, day('2026-09-29T21:30:00Z'))).toBe('started');
    expect(tickStreak(u, day('2026-09-29T22:30:00Z'))).toBe('continued');
    expect(tickStreak(u, day('2026-09-30T21:59:00Z'))).toBe('unchanged');
  });

  test('the 25-hour day when summer time ends is still one day', () => {
    const u = { streak: { current: 0, longest: 0, lastActiveDay: null } };
    expect(tickStreak(u, day('2026-10-24T10:00:00Z'))).toBe('started');
    expect(tickStreak(u, day('2026-10-25T22:30:00Z'))).toBe('continued'); // 23.30 vintertid
    expect(tickStreak(u, day('2026-10-26T10:00:00Z'))).toBe('continued');
  });

  test('streak days stored at UTC midnight before the fix still line up', () => {
    const u = { streak: { current: 3, longest: 3, lastActiveDay: new Date('2026-09-29T00:00:00Z') } };
    expect(tickStreak(u, day('2026-09-30T08:00:00Z'))).toBe('continued');
    const v = { streak: { current: 3, longest: 3, lastActiveDay: new Date('2026-09-30T00:00:00Z') } };
    expect(tickStreak(v, day('2026-09-30T08:00:00Z'))).toBe('unchanged');
  });

  test('subject XP total ignores junk', () => {
    expect(subjectXpTotal({ subjectXp: { matematik: 30, historia: '20', x: 'nope' } })).toBe(50);
    expect(subjectXpTotal({})).toBe(0);
  });
});
