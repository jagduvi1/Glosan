/**
 * Klassrummet: en hel klass bakom SAMMA skol-IP (bakom Cloudflare) ska kunna
 * logga in, refresha och använda appen utan att dela en enda hink — men ett
 * konto ska fortfarande inte kunna gissas på obegränsat.
 */
process.env.JWT_SECRET = 'test-secret-that-is-long-enough-0123456789';

const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { clientIp } = require('../utils/clientIp');
const { userOrIpKey } = require('./rateKeys');
const { loginLimiter, authFloodLimiter, refreshLimiter } = require('./authLimits');

function makeApp() {
  const app = express();
  app.set('trust proxy', 2);
  app.use((req, res, next) => {
    Object.defineProperty(req, 'ip', { value: clientIp(req), configurable: true, enumerable: true });
    next();
  });
  app.use(cookieParser());
  app.use(express.json());
  app.post('/login', authFloodLimiter, loginLimiter, (req, res) => res.status(401).json({ error: 'wrong password' }));
  app.post('/refresh', refreshLimiter, (req, res) => res.json({ ok: true }));
  const api = rateLimit({ windowMs: 60000, max: 3, keyGenerator: userOrIpKey, standardHeaders: true, legacyHeaders: false });
  app.get('/api/thing', api, (req, res) => res.json({ ip: req.ip }));
  return app;
}

// En skola: samma Cloudflare-kant och samma klient-IP för alla elever.
const SCHOOL = { 'X-Forwarded-For': '104.22.100.135, 172.19.0.5', 'CF-Connecting-IP': '81.227.40.12' };

test('the real client IP comes through Cloudflare', async () => {
  const res = await request(makeApp()).get('/api/thing').set(SCHOOL);
  expect(res.body.ip).toBe('81.227.40.12');
});

test('20 wrong logins for one student do not lock out the next student on the same school IP', async () => {
  const app = makeApp();
  for (let i = 0; i < 20; i++) {
    const r = await request(app).post('/login').set(SCHOOL).send({ username: 'anna', password: 'x' });
    expect(r.status).toBe(401);
  }
  expect((await request(app).post('/login').set(SCHOOL).send({ username: 'anna', password: 'x' })).status).toBe(429);
  expect((await request(app).post('/login').set(SCHOOL).send({ username: 'Bert', password: 'x' })).status).toBe(401);
});

test('refresh counts per session, not per school', async () => {
  const app = makeApp();
  const cookie = (fam) => `refreshToken=${fam.padEnd(32, '0')}.${'a'.repeat(64)}`;
  for (let i = 0; i < 60; i++) await request(app).post('/refresh').set(SCHOOL).set('Cookie', cookie('aa'));
  expect((await request(app).post('/refresh').set(SCHOOL).set('Cookie', cookie('aa'))).status).toBe(429);
  expect((await request(app).post('/refresh').set(SCHOOL).set('Cookie', cookie('bb'))).status).toBe(200);
});

test('logged-in students each get their own API budget; a forged token does not', async () => {
  const app = makeApp();
  const token = (id) => jwt.sign({ id, roles: ['user'] }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '15m' });
  for (let i = 0; i < 3; i++) await request(app).get('/api/thing').set(SCHOOL).set('Authorization', `Bearer ${token('anna')}`);
  expect((await request(app).get('/api/thing').set(SCHOOL).set('Authorization', `Bearer ${token('anna')}`)).status).toBe(429);
  expect((await request(app).get('/api/thing').set(SCHOOL).set('Authorization', `Bearer ${token('bert')}`)).status).toBe(200);
  // En påhittad token hamnar i adressens hink.
  const forged = jwt.sign({ id: 'someone' }, 'wrong-secret', { algorithm: 'HS256' });
  for (let i = 0; i < 3; i++) await request(app).get('/api/thing').set(SCHOOL).set('Authorization', `Bearer ${forged}`);
  expect((await request(app).get('/api/thing').set(SCHOOL).set('Authorization', `Bearer ${forged}`)).status).toBe(429);
});
