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
const { loginLimiter, authFloodLimiter, refreshLimiter, registerLimiter } = require('./authLimits');
const { validateRegistration } = require('./validateRegistration');
const User = require('../models/User');

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
  // Som i routes/auth.js; här misslyckas varje registrering som når fram
  // (t.ex. ett fel när kontot sparas) — den ska ändå räknas.
  app.post('/register', authFloodLimiter, validateRegistration, registerLimiter, (req, res) => res.status(400).json({ error: 'save failed' }));
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

test('an IPv6 host cannot dodge the login limit by rotating through its network (review of #119)', async () => {
  const app = makeApp();
  // Nya /64-nät inom samma /56 — det en hemmauppkoppling normalt får.
  const from = (net) => ({ 'X-Forwarded-For': '104.22.100.135, 172.19.0.5', 'CF-Connecting-IP': `2001:db8:1:${net.toString(16)}::1` });
  for (let i = 1; i <= 20; i++) {
    expect((await request(app).post('/login').set(from(i)).send({ username: 'anna', password: 'x' })).status).toBe(401);
  }
  expect((await request(app).post('/login').set(from(0xff)).send({ username: 'anna', password: 'x' })).status).toBe(429);
  // Ett annat /56-nät är en annan uppkoppling.
  const other = { 'X-Forwarded-For': '104.22.100.135, 172.19.0.5', 'CF-Connecting-IP': '2001:db8:1:100::1' };
  expect((await request(app).post('/login').set(other).send({ username: 'anna', password: 'x' })).status).toBe(401);
});

test('an access token that just expired still counts for its account, not the school (review of #119)', async () => {
  const app = makeApp();
  const now = Math.floor(Date.now() / 1000);
  const signed = (id, iat, exp) => jwt.sign({ id, roles: ['user'], iat, exp }, process.env.JWT_SECRET, { algorithm: 'HS256' });
  const expired = (id) => signed(id, now - 1200, now - 300);
  for (let i = 0; i < 3; i++) await request(app).get('/api/thing').set(SCHOOL).set('Authorization', `Bearer ${expired('anna')}`);
  expect((await request(app).get('/api/thing').set(SCHOOL).set('Authorization', `Bearer ${expired('anna')}`)).status).toBe(429);
  // Bert har också en utgången token — och sin egen hink, inte skolans.
  expect((await request(app).get('/api/thing').set(SCHOOL).set('Authorization', `Bearer ${expired('bert')}`)).status).toBe(200);
  // En token äldre än refresh-cookien (7 dagar) räknas på adressen.
  const ancient = signed('carl', now - 8 * 86400, now - 8 * 86400 + 900);
  for (let i = 0; i < 3; i++) await request(app).get('/api/thing').set(SCHOOL).set('Authorization', `Bearer ${ancient}`);
  expect((await request(app).get('/api/thing').set(SCHOOL)).status).toBe(429);
});

test('forms with mistakes do not use up the sign-up quota; every real attempt counts (review of #119)', async () => {
  const app = makeApp();
  // Ingen Mongo i sviten: "elevNN" med NN under 100 är upptagna, resten lediga.
  const exists = jest.spyOn(User, 'exists').mockImplementation(async (q) => {
    const name = q.$or[1].username;
    return /^elev\d{1,2}$/.test(name) ? { _id: 'x' } : null;
  });
  const form = (i, password) => ({ username: `elev${i}`, email: `elev${i}@skola.test`, password, ageConsent: true });
  // 70 för korta lösenord från samma skola: fel i formuläret, aldrig 429.
  for (let i = 0; i < 70; i++) {
    const r = await request(app).post('/register').set(SCHOOL).send(form(i, 'kort'));
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/at least 10 characters/);
  }
  // 70 upptagna namn: också fel i formuläret, aldrig 429.
  for (let i = 0; i < 70; i++) {
    const r = await request(app).post('/register').set(SCHOOL).send(form(i, 'Hemligt123abc'));
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Registration failed/);
  }
  // Formulär som kunde bli konton räknas, även när registreringen sedan
  // misslyckas: 60 ryms, nummer 61 stoppas.
  for (let i = 0; i < 60; i++) {
    expect((await request(app).post('/register').set(SCHOOL).send(form(100 + i, 'Hemligt123abc'))).body.error).toBe('save failed');
  }
  expect((await request(app).post('/register').set(SCHOOL).send(form(999, 'Hemligt123abc'))).status).toBe(429);
  exists.mockRestore();
});

test('a new account gets the same username rules as a rename (no Glosan-like names, no @, no look-alike letters)', async () => {
  const app = makeApp();
  const exists = jest.spyOn(User, 'exists').mockResolvedValue(null);
  for (const username of ['admin', 'glosan-support', 'emma@skola.test', 'emmа', 'a b']) {
    const r = await request(app).post('/register').send({ username, email: 'ny@skola.test', password: 'Hemligt123abc', ageConsent: true });
    expect(r.status).toBe(400);
    expect(r.body.error).not.toMatch(/Registration failed/); // säger vad som är fel med namnet
  }
  expect(exists).not.toHaveBeenCalled();
  exists.mockRestore();
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
