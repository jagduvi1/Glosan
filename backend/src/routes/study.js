const express = require('express');
const mongoose = require('mongoose');
const { requireAuth } = require('../middleware/auth');
const { requireFeature } = require('../middleware/feature');
const StudyUnit = require('../models/StudyUnit');
const { SUBJECTS, SUBJECT_GROUPS } = require('../config/subjects');
const { termFor, isValidTerm, termLabel, compareTerms } = require('../utils/term');

// Plugga — skolämnen. Dold bakom funktionsflaggan 'study' (config/features.js)
// tills modulen släpps. Innehållet skapas BARA via MCP (användarens egen AI);
// de här routerna läser, organiserar och tar emot övningssvar.
//
// Regel för hela modulen: Glosan anropar ALDRIG någon AI-API här. All
// AI-hjälp (skapa innehåll, rätta papperslösningar) sker i användarens egen
// AI via MCP. Se docs/plugga.md.

const router = express.Router();

router.use(requireAuth, requireFeature('study'));

// GET /api/study/overview?term=2026-HT — startsidan: ämnen med antal områden
// för terminen (egna + delade med mig) och vilka terminer som finns.
router.get('/overview', async (req, res, next) => {
  try {
    const current = termFor();
    const term = isValidTerm(req.query.term) ? req.query.term : current;
    const userId = new mongoose.Types.ObjectId(req.user.id);
    const readable = { $or: [{ user: userId }, { sharedWith: userId }], archivedAt: null };

    const [bySubject, terms] = await Promise.all([
      StudyUnit.aggregate([
        { $match: { ...readable, term } },
        { $group: { _id: '$subject', n: { $sum: 1 } } }
      ]),
      StudyUnit.distinct('term', readable)
    ]);
    const countBy = new Map(bySubject.map((r) => [r._id, r.n]));
    const allTerms = [...new Set([current, term, ...terms])].sort(compareTerms).reverse();

    res.json({
      term,
      termLabel: termLabel(term),
      currentTerm: current,
      terms: allTerms.map((t) => ({ key: t, label: termLabel(t) })),
      groups: Object.values(SUBJECT_GROUPS),
      subjects: SUBJECTS.map((s) => ({ ...s, unitCount: countBy.get(s.key) || 0 }))
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
