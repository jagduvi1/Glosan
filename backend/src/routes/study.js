const express = require('express');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const { ipKey } = require('../middleware/rateKeys');
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
  listRecipients, shareWithFriends, removeRecipient, createShareLink, listShareLinks, revokeShareLink, canRemove,
  loadShareableUnits, shareUnitsWithFriends, listMyShareLinks, revokeMyShareLink, MAX_UNITS_PER_SHARE, MAX_UNITS_PER_LINK
} = require('../services/study/sharing');
const { listFolders, folderDetail, createFolder, updateFolder, deleteFolder } = require('../services/study/folders');
const { friendsWithIt } = require('../services/sharedVia');
const { activityFor, todaySummary, effectiveStreak } = require('../services/study/activity');
const { testOverview, testSheet, startTest, submitTest, assessTest, attemptView } = require('../services/study/tests');
const { practiceSheet, SHEET_MODES } = require('../services/study/sheet');
const { deleteItems, listDeletions, restoreDeletion } = require('../services/study/itemDeletion');
const { PERIODS, parseYmd } = require('../utils/localTime');
const User = require('../models/User');

// Plugga — skolämnen. Dold bakom funktionsflaggan 'study' (config/features.js)
// tills modulen släpps. Innehållet skapas BARA via MCP (användarens egen AI);
// de här routerna läser, organiserar och tar emot övningssvar.
//
// Regel för hela modulen: Glosan anropar ALDRIG någon AI-API här. All
// AI-hjälp (skapa innehåll, rätta papperslösningar) sker i användarens egen
// AI via MCP. Se docs/plugga.md.

const router = express.Router();

// Plugga används i klassrum: en hel klass delar ofta EN IP-adress, och pass
// skickar ett anrop per svar (plus en "ping" var 30:e sekund medan en
// genomgång läses eller ett prov skrivs). De globala per-IP-limitrarna skulle
// strypa klassrummet, så hela /api/study är undantagen i app.js och begränsas
// här per inloggad användare i stället — efter flaggkollen, så en dold modul
// inte avslöjas av ett 429.
const studyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1500,
  keyGenerator: (req) => `u:${req.user.id}`,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'Lugn i stormen — vänta några minuter och fortsätt sedan plugga.' })
});

// Skydd mot översvämning från en adress (före inloggning och flaggkoll, som
// läser databasen). Högt tak: en hel skola kan dela IP, och bakom Cloudflare
// kan flera skolor dela kant-IP om proxykedjan inte ger rätt klient-IP.
const studyFloodLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1000,
  keyGenerator: ipKey,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'För många anrop just nu — vänta en minut.' })
});

router.use(studyFloodLimiter, requireAuth, requireFeature('study'), studyLimiter);

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
// Ett svar: text/tal som sträng, flervalsindex, eller en lista (flera rätta: index; ordna: texterna).
const isAnswerValue = (v, maxLen) => (typeof v === 'string' && v.length <= maxLen) || Number.isInteger(v)
  || (Array.isArray(v) && v.length <= 10 && v.every((x) => Number.isInteger(x) || (typeof x === 'string' && x.length <= 300)));
const isIdList = (v, max = 200) => v === undefined || (Array.isArray(v) && v.length <= max && v.every((x) => typeof x === 'string'));

/** Området om inloggad användare är skaparen, annars svarar den 404/403 och ger null. */
async function ownedUnit(req, res) {
  const access = await loadUnit(req.user.id, req.params.id, 'owner');
  if (access.error === 'forbidden') {
    res.status(403).json({ error: 'Bara den som skapade området kan göra det.' });
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

    const [bySubject, terms, readableIds, today, me] = await Promise.all([
      StudyUnit.aggregate([
        { $match: { ...readable, term } },
        { $group: { _id: '$subject', n: { $sum: 1 } } }
      ]),
      StudyUnit.distinct('term', readable),
      StudyUnit.distinct('_id', readable),
      todaySummary(req.user.id),
      User.findById(req.user.id).select('streak').lean()
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
      due,
      today,
      streak: effectiveStreak(me)
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/study/activity?period=day|week|month|term&date=YYYY-MM-DD — "Min plugg":
// tid, uppgifter och resultat per ämne och dag, och vad som gjorts (svensk tid).
router.get('/activity', async (req, res, next) => {
  try {
    const period = PERIODS.includes(req.query.period) ? req.query.period : 'week';
    const anchor = typeof req.query.date === 'string' && parseYmd(req.query.date) ? req.query.date : undefined;
    res.json(await activityFor(req.user.id, { period, anchor }));
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
// Body: { unitIds? | folderId? | subject? | group?, term?, allTerms?, mode, levels?, count? }
router.post('/sessions', async (req, res, next) => {
  try {
    const b = req.body || {};
    if (b.mode !== undefined && !MODES.includes(b.mode)) return bad(res, `mode must be one of: ${MODES.join(', ')}`);
    if (b.unitIds !== undefined && (!Array.isArray(b.unitIds) || b.unitIds.some((x) => typeof x !== 'string'))) {
      return bad(res, 'unitIds must be an array of ids');
    }
    if (b.folderId !== undefined && typeof b.folderId !== 'string') return bad(res, 'folderId must be an id');
    if (b.skills !== undefined && (!Array.isArray(b.skills) || b.skills.length > 10 || b.skills.some((x) => typeof x !== 'string' || x.length > 80))) {
      return bad(res, 'skills must be a short array of skill names');
    }
    if (b.levels !== undefined && (!Array.isArray(b.levels) || b.levels.some((l) => !LEVELS.includes(l)))) {
      return bad(res, 'levels must be a subset of E, C, A');
    }
    const result = await startSession(req.user.id, {
      unitIds: b.unitIds,
      folderId: b.folderId,
      skills: b.skills,
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

// GET /api/study/sheet?units=a,b | folder= | subject= | group=, term, allTerms=1,
// mode, levels=E,C, count, skill, exclude=id,id (redan utskrivna, "Nya uppgifter")
// — ett övningsblad att skriva ut: samma urval som ett pass, med facit. Inget
// pass skapas och inget räknas.
router.get('/sheet', async (req, res, next) => {
  try {
    const q = req.query;
    const str = (v, max = 80) => (typeof v === 'string' && v.length <= max ? v : undefined);
    const list = (v) => (str(v, 5000) ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined);
    if (q.mode !== undefined && !SHEET_MODES.includes(q.mode)) return bad(res, `mode must be one of: ${SHEET_MODES.join(', ')}`);
    const levels = list(q.levels);
    if (levels && levels.some((l) => !LEVELS.includes(l))) return bad(res, 'levels must be a subset of E, C, A');
    // Ett omfång som finns men inte går att läsa ger 400 — aldrig hela biblioteket.
    const unitIds = list(q.units);
    if (q.units !== undefined && !unitIds?.length) return bad(res, 'units must be a comma-separated list of ids');
    if (q.folder !== undefined && !str(q.folder, 40)) return bad(res, 'folder must be an id');
    const exclude = q.exclude === undefined ? [] : list(q.exclude);
    if (!exclude) return bad(res, 'exclude must be a comma-separated list of ids');
    const skill = str(q.skill);
    const result = await practiceSheet(req.user.id, {
      unitIds: unitIds?.slice(0, 50),
      exclude: exclude.filter((id) => /^[a-f0-9]{24}$/i.test(id)).slice(0, 200),
      folderId: str(q.folder, 40),
      subject: str(q.subject),
      group: str(q.group),
      term: str(q.term),
      allTerms: q.allTerms === '1',
      mode: q.mode,
      levels,
      count: str(q.count, 4),
      skills: skill ? [skill] : undefined
    });
    if (result.error) return res.status(404).json({ error: result.message });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/study/sessions/:id/answer — Body: { itemId, answer? | self?, seed? }
// (seed = mallövningens frö, se services/study/templates.js)
// Rättas på servern; svaret innehåller facit och lösning.
router.post('/sessions/:id/answer', async (req, res, next) => {
  try {
    const { itemId, answer, self, seed } = req.body || {};
    if (seed !== undefined && !(Number.isInteger(seed) && seed > 0)) return bad(res, 'seed must be a positive integer');
    if (answer !== undefined && !isAnswerValue(answer, 200)) {
      return bad(res, 'answer must be a short string, a choice index or a short list');
    }
    if (self !== undefined && typeof self !== 'string') return bad(res, 'self must be a string');
    const access = await loadItem(req.user.id, itemId, 'read');
    // Provfrågor rättas bara i ett prov — annars kunde ett övningspass visa provets facit.
    if (access.error || access.item.usage === 'test') return res.status(404).json({ error: 'Uppgiften hittades inte.' });
    const result = await answerInSession(req.user.id, req.params.id, access.item, access.unit, { answer, self, seed });
    if (result.error === 'already_answered') return res.status(409).json({ error: 'Du har redan svarat på den här uppgiften i passet.' });
    if (result.error === 'not_in_session') return res.status(404).json({ error: 'Uppgiften hör inte till det här passet.' });
    if (result.error) return res.status(404).json({ error: 'Passet är avslutat — starta ett nytt.' });
    if (result.invalid) return res.status(422).json({ invalid: true, message: result.message });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/study/sessions/:id/ping — aktiv lästid medan en genomgång är synlig.
router.post('/sessions/:id/ping', async (req, res, next) => {
  try {
    const result = await pingSession(req.user.id, req.params.id);
    if (result.error) return res.status(404).json({ error: 'Passet är avslutat.' });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/study/sessions/:id/finish — avsluta: sammanfattning, XP och streak.
router.post('/sessions/:id/finish', async (req, res, next) => {
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

// ── Ta bort uppgifter ────────────────────────────────────────────────────────
// Skaparen kan ta bort kort och övningar hen inte tycker är bra (papperskorgen
// i appen). Allt som tas bort loggas under "Borttaget" och kan ångras.

// DELETE /api/study/items/:id
router.delete('/items/:id', async (req, res, next) => {
  try {
    const access = await loadItem(req.user.id, req.params.id, 'owner');
    if (access.error === 'forbidden') return res.status(403).json({ error: 'Bara den som skapade området kan ta bort uppgifter. Rapportera felet i stället.' });
    if (access.error) return res.status(404).json({ error: 'Uppgiften hittades inte.' });
    const [code] = await deleteItems(access.unit, [access.item], { userId: req.user.id, via: 'app' });
    res.json({ deleted: code });
  } catch (err) {
    next(err);
  }
});

// GET /api/study/units/:id/deletions — "Borttaget" (bara skaparen)
router.get('/units/:id/deletions', async (req, res, next) => {
  try {
    const unit = await ownedUnit(req, res);
    if (!unit) return;
    res.json({ deletions: await listDeletions(unit, req.user.id) });
  } catch (err) {
    next(err);
  }
});

// POST /api/study/units/:id/deletions/:deletionId/restore — ångra
router.post('/units/:id/deletions/:deletionId/restore', async (req, res, next) => {
  try {
    const unit = await ownedUnit(req, res);
    if (!unit) return;
    const result = await restoreDeletion(unit, req.params.deletionId);
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json({ restored: result.code, deletions: await listDeletions(unit, req.user.id) });
  } catch (err) {
    next(err);
  }
});

// ── Övningsprov ──────────────────────────────────────────────────────────────
// Skapas av AI:n (create_practice_test). Eleven gör provet i appen — rättas
// här, öppna frågor bedömer eleven själv efter inlämning — eller på papper,
// som elevens AI rättar via MCP (record_paper_test). Facit visas först när
// provet är klart.

// GET /api/study/tests/attempts/:id — resultatet av ett försök
router.get('/tests/attempts/:id', async (req, res, next) => {
  try {
    const view = await attemptView(req.user.id, req.params.id);
    if (!view) return res.status(404).json({ error: 'Resultatet hittades inte.' });
    res.json(view);
  } catch (err) {
    next(err);
  }
});

// POST /api/study/tests/attempts/:id/submit — Body: { answers: [{ itemId, answer }] }
router.post('/tests/attempts/:id/submit', async (req, res, next) => {
  try {
    const { answers, lenient } = req.body || {};
    if (!Array.isArray(answers) || answers.length > 60) return bad(res, 'answers must be an array');
    if (lenient !== undefined && typeof lenient !== 'boolean') return bad(res, 'lenient must be a boolean');
    for (const a of answers) {
      if (!a || typeof a.itemId !== 'string') return bad(res, 'every answer needs an itemId');
      if (a.answer !== undefined && a.answer !== null && !isAnswerValue(a.answer, 2000)) {
        return bad(res, 'answer must be a string, a choice index or a short list');
      }
    }
    const result = await submitTest(req.user.id, req.params.id, answers, { lenient: lenient === true });
    if (result.error) return res.status(404).json({ error: 'Provet är redan inlämnat.' });
    if (result.invalid) return res.status(422).json({ invalid: result.invalid });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/study/tests/attempts/:id/assess — Body: { assessments: [{ itemId, level: none|E|C|A }] }
router.post('/tests/attempts/:id/assess', async (req, res, next) => {
  try {
    const { assessments } = req.body || {};
    if (!Array.isArray(assessments) || assessments.length > 60) return bad(res, 'assessments must be an array');
    const result = await assessTest(req.user.id, req.params.id, assessments);
    if (result.error) return res.status(404).json({ error: 'Provet är redan klart.' });
    if (result.missing) return res.status(400).json({ error: `Bedöm alla öppna frågor (${result.missing.join(', ')}).`, missing: result.missing });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/study/tests/:id — provet, betygsgränserna och mina försök
router.get('/tests/:id', async (req, res, next) => {
  try {
    const overview = await testOverview(req.user.id, req.params.id);
    if (!overview) return res.status(404).json({ error: 'Provet hittades inte.' });
    res.json(overview);
  } catch (err) {
    next(err);
  }
});

// GET /api/study/tests/:id/sheet — provet att skriva ut (utan facit)
router.get('/tests/:id/sheet', async (req, res, next) => {
  try {
    const sheet = await testSheet(req.user.id, req.params.id);
    if (!sheet) return res.status(404).json({ error: 'Provet hittades inte.' });
    res.json(sheet);
  } catch (err) {
    next(err);
  }
});

// POST /api/study/tests/:id/start — starta (eller fortsätt ett påbörjat) prov
router.post('/tests/:id/start', async (req, res, next) => {
  try {
    const result = await startTest(req.user.id, req.params.id);
    if (!result) return res.status(404).json({ error: 'Provet hittades inte.' });
    if (result.error) return res.status(409).json({ error: 'Provet har inga frågor.' });
    res.status(result.attempt.resumed ? 200 : 201).json(result);
  } catch (err) {
    next(err);
  }
});

// ── Mappar ───────────────────────────────────────────────────────────────────
// Elevens egna grupperingar av områden (egna + delade), tvärs över ämnen och
// terminer. Att radera en mapp rör aldrig områdena.

router.get('/folders', async (req, res, next) => {
  try {
    res.json({ folders: await listFolders(req.user.id) });
  } catch (err) {
    next(err);
  }
});

// POST /api/study/folders — Body: { name, color?, unitIds? }
router.post('/folders', async (req, res, next) => {
  try {
    const { name, color, unitIds } = req.body || {};
    if (typeof name !== 'string') return bad(res, 'name is required');
    if (!isIdList(unitIds)) return bad(res, 'unitIds must be an array of ids');
    const result = await createFolder(req.user.id, { name, color, unitIds });
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/folders/:id', async (req, res, next) => {
  try {
    const detail = await folderDetail(req.user.id, req.params.id);
    if (!detail) return res.status(404).json({ error: 'Mappen hittades inte.' });
    res.json(detail);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/study/folders/:id — Body: { name?, color?, addUnitIds?, removeUnitIds? }
router.patch('/folders/:id', async (req, res, next) => {
  try {
    const { name, color, addUnitIds, removeUnitIds } = req.body || {};
    if (name !== undefined && typeof name !== 'string') return bad(res, 'name must be a string');
    if (color !== undefined && color !== null && typeof color !== 'string') return bad(res, 'color must be a string');
    if (!isIdList(addUnitIds) || !isIdList(removeUnitIds)) return bad(res, 'addUnitIds/removeUnitIds must be arrays of ids');
    const result = await updateFolder(req.user.id, req.params.id, { name, color, addUnitIds, removeUnitIds });
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.delete('/folders/:id', async (req, res, next) => {
  try {
    if (!(await deleteFolder(req.user.id, req.params.id))) return res.status(404).json({ error: 'Mappen hittades inte.' });
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

// ── Dela ─────────────────────────────────────────────────────────────────────
// Alla som har ett område kan dela det vidare — med kompisar eller via
// länk/QR (publika delen ligger i routes/studyInvites.js). Mottagarna övar med
// egen progress; bara skaparen kan ändra innehållet. Skaparen ser alla och kan
// ta bort vem som helst; den som delat vidare ser och tar bort dem hen själv
// lagt till. Den som fått ett område delat kan lämna det.

/** Området om inloggad användare har det (eget eller delat), annars 404 och null. */
async function readableUnit(req, res) {
  const access = await loadUnit(req.user.id, req.params.id, 'read');
  if (access.error) {
    res.status(404).json({ error: 'Området hittades inte.' });
    return null;
  }
  return access.unit;
}

// GET /api/study/units/:id/shares → { recipients, links, isOwner, friendsWithIt }
// (friendsWithIt = mina kompisar som redan har området, så Dela inte erbjuder dem)
router.get('/units/:id/shares', async (req, res, next) => {
  try {
    const unit = await readableUnit(req, res);
    if (!unit) return;
    const [recipients, links, friends] = await Promise.all([
      listRecipients(unit, req.user.id), listShareLinks(unit, req.user.id), friendsWithIt(unit, req.user.id)
    ]);
    res.json({ recipients, links, isOwner: String(unit.user) === String(req.user.id), friendsWithIt: friends });
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
    const unit = await readableUnit(req, res);
    if (!unit) return;
    const result = await shareWithFriends(req.user.id, unit, friendIds);
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/study/units/:id/share/:userId — ta bort en mottagare (skaparen:
// vem som helst; andra: bara dem de själva lagt till)
router.delete('/units/:id/share/:userId', async (req, res, next) => {
  try {
    const unit = await readableUnit(req, res);
    if (!unit) return;
    if (!canRemove(unit, req.user.id, req.params.userId)) return res.status(404).json({ error: 'Personen hittades inte.' });
    await removeRecipient(unit, req.params.userId);
    const fresh = await StudyUnit.findById(unit._id, 'user sharedWith sharedVia').lean();
    res.json({ recipients: await listRecipients(fresh, req.user.id) });
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
    const unit = await readableUnit(req, res);
    if (!unit) return;
    const result = await createShareLink(req.user.id, unit, req.body || {});
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// ── Dela flera områden på en gång (Plugga-sidornas Dela: ett kapitel, en mapp) ──

const idArray = (v, max) => Array.isArray(v) && v.length > 0 && v.length <= max && v.every((x) => typeof x === 'string');
const NOT_OWN = 'Du kan bara dela områden du har (inte arkiverade).';

// POST /api/study/share — Body: { unitIds: [id], friendIds: [id] } → { units, friends, added }
router.post('/share', async (req, res, next) => {
  try {
    const { unitIds, friendIds } = req.body || {};
    if (!idArray(unitIds, MAX_UNITS_PER_SHARE)) return bad(res, `unitIds must be 1–${MAX_UNITS_PER_SHARE} ids`);
    if (!idArray(friendIds, 100)) return bad(res, 'friendIds must be a non-empty array of ids');
    const units = await loadShareableUnits(req.user.id, unitIds);
    if (!units) return res.status(404).json({ error: NOT_OWN });
    const result = await shareUnitsWithFriends(req.user.id, units, friendIds);
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/study/share-links → { links } — mina aktiva länkar, med områdena de gäller
router.get('/share-links', async (req, res, next) => {
  try {
    res.json({ links: await listMyShareLinks(req.user.id) });
  } catch (err) {
    next(err);
  }
});

// POST /api/study/share-links — Body: { unitIds: [id], ttlDays, maxUses, title? } → EN länk för alla
router.post('/share-links', shareLinkLimiter, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!idArray(b.unitIds, MAX_UNITS_PER_LINK)) return bad(res, `unitIds must be 1–${MAX_UNITS_PER_LINK} ids`);
    if (b.title !== undefined && b.title !== null && (typeof b.title !== 'string' || b.title.length > 100)) {
      return bad(res, 'title must be at most 100 characters');
    }
    const units = await loadShareableUnits(req.user.id, b.unitIds);
    if (!units) return res.status(404).json({ error: NOT_OWN });
    const result = await createShareLink(req.user.id, units, b);
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/study/share-links/:code — stäng av en av mina länkar
router.delete('/share-links/:code', async (req, res, next) => {
  try {
    if (!(await revokeMyShareLink(req.user.id, req.params.code))) return res.status(404).json({ error: 'Länken hittades inte.' });
    res.json({ links: await listMyShareLinks(req.user.id) });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/study/units/:id/share-links/:code — stäng av en länk (sin egen;
// skaparen av området även andras länkar till det)
router.delete('/units/:id/share-links/:code', async (req, res, next) => {
  try {
    const unit = await readableUnit(req, res);
    if (!unit) return;
    if (!(await revokeShareLink(unit, req.params.code, req.user.id))) return res.status(404).json({ error: 'Länken hittades inte.' });
    res.json({ links: await listShareLinks(unit, req.user.id) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
