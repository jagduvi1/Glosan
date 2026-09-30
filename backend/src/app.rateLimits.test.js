/**
 * De globala limitrarna i app.js (300 anrop / 100 skrivanrop per kvart och
 * adress för den som inte är inloggad) får inte ligga framför inloggningen:
 * en hel skola bakom en IP-adress skulle annars dela 100 inloggningar och
 * refresh-anrop per kvart (granskning av PR #119). Inloggningen har egna
 * limitrar per adress + användarnamn (middleware/authLimits.js).
 *
 * Svaren här kommer före databasen (400 för en ofullständig inloggning), så
 * sviten behöver ingen Mongo.
 */
process.env.JWT_SECRET = 'test-secret-that-is-long-enough-0123456789';

const request = require('supertest');
const app = require('./app');

// En skola: samma Cloudflare-kant och samma klient-IP för alla elever.
const SCHOOL = { 'X-Forwarded-For': '104.22.100.135, 172.19.0.5', 'CF-Connecting-IP': '81.227.40.12' };

test('a school logging in from one IP is not stopped by the global limiters', async () => {
  for (let i = 0; i < 150; i++) {
    const r = await request(app).post('/api/auth/login').set(SCHOOL).send({ username: `elev${i}` });
    expect(r.status).toBe(400);
  }
});

test('a school signing in with Google is not stopped by the global limiters (review of #119)', async () => {
  // Inloggningssidan frågar /sso/providers; 320 elever > de globala 300.
  for (let i = 0; i < 320; i++) {
    const r = await request(app).get('/api/auth/sso/providers').set(SCHOOL);
    expect(r.status).toBe(200);
  }
});

test('the global limiters still cover paths without their own limiter', async () => {
  // Samma skola, en okänd sökväg under /api/auth: den slipper inte undan.
  let limited = false;
  for (let i = 0; i < 101 && !limited; i++) {
    const r = await request(app).post('/api/auth/no-such-route').set(SCHOOL).send({});
    limited = r.status === 429;
  }
  expect(limited).toBe(true);
});
