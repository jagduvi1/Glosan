/**
 * Plugga-routerna genom den RIKTIGA appen: dolda (404) utan flaggan, och
 * översikten svarar med ämneskatalogen och terminer när flaggan är på.
 * User och StudyUnit fejkas — sviten har ingen Mongo.
 */
process.env.JWT_SECRET = 'test-secret';

const request = require('supertest');
const jwt = require('jsonwebtoken');

const mockUsers = new Map();
jest.mock('../models/User', () => {
  const actual = jest.requireActual('../models/User');
  actual.findById = (id) => ({
    select: () => ({ lean: async () => mockUsers.get(String(id)) || null })
  });
  return actual;
});
jest.mock('../models/StudyUnit', () => ({
  aggregate: async () => [{ _id: 'matematik', n: 2 }, { _id: 'historia', n: 1 }],
  distinct: async () => ['2025-HT']
}));

const app = require('../app');
const { termFor } = require('../utils/term');

const ON = '64b000000000000000000001';
const OFF = '64b000000000000000000002';
mockUsers.set(ON, { _id: ON, features: ['study'] });
mockUsers.set(OFF, { _id: OFF, features: [] });
const bearer = (id) => `Bearer ${jwt.sign({ id, roles: ['user'] }, process.env.JWT_SECRET, { algorithm: 'HS256' })}`;

test('hidden (404) for users without the flag — indistinguishable from an unknown route', async () => {
  const res = await request(app).get('/api/study/overview').set('Authorization', bearer(OFF));
  expect(res.status).toBe(404);
  expect(res.body).toEqual({ error: 'Route not found' });
});

test('requires login', async () => {
  expect((await request(app).get('/api/study/overview')).status).toBe(401);
});

test('overview lists every subject with counts for the term, and the terms that exist', async () => {
  const res = await request(app).get('/api/study/overview').set('Authorization', bearer(ON));
  expect(res.status).toBe(200);
  expect(res.body.term).toBe(termFor());
  const math = res.body.subjects.find((s) => s.key === 'matematik');
  expect(math).toMatchObject({ label: 'Matematik', code: 'MA', unitCount: 2 });
  expect(res.body.subjects.find((s) => s.key === 'fysik').unitCount).toBe(0);
  expect(res.body.terms.map((t) => t.key)).toEqual(expect.arrayContaining([termFor(), '2025-HT']));
  expect(res.body.groups.map((g) => g.key)).toEqual(['no', 'so']);
});

test('an explicit, valid term is honoured; garbage falls back to the current term', async () => {
  const ok = await request(app).get('/api/study/overview?term=2025-HT').set('Authorization', bearer(ON));
  expect(ok.body.term).toBe('2025-HT');
  expect(ok.body.termLabel).toBe('HT 2025');
  const bad = await request(app).get('/api/study/overview?term=$gt').set('Authorization', bearer(ON));
  expect(bad.body.term).toBe(termFor());
});
