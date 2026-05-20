const express = require('express');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');
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

router.use(requireAuth, aiLimiter);

function requireEnabled(req, res) {
  if (!anthropic.isEnabled()) {
    res.status(503).json({ error: 'AI features are not configured on this server' });
    return false;
  }
  return true;
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
  const n = Math.min(Math.max(Number(count) || 10, 1), 30);

  try {
    const system = `You generate vocabulary lists for language learners. Reply with valid JSON only — no prose, no markdown fences. Schema: {"glosor":[{"source":"...","target":"..."}]}. Each entry must be a single word or short phrase.`;
    const user = `Topic: ${topic}\nSource language: ${sourceLang}\nTarget language: ${targetLang}\nCount: ${n}\n\nReturn ${n} vocabulary pairs.`;

    const text = await anthropic.complete({ system, user, maxTokens: 2048 });
    const data = anthropic.extractJSON(text);
    if (!data || !Array.isArray(data.glosor)) {
      return res.status(502).json({ error: 'AI response was not valid JSON' });
    }
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

// POST /api/ai/example-sentence
// Body: { word, lang }
// Returns: { sentence }
router.post('/example-sentence', async (req, res) => {
  if (!requireEnabled(req, res)) return;
  const { word, lang } = req.body;
  if (!word || !lang) return res.status(400).json({ error: 'word and lang are required' });

  try {
    const system = `You write one short, natural example sentence using a given word. Reply with valid JSON only. Schema: {"sentence":"..."}.`;
    const user = `Word: ${word}\nLanguage: ${lang}\n\nReturn one example sentence.`;

    const text = await anthropic.complete({ system, user, maxTokens: 256 });
    const data = anthropic.extractJSON(text);
    if (!data || typeof data.sentence !== 'string') {
      return res.status(502).json({ error: 'AI response was not valid JSON' });
    }
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

  try {
    const system = `You translate single words or short phrases between languages. Reply with valid JSON only. Schema: {"translation":"..."}.`;
    const user = `Word: ${word}\nFrom: ${sourceLang}\nTo: ${targetLang}\n\nReturn the most common translation.`;

    const text = await anthropic.complete({ system, user, maxTokens: 128 });
    const data = anthropic.extractJSON(text);
    if (!data || typeof data.translation !== 'string') {
      return res.status(502).json({ error: 'AI response was not valid JSON' });
    }
    res.json({ translation: data.translation });
  } catch (error) {
    console.error('AI translate error:', error.message);
    res.status(502).json({ error: 'AI request failed' });
  }
});

module.exports = router;
