/**
 * Byta användarnamn (services/username.js): reglerna för ett namn, veckospärren
 * och det första valet efter en Google-inloggning. User fejkas — ingen Mongo.
 */
jest.mock('../models/User', () => ({ findById: jest.fn(), exists: jest.fn() }));
const User = require('../models/User');
const { usernameProblem, normalizeUsername, nextChangeAt, changeUsername } = require('./username');

const ID = '64b000000000000000000001';
const NOW = new Date('2026-10-06T12:00:00Z');

function userDoc(fields) {
  const doc = { _id: ID, username: 'emmnil1130', needsUsername: false, usernameChangedAt: null, ...fields };
  doc.save = jest.fn(async () => doc);
  return doc;
}

describe('the rules for a username', () => {
  test('trimmed and lower case, like the model stores it', () => {
    expect(normalizeUsername('  Majken_S ')).toBe('majken_s');
    expect(normalizeUsername(42)).toBe('');
  });

  test.each([
    ['majken', null],
    ['åsa.öberg-2', null],
    ['ab', 'Minst 3 tecken.'],
    ['a'.repeat(31), 'Högst 30 tecken.'],
    ['majken s', expect.stringMatching(/inga mellanslag/)],
    ['majken🔥', expect.stringMatching(/Bara bokstäver/)],
    ['...', 'Minst en bokstav eller siffra.'],
    ['admin', expect.stringMatching(/reserverat/)],
    ['glosan', expect.stringMatching(/reserverat/)]
  ])('%s', (name, expected) => {
    expect(usernameProblem(name)).toEqual(expected);
  });
});

test('once a week: the next change is allowed 7 days after the last', () => {
  expect(nextChangeAt({ usernameChangedAt: null }, NOW)).toBeNull();
  expect(nextChangeAt({ usernameChangedAt: new Date('2026-10-01T12:00:00Z') }, NOW)).toEqual(new Date('2026-10-08T12:00:00Z'));
  expect(nextChangeAt({ usernameChangedAt: new Date('2026-09-29T11:00:00Z') }, NOW)).toBeNull();
});

describe('changeUsername', () => {
  beforeEach(() => { User.findById.mockReset(); User.exists.mockReset(); });

  test('a free, valid name is saved and starts the weekly lock', async () => {
    const doc = userDoc();
    User.findById.mockResolvedValue(doc);
    User.exists.mockResolvedValue(null);
    const r = await changeUsername(ID, ' Emma ', NOW);
    expect(r.user).toBe(doc);
    expect([doc.username, doc.usernameChangedAt, doc.needsUsername]).toEqual(['emma', NOW, false]);
    expect(User.exists).toHaveBeenCalledWith({ username: 'emma', _id: { $ne: ID } });
  });

  test('a taken name is refused, also when someone takes it at the same moment', async () => {
    User.findById.mockResolvedValue(userDoc());
    User.exists.mockResolvedValue({ _id: 'other' });
    expect(await changeUsername(ID, 'majken', NOW)).toEqual({ error: expect.stringMatching(/upptaget/), status: 409 });
    const doc = userDoc();
    doc.save = jest.fn(async () => { throw Object.assign(new Error('dup'), { code: 11000 }); });
    User.findById.mockResolvedValue(doc);
    User.exists.mockResolvedValue(null);
    expect((await changeUsername(ID, 'majken', NOW)).status).toBe(409);
  });

  test('within a week of the last change: refused with the date it is allowed again', async () => {
    User.findById.mockResolvedValue(userDoc({ usernameChangedAt: new Date('2026-10-03T12:00:00Z') }));
    const r = await changeUsername(ID, 'emma', NOW);
    expect([r.status, r.nextChangeAt]).toEqual([429, new Date('2026-10-10T12:00:00Z')]);
    expect(r.error).toMatch(/10 oktober/);
    expect(User.exists).not.toHaveBeenCalled();
  });

  test('the first choice after a Google sign-in: keeping the suggestion just confirms it, and a new name does not start the lock', async () => {
    const keep = userDoc({ needsUsername: true });
    User.findById.mockResolvedValue(keep);
    expect((await changeUsername(ID, 'EMMNIL1130', NOW)).user).toBe(keep);
    expect([keep.needsUsername, keep.usernameChangedAt]).toEqual([false, null]);

    const pick = userDoc({ needsUsername: true, usernameChangedAt: null });
    User.findById.mockResolvedValue(pick);
    User.exists.mockResolvedValue(null);
    await changeUsername(ID, 'emma', NOW);
    expect([pick.username, pick.needsUsername, pick.usernameChangedAt]).toEqual(['emma', false, null]);
  });

  test('the same name again (not the first choice) and invalid names are refused without saving', async () => {
    const doc = userDoc();
    User.findById.mockResolvedValue(doc);
    expect((await changeUsername(ID, 'emmnil1130', NOW)).status).toBe(400);
    expect((await changeUsername(ID, 'a b', NOW)).status).toBe(400);
    expect(doc.save).not.toHaveBeenCalled();
  });
});
