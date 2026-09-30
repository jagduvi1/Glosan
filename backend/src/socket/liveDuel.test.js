/**
 * Live-duellen utan Mongo och utan nätverk: en falsk io/socket och en falsk
 * Duel-modell. Låser fast det som tog ner servern — trasiga meddelanden,
 * ett sent andra svar som startade en extra runda, ett upprepat "redo", en
 * timer som levde kvar efter sista frågan — och att "a/b a/b …" inte längre
 * räknar ut alla kombinationer.
 */
jest.mock('../models/Duel', () => ({ findById: jest.fn() }));
const Duel = require('../models/Duel');
const { registerLiveDuel, answerMatches, _games } = require('./liveDuel');

const DUEL = '64b0000000000000000000d1';
const A = '64b0000000000000000000a1';
const B = '64b0000000000000000000b1';

function duelDoc(questions) {
  return {
    _id: DUEL,
    kind: 'live',
    reversed: false,
    questions,
    participants: [A, B].map((id) => ({ user: { toString: () => id }, status: 'pending' })),
    save: jest.fn(async () => {})
  };
}

// findById(...) används både med await och med .populate().lean().
function query(doc) {
  const p = Promise.resolve(doc);
  return {
    then: (ok, fail) => p.then(ok, fail),
    populate: () => ({ lean: async () => ({ participants: doc.participants.map((x) => ({ user: { _id: x.user.toString(), username: 'u', avatar: null } })) }) })
  };
}

function setup(doc) {
  Duel.findById.mockImplementation(() => query(doc));
  const emitted = [];
  let onConnection = null;
  const io = {
    on: (ev, fn) => { if (ev === 'connection') onConnection = fn; },
    to: (room) => ({ emit: (ev, data) => emitted.push({ room, ev, data }) })
  };
  registerLiveDuel(io);
  const connect = (userId) => {
    const handlers = {};
    const socket = {
      id: `s-${userId}-${++socketSeq}`, // varje anslutning sitt eget id, som i Socket.IO
      user: { id: userId },
      data: {},
      own: [],
      on: (ev, fn) => { handlers[ev] = fn; },
      emit: (ev, data) => socket.own.push({ ev, data }),
      join: () => {}
    };
    onConnection(socket);
    return { socket, fire: (ev, payload) => handlers[ev](payload) };
  };
  return { emitted, connect };
}

let socketSeq = 0;
const flush = () => new Promise((r) => setImmediate(r));
const count = (emitted, ev) => emitted.filter((e) => e.ev === ev).length;

beforeEach(() => {
  // Date får gå på riktigt: tidsmätningen i 2^50-testet måste kunna slå till.
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'Date'] });
  _games.clear();
});
afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

describe('answerMatches', () => {
  test('slash alternatives per word, case and spacing ignored', () => {
    expect(answerMatches('mycket gullig', 'mycket söt/gullig')).toBe(true);
    expect(answerMatches('  Den   var ', 'den/det är/var')).toBe(true);
    expect(answerMatches('söt', 'mycket söt/gullig')).toBe(false);
    expect(answerMatches(12, 'häst')).toBe(false);
    expect(answerMatches(undefined, 'häst')).toBe(false);
  });

  test('"a/b a/b …" is checked word by word, not by listing 2^50 combinations', () => {
    const word = Array.from({ length: 50 }, () => 'a/b').join(' ');
    const t0 = Date.now();
    expect(answerMatches(Array.from({ length: 50 }, () => 'b').join(' '), word)).toBe(true);
    expect(Date.now() - t0).toBeLessThan(200);
  });
});

describe('the live duel', () => {
  test('malformed messages are ignored instead of taking down the process', async () => {
    const { connect } = setup(duelDoc([{ source: 'häst', target: 'horse' }]));
    const a = connect(A);
    for (const bad of [undefined, null, 12, 'x', { duelId: 12 }, { duelId: { $gt: '' } }]) {
      expect(() => a.fire('live:join', bad)).not.toThrow();
    }
    for (const bad of [undefined, null, { index: 0 }, { index: 'x', given: 'a' }, { index: 0, given: 7 }, { index: 0, given: 'x'.repeat(500) }]) {
      expect(() => a.fire('live:answer', bad)).not.toThrow();
    }
    await flush();
    expect(Duel.findById).not.toHaveBeenCalled();
  });

  test('one point and one advance per round, even when both answer right at once; the game ends once', async () => {
    const doc = duelDoc([{ source: 'häst', target: 'horse' }, { source: 'hund', target: 'dog' }]);
    const { emitted, connect } = setup(doc);
    const a = connect(A);
    const b = connect(B);
    a.fire('live:join', { duelId: DUEL });
    b.fire('live:join', { duelId: DUEL });
    await flush();
    a.fire('live:ready');
    b.fire('live:ready');
    b.fire('live:ready'); // ett upprepat "redo" under nedräkningen startar inte om matchen
    expect(count(emitted, 'live:start')).toBe(1);
    jest.advanceTimersByTime(1000);
    expect(count(emitted, 'live:round')).toBe(1);

    a.fire('live:answer', { index: 0, given: 'horse' });
    b.fire('live:answer', { index: 0, given: 'horse' }); // 200 ms senare — rundan är redan avgjord
    expect(count(emitted, 'live:round-result')).toBe(1);
    const result = emitted.find((e) => e.ev === 'live:round-result').data;
    expect(result.scores.find((s) => s.userId === A).score).toBe(1);
    expect(result.scores.find((s) => s.userId === B).score).toBe(0);

    jest.advanceTimersByTime(1500);
    expect(count(emitted, 'live:round')).toBe(2);
    b.fire('live:answer', { index: 1, given: 'dog' });
    jest.advanceTimersByTime(1500);
    await flush();
    expect(count(emitted, 'live:game-over')).toBe(1);
    expect(doc.save).toHaveBeenCalledTimes(1);

    // Inget kvar som kan slå till efter sista frågan (förut: en 15 s-timer som kraschade).
    expect(() => jest.advanceTimersByTime(60000)).not.toThrow();
    await flush();
    expect(count(emitted, 'live:game-over')).toBe(1);
    expect(count(emitted, 'live:round')).toBe(2);
  });

  test('when both leave, the game and its timers are gone — a rejoin starts one clean game', async () => {
    const doc = duelDoc([{ source: 'häst', target: 'horse' }, { source: 'hund', target: 'dog' }]);
    const { emitted, connect } = setup(doc);
    const a = connect(A);
    const b = connect(B);
    a.fire('live:join', { duelId: DUEL });
    b.fire('live:join', { duelId: DUEL });
    await flush();
    a.fire('live:ready');
    b.fire('live:ready');
    jest.advanceTimersByTime(1000);
    a.fire('live:answer', { index: 0, given: 'horse' }); // pausen mellan rundorna börjar
    a.fire('disconnect');
    b.fire('disconnect');
    expect(_games.size).toBe(0);
    const rounds = count(emitted, 'live:round');
    jest.advanceTimersByTime(60000); // den gamla matchens timers får inte fortsätta
    expect(count(emitted, 'live:round')).toBe(rounds);
    expect(count(emitted, 'live:game-over')).toBe(0);
  });

  test('a finished duel cannot be joined and replayed', async () => {
    const doc = duelDoc([{ source: 'häst', target: 'horse' }]);
    doc.participants.forEach((p) => { p.status = 'completed'; });
    const { connect } = setup(doc);
    const a = connect(A);
    a.fire('live:join', { duelId: DUEL });
    await flush();
    expect(a.socket.own).toContainEqual({ ev: 'live:error', data: 'Duellen är redan klar' });
    expect(_games.size).toBe(0);
  });
});

describe('reconnects and leaving', () => {
  async function started(questions) {
    const doc = duelDoc(questions);
    const env = setup(doc);
    const a = env.connect(A);
    const b = env.connect(B);
    a.fire('live:join', { duelId: DUEL });
    b.fire('live:join', { duelId: DUEL });
    await flush();
    a.fire('live:ready');
    b.fire('live:ready');
    jest.advanceTimersByTime(1000);
    return { ...env, a, b };
  }

  test('the old connection closing after a reconnect does not drop the player', async () => {
    const { emitted, connect, b } = await started([{ source: 'häst', target: 'horse' }]);
    const b2 = connect(B); // wifi → 4G: ny anslutning innan den gamla stängts
    b2.fire('live:join', { duelId: DUEL });
    await flush();
    b.fire('disconnect'); // den gamla anslutningen stängs sent
    expect(emitted.filter((e) => e.ev === 'live:opponent-left')).toHaveLength(0);
    expect(_games.get(DUEL).players.get(B)).toBe(b2.socket.id);
  });

  test('when everyone still there has answered wrong, the round moves on at once', async () => {
    const { emitted, a, b } = await started([{ source: 'häst', target: 'horse' }, { source: 'hund', target: 'dog' }]);
    a.fire('live:answer', { index: 0, given: 'cat' });
    a.fire('disconnect');
    b.fire('live:answer', { index: 0, given: 'cow' });
    expect(emitted.filter((e) => e.ev === 'live:round-result')).toHaveLength(1); // inte först efter 15 s
  });
});
