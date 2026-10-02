/**
 * Dela vidare: vem som delade med vem, vem som får se och ta bort vem, och
 * vilka som syns för varandra (veckans rekord). Ren logik — ingen Mongo.
 */
jest.mock('../models/User', () => ({ find: jest.fn() }));

const User = require('../models/User');
const { sharerOf, canRemove, circleOf, visibleRecipients } = require('./sharedVia');
const { canEditWords, listForViewer } = require('./listSharing');

const A = '64b000000000000000000001'; // skaparen
const B = '64b000000000000000000002'; // fick av A, delade vidare till D
const C = '64b000000000000000000003'; // fick av A (äldre delning, ingen rad)
const D = '64b000000000000000000004'; // fick av B
const E = '64b000000000000000000005'; // fick av D

const doc = {
  user: A,
  sharedWith: [B, C, D, E],
  sharedVia: [{ user: B, by: A }, { user: D, by: B }, { user: E, by: D }],
  shareMode: 'edit'
};

test('the sharer is the one who added you — the creator when there is no row', () => {
  expect(sharerOf(doc, B)).toBe(A);
  expect(sharerOf(doc, C)).toBe(A);
  expect(sharerOf(doc, D)).toBe(B);
  expect(sharerOf(doc, E)).toBe(D);
});

test('the creator removes anyone; others only the people they added', () => {
  expect(canRemove(doc, A, E)).toBe(true);
  expect(canRemove(doc, B, D)).toBe(true);
  expect(canRemove(doc, B, E)).toBe(false); // E fick av D
  expect(canRemove(doc, D, B)).toBe(false);
  expect(canRemove(doc, C, B)).toBe(false);
});

test('you see your sharer, the others they shared with and your own — never the chain beyond', () => {
  expect(circleOf(doc, A).sort()).toEqual([A, B, C, D, E].sort());
  expect(circleOf(doc, B).sort()).toEqual([A, B, C, D].sort());
  // D fick av B: ser B och E (som D delade med) — inte skaparen A, inte C.
  expect(circleOf(doc, D).sort()).toEqual([B, D, E].sort());
  expect(circleOf(doc, E).sort()).toEqual([D, E].sort());
});

test('only people the owner shared with may edit words', () => {
  expect(canEditWords(doc, A)).toBe(true);
  expect(canEditWords(doc, B)).toBe(true);
  expect(canEditWords(doc, C)).toBe(true);
  expect(canEditWords(doc, D)).toBe(false);
  expect(canEditWords({ ...doc, shareMode: 'read' }, B)).toBe(false);
  expect(canEditWords(doc, '64b0000000000000000000ff')).toBe(false); // har inte listan
});

test('a recipient never sees who else has a list, and gets their own mode', () => {
  const seen = listForViewer({ ...doc, title: 'Fruits' }, D);
  expect(seen.sharedWith).toBeUndefined();
  expect(seen.sharedVia).toBeUndefined();
  expect(seen.shareMode).toBe('read');
  expect(listForViewer(doc, B).shareMode).toBe('edit');
  expect(listForViewer(doc, A).sharedWith).toHaveLength(4);
});

test('the creator sees everyone with via; a re-sharer sees only their own adds', async () => {
  const names = { [A]: 'anna', [B]: 'bo', [C]: 'cia', [D]: 'dan', [E]: 'eva' };
  User.find.mockImplementation((q) => ({
    lean: async () => q._id.$in.map((id) => ({ _id: id, username: names[String(id)] }))
  }));
  const forA = await visibleRecipients(doc, A);
  expect(forA.map((r) => [r.username, r.via])).toEqual([['bo', null], ['cia', null], ['dan', 'bo'], ['eva', 'dan']]);
  const forB = await visibleRecipients(doc, B);
  expect(forB.map((r) => [r.username, r.via])).toEqual([['dan', null]]);
  expect(await visibleRecipients(doc, C)).toEqual([]);
});
