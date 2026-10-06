/**
 * Användarnamn (services/username.js): reglerna för ett namn, veckospärren,
 * ångra (tillbaka till det förra namnet), att ett bytt namn hålls åt sin
 * ägare, och det första valet efter en Google-inloggning. User fejkas.
 */
jest.mock('../models/User', () => ({ findById: jest.fn(), exists: jest.fn() }));
const User = require('../models/User');
const { usernameProblem, normalizeUsername, nextChangeAt, changeUsername, adminSetUsername } = require('./username');

const ID = '64b000000000000000000001';
const NOW = new Date('2026-10-06T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function userDoc(fields) {
  const doc = { _id: ID, username: 'emmnil1130', needsUsername: false, usernameChangedAt: null, previousUsername: null, ...fields };
  doc.save = jest.fn(async () => doc);
  return doc;
}

describe('the rules for a username', () => {
  test('trimmed and lower case, like the model stores it', () => {
    expect(normalizeUsername('  Majken_S ')).toBe('majken_s');
    expect(normalizeUsername(42)).toBe('');
  });

  const looksLikeGlosan = expect.stringMatching(/höra till Glosan/);
  test.each([
    ['majken', null],
    ['åsa.öberg-2', null],
    ['ab', 'Minst 3 tecken.'],
    ['a'.repeat(31), 'Högst 30 tecken.'],
    ['majken s', expect.stringMatching(/inga mellanslag/)],
    ['majken🔥', expect.stringMatching(/Bara bokstäver/)],
    ['emmа', expect.stringMatching(/Bara bokstäver/)], // kyrilliskt а som ser ut som ett a
    ['emma@skolan.se', expect.stringMatching(/Bara bokstäver/)], // inget @: inloggningen tar namn eller e-post
    ['...', 'Minst en bokstav eller siffra.'],
    ['admin', looksLikeGlosan],
    ['glosan', looksLikeGlosan],
    ['glosan-support', looksLikeGlosan],
    ['admin1', looksLikeGlosan],
    ['glosån', looksLikeGlosan],
    ['glosanteam', looksLikeGlosan],
    ['teamglosan', looksLikeGlosan],
    ['glo', looksLikeGlosan],
    ['administratör', looksLikeGlosan],
    ['administratören', looksLikeGlosan],
    ['moderatorn', looksLikeGlosan],
    ['adminen', looksLikeGlosan],
    ['admins', looksLikeGlosan],
    ['supporten', looksLikeGlosan],
    ['adminteam', looksLikeGlosan],
    ['supportteam', looksLikeGlosan],
    // Vanliga namn som bara råkar innehålla orden.
    ['badmintonlisa', null],
    ['aik.supporter', null],
    ['hammarbysupporter', null],
    ['supporters', null]
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

  test('a free, valid name is saved, starts the weekly lock and keeps the old name for its owner', async () => {
    const doc = userDoc();
    User.findById.mockResolvedValue(doc);
    User.exists.mockResolvedValue(null);
    const r = await changeUsername(ID, ' Emma ', NOW);
    expect(r.user).toBe(doc);
    expect([doc.username, doc.previousUsername, doc.usernameChangedAt, doc.needsUsername]).toEqual(['emma', 'emmnil1130', NOW, false]);
    // Upptaget = någon heter så, eller hålls namnet åt någon som just bytt bort det.
    const q = User.exists.mock.calls[0][0];
    expect(q._id).toEqual({ $ne: ID });
    expect(q.$or[0]).toEqual({ username: 'emma' });
    expect(q.$or[1].previousUsername).toBe('emma');
    expect(q.$or[1].usernameChangedAt.$gt).toEqual(new Date(NOW.getTime() - 7 * DAY));
  });

  test('a taken (or held) name is refused, also when someone takes it at the same moment', async () => {
    User.findById.mockResolvedValue(userDoc());
    User.exists.mockResolvedValue({ _id: 'other' });
    expect(await changeUsername(ID, 'majken', NOW)).toEqual({ error: expect.stringMatching(/upptaget/), status: 409 });
    const doc = userDoc();
    doc.save = jest.fn(async () => { throw Object.assign(new Error('dup'), { code: 11000 }); });
    User.findById.mockResolvedValue(doc);
    User.exists.mockResolvedValue(null);
    expect((await changeUsername(ID, 'majken', NOW)).status).toBe(409);
  });

  test('within a week of the last change: refused with when it is allowed again', async () => {
    User.findById.mockResolvedValue(userDoc({ usernameChangedAt: new Date('2026-10-03T12:00:00Z'), previousUsername: 'emmnil1130', username: 'emma' }));
    const r = await changeUsername(ID, 'emma2', NOW);
    expect([r.status, r.nextChangeAt]).toEqual([429, new Date('2026-10-10T12:00:00Z')]);
    expect(r.error).toMatch(/10 oktober/);
    expect(User.exists).not.toHaveBeenCalled();
  });

  test('undo: back to the previous name works during the lock, without extending it', async () => {
    const changedAt = new Date('2026-10-05T12:00:00Z');
    const doc = userDoc({ username: 'elak-namn', previousUsername: 'emma', usernameChangedAt: changedAt });
    User.findById.mockResolvedValue(doc);
    User.exists.mockResolvedValue(null);
    expect((await changeUsername(ID, 'Emma', NOW)).user).toBe(doc);
    expect([doc.username, doc.previousUsername, doc.usernameChangedAt]).toEqual(['emma', null, changedAt]);
  });

  test('the first choice after a Google sign-in: keeping the suggestion just confirms it, and a new name does not start the lock', async () => {
    const keep = userDoc({ needsUsername: true });
    User.findById.mockResolvedValue(keep);
    expect((await changeUsername(ID, 'EMMNIL1130', NOW)).user).toBe(keep);
    expect([keep.needsUsername, keep.usernameChangedAt]).toEqual([false, null]);

    const pick = userDoc({ needsUsername: true });
    User.findById.mockResolvedValue(pick);
    User.exists.mockResolvedValue(null);
    await changeUsername(ID, 'emma', NOW);
    expect([pick.username, pick.needsUsername, pick.usernameChangedAt, pick.previousUsername]).toEqual(['emma', false, null, null]);
  });

  test('an old name from before the rules is not held, and no undo is offered for it', async () => {
    const doc = userDoc({ username: 'majken s' }); // registrerat innan reglerna fanns
    User.findById.mockResolvedValue(doc);
    User.exists.mockResolvedValue(null);
    await changeUsername(ID, 'majken_s', NOW);
    expect([doc.username, doc.previousUsername, doc.usernameChangedAt]).toEqual(['majken_s', null, NOW]);
  });

  test('a suggestion that breaks the rules (support@…) cannot just be kept', async () => {
    const doc = userDoc({ username: 'support', needsUsername: true });
    User.findById.mockResolvedValue(doc);
    expect((await changeUsername(ID, 'support', NOW)).status).toBe(400);
    expect(doc.needsUsername).toBe(true);
  });

  test('the same name again (not the first choice) and invalid names are refused without saving', async () => {
    const doc = userDoc();
    User.findById.mockResolvedValue(doc);
    expect((await changeUsername(ID, 'emmnil1130', NOW)).status).toBe(400);
    expect((await changeUsername(ID, 'a b', NOW)).status).toBe(400);
    expect(doc.save).not.toHaveBeenCalled();
  });
});

test('admin sets a name: same rules, a fresh weekly lock and no way back to the old name', async () => {
  const doc = userDoc({ username: 'elak-namn', usernameChangedAt: new Date('2026-10-01T12:00:00Z'), previousUsername: 'emma' });
  User.findById.mockResolvedValue(doc);
  User.exists.mockResolvedValue(null);
  expect((await adminSetUsername(ID, 'admin1', NOW)).status).toBe(400);
  expect((await adminSetUsername(ID, 'Elev123', NOW)).user).toBe(doc);
  expect([doc.username, doc.previousUsername, doc.usernameChangedAt]).toEqual(['elev123', null, NOW]);
  // Den som fick namnet bytt kan inte genast välja ett nytt elakt namn.
  User.findById.mockResolvedValue(doc);
  expect((await changeUsername(ID, 'elak-igen', new Date(NOW.getTime() + DAY))).status).toBe(429);
});
