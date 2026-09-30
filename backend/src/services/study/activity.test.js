/**
 * "Min plugg" för månad och termin räknar svaren i databasen (aggregering) i
 * stället för att läsa in varje svar — en termin kan vara tiotusentals. Här
 * fejkas modellerna (sviten har ingen Mongo); plugga-fas2-e2e.mjs jämför
 * vägarna mot en riktig databas.
 */
const lean = (v) => ({ lean: async () => v, sort: () => ({ lean: async () => v }) });
jest.mock('../../models/StudySession', () => ({ find: jest.fn() }));
jest.mock('../../models/StudyAttempt', () => ({ find: jest.fn(), aggregate: jest.fn() }));
jest.mock('../../models/StudyUnit', () => ({ find: jest.fn() }));
jest.mock('../../models/StudyTestAttempt', () => ({ find: jest.fn() }));
jest.mock('../../models/XpEvent', () => ({ aggregate: jest.fn(async () => [{ xp: 70 }]) }));
jest.mock('../../models/User', () => ({ findById: jest.fn() }));

const StudySession = require('../../models/StudySession');
const StudyAttempt = require('../../models/StudyAttempt');
const StudyTestAttempt = require('../../models/StudyTestAttempt');
const User = require('../../models/User');
const { activityFor } = require('./activity');

const UID = '64b000000000000000000001';
const S1 = '64b0000000000000000000f1';

beforeEach(() => {
  StudySession.find.mockReturnValue(lean([
    { _id: S1, kind: 'practice', subjects: ['matematik', 'fysik'], activeSeconds: 600, answered: 8, startedAt: new Date('2026-09-14T15:00:00Z') }
  ]));
  StudyTestAttempt.find.mockReturnValue(lean([]));
  User.findById.mockReturnValue(lean({ streak: null }));
});

test('a term is counted from aggregated rows, not answer by answer', async () => {
  StudyAttempt.aggregate.mockResolvedValue([
    { _id: { session: S1, subject: 'matematik', result: 'correct', source: 'app', day: '2026-09-14' }, n: 5 },
    { _id: { session: S1, subject: 'matematik', result: 'wrong', source: 'app', day: '2026-09-14' }, n: 1 },
    { _id: { session: S1, subject: 'fysik', result: 'partial', source: 'paper', day: '2026-09-14' }, n: 2 }
  ]);
  const out = await activityFor(UID, { period: 'term', anchor: '2026-09-14' });

  expect(StudyAttempt.find).not.toHaveBeenCalled();
  const [{ $group }] = StudyAttempt.aggregate.mock.calls[0][0].slice(1);
  expect($group._id.day.$dateToString.timezone).toBe('Europe/Stockholm');

  expect(out.totals).toMatchObject({ answered: 8, correct: 5, wrong: 1, partial: 2, paper: 2, daysStudied: 1, xp: 70 });
  const math = out.bySubject.find((s) => s.subject === 'matematik');
  const physics = out.bySubject.find((s) => s.subject === 'fysik');
  expect(math).toMatchObject({ answered: 6, correct: 5, activeSeconds: 450 }); // 6 av 8 svar → 6/8 av tiden
  expect(physics).toMatchObject({ answered: 2, correct: 0, activeSeconds: 150 });
  expect(out.days.find((d) => d.date === '2026-09-14')).toMatchObject({ answered: 8, correct: 5, activeSeconds: 600 });
  expect(out.timeline.kind).toBe('days');
});

test('a week still loads each answer for the timeline', async () => {
  StudyAttempt.find.mockReturnValue(lean([
    { session: S1, subject: 'matematik', result: 'correct', source: 'app', itemCode: 'MA1-1', createdAt: new Date('2026-09-14T15:01:00Z') }
  ]));
  const out = await activityFor(UID, { period: 'week', anchor: '2026-09-14' });
  expect(out.totals.answered).toBe(1);
  expect(out.timeline.sessions[0].items[0].code).toBe('MA1-1');
});
