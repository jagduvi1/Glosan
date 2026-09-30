/**
 * Delningslänkar till Plugga-områden (/p/<kod>). Förhandsvisningen måste nås
 * UTAN inloggning och utan Plugga-flaggan — routern monteras före glosor.js,
 * som kräver inloggning för hela /api — och att gå med kräver inloggning.
 * StudyShareLink fejkas — sviten har ingen Mongo.
 */
process.env.JWT_SECRET = 'test-secret';

const request = require('supertest');

const mockFindOne = jest.fn(async () => null);
jest.mock('../models/StudyShareLink', () => ({
  findOne: (...args) => mockFindOne(...args),
  exists: async () => false
}));

const app = require('../app');

test('the preview is public: an unknown code is a 404 with a message, not a 401', async () => {
  const res = await request(app).get('/api/study-invite/ABCD2345');
  expect(res.status).toBe(404);
  expect(res.body.error).toMatch(/ogiltig/);
  expect(mockFindOne).toHaveBeenCalledWith({ code: 'ABCD2345' });
});

test('a malformed code never reaches the database', async () => {
  mockFindOne.mockClear();
  const res = await request(app).get('/api/study-invite/%7B%24gt%3A1%7D');
  expect(res.status).toBe(404);
  expect(mockFindOne).not.toHaveBeenCalled();
});

test('joining requires login', async () => {
  const res = await request(app).post('/api/study-invite/ABCD2345/accept');
  expect(res.status).toBe(401);
});
