const express = require('express');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');
const { enforceAiQuota, incrementAiUsage } = require('../middleware/aiQuota');
const anthropic = require('../services/anthropic');
const GlosList = require('../models/GlosList');
const Glos = require('../models/Glos');

const router = express.Router();

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'AI rate limit exceeded — please slow down' })
});

router.use(requireAuth, aiLimiter, enforceAiQuota);

function requireEnabled(req, res) {
  if (!anthropic.isEnabled()) {
    res.status(503).json({ error: 'AI features are not configured on this server' });
    return false;
  }
  return true;
}

// Kort, fyrkantig längdvalidering så ingen kan trycka in megabytes av
// text i prompts och blåsa upp Anthropic-anrop. Returnerar true (och
// 400-svar) om något fält är för långt; den anropande routen ska
// returnera tidigt i det fallet.
function rejectIfTooLong(res, fields) {
  for (const [name, spec] of Object.entries(fields)) {
    if (typeof spec.value === 'string' && spec.value.length > spec.max) {
      res.status(400).json({ error: `${name} is too long (max ${spec.max} characters)` });
      return true;
    }
  }
  return false;
}

// POST /api/ai/generate-list
// Body: { topic, sourceLang, targetLang, count }
// Returns: { glosor: [{ source, target }] }
router.post('/generate-list', async (req, res) => {
  if (!requireEnabled(req, res)) return;
  const { topic, sourceLang, targetLang, count } = req.body;
  if (!topic || !sourceLang || !targetLang) {
    return res.status(400).json({ error: 'topic, sourceLang and targetLang are required' });
  }
  if (rejectIfTooLong(res, {
    topic: { value: topic, max: 200 },
    sourceLang: { value: sourceLang, max: 32 },
    targetLang: { value: targetLang, max: 32 }
  })) return;
  const n = Math.min(Math.max(Number(count) || 10, 1), 30);

  try {
    const system = `You generate vocabulary lists for language learners. Reply with valid JSON only — no prose, no markdown fences. Schema: {"glosor":[{"source":"...","target":"..."}]}. Each entry must be a single word or short phrase.`;
    const user = `Topic: ${topic}\nSource language: ${sourceLang}\nTarget language: ${targetLang}\nCount: ${n}\n\nReturn ${n} vocabulary pairs.`;

    const text = await anthropic.complete({ system, user, maxTokens: 2048 });
    const data = anthropic.extractJSON(text);
    if (!data || !Array.isArray(data.glosor)) {
      return res.status(502).json({ error: 'AI response was not valid JSON' });
    }
    await incrementAiUsage(req.user.id);
    res.json({ glosor: data.glosor.slice(0, n) });
  } catch (error) {
    console.error('AI generate-list error:', error.message);
    res.status(502).json({ error: 'AI request failed' });
  }
});

// POST /api/ai/extend-list
// Body: { listId, count? }
// Returns: { glosor: [{ source, target }] }
// Uses the list's existing glosor as thematic context — Glo generates more
// pairs in the same theme without needing the user to type a topic.
router.post('/extend-list', async (req, res) => {
  if (!requireEnabled(req, res)) return;
  const { listId, count } = req.body;
  if (!listId || !mongoose.Types.ObjectId.isValid(listId)) {
    return res.status(400).json({ error: 'listId is required' });
  }
  const n = Math.min(Math.max(Number(count) || 10, 1), 20);

  try {
    const list = await GlosList.findOne({ _id: listId, user: req.user.id });
    if (!list) return res.status(404).json({ error: 'List not found' });

    // Cap context size — 30 most-recent pairs are enough to convey theme.
    const glosor = await Glos.find({ list: list._id }).sort({ createdAt: -1 }).limit(30).lean();
    if (glosor.length === 0) {
      return res.status(400).json({ error: 'Listan måste ha minst en glosa för att Glo ska kunna gissa tema' });
    }

    const sample = glosor.map((g, i) => `${i + 1}. ${g.source} → ${g.target}`).join('\n');
    const system = `You extend a learner's vocabulary list with thematically related pairs. Reply with valid JSON only — no prose, no markdown fences. Schema: {"glosor":[{"source":"...","target":"..."}]}. Each entry is a single word or short phrase. Never repeat a pair that already appears in the list.`;
    const user = `Source language: ${list.sourceLang}\nTarget language: ${list.targetLang}\nList title: ${list.title}\nCount: ${n}\n\nExisting pairs:\n${sample}\n\nReturn ${n} new pairs that share the same theme.`;

    const text = await anthropic.complete({ system, user, maxTokens: 2048 });
    const data = anthropic.extractJSON(text);
    if (!data || !Array.isArray(data.glosor)) {
      return res.status(502).json({ error: 'AI response was not valid JSON' });
    }
    await incrementAiUsage(req.user.id);
    res.json({ glosor: data.glosor.slice(0, n) });
  } catch (error) {
    console.error('AI extend-list error:', error.message);
    if (error.status === 529 || error.status === 503) {
      return res.status(503).json({ error: 'Anthropic is temporarily overloaded — please try again in a moment.' });
    }
    if (error.status === 429) {
      return res.status(429).json({ error: 'Anthropic rate limit hit — please wait a few seconds and retry.' });
    }
    res.status(502).json({ error: 'AI request failed' });
  }
});

// POST /api/ai/parse-list
// Body: { text, sourceLang?, targetLang? }
// Returns: { glosor: [{source, target}], sourceLang, targetLang }
router.post('/parse-list', async (req, res) => {
  if (!requireEnabled(req, res)) return;
  const { text, sourceLang, targetLang } = req.body;
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'text is required' });
  }
  if (text.length > 8000) {
    return res.status(400).json({ error: 'text is too long (max 8000 characters)' });
  }
  if (rejectIfTooLong(res, {
    sourceLang: { value: sourceLang, max: 32 },
    targetLang: { value: targetLang, max: 32 }
  })) return;

  const langHint = sourceLang && targetLang
    ? `The source language is "${sourceLang}" and the target language is "${targetLang}".`
    : 'Detect the source and target languages yourself based on the content.';

  try {
    const system = `You parse pasted vocabulary lists into structured source/target pairs. Input may be tab-separated, multi-space-aligned, dash-separated, comma-separated, table-format, or any other layout a teacher might produce. Reply with valid JSON only — no prose, no markdown fences. Schema: {"sourceLang":"<ISO 639-1 code>","targetLang":"<ISO 639-1 code>","glosor":[{"source":"...","target":"..."}]}. Preserve punctuation, apostrophes, accents, and slash-separated alternatives (e.g. "söt/gullig"). Only include pairs that actually appear in the input — never invent. Skip headings, dates, page numbers, and instructions.`;
    const user = `${langHint}\n\nText:\n<<<\n${text}\n>>>`;

    const aiText = await anthropic.complete({ system, user, maxTokens: 4096 });
    const data = anthropic.extractJSON(aiText);
    if (!data || !Array.isArray(data.glosor)) {
      return res.status(502).json({ error: 'AI response was not valid JSON' });
    }
    await incrementAiUsage(req.user.id);
    res.json({
      glosor: data.glosor.filter((g) => g && g.source && g.target),
      sourceLang: data.sourceLang || sourceLang || '',
      targetLang: data.targetLang || targetLang || ''
    });
  } catch (error) {
    console.error('AI parse-list error:', error.message);
    if (error.status === 529 || error.status === 503) {
      return res.status(503).json({ error: 'Anthropic is temporarily overloaded — please try again in a moment.' });
    }
    if (error.status === 429) {
      return res.status(429).json({ error: 'Anthropic rate limit hit — please wait a few seconds and retry.' });
    }
    res.status(502).json({ error: 'AI request failed' });
  }
});

// Tillåtna bildformat — samma lista som Messages API accepterar.
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// Taket gäller den AVKODADE bilden, inte base64-strängen. Klienten skickar
// normalt ~300 kB (nerskalat), så det här är rejält tilltaget — men det
// ligger under body-parserns egen gräns i app.js, så en för stor bild får
// ett begripligt felmeddelande i stället för ett rått 413.
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;

// base64 kodar 3 bytes per 4 tecken; padding ('=') räknas bort.
function decodedBase64Bytes(b64) {
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

// Klienten skickar rå base64, men en data-URL ("data:image/jpeg;base64,...")
// är ett lätt misstag att göra — strippa prefixet i stället för att skicka
// skräp till Anthropic.
function stripDataUrlPrefix(value) {
  const match = /^data:([a-z/+-]+);base64,(.*)$/is.exec(value);
  return match ? { mediaType: match[1].toLowerCase(), data: match[2] } : { mediaType: null, data: value };
}

// POST /api/ai/parse-image
// Body: { image (base64), mediaType, sourceLang?, targetLang? }
// Returns: { glosor: [{source, target}], sourceLang, targetLang }
//
// Exakt samma svarskontrakt som /parse-list — bara indata skiljer, så
// ImportModal kan återanvända hela gransknings- och sparsteget. Bilden
// sparas ALDRIG: den går till Anthropic och slängs när svaret kommit.
router.post('/parse-image', async (req, res) => {
  if (!requireEnabled(req, res)) return;
  const { image, sourceLang, targetLang } = req.body;

  if (!image || typeof image !== 'string') {
    return res.status(400).json({ error: 'image is required' });
  }
  if (rejectIfTooLong(res, {
    sourceLang: { value: sourceLang, max: 32 },
    targetLang: { value: targetLang, max: 32 }
  })) return;

  const stripped = stripDataUrlPrefix(image.trim());
  const data = stripped.data;
  const mediaType = (stripped.mediaType || req.body.mediaType || '').toLowerCase();

  if (!ALLOWED_IMAGE_TYPES.includes(mediaType)) {
    return res.status(400).json({ error: 'mediaType must be one of image/jpeg, image/png, image/webp, image/gif' });
  }
  // Validera base64 innan storleksberäkningen — annars mäter vi skräp.
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    return res.status(400).json({ error: 'image is not valid base64' });
  }
  if (decodedBase64Bytes(data) > MAX_IMAGE_BYTES) {
    return res.status(413).json({ error: 'Bilden är för stor. Ta en ny bild eller beskär den.' });
  }

  const langHint = sourceLang && targetLang
    ? `The source language is "${sourceLang}" and the target language is "${targetLang}".`
    : 'Detect the source and target languages yourself based on the content.';

  try {
    const system = `You read a photographed or scanned vocabulary sheet — the kind a teacher hands out — and extract the source/target word pairs. The photo may be taken at an angle, be unevenly lit, or contain handwriting. Columns may be separated by whitespace, dots, dashes or table rules; pairs may also run left-to-right across two columns per line. Reply with valid JSON only — no prose, no markdown fences. Schema: {"sourceLang":"<ISO 639-1 code>","targetLang":"<ISO 639-1 code>","glosor":[{"source":"...","target":"..."}]}. Preserve punctuation, apostrophes, accents, and slash-separated alternatives (e.g. "söt/gullig"). Only include pairs you can actually read in the image — never invent a translation, and never guess at a word you cannot make out: skip it instead, the user reviews the result and would rather add one than find a wrong one. Skip headings, dates, page numbers, names and instructions.`;
    const user = [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
      { type: 'text', text: `${langHint}\n\nExtract the vocabulary pairs from this sheet.` }
    ];

    const aiText = await anthropic.complete({
      system,
      user,
      maxTokens: 4096,
      model: anthropic.VISION_MODEL
    });
    const parsed = anthropic.extractJSON(aiText);
    if (!parsed || !Array.isArray(parsed.glosor)) {
      return res.status(502).json({ error: 'AI response was not valid JSON' });
    }
    await incrementAiUsage(req.user.id);
    res.json({
      glosor: parsed.glosor.filter((g) => g && g.source && g.target),
      sourceLang: parsed.sourceLang || sourceLang || '',
      targetLang: parsed.targetLang || targetLang || ''
    });
  } catch (error) {
    console.error('AI parse-image error:', error.message);
    if (error.status === 529 || error.status === 503) {
      return res.status(503).json({ error: 'Anthropic is temporarily overloaded — please try again in a moment.' });
    }
    if (error.status === 429) {
      return res.status(429).json({ error: 'Anthropic rate limit hit — please wait a few seconds and retry.' });
    }
    res.status(502).json({ error: 'AI request failed' });
  }
});

// POST /api/ai/example-sentence
// Body: { word, lang }
// Returns: { sentence }
router.post('/example-sentence', async (req, res) => {
  if (!requireEnabled(req, res)) return;
  const { word, lang } = req.body;
  if (!word || !lang) return res.status(400).json({ error: 'word and lang are required' });
  if (rejectIfTooLong(res, {
    word: { value: word, max: 100 },
    lang: { value: lang, max: 32 }
  })) return;

  try {
    const system = `You write one short, natural example sentence using a given word. Reply with valid JSON only. Schema: {"sentence":"..."}.`;
    const user = `Word: ${word}\nLanguage: ${lang}\n\nReturn one example sentence.`;

    const text = await anthropic.complete({ system, user, maxTokens: 256 });
    const data = anthropic.extractJSON(text);
    if (!data || typeof data.sentence !== 'string') {
      return res.status(502).json({ error: 'AI response was not valid JSON' });
    }
    await incrementAiUsage(req.user.id);
    res.json({ sentence: data.sentence });
  } catch (error) {
    console.error('AI example-sentence error:', error.message);
    res.status(502).json({ error: 'AI request failed' });
  }
});

// POST /api/ai/translate
// Body: { word, sourceLang, targetLang }
// Returns: { translation }
router.post('/translate', async (req, res) => {
  if (!requireEnabled(req, res)) return;
  const { word, sourceLang, targetLang } = req.body;
  if (!word || !sourceLang || !targetLang) {
    return res.status(400).json({ error: 'word, sourceLang and targetLang are required' });
  }
  if (rejectIfTooLong(res, {
    word: { value: word, max: 100 },
    sourceLang: { value: sourceLang, max: 32 },
    targetLang: { value: targetLang, max: 32 }
  })) return;

  try {
    const system = `You translate single words or short phrases between languages. Reply with valid JSON only. Schema: {"translation":"..."}.`;
    const user = `Word: ${word}\nFrom: ${sourceLang}\nTo: ${targetLang}\n\nReturn the most common translation.`;

    const text = await anthropic.complete({ system, user, maxTokens: 128 });
    const data = anthropic.extractJSON(text);
    if (!data || typeof data.translation !== 'string') {
      return res.status(502).json({ error: 'AI response was not valid JSON' });
    }
    await incrementAiUsage(req.user.id);
    res.json({ translation: data.translation });
  } catch (error) {
    console.error('AI translate error:', error.message);
    res.status(502).json({ error: 'AI request failed' });
  }
});

module.exports = router;

// Exporterade för enhetstest — ren validerings-/mattelogik utan DB eller
// nätverk, och det är just den som avgör om en för stor bild stoppas.
module.exports.decodedBase64Bytes = decodedBase64Bytes;
module.exports.stripDataUrlPrefix = stripDataUrlPrefix;
module.exports.MAX_IMAGE_BYTES = MAX_IMAGE_BYTES;
module.exports.ALLOWED_IMAGE_TYPES = ALLOWED_IMAGE_TYPES;
