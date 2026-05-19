const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');
const anthropic = require('../services/anthropic');

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
