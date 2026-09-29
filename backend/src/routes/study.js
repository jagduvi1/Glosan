const express = require('express');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');
const { requireFeature } = require('../middleware/feature');
const StudyUnit = require('../models/StudyUnit');
const StudyItemState = require('../models/StudyItemState');
const StudyFlag = require('../models/StudyFlag');
const { SUBJECTS, SUBJECT_GROUPS } = require('../config/subjects');
const { termFor, isValidTerm, termLabel, compareTerms } = require('../utils/term');
const { readableFilter, loadUnit, loadItem } = require('../services/study/access');
const { listUnits, unitDetail } = require('../services/study/views');
const { startSession, answerInSession, pingSession, finishSession, MODES, LEVELS } = require('../services/study/practice');
const {
  listRecipients, shareWithFriends, removeRecipient, createShareLink, listShareLinks, revokeShareLink
} = require('../services/study/sharing');

// Plugga — skolämnen. Dold bakom funktionsflaggan 'study' (config/features.js)
// tills modulen släpps. Innehållet skapas BARA via MCP (användarens egen AI);
// de här routerna läser, organiserar och tar emot övningssvar.
//
// Regel för hela modulen: Glosan anropar ALDRIG någon AI-API här. All
// AI-hjälp (skapa innehåll, rätta papperslösningar) sker i användarens egen
// AI via MCP. Se docs/plugga.md.

const router = express.Router();

router.use(requireAuth, requireFeature('study'));

// Pluggpass skickar ett anrop per svar (plus en "ping" var 30:e sekund när en
// genomgång läses). En skolklass delar ofta EN IP-adress, så de globala
// per-IP-limitrarna skulle strypa hela klassrummet — pass-routerna är
// undantagna i app.js och begränsas här per inloggad användare i stället.
const practiceLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 900,
  keyGenerator: (req) => `u:${req.user.id}`,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'Lugn i stormen — vänta några minuter och fortsätt sedan plugga.' })
});

// Nya delningslänkar kostar en skrivning + kollisionskoll — begränsa per användare.
const shareLinkLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => `u:${req.user.id}`,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'För många nya länkar — vänta en stund.' })
});

const bad = (res, error) => res.status(400).json({ error });

/** Området om inloggad användare är skaparen, annars svarar den 404/403 och ger null. */
async function ownedUnit(req, res) {
  const access = await loadUnit(req.user.id, req.params.id, 'owner');
  if (access.error === 'forbidden') {
    res.status(403).json({ error: 'Bara den som skapade området kan dela det.' });
    return null;
  }
  if (access.error) {
    res.status(404).json({ error: 'Området hittades inte.' });
    return null;
  }
  return access.unit;
}

// GET /api/study/overview?term=2026-HT — startsidan: ämnen med antal områden
// för terminen (egna + delade med mig), vilka terminer som finns och hur
// mycket som är dags att repetera.
router.get('/overview', async (req, res, next) => {
  try {
    const current = termFor();
    const term = isValidTerm(req.query.term) ? req.query.term : current;
    const userId = new mongoose.Types.ObjectId(req.user.id);
    const readable = { ...readableFilter(userId), archivedAt: null };

    const [bySubject, terms, readableIds] = await Promise.all([
      StudyUnit.aggregate([
        { $match: { ...readable, term } },
        { $group: { _id: '$subject', n: { $sum: 1 } } }
      ]),
      StudyUnit.distinct('term', readable),
      StudyUnit.distinct('_id', readable)
    ]);
    const due = readableIds.length
      ? await StudyItemState.countDocuments({ user: userId, unit: { $in: readableIds }, dueAt: { $lte: new Date() } })
      : 0;
    const countBy = new Map(bySubject.map((r) => [r._id, r.n]));
    const allTerms = [...new Set([current, term, ...terms])].sort(compareTerms).reverse();

    res.json({
      term,
      termLabel: termLabel(term),
      currentTerm: current,
      terms: allTerms.map((t) => ({ key: t, label: termLabel(t) })),
      groups: Object.values(SUBJECT_GROUPS),
      subjects: SUBJECTS.map((s) => ({ ...s, unitCount: countBy.get(s.key) || 0 })),
      totalUnits: readableIds.length,
      due
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/study/units?subject=matematik&term=2026-HT (&group=no, &allTerms=1)
router.get('/units', async (req, res, next) => {
  try {
    const q = req.query;
    const units = await listUnits(req.user.id, {
      subject: typeof q.subject === 'string' ? q.subject : undefined,
      group: typeof q.group === 'string' ? q.group : undefined,
      term: typeof q.term === 'string' ? q.term : undefined,
      allTerms: q.allTerms === '1'
    });
    res.json({ units });
  } catch (err) {
    next(err);
  }
});

// GET /api/study/units/:id — områdessidan (genomgångar + uppgifter utan facit).
router.get('/units/:id', async (req, res, next) => {
  try {
    const detail = await unitDetail(req.user.id, req.params.id);
    if (detail.error) return res.status(404).json({ error: 'Området hittades inte.' });
    res.json(detail);
  } catch (err) {
    next(err);
  }
});

// POST /api/study/sessions — starta ett pass.
// Body: { unitIds? | subject? | group?, term?, allTerms?, mode, levels?, count? }
router.post('/sessions', practiceLimiter, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (b.mode !== undefined && !MODES.includes(b.mode)) return bad(res, `mode must be one of: ${MODES.join(', ')}`);
    if (b.unitIds !== undefined && (!Array.isArray(b.unitIds) || b.unitIds.some((x) => typeof x !== 'string'))) {
      return bad(res, 'unitIds must be an array of ids');
    }
    if (b.levels !== undefined && (!Array.isArray(b.levels) || b.levels.some((l) => !LEVELS.includes(l)))) {
      return bad(res, 'levels must be a subset of E, C, A');
    }
    const result = await startSession(req.user.id, {
      unitIds: b.unitIds,
      subject: typeof b.subject === 'string' ? b.subject : undefined,
      group: typeof b.group === 'string' ? b.group : undefined,
      term: typeof b.term === 'string' ? b.term : undefined,
      allTerms: b.allTerms === true,
      mode: b.mode,
      levels: b.levels,
      count: b.count
    });
    if (result.error) return res.status(404).json({ error: result.message });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/study/sessions/:id/answer — Body: { itemId, answer? | self? }
// Rättas på servern; svaret innehåller facit och lösning.
router.post('/sessions/:id/answer', practiceLimiter, async (req, res, next) => {
  try {
    const { itemId, answer, self } = req.body || {};
    if (answer !== undefined && !(typeof answer === 'string' && answer.length <= 200) && !Number.isInteger(answer)) {
      return bad(res, 'answer must be a short string or a choice index');
    }
    if (self !== undefined && typeof self !== 'string') return bad(res, 'self must be a string');
    const access = await loadItem(req.user.id, itemId, 'read');
    if (access.error) return res.status(404).json({ error: 'Uppgiften hittades inte.' });
    const result = await answerInSession(req.user.id, req.params.id, access.item, access.unit, { answer, self });
    if (result.error) return res.status(404).json({ error: 'Passet är avslutat — starta ett nytt.' });
    if (result.invalid) return res.status(422).json({ invalid: true, message: result.message });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/study/sessions/:id/ping — aktiv lästid medan en genomgång är synlig.
router.post('/sessions/:id/ping', practiceLimiter, async (req, res, next) => {
  try {
    const result = await pingSession(req.user.id, req.params.id);
    if (result.error) return res.status(404).json({ error: 'Passet är avslutat.' });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/study/sessions/:id/finish — avsluta: sammanfattning, XP och streak.
router.post('/sessions/:id/finish', practiceLimiter, async (req, res, next) => {
  try {
    const result = await finishSession(req.user.id, req.params.id);
    if (result.error) return res.status(404).json({ error: 'Passet är redan avslutat.' });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/study/items/:id/flag — "Rapportera fel i facit". Body: { note }
// Går till områdets skapare, vars AI rättar via MCP. En öppen rapport per
// uppgift och elev — en ny rapport uppdaterar anteckningen.
router.post('/items/:id/flag', async (req, res, next) => {
  try {
    const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 500) : '';
    const access = await loadItem(req.user.id, req.params.id, 'read');
    if (access.error) return res.status(404).json({ error: 'Uppgiften hittades inte.' });
    await StudyFlag.updateOne(
      { item: access.item._id, reporter: req.user.id, status: 'open' },
      { $set: { note }, $setOnInsert: { unit: access.unit._id, owner: access.unit.user, createdAt: new Date() } },
      { upsert: true }
    );
    res.status(201).json({ flagged: true });
  } catch (err) {
    next(err);
  }
});

// ── Dela ─────────────────────────────────────────────────────────────────────
// Skaparen delar med kompisar eller via länk/QR (publika delen ligger i
// routes/studyInvites.js). Mottagarna övar med egen progress; bara skaparen
// kan ändra innehållet. Den som fått ett område delat kan lämna det.

// GET /api/study/units/:id/shares → { recipients, links }
router.get('/units/:id/shares', async (req, res, next) => {
  try {
    const unit = await ownedUnit(req, res);
    if (!unit) return;
    const [recipients, links] = await Promise.all([listRecipients(unit), listShareLinks(unit)]);
    res.json({ recipients, links });
  } catch (err) {
    next(err);
  }
});

// POST /api/study/units/:id/share — Body: { friendIds: [id] }
router.post('/units/:id/share', async (req, res, next) => {
  try {
    const { friendIds } = req.body || {};
    if (!Array.isArray(friendIds) || friendIds.length === 0 || friendIds.length > 100 || friendIds.some((x) => typeof x !== 'string')) {
      return bad(res, 'friendIds must be a non-empty array of ids');
    }
    const unit = await ownedUnit(req, res);
    if (!unit) return;
    const result = await shareWithFriends(req.user.id, unit, friendIds);
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/study/units/:id/share/:userId — ta bort en mottagare
router.delete('/units/:id/share/:userId', async (req, res, next) => {
  try {
    const unit = await ownedUnit(req, res);
    if (!unit) return;
    await removeRecipient(unit, req.params.userId);
    const fresh = await StudyUnit.findById(unit._id, 'sharedWith').lean();
    res.json({ recipients: await listRecipients(fresh) });
  } catch (err) {
    next(err);
  }
});

// POST /api/study/units/:id/leave — mottagaren lämnar ett delat område
router.post('/units/:id/leave', async (req, res, next) => {
  try {
    const access = await loadUnit(req.user.id, req.params.id, 'read');
    if (access.error) return res.status(404).json({ error: 'Området hittades inte.' });
    if (access.isOwner) return bad(res, 'Det här är ditt eget område — be din AI arkivera eller radera det.');
    await removeRecipient(access.unit, req.user.id);
    res.json({ left: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/study/units/:id/share-links — Body: { ttlDays: 1|7|30, maxUses: 10|30|100 }
router.post('/units/:id/share-links', shareLinkLimiter, async (req, res, next) => {
  try {
    const unit = await ownedUnit(req, res);
    if (!unit) return;
    const result = await createShareLink(req.user.id, unit, req.body || {});
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/study/units/:id/share-links/:code — stäng av en länk
router.delete('/units/:id/share-links/:code', async (req, res, next) => {
  try {
    const unit = await ownedUnit(req, res);
    if (!unit) return;
    if (!(await revokeShareLink(unit, req.params.code))) return res.status(404).json({ error: 'Länken hittades inte.' });
    res.json({ links: await listShareLinks(unit) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
