/**
 * Integrationstest för POST /api/ai/parse-image.
 *
 * Kör hela routen — validering, promptbygge och svarsformat — men med
 * auth, kvot och Anthropic mockade, så testet behöver varken DB, nätverk
 * eller API-nyckel.
 *
 * Det viktigaste som pinnas här är att bilden skickas som ett riktigt
 * image-content-block till Messages API och att vision-modellen används.
 * Skickas bilden som text i stället "fungerar" anropet — det kostar pengar
 * och returnerar nonsens — så det är inget en trasig deploy avslöjar.
 */

process.env.JWT_SECRET = 'test-secret';

jest.mock('../middleware/auth', () => ({
  requireAuth: (req, res, next) => { req.user = { id: 'user-1' }; next(); },
}));

jest.mock('../middleware/aiQuota', () => ({
  enforceAiQuota: (req, res, next) => next(),
  incrementAiUsage: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/anthropic', () => ({
  isEnabled: () => true,
  complete: jest.fn(),
  extractJSON: (text) => { try { return JSON.parse(text); } catch { return null; } },
  DEFAULT_MODEL: 'claude-haiku-4-5-20251001',
  VISION_MODEL: 'claude-sonnet-5',
}));

const express = require('express');
const request = require('supertest');
const anthropic = require('../services/anthropic');
const { incrementAiUsage } = require('../middleware/aiQuota');
const router = require('./ai');

const app = express();
// Samma tak som app.js ger just den här routen.
app.use(express.json({ limit: '2mb' }));
app.use('/api/ai', router);

const jpegBase64 = (bytes = 64) => Buffer.alloc(bytes).toString('base64');

const goodReply = JSON.stringify({
  sourceLang: 'fr',
  targetLang: 'sv',
  glosor: [{ source: 'le chien', target: 'hunden' }],
});

beforeEach(() => {
  jest.clearAllMocks();
  anthropic.complete.mockResolvedValue(goodReply);
});

describe('POST /api/ai/parse-image — lyckat fall', () => {
  test('svarar med samma form som parse-list', async () => {
    const res = await request(app)
      .post('/api/ai/parse-image')
      .send({ image: jpegBase64(), mediaType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      glosor: [{ source: 'le chien', target: 'hunden' }],
      sourceLang: 'fr',
      targetLang: 'sv',
    });
  });

  test('skickar bilden som image-block och texten som separat block', async () => {
    const data = jpegBase64();
    await request(app).post('/api/ai/parse-image').send({ image: data, mediaType: 'image/png' });

    const call = anthropic.complete.mock.calls[0][0];
    expect(Array.isArray(call.user)).toBe(true);
    expect(call.user[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data },
    });
    expect(call.user[1].type).toBe('text');
  });

  test('använder vision-modellen, inte textstandarden', async () => {
    await request(app).post('/api/ai/parse-image').send({ image: jpegBase64(), mediaType: 'image/jpeg' });
    expect(anthropic.complete.mock.calls[0][0].model).toBe('claude-sonnet-5');
  });

  test('räknar av ett AI-anrop mot kvoten', async () => {
    await request(app).post('/api/ai/parse-image').send({ image: jpegBase64(), mediaType: 'image/jpeg' });
    expect(incrementAiUsage).toHaveBeenCalledWith('user-1');
  });

  test('accepterar en data-URL och strippar prefixet innan anropet', async () => {
    const data = jpegBase64();
    const res = await request(app)
      .post('/api/ai/parse-image')
      .send({ image: `data:image/jpeg;base64,${data}` });

    expect(res.status).toBe(200);
    // mediaType togs ur data-URL:en, och prefixet följde inte med datan.
    expect(anthropic.complete.mock.calls[0][0].user[0].source).toEqual({
      type: 'base64',
      media_type: 'image/jpeg',
      data,
    });
  });

  test('skickar med språkhint när klienten angett språk', async () => {
    await request(app)
      .post('/api/ai/parse-image')
      .send({ image: jpegBase64(), mediaType: 'image/jpeg', sourceLang: 'fr', targetLang: 'sv' });

    expect(anthropic.complete.mock.calls[0][0].user[1].text).toContain('"fr"');
  });

  test('filtrerar bort ofullständiga par ur AI-svaret', async () => {
    anthropic.complete.mockResolvedValue(JSON.stringify({
      glosor: [{ source: 'le chat', target: 'katten' }, { source: 'oläsligt' }, null],
    }));
    const res = await request(app)
      .post('/api/ai/parse-image')
      .send({ image: jpegBase64(), mediaType: 'image/jpeg' });

    expect(res.body.glosor).toEqual([{ source: 'le chat', target: 'katten' }]);
  });
});

describe('POST /api/ai/parse-image — avvisade requests', () => {
  test.each([
    ['ingen bild', {}],
    ['bild som inte är en sträng', { image: 12345, mediaType: 'image/jpeg' }],
    ['okänd mediaType', { image: 'AAAA', mediaType: 'image/heic' }],
    ['mediaType saknas helt', { image: 'AAAA' }],
    ['inte giltig base64', { image: 'inte base64!!', mediaType: 'image/jpeg' }],
  ])('%s → 400', async (_label, body) => {
    const res = await request(app).post('/api/ai/parse-image').send(body);
    expect(res.status).toBe(400);
    expect(anthropic.complete).not.toHaveBeenCalled();
  });

  test('för stor bild → 413, och Anthropic anropas aldrig', async () => {
    const res = await request(app)
      .post('/api/ai/parse-image')
      .send({ image: jpegBase64(1.6 * 1024 * 1024), mediaType: 'image/jpeg' });

    expect(res.status).toBe(413);
    expect(anthropic.complete).not.toHaveBeenCalled();
  });

  test('AI-svar som inte är JSON → 502, och kvoten räknas inte av', async () => {
    anthropic.complete.mockResolvedValue('Förlåt, jag kan inte läsa bilden.');
    const res = await request(app)
      .post('/api/ai/parse-image')
      .send({ image: jpegBase64(), mediaType: 'image/jpeg' });

    expect(res.status).toBe(502);
    expect(incrementAiUsage).not.toHaveBeenCalled();
  });

  test('överbelastad Anthropic → 503 med ett begripligt meddelande', async () => {
    anthropic.complete.mockRejectedValue(Object.assign(new Error('overloaded'), { status: 529 }));
    const res = await request(app)
      .post('/api/ai/parse-image')
      .send({ image: jpegBase64(), mediaType: 'image/jpeg' });

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/overloaded/i);
  });
});

describe('POST /api/ai/parse-image — stavningsrättning', () => {
  test('rättningen följer med i svaret så UI:t kan markera den', async () => {
    anthropic.complete.mockResolvedValue(JSON.stringify({
      sourceLang: 'sv',
      targetLang: 'en',
      glosor: [{ source: 'hej', target: 'hello', corrections: { target: 'hallo' } }],
    }));

    const res = await request(app)
      .post('/api/ai/parse-image')
      .send({ image: jpegBase64(), mediaType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(res.body.glosor).toEqual([
      { source: 'hej', target: 'hello', corrections: { target: 'hallo' } },
    ]);
  });

  test('en rättning som inte ändrar något filtreras bort', async () => {
    anthropic.complete.mockResolvedValue(JSON.stringify({
      glosor: [{ source: 'hej', target: 'hello', corrections: { target: 'hello' } }],
    }));

    const res = await request(app)
      .post('/api/ai/parse-image')
      .send({ image: jpegBase64(), mediaType: 'image/jpeg' });

    expect(res.body.glosor).toEqual([{ source: 'hej', target: 'hello' }]);
  });

  test('prompten instruerar modellen att rapportera rättningar', async () => {
    await request(app).post('/api/ai/parse-image').send({ image: jpegBase64(), mediaType: 'image/jpeg' });
    const system = anthropic.complete.mock.calls[0][0].system;
    expect(system).toContain('corrections');
    // Den viktiga skyddsregeln: ett oläsligt ord är inte ett stavfel.
    expect(system).toContain('never treat a word you cannot read as a misspelling');
  });
});
