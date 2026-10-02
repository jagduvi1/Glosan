const express = require('express');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { previewInvite, acceptInvite } = require('../services/study/sharing');

// Delningslänkar till områden i Plugga (/p/<kod>, QR-koden). Förhandsvisningen
// är publik, precis som /j/-länkarna för glos-listor, och att gå med kräver
// bara inloggning — INTE Plugga-flaggan: den som bjuds in får Plugga påslaget
// när hen går med (inbjudningsbeta, services/study/sharing.js).
//
// Monteras på /api FÖRE glosor.js, som kräver inloggning för hela /api.

const router = express.Router();

const GONE = 'Den här länken är ogiltig eller har gått ut.';

// GET /api/study-invite/:code — publik förhandsvisning. Inloggad visas samma
// urval som man får när man går med (utan områden man inte kan få).
router.get('/study-invite/:code', optionalAuth, async (req, res, next) => {
  try {
    const preview = await previewInvite(req.params.code, req.user?.id);
    if (!preview) return res.status(404).json({ error: GONE });
    res.json(preview);
  } catch (err) {
    next(err);
  }
});

// POST /api/study-invite/:code/accept — gå med (läggs till i områdets sharedWith)
router.post('/study-invite/:code/accept', requireAuth, async (req, res, next) => {
  try {
    const result = await acceptInvite(req.user.id, req.params.code);
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
