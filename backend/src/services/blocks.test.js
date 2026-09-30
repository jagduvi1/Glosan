/**
 * Blockera: allt mellan de två tas bort — men bara det som är DERAS. En
 * gruppmutmaning med 25 klasskompisar är de andras också och får inte försvinna
 * för att två av deltagarna blockerar varandra (granskning av PR #120).
 * Modellerna fejkas — sviten har ingen Mongo.
 */
jest.mock('../models/User', () => ({
  exists: jest.fn(async () => true),
  updateOne: jest.fn(async () => ({ matchedCount: 1 })),
  findById: jest.fn(() => ({ lean: async () => ({ blocked: [] }) })),
  find: jest.fn(() => ({ lean: async () => [] }))
}));
jest.mock('../models/Friendship', () => ({ deleteMany: jest.fn(async () => ({})) }));
jest.mock('../models/CoopStreak', () => ({ deleteMany: jest.fn(async () => ({})) }));
jest.mock('../models/GlosList', () => ({ updateMany: jest.fn(async () => ({})) }));
jest.mock('../models/Duel', () => ({ deleteMany: jest.fn(async () => ({})) }));
jest.mock('./study/sharing', () => ({ unshareBetween: jest.fn(async () => {}) }));

const Duel = require('../models/Duel');
const Friendship = require('../models/Friendship');
const { unshareBetween } = require('./study/sharing');
const { blockUser } = require('./blocks');

const A = '64b000000000000000000001';
const B = '64b000000000000000000002';

test("blocking removes only the pair's own pending challenges, never a group's", async () => {
  const r = await blockUser(A, B);
  expect(r.blocked).toEqual([]);
  const [filter] = Duel.deleteMany.mock.calls[0];
  expect(filter.participants).toEqual({ $size: 2 });
  expect(filter['participants.status']).toBe('pending');
  expect(Friendship.deleteMany).toHaveBeenCalled();
  expect(unshareBetween).toHaveBeenCalledWith(A, B);
});

test('you cannot block yourself, and a bad id is not found', async () => {
  expect((await blockUser(A, A)).status).toBe(400);
  expect((await blockUser(A, 'not-an-id')).status).toBe(404);
});
