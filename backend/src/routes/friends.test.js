/**
 * POST /api/me/friends/by-code med något annat än text som kod: ett tal
 * kastade förut (utanför try) och Node avslutade hela processen.
 */
process.env.JWT_SECRET = 'test-secret';

jest.mock('../middleware/auth', () => ({
  requireAuth: (req, res, next) => { req.user = { id: '64b000000000000000000001' }; next(); },
  optionalAuth: (req, res, next) => next()
}));

const express = require('express');
const request = require('supertest');
const router = require('./friends');

const app = express();
app.use(express.json());
app.use('/api/me', router);

test.each([12345678, null, ['ABCD1234'], { $gt: '' }])('code %p is a 400, not a crash', async (code) => {
  const res = await request(app).post('/api/me/friends/by-code').send({ code });
  expect(res.status).toBe(400);
});
